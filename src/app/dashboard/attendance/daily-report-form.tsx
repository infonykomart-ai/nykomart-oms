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
// start time ka option ho kitne baje compleate hua ka option ho submit
// report ka option ho subit karte hi khud ke kaam me add ho jaye or md
// admin ke page par show ho jaye" — Start/Pause toggling is gone. Now:
// ▶ Start (once, optional) + ✔ Submit Report (once, records the
// completion time AND finalizes the row in the same click). A row is a
// DRAFT (still auto-saving/refresh-safe as before, editable) until
// submitted; after that it renders read-only here and starts showing in
// "My Recent Reports" and the Admin/MD Team Daily Work Log — both now
// filter on submitted_at IS NOT NULL (see recent-reports-list.tsx and
// attendance/admin/page.tsx).
import { useEffect, useRef, useState } from "react";
import { upsertDailyLog, deleteDailyLog, startReportTimer, submitDailyLog } from "./actions";
import { liveElapsedSeconds, formatDuration, formatISTTime } from "@/lib/attendance/timer";

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
  timerStartedAt: string | null;
  timeSpentSeconds: number;
  firstStartedAt: string | null;
  lastPausedAt: string | null;
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
  timer_started_at: string | null;
  time_spent_seconds: number;
  first_started_at: string | null;
  last_paused_at: string | null;
  carried_from_log_id: string | null;
  submitted_at: string | null;
};

function fromServer(l: ServerLog): LogRow {
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
    timerStartedAt: l.timer_started_at,
    timeSpentSeconds: l.time_spent_seconds ?? 0,
    firstStartedAt: l.first_started_at,
    lastPausedAt: l.last_paused_at,
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
    timerStartedAt: null,
    timeSpentSeconds: 0,
    firstStartedAt: null,
    lastPausedAt: null,
    carriedFromLogId: null,
    submittedAt: null,
  };
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
  const [timerPendingIds, setTimerPendingIds] = useState<Set<string>>(new Set());
  // 2026-08-11 (round 3 review fix): surface a failed save/start/submit
  // instead of silently discarding it — e.g. a save that lost a race
  // against submitDailyLog and got rejected by the server-side
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

  // Tick every second while any DRAFT row's timer is running, so the
  // elapsed display advances live without needing a server round-trip.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const anyRunning = rows.some((r) => r.timerStartedAt && !r.submittedAt);
  useEffect(() => {
    if (!anyRunning) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [anyRunning]);

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
    const result = await upsertDailyLog({
      id: row.id ?? undefined,
      logDate: row.logDate,
      category: row.category,
      description: row.description,
      targetQty: row.targetQty,
      qtyDone: row.qtyDone,
      workStatus: row.workStatus,
      remarkSku: row.remarkSku,
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

  async function handleStart(clientId: string) {
    let id = rowsRef.current.find((r) => r.clientId === clientId)?.id ?? null;
    if (!id) id = await saveRow(clientId); // timer needs a saved row — save first if this is a brand-new row
    if (!id) return; // still nothing to save (empty description) — Start is a no-op
    setTimerPendingIds((prev) => new Set(prev).add(clientId));
    const result = await startReportTimer(id);
    setTimerPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    if (!result.error) {
      setRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? { ...r, timerStartedAt: result.timerStartedAt, timeSpentSeconds: result.timeSpentSeconds, firstStartedAt: result.firstStartedAt }
            : r
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

  async function handleSubmit(clientId: string) {
    // 2026-08-11 (round 3 review fix): always flush any pending
    // (debounced or blur-triggered) edit first, whether or not this row
    // already has an id — otherwise a field edited just before clicking
    // Submit could lose its race against submitDailyLog and get finalized
    // with a stale value.
    const id = await saveRow(clientId);
    if (!id) return; // nothing to submit yet (empty description)
    setTimerPendingIds((prev) => new Set(prev).add(clientId));
    const result = await submitDailyLog(id);
    setTimerPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    if (!result.error) {
      setRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? {
                ...r,
                timerStartedAt: result.timerStartedAt,
                timeSpentSeconds: result.timeSpentSeconds,
                lastPausedAt: result.lastPausedAt,
                submittedAt: result.submittedAt,
              }
            : r
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
              <div><span className="text-slate-400">Started At:</span> {formatISTTime(row.firstStartedAt)}</div>
              <div><span className="text-slate-400">Completed At:</span> {formatISTTime(row.lastPausedAt)}</div>
              <div><span className="text-slate-400">Total Time:</span> {formatDuration(row.timeSpentSeconds)}</div>
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

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="mb-1.5 text-xs font-medium text-amber-800">⏱ Time Watch</div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <div className="text-slate-400">Start Time</div>
                  <div className="font-medium text-slate-900">{formatISTTime(row.firstStartedAt)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Completed At</div>
                  <div className="font-medium text-slate-900">
                    {row.timerStartedAt ? "Running…" : formatISTTime(row.lastPausedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Total Time</div>
                  <div className="font-semibold text-amber-800">
                    {formatDuration(liveElapsedSeconds({ timeSpentSeconds: row.timeSpentSeconds, timerStartedAt: row.timerStartedAt }, nowMs))}
                  </div>
                </div>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    disabled={!!row.timerStartedAt || timerPendingIds.has(row.clientId)}
                    onClick={() => handleStart(row.clientId)}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ▶ Start
                  </button>
                  <button
                    type="button"
                    disabled={timerPendingIds.has(row.clientId) || !row.description.trim()}
                    onClick={() => handleSubmit(row.clientId)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ✔ Submit Report
                  </button>
                </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}
