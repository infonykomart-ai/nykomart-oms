"use client";

// 2026-10-29 — "ye invoice duplicate hua hai usko ek me kar do jisme 11 AWB
// already add hai, or ek me credit note — merge kar ke single entry".
//
// The Party Ledger is where a duplicate is actually SEEN, so the merge lives
// here too: any invoice this party has more than one entry for (same company,
// same vendor invoice number, e.g. one "Courier Bill (Freight)" row and one
// legacy "FREIGHT INVOICE" row) shows a panel offering to keep the entry that
// carries the document/AWBs and fold the other into it.
//
// Same server action Bill Payment already uses (mergeDuplicateBills): payments,
// credit/debit notes and adjustments move onto the keeper, the duplicate rows
// are zeroed and tagged (never deleted), and the ledger then shows ONE entry.
import { useActionState, useEffect, useState } from "react";
import { mergeDuplicateBills, type MergeBillsState } from "@/app/dashboard/bill-payment/merge-actions";

const initial: MergeBillsState = { error: null, success: null };

export type LedgerDuplicateRow = {
  id: string;
  label: string;
  total: number;
  creditNote: number;
  hasDocument: boolean;
};

export type LedgerDuplicateGroup = {
  key: string;
  invoiceNo: string;
  companyName: string;
  rows: LedgerDuplicateRow[];
};

export function LedgerDuplicateMerge({ groups }: { groups: LedgerDuplicateGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {groups.map((g) => (
        <DuplicateGroupRow key={g.key} group={g} />
      ))}
    </div>
  );
}

function DuplicateGroupRow({ group }: { group: LedgerDuplicateGroup }) {
  const [state, action, pending] = useActionState(mergeDuplicateBills, initial);
  // Keep the entry that carries the real document (the Courier Bill with its
  // AWBs) — that is the one the user pointed at. A loose/manual duplicate is
  // folded into it, credit note included.
  const preferred = group.rows.find((r) => r.hasDocument) ?? group.rows[0];
  const [keeperId, setKeeperId] = useState(preferred.id);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!state.success) return;
    const t = setTimeout(() => setDone(true), 1200);
    return () => clearTimeout(t);
  }, [state.success]);

  if (done) {
    return (
      <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
        ✓ {group.invoiceNo} merged into one entry — refresh to see the single line.
      </p>
    );
  }

  const losers = group.rows.filter((r) => r.id !== keeperId);
  const keeper = group.rows.find((r) => r.id === keeperId) ?? group.rows[0];

  return (
    <form action={action} className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs">
      <input type="hidden" name="bill_ids_json" value={JSON.stringify([keeperId, ...losers.map((l) => l.id)])} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-teal-900">
          🔗 Duplicate invoice {group.invoiceNo} — {group.rows.length} entries in {group.companyName}
        </span>
        <span className="text-teal-700">
          {group.rows.map((r) => `${r.label} ₹${r.total.toFixed(2)}${r.creditNote ? ` (CN ₹${r.creditNote.toFixed(2)})` : ""}`).join("  ·  ")}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-teal-700" htmlFor={`keep-${group.key}`}>
            Entry to keep
          </label>
          <select
            id={`keep-${group.key}`}
            value={keeperId}
            onChange={(e) => setKeeperId(e.target.value)}
            className="rounded-lg border border-teal-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            {group.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — ₹{r.total.toFixed(2)}
                {r.creditNote ? ` · CN ₹${r.creditNote.toFixed(2)}` : ""}
                {r.hasDocument ? " · with document" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
        >
          {pending ? "Merging…" : `🔗 Merge ${group.rows.length} entries into one`}
        </button>
        <span className="text-[10px] text-teal-700">
          Payments, credit/debit notes and adjustments move onto <strong>{keeper.label}</strong>; duplicate amounts are dropped.
        </span>
      </div>
      {state.error && <p className="mt-1 font-medium text-red-600">{state.error}</p>}
    </form>
  );
}
