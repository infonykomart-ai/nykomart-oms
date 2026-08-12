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
import { upsertDailyLog, deleteDailyLog, submitDailyLog } from "./actions";
import { formatDuration, formatISTTime } from "@/lib/attendance/timer";

const CATEGORIES = [
  "Technical Work", "Tracking Update & Check", "Inventory Management", "Product Photography",
  "Product Uploading", "Listing Update", "Photo Edit", "Video Edit", "SEO", "Content / Blog",
  "Social Media", "Order Management", "Mail & Inbox", "Accounts & Billing", "Shipping & Customs",
  "Vendor & Stock", "Admin / Communication", "Other",
];
const WORK_STATUSES = ["Pending", "In Progress", "Completed", "Next Day Carry On"];
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
  };
}

function hmToMinutes(h: string, m: string): number {
  return Math.max(0, parseInt(h, 10) || 0) * 60 + Math.max(0, Math.min(59, parseInt(m, 10) || 0));
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
  todayLogs,
  today,
}: {
  todayLogs: ServerLog[];
  recentLogs: ServerLog[];
  today: string;
}) {
  const [rows, setRows] = useState<LogRow[]>(() => {
    const serverRows = todayLogs.map(fromServer);
    if (typeof window === "undefined") return serverRows.length ? serverRows : [blankRow(today)];

    // Merge in any localStorage draft that's newer than (or has no) server
    // counterpart. Only relevant for still-editable rows — a submitted row
    // is finalized server-side, so its own draft entry (if any leftover)
    // is never restored over it.
    const draftMap = loadDraftMap();
    const merged = new Map(serverRows.map((r) => [r.clientId, r]));
    for (const key of Object.keys(draftMap)) {
      const draft = draftMap[key];
      if (draft.logDate !== today || draft.submittedAt) continue;
      const serverRow = merged.get(draft.id ?? draft.clientId);
      if (serverRow?.submittedAt) continue;
      const draftIsNewer = !serverRow || (!serverRow.serverUpdatedAt || draft.savedLocallyAt > new Date(serverRow.serverUpdatedAt).getTime());
      if (draftIsNewer) {
        merged.set(draft.clientId, { ...draft });
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
    // 2026-08-11 (round 3 review fix): always flush any pending
    // (debounced or blur-triggered) edit first, whether or not this row
    // already has an id — otherwise a field edited just before clicking
    // Submit could lose its race against submitDailyLog and get finalized
    // with a stale value.
    const id = await saveRow(clientId);
    if (!id) return; // nothing to submit yet (empty description)
    setSubmitPendingIds((prev) => new Set(prev).add(clientId));
    const result = await submitDailyLog(id);
    setSubmitPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    if (!result.error) {
      setRows((prev) =>
        prev.map((r) => (r.clientId === clientId ? { ...r, submittedAt: result.submittedAt } : r))
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

  return (
    <div className="space-y-3">
      {rows.map((row) =>
        row.submittedAt ? (
          <div key={row.clientId} className="rounded-xl border border-green-200 bg-green-50/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs">
                {row.carriedFromLogId && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">Carried from yesterday</span>}
                <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                  ✓ Submitted at {formatISTTime(row.submittedAt)}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 md:grid-cols-4">
              <div><span className="text-slate-400">Work Type:</span> {row.category}</div>
              <div><span className="text-slate-400">Target Qty:</span> {row.targetQty || "—"}</div>
              <div><span className="text-slate-400">Qty Done:</span> {row.qtyDone || "—"}</div>
              <div><span className="text-slate-400">Status:</span> {row.workStatus}</div>
              <div><span className="text-slate-400">Remark/SKU:</span> {row.remarkSku || "—"}</div>
              <div><span className="text-slate-400">Estimated Time:</span> {formatDuration(hmToMinutes(row.estimatedHours, row.estimatedMinutes) * 60)}</div>
              <div><span className="text-slate-400">Time Consumed:</span> {formatDuration(hmToMinutes(row.consumedHours, row.consumedMinutes) * 60)}</div>
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
              <Field label="Remark / SKU">
                <input
                  value={row.remarkSku}
                  onChange={(e) => updateRow(row.clientId, { remarkSku: e.target.value })}
                  onBlur={() => saveRow(row.clientId)}
                  className={inputClass}
                  placeholder="optional"
                />
              </Field>
            </div>

            {/* 2026-08-11 (round 4): manual Hour+Minute entry replacing the
                old automatic Start button + live timer, for THIS table
                only (Tasks keeps its own separate Start/Pause/Done timer). */}
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-1.5 text-xs font-medium text-amber-800">⏱ Time</div>
              <div className="flex flex-wrap items-end gap-4 text-xs">
                <HourMinuteField
                  label="Estimated Time"
                  hours={row.estimatedHours}
                  minutes={row.estimatedMinutes}
                  onChangeHours={(v) => updateRow(row.clientId, { estimatedHours: v })}
                  onChangeMinutes={(v) => updateRow(row.clientId, { estimatedMinutes: v })}
                  onBlur={() => saveRow(row.clientId)}
                />
                <HourMinuteField
                  label="Time Consumed"
                  hours={row.consumedHours}
                  minutes={row.consumedMinutes}
                  onChangeHours={(v) => updateRow(row.clientId, { consumedHours: v })}
                  onChangeMinutes={(v) => updateRow(row.clientId, { consumedMinutes: v })}
                  onBlur={() => saveRow(row.clientId)}
                />
                <button
                  type="button"
                  disabled={submitPendingIds.has(row.clientId) || !row.description.trim()}
                  onClick={() => handleSubmit(row.clientId)}
                  className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ✔ Submit Report
                </button>
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
        )
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
          inputMode="numeric"
          value={hours}
          onChange={(e) => onChangeHours(e.target.value)}
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
