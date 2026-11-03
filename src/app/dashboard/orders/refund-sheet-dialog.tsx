"use client";

// 2026-11-03 — extracted out of order-hold-cancel-actions.tsx so the
// Returns/Refunds report can open the EXACT same read-only A4 refund sheet
// from its own section ("isi section se ... po ya order no select kar to us
// order ki sari detail auto fill hokar a4 ka form open ho jaye read only or
// phir option ho ki kis reason ka refund kiya ja raha"). One component, one
// save action, one print layout — the orders page and the returns page can
// never drift apart.
//
// Also new in this round: the conversion-rate panel. It shows the order-date
// rate that produced the order's own INR value next to the refund-date rate
// the refund will be converted at, because those two rates differ whenever
// the rupee moves and that difference used to surface only as a confusing
// "exceeds the order's value" error (see saveOrderRefundCore's FX note).

import { useActionState, useEffect, useMemo, useState } from "react";
import { A4Dialog } from "@/components/a4-dialog";
import { PrintArea } from "@/components/print-view";
import { getRefundFxPreview, saveOrderRefund, type OrderRefundState, type RefundFxPreview } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const initialRefundState: OrderRefundState = { error: null, success: null };

// 10% steps up to Full Refund — the user's own ask: "10% 20% 30% to 100%
// manual entry or dropdown number 10 to 100% and calculation automatic".
const REFUND_PERCENT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export type RefundSheetOrder = {
  id: string;
  ref_no: string;
  status: string;
  order_currency: string;
  order_value_original: number;
  buyer_name_address?: string | null;
  marketplace_order_no?: string | null;
};

function money(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);
}

export function RefundSheetDialog({
  order,
  currencies,
  onClose,
  onSaved,
}: {
  order: RefundSheetOrder;
  currencies: { code: string; name: string }[];
  onClose: () => void;
  onSaved?: (creditNoteNo: string | null) => void;
}) {
  const [refundState, refundAction, refundPending] = useActionState(saveOrderRefund, initialRefundState);

  // Refund calculator state — the amount field is the actual submitted
  // value; the % / Shipping / Duty inputs only ever write INTO it.
  const [refundBasisPercent, setRefundBasisPercent] = useState("");
  const [shippingRefund, setShippingRefund] = useState("");
  const [dutyRefund, setDutyRefund] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundDate, setRefundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refundReason, setRefundReason] = useState("");
  const [refundCurrency, setRefundCurrency] = useState(order.order_currency);
  const [fx, setFx] = useState<RefundFxPreview | null>(null);

  // 2026-11-02 — the currency dropdown listed only the currency master. If the
  // order's own currency isn't in that list (a marketplace order in GBP before
  // GBP was added, say), the <select> had no matching option, so it displayed
  // the FIRST currency while the form still meant another one — and a refund
  // could be saved in the wrong currency. The order's own currency is now
  // always offered, and selected.
  const refundCurrencyOptions = useMemo(() => {
    const codes = currencies.map((c) => c.code);
    return codes.includes(order.order_currency) ? codes : [order.order_currency, ...codes];
  }, [currencies, order.order_currency]);

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
    // or a shipping/duty amount was typed) — plain manual entry stays
    // untouched.
    if (nextBasisPercent || Number(nextShipping) > 0 || Number(nextDuty) > 0) {
      setRefundAmount(total ? total.toFixed(2) : "");
    }
  }

  // Conversion-rate panel (read-only). Re-runs whenever the currency, date
  // or amount changes; a failure just leaves the panel hidden — it must
  // never block saving the refund.
  useEffect(() => {
    let cancelled = false;
    getRefundFxPreview(order.id, refundCurrency, refundDate, Number(refundAmount) || 0)
      .then((preview) => {
        if (!cancelled && !preview.error) setFx(preview);
      })
      .catch(() => {
        /* preview is informational only — ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [order.id, refundCurrency, refundDate, refundAmount]);

  // Parent shows the "Refund saved" line and closes this dialog. Done in an
  // effect (not during render) because it updates the PARENT's state, and
  // react-hooks forbids setState-in-effect only for this component's own
  // synchronous state — a saved refund is an external event, so this is the
  // correct place for it.
  const savedCreditNoteNo = refundState.success?.creditNoteNo ?? null;
  const saved = refundState.success != null;
  useEffect(() => {
    if (!saved) return;
    onSaved?.(savedCreditNoteNo);
    onClose();
  }, [saved, savedCreditNoteNo, onSaved, onClose]);

  const orderRate = fx?.order?.rate ?? null;
  const refundRate = fx?.refund?.rate ?? null;

  return (
    <A4Dialog
      open
      onClose={onClose}
      title={`Refund — ${order.ref_no}`}
      subtitle={`Order value ${Number(order.order_value_original || 0).toFixed(2)} ${order.order_currency} · status ${order.status}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            {order.buyer_name_address ? order.buyer_name_address.slice(0, 60) : "Read-only order details on the sheet"}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              🖨 Print Refund Sheet
            </button>
            <button
              type="button"
              onClick={onClose}
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

          {/* Refund calculator: pick a % of order value and/or type
              Shipping/Duty amounts, they auto-sum into Refund Amount below.
              Purely a suggestion — Refund Amount stays editable. */}
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
                {refundCurrencyOptions.length > 0
                  ? refundCurrencyOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
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

          {/* Conversion rates — order date vs refund date. */}
          {fx && (
            <div className="grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-600 sm:grid-cols-2 print:hidden">
              <p>
                <span className="font-medium text-slate-500">Order-date rate:</span>{" "}
                {orderRate != null
                  ? `₹${orderRate.toFixed(2)} / ${order.order_currency} (${fx.order?.date}) → ₹${money(fx.order?.valueInr)}`
                  : "rate unavailable"}
              </p>
              <p>
                <span className="font-medium text-slate-500">Refund-date rate:</span>{" "}
                {refundRate != null
                  ? `₹${refundRate.toFixed(2)} / ${refundCurrency} (${fx.refund?.date}) → ₹${money(fx.refund?.valueInr)}`
                  : "enter amount / date"}
              </p>
              <p className="sm:col-span-2 text-[10px] text-slate-400">
                Refund is capped in the order&apos;s own currency ({order.order_currency}); a different-currency refund is
                compared converted at the refund-date rate, so rate movement between the two dates cannot block a valid refund. {fx.source}
              </p>
            </div>
          )}
        </form>

        {/* Printable refund sheet — read-only order details + what is being
            refunded, reason included. Prints A4 via the shared PrintArea. */}
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
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Buyer</dt>
                <dd className="text-slate-800">{order.buyer_name_address || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {order.marketplace_order_no ? "Marketplace Order No." : "Order Status"}
                </dt>
                <dd className="text-slate-800">{order.marketplace_order_no || order.status}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order Status</dt>
                <dd className="text-slate-800">{order.status}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Order Value</dt>
                <dd className="text-slate-800">
                  {Number(order.order_value_original || 0).toFixed(2)} {order.order_currency}
                  {fx?.order?.valueInr != null ? ` (₹${money(fx.order.valueInr)})` : ""}
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
              {(orderRate != null || refundRate != null) && (
                <div className="col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conversion Rate</dt>
                  <dd className="text-slate-800">
                    {orderRate != null ? `Order date ${fx?.order?.date}: ₹${orderRate.toFixed(2)}/${order.order_currency}` : "Order-date rate —"}
                    {"  ·  "}
                    {refundRate != null ? `Refund date ${fx?.refund?.date}: ₹${refundRate.toFixed(2)}/${refundCurrency}` : "Refund-date rate —"}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 print:border-slate-300 print:bg-white">
              <span className="text-sm font-semibold text-slate-600">Refund Amount</span>
              <span className="text-lg font-bold text-slate-900">
                {(Number(refundAmount) || 0).toFixed(2)} {refundCurrency}
                {fx?.refund?.valueInr != null ? ` · ₹${money(fx.refund.valueInr)}` : ""}
              </span>
            </div>

            <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              On save: an invoiced order auto-generates a Credit Note for this amount, the goods are restocked, and the
              entry appears under Returns &amp; Refunds. Totals can never exceed the order&apos;s own value.
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
  );
}
