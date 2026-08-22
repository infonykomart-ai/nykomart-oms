"use client";

import { useState, useTransition } from "react";
import { deleteFreightEstimate } from "./actions";

export type EstimateRow = {
  id: string;
  companyName: string;
  orderRefNo: string | null;
  courier_name: string;
  zone_label: string;
  weight_kg: number;
  estimated_total: number;
  currency: string;
  remark: string | null;
  created_at: string;
};

export function EstimateList({ rows }: { rows: EstimateRow[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteFreightEstimate(id);
      if (r.error) setError(r.error);
      setDeletingId(null);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Recent Saved Estimates</h2>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="max-h-[32rem] overflow-y-auto">
        {rows.length === 0 && <p className="px-5 py-6 text-center text-xs text-slate-400">No estimates saved yet.</p>}
        {rows.map((r) => (
          <div key={r.id} className="border-b border-slate-100 px-5 py-3 text-xs last:border-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-slate-900">
                  {r.courier_name} · {r.zone_label} {r.orderRefNo ? `· ${r.orderRefNo}` : ""}
                </div>
                <div className="mt-0.5 text-slate-400">
                  {r.companyName} · {r.weight_kg}kg · {new Date(r.created_at).toLocaleDateString()}
                </div>
                {r.remark && <div className="mt-0.5 text-slate-500">{r.remark}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold text-slate-900">{r.currency} {r.estimated_total.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-end gap-2 border-t border-slate-50 pt-1.5">
              {deletingId === r.id ? (
                <>
                  <button type="button" disabled={isPending} onClick={() => handleDelete(r.id)} className="font-semibold text-red-600 hover:underline">
                    Confirm
                  </button>
                  <button type="button" onClick={() => setDeletingId(null)} className="text-slate-400 hover:underline">
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setDeletingId(r.id)} className="text-slate-400 hover:text-red-600 hover:underline">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
