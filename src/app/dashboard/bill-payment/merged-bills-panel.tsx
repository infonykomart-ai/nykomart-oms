"use client";

// 2026-10-29b — "MERGED ENTRIES" panel + UNDO.
//
// A merge folds a duplicate bill into a keeper: the duplicate's amount is
// zeroed (kept only as a remark for audit) and its payments/CN-DN adjustments
// move to the keeper. When the merge key was too loose (same invoice NUMBER,
// different invoice date/amount — a different bill) that folded real money
// into the wrong row, and there was no way back from the UI at all.
//
// This panel lists every merged duplicate in the visible companies with the
// amount it originally carried, and gives Admin a one-click "Undo" that calls
// unmergeBill (see merge-actions.ts) to restore the bill, its payments and its
// adjustment rows. Admin-only, because it rewrites money Finance has posted.
import { useActionState } from "react";
import { unmergeAllBills, unmergeBill, type UnmergeAllState, type UnmergeState } from "./merge-actions";

const initialUnmergeState: UnmergeState = { error: null, success: null };
const initialUnmergeAllState: UnmergeAllState = { error: null, summary: null };

export type MergedBillRow = {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  partyName: string | null;
  companyName: string;
  keeperInvoiceNo: string;
  keeperCompany: string;
  /** Original bill amount, read from the merge's own audit note. */
  originalTotal: number;
  remark: string | null;
};

export function MergedBillsPanel({ rows }: { rows: MergedBillRow[] }) {
  const [state, formAction, pending] = useActionState(unmergeBill, initialUnmergeState);
  // 2026-10-29k — "single single unmerge karni pad rahi hai, ek sath karo":
  // one click for the whole list. Same server step as the per-row button.
  const [allState, allAction, allPending] = useActionState(unmergeAllBills, initialUnmergeAllState);

  if (rows.length === 0) return null;

  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">🔗 Merged entries ({rows.length})</h2>
          <p className="mt-1 text-[11px] text-amber-800">
            Each row below is a bill that was folded into another one by a merge — its own amount is hidden (0) and its
            payments/notes now sit on the keeper. Undo restores the bill with its original amount and moves its payments
            and CN/DN adjustments back. Only a true duplicate should ever be merged.
          </p>
        </div>
        <form
          action={allAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Undo all ${rows.length} merges?\n\nEvery merged entry gets its own original amount back and its payments / CN-DN adjustments are moved back to it.`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            disabled={allPending || pending}
            className="whitespace-nowrap rounded-lg border border-amber-500 bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {allPending ? "Undoing all…" : `↩ Undo all ${rows.length} merges`}
          </button>
        </form>
      </div>

      {allState.error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{allState.error}</div>
      )}
      {allState.summary && (
        <div className="mx-4 mt-3 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <div className="font-semibold">
            ✅ {allState.summary.undone} merge{allState.summary.undone === 1 ? "" : "s"} undone — ₹
            {allState.summary.restoredTotal.toFixed(2)} restored
            {allState.summary.failed > 0 && ` · ${allState.summary.failed} could not be undone`}
          </div>
          {allState.summary.failures.length > 0 && (
            <ul className="list-disc pl-4 text-red-700">
              {allState.summary.failures.slice(0, 20).map((f) => (
                <li key={`${f.invoiceNo}-${f.error}`}>
                  {f.invoiceNo}: {f.error}
                </li>
              ))}
            </ul>
          )}
          {allState.summary.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-amber-800">
              {allState.summary.warnings.slice(0, 20).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="text-[10px] text-emerald-700">Refresh (or reopen the page) to see the restored bills in the list.</div>
        </div>
      )}
      {state.error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</div>
      )}
      {state.success && (
        <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✅ Merge undone for {state.success.invoiceNo} — ₹{state.success.restoredTotal.toFixed(2)} restored
          {state.success.movedPayments > 0 && `, ${state.success.movedPayments} payment${state.success.movedPayments === 1 ? "" : "s"} moved back`}
          {state.success.movedAdjustments > 0 && `, ${state.success.movedAdjustments} note adjustment${state.success.movedAdjustments === 1 ? "" : "s"} moved back`}.
          {state.success.warning && <div className="mt-1 text-amber-800">{state.success.warning}</div>}
        </div>
      )}

      <div className="overflow-x-auto p-4">
        <table className="min-w-full divide-y divide-amber-200 text-xs">
          <thead>
            <tr className="text-left uppercase text-amber-700">
              <th className="px-2 py-1.5">Invoice No.</th>
              <th className="px-2 py-1.5">Date</th>
              <th className="px-2 py-1.5">Party</th>
              <th className="px-2 py-1.5">Own company</th>
              <th className="px-2 py-1.5">Merged into</th>
              <th className="px-2 py-1.5 text-right">Original amount</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {rows.map((r) => (
              <tr key={r.id} className="text-amber-950">
                <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{r.invoiceNo}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{r.invoiceDate ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{r.partyName ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{r.companyName}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {r.keeperInvoiceNo} <span className="text-amber-700">({r.keeperCompany})</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">₹{r.originalTotal.toFixed(2)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <form action={formAction}>
                    <input type="hidden" name="bill_id" value={r.id} />
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {pending ? "Undoing…" : "↩ Undo merge"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
