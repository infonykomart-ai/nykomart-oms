"use client";

import { useState, useTransition } from "react";
import { lookupOrderForEntry, type OrderLookup } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * Shared PO/RF/RG lookup box used by Credit Note / Debit Note / Washing
 * Entry forms. Shows the order AND — this is the point of this whole
 * module — whatever's already connected to it: its generated invoice (if
 * any) and any existing Credit/Debit Notes. `onFound` lets the parent form
 * autofill its own fields (company, buyer, invoice values, etc.).
 */
export function OrderLookupBox({ label = "Look up order by PO/RF/RG No.", onFound }: { label?: string; onFound: (result: OrderLookup) => void }) {
  const [refNo, setRefNo] = useState("");
  const [result, setResult] = useState<OrderLookup | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFind() {
    startTransition(async () => {
      const r = await lookupOrderForEntry(refNo);
      setResult(r);
      onFound(r);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input
          value={refNo}
          onChange={(e) => setRefNo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleFind())}
          placeholder="e.g. PO-0001"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleFind}
          disabled={isPending}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isPending ? "..." : "Find"}
        </button>
      </div>

      {result?.error && <p className="mt-2 text-xs text-red-600">{result.error}</p>}

      {result?.order && (
        <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-xs text-slate-600">
          <p>
            <strong className="text-slate-900">{result.order.ref_no}</strong> — {result.order.buyer_name_address || "—"}
          </p>
          <p>
            Value: {result.order.order_value_original} {result.order.order_currency}
            {result.order.order_value_usd ? ` (≈ $${result.order.order_value_usd})` : ""}
          </p>
          {result.invoice ? (
            <p className="text-green-700">
              ✓ Invoice already generated: <strong>{result.invoice.invoice_no}</strong> (Master: {result.invoice.master_invoice_no})
            </p>
          ) : (
            <p className="text-slate-400">No invoice has been generated for this order yet.</p>
          )}
          {result.debitNotes.length > 0 && (
            <p>Debit Notes already raised: {result.debitNotes.map((d) => `${d.debit_note_no ?? "—"} (₹${d.debit_amount})`).join(", ")}</p>
          )}
          {result.creditNotes.length > 0 && (
            <p>Credit Notes already raised: {result.creditNotes.map((c) => `${c.cn_no ?? "—"} (₹${c.refund_amount})`).join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
