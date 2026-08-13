"use client";

import { useState, useTransition } from "react";
import { deleteExchangeRate } from "./actions";

export type ExchangeRateRow = {
  id: string;
  currency_code: string;
  effective_from: string;
  rate_to_inr: number;
  notification_no: string | null;
  remark: string | null;
  entered_on: string;
};

export function ExchangeRateList({ rates }: { rates: ExchangeRateRow[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteExchangeRate(id);
      if (r.error) setError(r.error);
      setDeletingId(null);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Rate History (most recent first)</h2>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Currency</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Effective From</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Rate to INR</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Notification No.</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Remark</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">No rates entered yet.</td>
              </tr>
            )}
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800">{r.currency_code}</td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{r.effective_from}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-slate-800">{Number(r.rate_to_inr).toFixed(6)}</td>
                <td className="px-4 py-2 text-slate-600">{r.notification_no ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{r.remark ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
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
