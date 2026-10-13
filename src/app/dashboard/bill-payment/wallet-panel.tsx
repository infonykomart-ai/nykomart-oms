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
//   • Recent txn history (recharge/consume/refund lines) — every row
//     editable ✏️ / deletable 🗑 (2026-10-13, walletUpdateTxn /
//     walletDeleteTxn in wallet-actions.ts)
//
// Per-bill "Pay from Wallet" lives on the bill row (WalletPayButton in
// wallet-pay-button.tsx) — that's where the money actually leaves.

import { Fragment, useActionState, useEffect, useState } from "react";
import {
  walletDeleteTxn,
  walletRecharge,
  walletRefund,
  walletUpdateTxn,
  type WalletActionState,
  type WalletOverview,
} from "./wallet-actions";
import { groupPartyOptions, type PartyOption } from "../documents/party-options";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialWalletState: WalletActionState = { error: null, success: false };

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function txnLabel(t: { txn_type: string }): string {
  return t.txn_type === "recharge" ? "Recharge" : t.txn_type === "consume" ? "Invoice paid" : "Refund";
}

export function WalletPanel({
  overview,
  companies,
  parties,
}: {
  overview: WalletOverview;
  companies: { id: string; name: string }[];
  parties: PartyOption[];
}) {
  const [rechargeState, rechargeAction, rechargePending] = useActionState(walletRecharge, initialWalletState);
  const [refundState, refundAction, refundPending] = useActionState(walletRefund, initialWalletState);
  const [editState, editAction, editPending] = useActionState(walletUpdateTxn, initialWalletState);
  const [deleteState, deleteAction, deletePending] = useActionState(walletDeleteTxn, initialWalletState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const busy = editPending || deletePending;
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const today = new Date().toISOString().slice(0, 10);

  // 2026-10-12 — dead-dropdown fix: the party list was built ONLY from
  // existing wallet history (overview.balances), so on the very first
  // recharge there was no history yet → the select rendered a lone "—",
  // required validation could never pass and Recharge stayed unusable.
  // It now comes from the page's full parties list, grouped Courier-first
  // by the same helper every other form uses; wallet history only decides
  // which party starts out selected.
  const partyGroups = groupPartyOptions(parties);
  const hasParties = partyGroups.length > 0;
  const firstParty = overview.balances[0]?.party_id ?? partyGroups[0]?.parties[0]?.id ?? "";
  const [partyId, setPartyId] = useState(firstParty);

  useEffect(() => {
    if (rechargeState.success || refundState.success) window.location.reload();
  }, [rechargeState.success, refundState.success]);

  // No effect for ✏️/🗑 success: the edit form below is keyed on the
  // row's own values, so when the action's revalidatePath refreshes the
  // data (same roundtrip — Next 16 server-actions guide) the form
  // remounts prefilled with the SAVED values instead of stale input —
  // the save is visible in place, the panel stays open, and a failed
  // save never remounts (typed input survives for correction).

  const partySelect = hasParties ? (
    partyGroups.map((g) => (
      <optgroup key={g.label} label={g.label}>
        {g.parties.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </optgroup>
    ))
  ) : (
    <option value="">—</option>
  );

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
                {partySelect}
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
                {partySelect}
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
            disabled={refundPending || !hasParties}
            className="mt-2 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-40"
          >
            {refundPending ? "Saving…" : "↩️ Record Refund"}
          </button>
        </form>
      </div>

      {/* Recent history — ✏️ edit / 🗑 delete (2026-10-13) */}
      {overview.recent.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">Recent wallet activity</div>
            <div className="text-[10px] text-slate-400">galat entry? ✏️ se theek karo ya 🗑 se hatao</div>
          </div>
          {editState.error && (
            <p className="mb-1 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-600">{editState.error}</p>
          )}
          {!editState.error && deleteState.error && (
            <p className="mb-1 rounded-lg bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-600">{deleteState.error}</p>
          )}
          {!editState.error && !deleteState.error && editState.done && editState.done >= (deleteState.done ?? 0) && (
            <p className="mb-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700">✅ Entry updated.</p>
          )}
          {!editState.error && !deleteState.error && deleteState.done && deleteState.done > (editState.done ?? 0) && (
            <p className="mb-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-700">✅ Entry deleted.</p>
          )}
          <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-100">
            <table className="min-w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {overview.recent.slice(0, 40).map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td className="px-2 py-1 text-slate-400">{t.txn_date}</td>
                      <td className="px-2 py-1">{t.party_name}</td>
                      <td className={`px-2 py-1 font-semibold ${t.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                        {txnLabel(t)} {t.direction === "in" ? "+" : "−"}₹{inr(t.amount)}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{t.payment_mode ?? ""} {t.reference_no ?? ""}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        <button
                          type="button"
                          title="Edit entry"
                          aria-label={`Edit ${txnLabel(t)} entry`}
                          disabled={busy}
                          onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                          className="rounded px-1.5 py-0.5 transition hover:bg-amber-100 disabled:opacity-40"
                        >
                          ✏️
                        </button>
                        <form action={deleteAction} className="inline">
                          <input type="hidden" name="txn_id" value={t.id} />
                          <button
                            type="submit"
                            title="Delete entry"
                            aria-label={`Delete ${txnLabel(t)} entry`}
                            disabled={busy}
                            onClick={(e) => {
                              const invoiceHint =
                                t.txn_type === "consume" ? " The linked invoice will go back to due." : "";
                              if (
                                !window.confirm(
                                  `Delete ${txnLabel(t)} of ₹${inr(t.amount)} for ${t.party_name} (${t.txn_date})?${invoiceHint}`
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                            className="rounded px-1.5 py-0.5 transition hover:bg-rose-100 disabled:opacity-40"
                          >
                            🗑️
                          </button>
                        </form>
                      </td>
                    </tr>
                    {editingId === t.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-2 py-2">
                          <form
                            key={`${t.amount}|${t.txn_date}|${t.payment_mode ?? ""}|${t.reference_no ?? ""}|${t.remark ?? ""}`}
                            action={editAction}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="txn_id" value={t.id} />
                            <div className="w-28">
                              <label className={labelClass}>Amount ₹</label>
                              <input name="amount" type="number" step="0.01" min="0.01" required defaultValue={t.amount} className={inputClass} />
                            </div>
                            <div className="w-36">
                              <label className={labelClass}>Date</label>
                              <input name="txn_date" type="date" required defaultValue={t.txn_date} className={inputClass} />
                            </div>
                            <div className="w-36">
                              <label className={labelClass}>Mode</label>
                              <input name="payment_mode" defaultValue={t.payment_mode ?? ""} placeholder="NEFT / RTGS / UPI" className={inputClass} />
                            </div>
                            <div className="w-36">
                              <label className={labelClass}>UTR / Reference</label>
                              <input name="reference_no" defaultValue={t.reference_no ?? ""} className={inputClass} />
                            </div>
                            <div className="min-w-[160px] flex-1">
                              <label className={labelClass}>Remark</label>
                              <input name="remark" defaultValue={t.remark ?? ""} className={inputClass} />
                            </div>
                            <div className="flex gap-1.5 pb-0.5">
                              <button
                                type="submit"
                                disabled={busy}
                                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
                              >
                                {editPending ? "Saving…" : "💾 Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                ✕ Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
