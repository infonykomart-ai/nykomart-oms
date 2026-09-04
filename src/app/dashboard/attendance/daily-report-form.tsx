"use client";

// Daily Work Report — direct equivalent of the old standalone "NYKO MART
// Work & Performance" Apps Script tool's DailyLogs entry form, rebuilt
// against Postgres. "JESE JESE WORK DALTE JAYE AUTO SYNC HOYE AGAR GALTI SE
// REFRESH HO TO JO LIKHA HAI VO VESA HI RAHE":
//   - Every keystroke immediately mirrors the row into localStorage
//     (synchronous, no network) — this alone is what makes a refresh safe,
//     independent of whether the debounced server save has fired yet.
//   - 1.1s after the last keystroke anywhere in a row, that row
//     auto-saves to the server (upsertDailyLog). Blurring a field (e.g.
//     clicking Logout, which moves focus away first) also saves
//     immediately rather than waiting out the debounce.
//   - On page load, any localStorage draft not yet reflected on the server
//     (or newer than the server's own updated_at) is restored into the
//     form and immediately re-saved — so a refresh mid-typing never loses
//     text, even if the debounce hadn't fired yet before the reload.
//
// 2026-08-11 (round 2): "SUBMIT REPORT VALE SECTION ME ESTIMATE TIME KA
// OPTION HAI TO USKI JAGH PAR WATCH LAGA DO KITNE BAJE START KIYA KITNE
// BAJE WORK KHATM KIYA" — a real watch on each row, replacing the old
// free-text Estimated Time field.
//
// 2026-08-11 (round 3): "start & pause button ko remove karo or sirf
// start time ka option ho ... submit report ka option ho" — Start/Pause
// toggling replaced with Start once + Submit once.
//
// 2026-08-11 (round 4): "daily work vale section se bhi start button ko
// hatane ko bola tha yaha manual entry ka option rakhna tha, estimate
// time me hour or minut ka colom ho kitna estimate time laga, dusra
// option rakhna tha ki kitna time consume kiya hour & minut" — the
// automatic Start button + live timer is gone entirely for this table.
// Replaced with two manual Hours + Minutes entry pairs: Estimated Time
// (how long the work is expected to take) and Time Consumed (how long it
// actually took). ✔ Submit Report still finalizes the row the same way.
import { useEffect, useRef, useState } from "react";
import { upsertDailyLog, deleteDailyLog, saveAndSubmitDailyLog } from "./actions";
import { formatDuration, formatISTTime } from "@/lib/attendance/timer";

// 2026-08-17 — "TEAM WORK REPORT ME YE WORK OR UPDATE KARNE HAI" added a
// batch of Etsy/marketplace-specific Work Type options. Appended after the
// original list rather than merged into look-alike existing entries (e.g.
// "Tracking Check" vs. the pre-existing "Tracking Update & Check", "Update
// Social Media" vs. "Social Media") — deliberately not guessing which ones
// are meant to replace/merge with an existing option, since that's a real
// business decision, not a wording cleanup; both stay selectable until
// confirmed otherwise.
const CATEGORIES = [
  "Technical Work", "Tracking Update & Check", "Inventory Management", "Product Photography",
  "Product Uploading", "Listing Update", "Photo Edit", "Video Edit", "SEO", "Content / Blog",
  "Social Media", "Order Management", "Mail & Inbox", "Accounts & Billing", "Shipping & Customs",
  "Vendor & Stock", "Admin / Communication",
  "Tracking Update", "Shipment Dispatch Process (Invoicing, Booking, Data Manage)", "Etsy Report",
  "Mail to Inquiry", "Follow Etsy User", "Link Submission", "Ads Work", "Other Work", "Tracking Check",
  "Order Update & Sheet Update (All Etsy Three Portals)", "Vendor Date", "Update Social Media",
  "Other Work Language Update", "New Listing", "Update Listing New",
  "Other",
];
const WORK_STATUSES = ["Pending", "In Progress", "Completed", "Next Day Carry On"];
// "Carried Forward" is deliberately NOT in WORK_STATUSES above — it's a
// terminal, system-set status (only ever written by carryForwardDailyLog,
// see the Incomplete Work section), never a manually-selectable option in
// this dropdown.
// 2026-09-01 — "Today's Work -> Carry Forward": Priority didn't exist on
// this table before — same Low/Medium/High/Urgent shape as tasks.priority
// (the sibling Task Assignment feature on this same page).
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const DRAFT_KEY = "oms_daily_report_draft_v1";

type LogRow = {
  clientId: string;
  id: string | null;
  logDate: string;
  category: string;
  description: string;
  targetQty: string;
  qtyDone: string;
  workStatus: string;
  remarkSku: string;
  serverUpdatedAt: string | null;
  // Manual Hour/Minute entry pairs — kept as separate string fields so an
  // empty box doesn't get coerced to "0" while the person is still typing.
  estimatedHours: string;
  estimatedMinutes: string;
  consumedHours: string;
  consumedMinutes: string;
  carriedFromLogId: string | null;
  submittedAt: string | null;
  priority: string;
  carriedToDate: string | null;
};

type ServerLog = {
  id: string;
  log_date: string;
  category: string | null;
  description: string | null;
  target_qty: string | null;
  qty_done: string | null;
  work_status: string | null;
  remark_sku: string | null;
  updated_at: string;
  time_spent_seconds: number;
  estimated_time_minutes: number | null;
  carried_from_log_id: string | null;
  submitted_at: string | null;
  priority: string;
  carried_to_date: string | null;
};

function splitHM(totalMinutes: number): { h: string; m: string } {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { h: h ? String(h) : "", m: m ? String(m) : "" };
}

function fromServer(l: ServerLog): LogRow {
  const consumed = splitHM(Math.round((l.time_spent_seconds ?? 0) / 60));
  const estimated = splitHM(l.estimated_time_minutes ?? 0);
  return {
    clientId: l.id,
    id: l.id,
    logDate: l.log_date,
    category: l.category ?? CATEGORIES[0],
    description: l.description ?? "",
    targetQty: l.target_qty ?? "",
    qtyDone: l.qty_done ?? "",
    workStatus: l.work_status ?? "In Progress",
    remarkSku: l.remark_sku ?? "",
    serverUpdatedAt: l.updated_at,
    estimatedHours: estimated.h,
    estimatedMinutes: estimated.m,
    consumedHours: consumed.h,
    consumedMinutes: consumed.m,
    carriedFromLogId: l.carried_from_log_id,
    submittedAt: l.submitted_at,
    priority: l.priority || "Medium",
    carriedToDate: l.carried_to_date,
  };
}

function blankRow(today: string): LogRow {
  return {
    clientId: "new_" + Math.random().toString(36).slice(2, 9),
    id: null,
    logDate: today,
    category: CATEGORIES[0],
    description: "",
    targetQty: "",
    qtyDone: "",
    workStatus: "In Progress",
    remarkSku: "",
    serverUpdatedAt: null,
    estimatedHours: "",
    estimatedMinutes: "",
    consumedHours: "",
    consumedMinutes: "",
    carriedFromLogId: null,
    submittedAt: null,
    priority: "Medium",
    carriedToDate: null,
  };
}

// 2026-08-17: "8:15 minut pure din kaam chahiye ... 10 ghnte 50 ghnate to
// alert aajaye" — root cause of an absurd Time Consumed value (10h, 50h):
// the Hours box below had NO upper bound at all (only Minutes was capped
// at 59), so a typo like "50" instead of "5" sailed straight through.
// 24 is a hard ceiling (can't work more hours than exist in a day) — the
// separate, softer "past 9h looks wrong" alert (see work-hours.ts) still
// applies well below this for anything that's merely unusual rather than
// impossible.
const MAX_HOURS_PER_ROW = 24;

function hmToMinutes(h: string, m: string): number {
  return Math.max(0, Math.min(MAX_HOURS_PER_ROW, parseInt(h, 10) || 0)) * 60 + Math.max(0, Math.min(59, parseInt(m, 10) || 0));
}

function loadDraftMap(): Record<string, LogRow & { savedLocallyAt: number }> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function persistDraftMap(map: Record<string, LogRow & { savedLocallyAt: number }>) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable (private mode, quota) — the debounced
    // server save is still the primary path, this is just extra safety.
  }
}

export function DailyReportForm({
  editableLogs,
  today,
  minDate,
}: {
  // 2026-09-02: "agar employee back date me report submit kare to iska koi
  // option nahi hai" — this now carries every not-yet-submitted-or-recent
  // row across the whole backdate window (today and the 6 days before it),
  // not just today's rows. Each row still shows/edits its own Date field
  // (see the Field label="Date" below), clamped to [minDate, today].
  editableLogs: ServerLog[];
  recentLogs: ServerLog[];
  today: string;
  minDate: string;
}) {
  const [rows, setRows] = useState<LogRow[]>(() => {
    const serverRows = editableLogs.map(fromServer);
    if (typeof window === "undefined") return serverRows.length ? serverRows : [blankRow(today)];

    // Merge in any localStorage draft that's newer than (or has no) server
    // counterpart. Only relevant for still-editable rows — a submitted row
    // is finalized server-side, so its own draft entry (if any leftover)
    // is never restored over it.
    const draftMap = loadDraftMap();
    const merged = new Map(serverRows.map((r) => [r.clientId, r]));
    for (const key of Object.keys(draftMap)) {
      const draft = draftMap[key];
      if (draft.logDate < minDate || draft.logDate > today || draft.submittedAt) continue;
      // A row's clientId is "new_xxx" only until its FIRST save — once it
      // has a server id, fromServer() re-keys it by that id (see below),
      // but the localStorage entry for it is still sitting under the old
      // "new_xxx" key. Resolve to the row's real identity (server id once
      // it has one, else its own clientId) and both read AND write under
      // that same resolved key — otherwise a draft saved once, then
      // refreshed, gets added as a SECOND card sharing one server id
      // instead of replacing the original.
      const mapKey = draft.id ?? draft.clientId;
      const serverRow = merged.get(mapKey);
      if (serverRow?.submittedAt) continue;
      const draftIsNewer = !serverRow || (!serverRow.serverUpdatedAt || draft.savedLocallyAt > new Date(serverRow.serverUpdatedAt).getTime());
      if (draftIsNewer) {
        merged.set(mapKey, { ...draft, clientId: mapKey });
      }
    }
    const result = Array.from(merged.values());
    return result.length ? result : [blankRow(today)];
  });

  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [submitPendingIds, setSubmitPendingIds] = useState<Set<string>>(new Set());
  // 2026-08-11 (round 3 review fix): surface a failed save/submit instead
  // of silently discarding it — e.g. a save that lost a race against
  // submitDailyLog and got rejected by the server-side
  // .is("submitted_at", null) guard.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Mirror every DRAFT row change into localStorage immediately
  // (synchronous, no network) — this is what actually makes a refresh
  // mid-typing safe. Submitted rows are finalized, nothing to mirror.
  useEffect(() => {
    const map: Record<string, LogRow & { savedLocallyAt: number }> = {};
    for (const r of rows) {
      if (!r.submittedAt && (r.description.trim() || r.category !== CATEGORIES[0])) {
        map[r.clientId] = { ...r, savedLocallyAt: Date.now() };
      }
    }
    persistDraftMap(map);
  }, [rows]);

  function updateRow(clientId: string, patch: Partial<LogRow>) {
    setRows((prev) => prev.map((r) => (r.clientId === clientId ? { ...r, ...patch } : r)));
    scheduleSave(clientId);
  }

  function scheduleSave(clientId: string) {
    if (debounceTimers.current[clientId]) clearTimeout(debounceTimers.current[clientId]);
    debounceTimers.current[clientId] = setTimeout(() => saveRow(clientId), 1100);
  }

  async function saveRow(clientId: string): Promise<string | null> {
    const row = rowsRef.current.find((r) => r.clientId === clientId);
    if (!row || row.submittedAt || !row.description.trim()) return row?.id ?? null; // nothing worth saving yet, or already finalized
    if (debounceTimers.current[clientId]) {
      clearTimeout(debounceTimers.current[clientId]);
      delete debounceTimers.current[clientId];
    }
    setSavingIds((prev) => new Set(prev).add(clientId));
    const estimatedTotal = hmToMinutes(row.estimatedHours, row.estimatedMinutes);
    const consumedTotal = hmToMinutes(row.consumedHours, row.consumedMinutes);
    const result = await upsertDailyLog({
      id: row.id ?? undefined,
      logDate: row.logDate,
      category: row.category,
      description: row.description,
      targetQty: row.targetQty,
      qtyDone: row.qtyDone,
      workStatus: row.workStatus,
      remarkSku: row.remarkSku,
      estimatedTimeMinutes: estimatedTotal ? String(estimatedTotal) : "",
      timeSpentMinutes: consumedTotal ? String(consumedTotal) : "",
      priority: row.priority,
    });
    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    if (result.id) {
      setRows((prev) =>
        prev.map((r) => (r.clientId === clientId ? { ...r, id: result.id, serverUpdatedAt: result.updatedAt } : r))
      );
      setRowErrors((prev) => {
        if (!(clientId in prev)) return prev;
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
    } else if (result.error) {
      setRowErrors((prev) => ({ ...prev, [clientId]: result.error as string }));
    }
    return result.id;
  }

  async function removeRow(clientId: string) {
    const row = rows.find((r) => r.clientId === clientId);
    if (row?.submittedAt) return; // finalized — nothing to remove
    setRows((prev) => {
      const next = prev.filter((r) => r.clientId !== clientId);
      return next.length ? next : [blankRow(today)];
    });
    if (row?.id) await deleteDailyLog(row.id);
  }

  async function handleSubmit(clientId: string) {
    const row = rowsRef.current.find((r) => r.clientId === clientId);
    if (!row || !row.description.trim()) return; // nothing to submit
    // 2026-08-24 — "submit button single click me work karna chahiye bahut
    // hang hota hai" fix, client half: disable the button and flip its
    // label to "Submitting…" THE INSTANT it's clicked, before any network
    // call starts (previously this only happened after a first full
    // save-request had already resolved, leaving a window where a second
    // click fired a duplicate, overlapping submit). Also cancel any pending
    // debounced auto-save for this row — saveAndSubmitDailyLog below sends
    // the row's current values itself in one combined request, so the old
    // separate saveRow() flush is no longer needed here.
    if (debounceTimers.current[clientId]) {
      clearTimeout(debounceTimers.current[clientId]);
      delete debounceTimers.current[clientId];
    }
    setSubmitPendingIds((prev) => new Set(prev).add(clientId));
    const estimatedTotal = hmToMinutes(row.estimatedHours, row.estimatedMinutes);
    const consumedTotal = hmToMinutes(row.consumedHours, row.consumedMinutes);
    const result = await saveAndSubmitDailyLog({
      id: row.id ?? undefined,
      logDate: row.logDate,
      category: row.category,
      description: row.description,
      targetQty: row.targetQty,
      qtyDone: row.qtyDone,
      workStatus: row.workStatus,
      remarkSku: row.remarkSku,
      estimatedTimeMinutes: estimatedTotal ? String(estimatedTotal) : "",
      timeSpentMinutes: consumedTotal ? String(consumedTotal) : "",
      priority: row.priority,
    });
    setSubmitPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    if (!result.error) {
      setRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId ? { ...r, id: result.id ?? r.id, submittedAt: result.submittedAt } : r
        )
      );
      setRowErrors((prev) => {
        if (!(clientId in prev)) return prev;
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
    } else {
      setRowErrors((prev) => ({ ...prev, [clientId]: result.error as string }));
    }
  }

  // 2026-09-04: "aaj ka kaam or pichle 6 din ka backdated kaam ek hi flat
  // list me mix ho ke aa raha hai, samajh nahi aata" — split the same
  // `rows` array (still one source of truth, still the full 7-day
  // editable/backdate window — this is a display/grouping change only,
  // backdating itself keeps working exactly as before) into TODAY's
  // entries (shown by default) and the last 6 days' entries (collapsed by
  // default, in their own clearly-labeled section below). A fresh blank
  // row and "+ Add more work" both default logDate to `today`, so they
  // always land in the always-visible group, never inside the collapsed
  // one.
  const todayRows = rows.filter((row) => row.logDate === today);
  const backdatedRows = rows.filter((row) => row.logDate !== today);

  function renderRow(row: LogRow) {
    return row.submittedAt ? (
          // 2026-09-01: a "Carried Forward" row is ALSO finalized/read-only
          // (submittedAt gets set by carryForwardDailyLog specifically so
          // it's visible everywhere else on this table's submitted_at IS
          // NOT NULL filters — Report History, My Recent Reports, the
          // Admin Team Daily Work Log) but it is NOT a completed report —
          // give it its own purple badge instead of the green "✓
          // Submitted" one, so the two are never confused at a glance.
          <div key={row.clientId} className={`rounded-xl border p-4 ${row.workStatus === "Carried Forward" ? "border-purple-200 bg-purple-50/40" : "border-green-200 bg-green-50/40"}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs">
                {row.carriedFromLogId && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">Carried from yesterday</span>}
                {row.workStatus === "Carried Forward" ? (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700">
                    ↪ Carried Forward{row.carriedToDate ? ` to ${row.carriedToDate}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                    ✓ Submitted at {formatISTTime(row.submittedAt)}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
              <div><span className="text-slate-400">Date:</span> {row.logDate}{row.logDate !== today && <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700">Backdated</span>}</div>
              <div><span className="text-slate-400">Work Type:</span> {row.category}</div>
              <div><span className="text-slate-400">Priority:</span> {row.priority}</div>
              <div><span className="text-slate-400">Target Qty:</span> {row.targetQty || "—"}</div>
              <div><span className="text-slate-400">Qty Done:</span> {row.qtyDone || "—"}</div>
              <div><span className="text-slate-400">Status:</span> {row.workStatus}</div>
              <div><span className="text-slate-400">Remark/SKU (Notes):</span> {row.remarkSku || "—"}</div>
              <div><span className="text-slate-400">Estimated Time (guess, not counted):</span> {formatDuration(hmToMinutes(row.estimatedHours, row.estimatedMinutes) * 60)}</div>
              <div><span className="text-slate-400">Time Consumed (counted):</span> {formatDuration(hmToMinutes(row.consumedHours, row.consumedMinutes) * 60)}</div>
            </div>
            <p className="mt-2 whitespace-pre-line text-xs text-slate-700">{row.description}</p>
          </div>
        ) : (
          <div key={row.clientId} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {row.carriedFromLogId && <span className="mr-2 rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">Carried from yesterday</span>}
                {savingIds.has(row.clientId) ? "Saving..." : row.id ? "Saved (draft)" : "Not saved yet — start typing"}
              </span>
              <button type="button" onClick={() => removeRow(row.clientId)} className="text-xs text-rose-600 hover:underline">
                Remove
              </button>
            </div>
            {rowErrors[row.clientId] && (
              <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{rowErrors[row.clientId]}</p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {/* 2026-09-02: "agar employee back date me report submit kare
                  to iska koi option nahi hai" — a not-yet-submitted row's
                  Date is now editable, clamped to the last 7 days
                  (today included). Defaults to today for a fresh row. */}
              <Field label="Date">
                <input
                  type="date"
                  value={row.logDate}
                  min={minDate}
                  max={today}
                  onChange={(e) => updateRow(row.clientId, { logDate: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={inputClass}
                />
              </Field>
              <Field label="Work Type">
                <select
                  value={row.category}
                  onChange={(e) => updateRow(row.clientId, { category: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={selectClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Target Qty">
                <input
                  value={row.targetQty}
                  onChange={(e) => updateRow(row.clientId, { targetQty: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={inputClass}
                  placeholder="e.g. 15"
                />
              </Field>
              <Field label="Qty Done">
                <input
                  value={row.qtyDone}
                  onChange={(e) => updateRow(row.clientId, { qtyDone: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={inputClass}
                  placeholder="e.g. 12"
                />
              </Field>
              <Field label="Work Status">
                <select
                  value={row.workStatus}
                  onChange={(e) => updateRow(row.clientId, { workStatus: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={selectClass}
                >
                  {WORK_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Remark / SKU (Notes)">
                <input
                  value={row.remarkSku}
                  onChange={(e) => updateRow(row.clientId, { remarkSku: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={inputClass}
                  placeholder="optional"
                />
              </Field>
              {/* 2026-09-01 — "Today's Work -> Carry Forward": Priority
                  didn't exist on this table before, added alongside Work
                  Type/Expected Time/Notes/Status per the owner's spec. */}
              <Field label="Priority">
                <select
                  value={row.priority}
                  onChange={(e) => updateRow(row.clientId, { priority: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={selectClass}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* 2026-08-11 (round 4): manual Hour+Minute entry replacing the
                old automatic Start button + live timer, for THIS table
                only (Tasks keeps its own separate Start/Pause/Done timer). */}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-1.5 text-xs font-medium text-amber-800">⏱ Time</div>
              <div className="flex flex-wrap items-end gap-4 text-xs">
                {/* 2026-08-24 — "estimate time sirf ek anuman hai, isko kahi
                    count nahi karna" (estimated time is just a guess, never
                    count it anywhere) — it genuinely never is, in any total
                    or report (only time_spent_seconds/"Time Consumed" ever
                    gets summed — see page.tsx's todaysConsumedMinutes and
                    admin/page.tsx's perfTotalMinutes). The confusion was the
                    two fields sitting side-by-side with no visual
                    distinction; these captions make that explicit right on
                    the entry form, not just in submitted-report cards. */}
                <HourMinuteField
                  label="Estimated Time (guess — not counted)"
                  hours={row.estimatedHours}
                  minutes={row.estimatedMinutes}
                  onChangeHours={(v) => updateRow(row.clientId, { estimatedHours: v })}
                  onChangeMinutes={(v) => updateRow(row.clientId, { estimatedMinutes: v })}
                  onBlur={() => saveRow(row.clientId)}
                />
                <HourMinuteField
                  label="Time Consumed (this is what's counted)"
                  hours={row.consumedHours}
                  minutes={row.consumedMinutes}
                  onChangeHours={(v) => updateRow(row.clientId, { consumedHours: v })}
                  onChangeMinutes={(v) => updateRow(row.clientId, { consumedMinutes: v })}
                  onBlur={() => saveRow(row.clientId)}
                />
                {/* 2026-08-12 (round 6): "agar report pending hai to update
                    ka option karne ka option aaye, compleate hai to direct
                    submit" — a finalizing "Submit Report" (locks the row)
                    only once Work Status is Completed; otherwise a plain
                    "Update" that just saves, same as auto-save but on
                    demand and with visible confirmation. */}
                {row.workStatus === "Completed" ? (
                  <button
                    type="button"
                    disabled={submitPendingIds.has(row.clientId) || !row.description.trim()}
                    onClick={() => handleSubmit(row.clientId)}
                    className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitPendingIds.has(row.clientId) ? "Submitting…" : "✔ Submit Report"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={savingIds.has(row.clientId) || !row.description.trim()}
                    onClick={() => saveRow(row.clientId)}
                    className="ml-auto rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    💾 {savingIds.has(row.clientId) ? "Updating..." : "Update"}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3">
              <Field label="Description">
                <textarea
                  value={row.description}
                  onChange={(e) => updateRow(row.clientId, { description: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  rows={2}
                  className={inputClass}
                  placeholder="Exactly kya kaam kiya…"
                />
              </Field>
            </div>
          </div>
        );
  }

  return (
    <div className="space-y-3">
      {todayRows.length > 0 ? (
        todayRows.map((row) => renderRow(row))
      ) : (
        <p className="text-xs text-slate-400">Nothing for today yet — use &quot;+ Add more work&quot; below.</p>
      )}

      {backdatedRows.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
            🕘 Backdated entries (last 6 days) ({backdatedRows.length})
          </summary>
          <div className="space-y-3 p-3 pt-0">{backdatedRows.map((row) => renderRow(row))}</div>
        </details>
      )}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, blankRow(today)])}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        + Add more work
      </button>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const selectClass = inputClass;
const hmInputClass =
  "w-14 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function HourMinuteField({
  label,
  hours,
  minutes,
  onChangeHours,
  onChangeMinutes,
  onBlur,
}: {
  label: string;
  hours: string;
  minutes: string;
  onChangeHours: (v: string) => void;
  onChangeMinutes: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <div className="mb-1 text-slate-400">{label}</div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={MAX_HOURS_PER_ROW}
          inputMode="numeric"
          value={hours}
          onChange={(e) => {
            const raw = e.target.value;
            // Clamp as they type (not just on save) — a typo like "50"
            // should visibly correct itself immediately, not silently get
            // truncated only once the row saves.
            if (raw === "") return onChangeHours(raw);
            const n = parseInt(raw, 10);
            onChangeHours(Number.isFinite(n) ? String(Math.max(0, Math.min(MAX_HOURS_PER_ROW, n))) : raw);
          }}
          onBlur={onBlur}
          className={hmInputClass}
          placeholder="0"
        />
        <span className="text-slate-400">h</span>
        <input
          type="number"
          min={0}
          max={59}
          inputMode="numeric"
          value={minutes}
          onChange={(e) => onChangeMinutes(e.target.value)}
          onBlur={onBlur}
          className={hmInputClass}
          placeholder="0"
        />
        <span className="text-slate-400">m</span>
      </div>
    </div>
  );
}
