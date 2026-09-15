"use client";

// 2026-09-15 — "kuch kuch courier me shipment bhejne se pehle wallet
// recharge karna padta hai phir baad me adjust hota hai jab uska invoice
// aata hai to iska kese karenge" — the 💳 Wallet panel, opened from a
// toggle button in the Bill Payment header. Sections:
//
//   • Per-courier balance cards (green = money in the wallet, red =
//     consumed more than recharged — data error or pending recharge)
//   • 💰 Recharge form (amount + date + mode + UTR) → walletRecharge
//   • ↩️ Refund form (courier returned unused money) → walletRefund
//   • Recent txn history (recharge/consume/refund lines)
//
// Per-bill "Pay from Wallet" lives on the bill row (WalletPayButton in
// wallet-pay-button.tsx) — that's where the money actually leaves.

import { useActionState, useEffect, useState } from "react";
import { walletRecharge, walletRefund, type WalletActionState, type WalletOverview } from "./wallet-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialWalletState: WalletActionState = { error: null, success: false };

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WalletPanel({ overview, companies }: { overview: WalletOverview; companies: { id: string; name: string }[] }) {
  const [rechargeState, rechargeAction, rechargePending] = useActionState(walletRecharge, initialWalletState);
  const [refundState, refundAction, refundPending] = useActionState(walletRefund, initialWalletState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const firstParty = overview.balances[0]?.party_id ?? "";
  const [partyId, setPartyId] = useState(firstParty);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (rechargeState.success || refundState.success) window.location.reload();
  }, [rechargeState.success, refundState.success]);

  const partyOptions =
    overview.balances.length > 0
      ? overview.balances
      : // No wallet history yet — offer a free-text party pick from the
        // bill rows passed via the parent page's parties (see page.tsx).
        [];

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">💳</span>
        <h2 className="text-sm font-bold text-slate-700">Courier Wallets (prepaid)</h2>
        <span className="text-[11px] text-slate-400">Recharge before booking · invoice consume kar deta hai</span>
      </div>

      {/* Balance cards */}
      {overview.balances.length === 0 ? (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Koi wallet entry nahi. Pehla recharge neeche karo — phir har courier bill pe &quot;Pay from Wallet&quot; dikhega.
        </p>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          {overview.balances.map((b) => (
            <div
              key={b.party_id}
              className={`min-w-[180px] rounded-lg border px-3 py-2 ${b.balance >= 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}
            >
              <div className="text-[11px] font-semibold text-slate-500">{b.party_name}</div>
              <div className={`text-base font-bold ${b.balance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                ₹{inr(b.balance)}
              </div>
              <div className="text-[10px] text-slate-400">{b.balance >= 0 ? "available balance" : "negative — recharge pending?"}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recharge + Refund forms side by side */}
      <div className="grid gap-4 md:grid-cols-2">
        <form action={rechargeAction} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
          <div className="mb-2 text-xs font-bold text-emerald-700">💰 Recharge wallet</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Company</label>
              <select name="company_id" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass} required>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Courier party</label>
              <select name="party_id" value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass} required>
                {partyOptions.length === 0 && <option value="">—</option>}
                {partyOptions.map((p) => (
                  <option key={p.party_id} value={p.party_id}>{p.party_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount ₹</label>
              <input name="amount" type="number" step="0.01" min="0.01" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input name="txn_date" type="date" defaultValue={today} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Mode</label>
              <input name="payment_mode" placeholder="NEFT / RTGS / UPI" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>UTR / Reference</label>
              <input name="reference_no" className={inputClass} />
            </div>
          </div>
          {rechargeState.error && <p className="mt-1.5 text-xs font-medium text-rose-600">{rechargeState.error}</p>}
          <button
            type="submit"
            disabled={rechargePending || !companyId || !partyId}
            className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {rechargePending ? "Recharging…" : "💰 Recharge"}
          </button>
        </form>

        <form action={refundAction} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 text-xs font-bold text-slate-600">↩️ Refund (courier ne unused money wapas ki)</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Company</label>
              <select name="company_id" className={inputClass} required>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Courier party</label>
              <select name="party_id" className={inputClass} required>
                {partyOptions.length === 0 && <option value="">—</option>}
                {partyOptions.map((p) => (
                  <option key={p.party_id} value={p.party_id}>{p.party_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount ₹</label>
              <input name="amount" type="number" step="0.01" min="0.01" className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input name="txn_date" type="date" defaultValue={today} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Remark</label>
              <input name="remark" className={inputClass} />
            </div>
          </div>
          {refundState.error && <p className="mt-1.5 text-xs font-medium text-rose-600">{refundState.error}</p>}
          <button
            type="submit"
            disabled={refundPending || partyOptions.length === 0}
            className="mt-2 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-40"
          >
            {refundPending ? "Saving…" : "↩️ Record Refund"}
          </button>
        </form>
      </div>

      {/* Recent history */}
      {overview.recent.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-slate-500">Recent wallet activity</div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-100">
            <table className="min-w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {overview.recent.slice(0, 40).map((t) => (
                  <tr key={t.id}>
                    <td className="px-2 py-1 text-slate-400">{t.txn_date}</td>
                    <td className="px-2 py-1">{t.party_name}</td>
                    <td className={`px-2 py-1 font-semibold ${t.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                      {t.txn_type === "recharge" ? "Recharge" : t.txn_type === "consume" ? "Invoice paid" : "Refund"} {t.direction === "in" ? "+" : "−"}₹{inr(t.amount)}
                    </td>
                    <td className="px-2 py-1 text-slate-400">{t.payment_mode ?? ""} {t.reference_no ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
