"use client";

// 2026-09-15 — per-bill "Pay from Wallet" (the wallet consume half — see
// wallet-pay-actions.ts). Shown in the bill row's actions cell next to
// Record Payment, ONLY when that bill's party actually has a wallet
// (partyWalletBalances has an entry for it) — pure bank-bill rows are
// untouched. Inline expander, same pattern as the row's other forms.

import { useActionState, useEffect, useState } from "react";
import { walletPayBill, type WalletPayState } from "./wallet-pay-actions";

const initialPayState: WalletPayState = { error: null, success: false };

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WalletPayButton({
  billId,
  balanceDue,
  walletBalance,
}: {
  billId: string;
  balanceDue: number;
  walletBalance: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(walletPayBill, initialPayState);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (state.success) window.location.reload();
  }, [state.success]);

  const enough = walletBalance + 0.005 >= Math.min(balanceDue, walletBalance);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
      >
        💳 Pay from Wallet
      </button>
      {open && (
        <form action={action} className="mt-1 flex items-end gap-1.5 rounded-lg border border-violet-200 bg-violet-50/60 p-2">
          <input type="hidden" name="bill_pass_register_id" value={billId} />
          <div>
            <label className="block text-[10px] text-slate-400">Amount ₹ (wallet: ₹{inr(walletBalance)})</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={Math.min(balanceDue, walletBalance)}
              defaultValue={Math.min(balanceDue, walletBalance).toFixed(2)}
              className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400">Date</label>
            <input name="txn_date" type="date" defaultValue={today} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" />
          </div>
          <button
            type="submit"
            disabled={pending || !enough}
            className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {pending ? "Paying…" : "Pay"}
          </button>
          {state.error && <span className="text-[11px] font-medium text-rose-600">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
