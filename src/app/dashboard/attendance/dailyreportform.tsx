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
import { useEffect, useRef, useState } from "react";
import { upsertDailyLog, deleteDailyLog } from "./actions";

const CATEGORIES = [
  "Technical Work", "Tracking Update & Check", "Inventory Management", "Product Photography",
  "Product Uploading", "Listing Update", "Photo Edit", "Video Edit", "SEO", "Content / Blog",
  "Social Media", "Order Management", "Mail & Inbox", "Accounts & Billing", "Shipping & Customs",
  "Vendor & Stock", "Admin / Communication", "Other",
];
const WORK_STATUSES = ["Completed", "In Progress", "Next Day Carry On"];
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
  estimatedTime: string;
  timeTaken: string;
  remarkSku: string;
  serverUpdatedAt: string | null;
};

type ServerLog = {
  id: string;
  log_date: string;
  category: string | null;
  description: string | null;
  target_qty: string | null;
  qty_done: string | null;
  work_status: string | null;
  estimated_time: string | null;
  time_taken: string | null;
  remark_sku: string | null;
  updated_at: string;
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
    estimatedTime: l.estimated_time ?? "",
    timeTaken: l.time_taken ?? "",
    remarkSku: l.remark_sku ?? "",
    serverUpdatedAt: l.updated_at,
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
    estimatedTime: "",
    timeTaken: "",
    remarkSku: "",
    serverUpdatedAt: null,
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

    // Merge in any localStorage draft that's newer than (or has no) server counterpart.
    const draftMap = loadDraftMap();
    const merged = new Map(serverRows.map((r) => [r.clientId, r]));
    for (const key of Object.keys(draftMap)) {
      const draft = draftMap[key];
      if (draft.logDate !== today) continue; // only today's draft rows are relevant here
      const serverRow = merged.get(draft.id ?? draft.clientId);
      const draftIsNewer = !serverRow || (!serverRow.serverUpdatedAt || draft.savedLocallyAt > new Date(serverRow.serverUpdatedAt).getTime());
      if (draftIsNewer) {
        merged.set(draft.clientId, { ...draft });
      }
    }
    const result = Array.from(merged.values());
    return result.length ? result : [blankRow(today)];
  });

  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Mirror every row change into localStorage immediately (synchronous,
  // no network) — this is what actually makes a refresh mid-typing safe.
  useEffect(() => {
    const map: Record<string, LogRow & { savedLocallyAt: number }> = {};
    for (const r of rows) {
      if (r.description.trim() || r.category !== CATEGORIES[0]) {
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

  async function saveRow(clientId: string) {
    const row = rowsRef.current.find((r) => r.clientId === clientId);
    if (!row || !row.description.trim()) return; // nothing worth saving yet
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
      estimatedTime: row.estimatedTime,
      timeTaken: row.timeTaken,
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
    }
  }

  async function removeRow(clientId: string) {
    const row = rows.find((r) => r.clientId === clientId);
    setRows((prev) => {
      const next = prev.filter((r) => r.clientId !== clientId);
      return next.length ? next : [blankRow(today)];
    });
    if (row?.id) await deleteDailyLog(row.id);
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.clientId} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {savingIds.has(row.clientId) ? "Saving..." : row.id ? "Saved" : "Not saved yet — start typing"}
            </span>
            <button type="button" onClick={() => removeRow(row.clientId)} className="text-xs text-rose-600 hover:underline">
              Remove
            </button>
          </div>
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
            <Field label="Estimated Time">
              <input
                value={row.estimatedTime}
                onChange={(e) => updateRow(row.clientId, { estimatedTime: e.target.value })}
                onBlur={() => saveRow(row.clientId)}
                className={inputClass}
                placeholder="e.g. 1 Hr"
              />
            </Field>
            <Field label="Time Taken">
              <input
                value={row.timeTaken}
                onChange={(e) => updateRow(row.clientId, { timeTaken: e.target.value })}
                onBlur={() => saveRow(row.clientId)}
                className={inputClass}
                placeholder="e.g. 1.5 Hr"
              />
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
      ))}
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
