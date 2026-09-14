"use client";

// 2026-09-13 — "order ko check box se select kar ke vendor assign kar sake"
// — the bar that appears whenever ≥1 order row is checkbox-selected on the
// Orders hub. One party + one date applies to EVERY selected order in a
// single action (bulkAssignVendorsToOrders), producing the same per-order
// assignment cycles as the single-order button on the order detail page —
// so history, remark and receive-marking behave identically afterwards.
// Results render per-row (✓ PO-xxx / ✗ reason) so a partially-failed batch
// is readable at a glance, then auto-clears after a few seconds.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkAssignVendorsToOrders, type BulkVendorAssignRowResult } from "./vendor-assignment-actions";

export function BulkVendorAssignBar({ selectedIds, parties, onClear }: { selectedIds: string[]; parties: { id: string; name: string }[]; onClear: () => void }) {
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [assignedDate, setAssignedDate] = useState(new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState("");
  const [results, setResults] = useState<BulkVendorAssignRowResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAssign() {
    setError(null);
    setResults(null);
    startTransition(async () => {
      const res = await bulkAssignVendorsToOrders(selectedIds, partyId, assignedDate, remark || null);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResults(res.results);
      onClear();
      router.refresh();
      // Auto-clear the report after a moment so the bar doesn't linger.
      setTimeout(() => setResults(null), 8000);
    });
  }

  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="mb-3 rounded-xl border border-teal-300 bg-teal-50 p-3 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-0.5 block text-[11px] text-slate-400">Party (vendor)</label>
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">— Choose party —</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] text-slate-400">Assigned date</label>
          <input type="date" value={assignedDate} onChange={(e) => setAssignedDate(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-0.5 block text-[11px] text-slate-400">Remark (optional)</label>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. batch assigned" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <button
          type="button"
          onClick={handleAssign}
          disabled={pending || !partyId || selectedIds.length === 0}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {pending ? "Assigning..." : `👷 Assign Party to ${selectedIds.length} order${selectedIds.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" onClick={onClear} className="text-[11px] text-slate-400 underline">
          clear selection
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

      {results && (
        <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-white p-2 text-xs">
          {failed.length === 0 ? (
            <p className="text-green-700">✓ All {results.length} order(s) assigned successfully.</p>
          ) : (
            <>
              <p className="mb-1 font-medium text-amber-700">
                {results.length - failed.length} assigned, {failed.length} failed:
              </p>
              <ul className="space-y-0.5">
                {failed.map((r) => (
                  <li key={r.label} className="text-red-600">
                    ✗ {r.label} — {r.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
