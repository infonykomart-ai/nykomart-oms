"use client";

import { useState, useTransition } from "react";
import { deleteCourierRate } from "./actions";

export type RateCardRow = {
  id: string;
  companyName: string;
  courier_name: string;
  zone_label: string;
  min_weight_kg: number;
  max_weight_kg: number;
  base_rate: number;
  rate_per_kg: number;
  fuel_surcharge_pct: number;
  other_charges: number;
  currency: string;
  remark: string | null;
};

export function RateCardList({ rows }: { rows: RateCardRow[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteCourierRate(id);
      if (r.error) setError(r.error);
      setDeletingId(null);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Rate Card ({rows.length} slabs)</h2>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Courier</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Zone</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Weight Slab (kg)</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Base</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">/kg</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Fuel %</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Other</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Remark</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-400">No rate slabs entered yet.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.companyName}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{r.courier_name}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.zone_label}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{r.min_weight_kg}–{r.max_weight_kg}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{r.base_rate.toFixed(2)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{r.rate_per_kg.toFixed(2)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{r.fuel_surcharge_pct}%</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{r.other_charges.toFixed(2)}</td>
                <td className="px-3 py-2 text-slate-500">{r.remark ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {deletingId === r.id ? (
                    <span className="inline-flex gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDelete(r.id)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Confirm
                      </button>
                      <button type="button" onClick={() => setDeletingId(null)} className="text-xs text-slate-400 hover:underline">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setDeletingId(r.id)} className="text-xs text-slate-400 hover:text-red-600 hover:underline">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
