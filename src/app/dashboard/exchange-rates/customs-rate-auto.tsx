"use client";

// 2026-10-17 — the automatic side of the Exchange Rate Master: what DGFT /
// ICEGATE / eximin.net currently say for EVERY currency, refreshed without
// anyone touching it. The manual form beside this stays as the override for
// a specific CBIC notification.
import { useMemo, useState, useTransition } from "react";
import { refreshCustomsRates } from "./actions";
import type { CustomsRatesSnapshot } from "@/lib/fx/customs";

export function CustomsRateAuto({ snapshot }: { snapshot: CustomsRatesSnapshot }) {
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return snapshot.rows;
    return snapshot.rows.filter((r) => r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle));
  }, [q, snapshot.rows]);

  function handleRefresh() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await refreshCustomsRates();
      if (r.error) setError(r.error);
      else setNotice(r.message ?? "Rates refreshed.");
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">🌐 Auto Customs / Export Rates — all currencies</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Source: <strong>{snapshot.provider}</strong>
            {snapshot.effectiveDate && <> · notification effective {snapshot.effectiveDate}</>}
            {snapshot.notificationNo && <> · No. {snapshot.notificationNo}</>}
            {snapshot.fetchedAt && <> · refreshed {new Date(snapshot.fetchedAt).toLocaleString("en-IN")}</>}
            {snapshot.stale && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">stale</span>}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Chain: DGFT → ICEGATE → eximin.net (first one that answers wins). The <strong>export</strong> rate is what
            gets written to the legal rate master for each currency — no manual entry needed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search currency…"
            className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-amber-500"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={handleRefresh}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isPending ? "Fetching…" : "↻ Refresh now"}
          </button>
        </div>
      </div>

      {snapshot.warning && (
        <p className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {snapshot.warning}
        </p>
      )}
      {error && <p className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-800">{error}</p>}
      {notice && <p className="mx-5 mt-3 rounded-lg bg-green-50 px-3 py-2 text-[11px] text-green-800">✓ {notice}</p>}

      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Currency</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Import ₹</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Export ₹</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Effective</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="whitespace-nowrap px-4 py-1.5 font-medium text-slate-800">{r.code}</td>
                <td className="px-4 py-1.5 text-slate-600">{r.name}</td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right text-slate-600">
                  {r.importRate == null ? "—" : r.importRate.toFixed(4)}
                </td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right font-semibold text-slate-900">
                  {r.exportRate.toFixed(4)}
                </td>
                <td className="whitespace-nowrap px-4 py-1.5 text-slate-500">{r.effectiveDate ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  {snapshot.rows.length === 0 ? "No automatic rates yet — press Refresh now." : "No currency matches that search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
