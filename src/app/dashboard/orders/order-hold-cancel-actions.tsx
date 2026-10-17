"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { A4Dialog } from "@/components/a4-dialog";
import { PrintArea } from "@/components/print-view";
import { holdOrder, cancelOrder, returnOrder, saveOrderRefund, type OrderRefundState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const initialRefundState: OrderRefundState = { error: null, success: null };

// 10% steps up to Full Refund — the user's own ask: "10% 20% 30% to 100%
// manual entry or dropdown number 10 to 100% and calculation automatic".
const REFUND_PERCENT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// Pending item 2 (2026-08-08) — Hold/Cancel + the Refund entry that follows
// Cancel. Design confirmed with the user: Hold blocks the order from
// further action entirely (see invoices module's exclusion of Hold orders);
// refund amount is always case-by-case manual entry (never auto-computed);
// and a refund against an already-invoiced order auto-generates a Credit
// Note (see saveOrderRefund in actions.ts) while a not-yet-dispatched
// order's refund is just its own row — this component doesn't need to know
// which path it took, only report back whether a Credit Note came out of it.
//
// 2026-08-25 — added a second, separate path: Return + Refund. User's own
// clarification (verbatim): an order with no work done on it that gets
// cancelled needs no Credit Note, just an entry in Cancel & Refund — that's
// the EXISTING Cancel button, unchanged, still correct for pre-dispatch
// orders. But an order that WAS invoiced/dispatched/delivered, and the
// buyer returns it after delivery for a customer-satisfaction refund, is
// NOT a cancellation — "order to dispatch kar diya cancel thodi hua hai" —
// so it now gets its own "↩️ Return & Refund" button (only shown once the
// order has actually shipped) that sets status to 'Returned' instead of
// 'Cancelled' via the new returnOrder action, then opens the exact same
// refund form below (still auto-generates a Credit Note the same way,
// still lands in the Returns report's "Dispatch & Refund" bucket — that
// bucket is keyed off whether a Credit Note exists, not off which button
// was clicked).
//
// Also added: an optional refund-amount CALCULATOR (percent-of-order-value
// dropdown + separate Shipping/Duty fields, auto-summed) ahead of the
// amount field. It only ever SUGGESTS a number into that field — the field
// stays a normal editable input, so "case-by-case decide karna padta hai"
// is still the last word. User's own confirmation: "Full refund ka matlab
// hai order value 100% refund" — the % dropdown is against order value
// ONLY; Shipping/Duty are always separate add-ons on top, never folded into
// the percentage itself.
//
// 2026-08-25, same round, second clarification — a refund doesn't always
// mean the order was returned at all: "kai baar hota hai ki country policy
// ke acording duty & taxes lag jata hai to buyer deny karta hai is vajh se
// bhi refund karte hai" (destination customs charges an unexpected duty,
// buyer balks, so a PARTIAL DUTY-ONLY refund is negotiated — e.g. 20 EUR
// duty becomes a 10 EUR refund — as a goodwill gesture so the buyer keeps
// the order). That's neither a Cancel nor a Return: the order stays exactly
// where it is (Dispatched/Delivered), only money moves. So "💸 Add Refund"
// now also opens directly on Dispatched/Delivered orders, with no status
// change and no Cancel/Return click needed first — set the % dropdown to
// Manual (or 0), type only the Duty amount, save. The Cancel/Return buttons
// stay for when the order's OWN status genuinely needs to change.
//
// Also: no longer blocks a second refund entry on the same order once one
// exists (previously `!hasExistingRefund` hid the button entirely) — a
// duty-only goodwill refund now and a full Return refund later on the same
// order is a real sequence this flow needs to allow. Every prior refund on
// this order is already listed inline above these buttons (order-list-
// table.tsx), so nothing about refund history is hidden by allowing more.
export function OrderHoldCancelActions({
  order,
  hasExistingRefund,
  currencies,
}: {
  order: { id: string; ref_no: string; status: string; order_currency: string; order_value_original: number };
  hasExistingRefund: boolean;
  currencies: { code: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundState, refundAction, refundPending] = useActionState(saveOrderRefund, initialRefundState);

  // Refund calculator state — see header comment. `refundAmount` is the
  // actual submitted field; the other three only ever write INTO it.
  const [refundBasisPercent, setRefundBasisPercent] = useState("");
  const [shippingRefund, setShippingRefund] = useState("");
  const [dutyRefund, setDutyRefund] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  // 2026-10-17 — "refund vala system … iske liye bhi A4 size dialog box
  // open ho": the form now lives in the shared A4Dialog WITH a printable
  // refund sheet below it, so date/reason are controlled state too (the
  // sheet prints exactly what's on screen).
  const [refundDate, setRefundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refundReason, setRefundReason] = useState("");
  const [refundCurrency, setRefundCurrency] = useState(order.order_currency);

  const orderValueRefundAmount = useMemo(() => {
    if (!refundBasisPercent) return 0;
    return (Number(order.order_value_original) || 0) * (Number(refundBasisPercent) / 100);
  }, [refundBasisPercent, order.order_value_original]);

  function recalculate(nextBasisPercent: string, nextShipping: string, nextDuty: string) {
    const orderPortion = nextBasisPercent
      ? (Number(order.order_value_original) || 0) * (Number(nextBasisPercent) / 100)
      : 0;
    const total = orderPortion + (Number(nextShipping) || 0) + (Number(nextDuty) || 0);
    // Only auto-fill once the calculator is actually in use (a % is picked,
    // or a shipping/duty amount was typed) — otherwise leave the amount
    // field alone so plain manual entry (the original behavior) is
    // untouched.
    if (nextBasisPercent || Number(nextShipping) > 0 || Number(nextDuty) > 0) {
      setRefundAmount(total ? total.toFixed(2) : "");
    }
  }

  // 2026-08-25 — a successful save used to replace this ENTIRE component
  // with just the "Refund saved" line (see the removed early-return below),
  // permanently hiding Hold/Cancel/Return/Add-Refund for that order row for
  // as long as the page stayed open. That was harmless when only one refund
  // per order was ever allowed, but now that a second later refund is a
  // real case (duty goodwill now, a full return later), permanently hiding
  // the buttons would block exactly that. Close the form instead — the
  // server-refreshed refund list above (order-list-table.tsx) already shows
  // the authoritative saved row; this is just closing the now-done form.
  // Adjusted during render (project convention, see company-switcher.tsx's
  // prevPending — the react-hooks/set-state-in-effect lint rule forbids a
  // synchronous setState inside a useEffect body), not inside a useEffect.
  const [prevRefundSuccess, setPrevRefundSuccess] = useState(refundState.success);
  if (refundState.success !== prevRefundSuccess) {
    setPrevRefundSuccess(refundState.success);
    if (refundState.success) setShowRefundForm(false);
  }

  function openWhatsApp(text: string) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function handleHold() {
    setError(null);
    startTransition(async () => {
      const result = await holdOrder(order.id);
      if (result.error) setError(result.error);
      else openWhatsApp(`${order.ref_no} Hold this order`);
    });
  }

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOrder(order.id);
      if (result.error) setError(result.error);
      else {
        openWhatsApp(`${order.ref_no} Cancel this order`);
        setShowRefundForm(true);
      }
    });
  }

  function handleReturn() {
    setError(null);
    startTransition(async () => {
      const result = await returnOrder(order.id);
      if (result.error) setError(result.error);
      else {
        openWhatsApp(`${order.ref_no} Returned by buyer after delivery — refund being processed`);
        setShowRefundForm(true);
      }
    });
  }

  const canHold = order.status !== "Hold" && order.status !== "Cancelled" && order.status !== "Returned";
  // Cancel stays for pre-dispatch orders — nothing shipped yet, so
  // "cancelling" it is the accurate word.
  const canCancel = !["Dispatched", "Delivered", "Cancelled", "Returned"].includes(order.status);
  // Return & Refund is the post-delivery counterpart — only once it's
  // actually shipped, per the user's clarification above.
  const canReturn = ["Dispatched", "Delivered"].includes(order.status);
  // "💸 Add Refund" is deliberately broader than Cancel/Return: also opens
  // directly on Dispatched/Delivered orders with NO status change, for a
  // goodwill/partial refund (e.g. duty-only) where the order itself isn't
  // being cancelled or sent back — see header comment. No longer blocked by
  // an existing refund, either — a second refund later on the same order is
  // a real sequence (duty goodwill now, a full return later).
  const canAddRefund = ["Cancelled", "Returned", "Dispatched", "Delivered"].includes(order.status);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {refundState.success && !showRefundForm && (
        <p className="rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-800">
          Refund saved{refundState.success.creditNoteNo ? ` — Credit Note ${refundState.success.creditNoteNo} auto-generated.` : "."}
        </p>
      )}
      <div className="flex shrink-0 gap-2">
        {canHold && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleHold}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            ⏸ Hold
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            ✕ Cancel
          </button>
        )}
        {canReturn && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleReturn}
            title="Order already shipped — buyer is returning it after delivery"
            className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          >
            ↩️ Return &amp; Refund
          </button>
        )}
        {canAddRefund && !showRefundForm && (
          <button
            type="button"
            onClick={() => setShowRefundForm(true)}
            title={
              order.status === "Dispatched" || order.status === "Delivered"
                ? "Goodwill/partial refund (e.g. duty & taxes) — order status stays unchanged"
                : undefined
            }
            className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            💸 {hasExistingRefund ? "Add Another Refund" : "Add Refund"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* 2026-10-17 — the refund form now opens in the SHARED A4 dialog
          (same one every edit/view/print surface in the app uses) with a
          printable refund sheet under it: fill the form, press Save — or
          Print the sheet first for a paper/PDF record. Same server action,
          same validation, same credit-note/restock behaviour as before. */}
      {showRefundForm && (
        <A4Dialog
          open
          onClose={() => setShowRefundForm(false)}
          title={`Refund — ${order.ref_no}`}
          subtitle={`Order value ${Number(order.order_value_original || 0).toFixed(2)} ${order.order_currency} · status ${order.status}`}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                🖨 Print Refund Sheet
              </button>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowRefundForm(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  form="order-refund-form"
                  disabled={refundPending}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {refundPending ? "Saving…" : "Save Refund"}
                </button>
              </div>
            </div>
          }
        >
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <form id="order-refund-form" action={refundAction} className="space-y-2.5 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
              <input type="hidden" name="order_id" value={order.id} />
              {refundState.error && <p className="text-xs text-red-600">{refundState.error}</p>}

          {/* 2026-08-25 — refund calculator: pick a % of order value and/or
              type Shipping/Duty amounts, they auto-sum into Refund Amount
              below. Purely a suggestion — Refund Amount stays editable. */}
          <div className="rounded-md border border-teal-100 bg-white/60 p-1.5">
            <label className="mb-0.5 block text-[10px] font-medium text-slate-500">
              Refund Calculator (optional — order value {Number(order.order_value_original || 0).toFixed(2)} {order.order_currency})
            </label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-0.5 block text-[9px] text-slate-400">% of order value</label>
                <select
                  name="refund_basis_percent"
                  value={refundBasisPercent}
                  onChange={(e) => {
                    setRefundBasisPercent(e.target.value);
                    recalculate(e.target.value, shippingRefund, dutyRefund);
                  }}
                  className={inputClass}
                >
                  <option value="">Manual</option>
                  {REFUND_PERCENT_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p === 100 ? "100% (Full)" : `${p}%`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] text-slate-400">Shipping</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={shippingRefund}
                  onChange={(e) => {
                    setShippingRefund(e.target.value);
                    recalculate(refundBasisPercent, e.target.value, dutyRefund);
                  }}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[9px] text-slate-400">Duty &amp; Taxes</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={dutyRefund}
                  onChange={(e) => {
                    setDutyRefund(e.target.value);
                    recalculate(refundBasisPercent, shippingRefund, e.target.value);
                  }}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
          {/* Hidden breakdown fields — stored alongside the total purely for
              reporting; see saveOrderRefund's header comment. */}
          <input type="hidden" name="order_value_refund_amount" value={orderValueRefundAmount || 0} />
          <input type="hidden" name="shipping_refund_amount" value={shippingRefund || 0} />
          <input type="hidden" name="duty_refund_amount" value={dutyRefund || 0} />

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Refund Amount *</label>
                  <input
                    name="refund_amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Currency</label>
                  <select
                    name="refund_currency"
                    value={refundCurrency}
                    onChange={(e) => setRefundCurrency(e.target.value)}
                    className={inputClass}
                  >
                    {currencies.length > 0
                      ? currencies.map((c) => (
                          <option key={c.code} value={c.code}>{c.code}</option>
                        ))
                      : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Refund Date *</label>
                  <input
                    name="refund_date"
                    type="date"
                    required
                    value={refundDate}
                    onChange={(e) => setRefundDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-500">Reason</label>
                  <input name="reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className={inputClass} />
                </div>
              </div>
            </form>

            {/* Printable refund sheet — prints A4 (the shared PrintArea's
                @page) with only this sheet visible, exactly like every
                other in-page dialog document in the app. */}
            <PrintArea id={`refund-sheet-${order.id}`}>
              <article className="rounded-lg border border-slate-200 bg-white p-6 text-slate-900 print:rounded-none print:border-0 print:p-0">
                <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
                  <div>
                    <h1 className="text-lg font-bold tracking-wide text-slate-900">REFUND RECORD</h1>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500">
                      Cancel / Return / Goodwill refund — order {order.ref_no}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div className="text-sm font-semibold text-slate-900">{order.ref_no}</div>
                    <div>Date: {refundDate}</div>
                  </div>
                </header>

                <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order Status</dt>
                    <dd className="text-slate-800">{order.status}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order Value</dt>
                    <dd className="text-slate-800">
                      {Number(order.order_value_original || 0).toFixed(2)} {order.order_currency}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Basis</dt>
                    <dd className="text-slate-800">
                      {refundBasisPercent ? `${refundBasisPercent}% of order value` : "Manual"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order Value Portion</dt>
                    <dd className="text-slate-800">
                      {orderValueRefundAmount ? `${orderValueRefundAmount.toFixed(2)} ${order.order_currency}` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Shipping Refund</dt>
                    <dd className="text-slate-800">{Number(shippingRefund || 0) > 0 ? Number(shippingRefund).toFixed(2) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Duty &amp; Taxes Refund</dt>
                    <dd className="text-slate-800">{Number(dutyRefund || 0) > 0 ? Number(dutyRefund).toFixed(2) : "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reason</dt>
                    <dd className="text-slate-800">{refundReason || "—"}</dd>
                  </div>
                </dl>

                <div className="mt-5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 print:border-slate-300 print:bg-white">
                  <span className="text-sm font-semibold text-slate-600">Refund Amount</span>
                  <span className="text-lg font-bold text-slate-900">
                    {(Number(refundAmount) || 0).toFixed(2)} {refundCurrency}
                  </span>
                </div>

                <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                  On save: an invoiced order auto-generates a Credit Note for this amount, the goods are
                  restocked, and the entry appears under Returns &amp; Refunds. Totals can never exceed the
                  order&apos;s own value.
                </p>

                <div className="mt-12 flex justify-end">
                  <div className="w-52 border-t border-slate-400 pt-1 text-center text-[11px] text-slate-500">
                    Authorised Signatory
                  </div>
                </div>
              </article>
            </PrintArea>
          </div>
        </A4Dialog>
      )}
    </div>
  );
}
