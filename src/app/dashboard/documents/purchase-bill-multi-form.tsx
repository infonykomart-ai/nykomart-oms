"use client";

// 2026-08-12 (round 10): "JIS JIS PO RF RG NO KO SELECT KARE UNKE LIYE JO
// PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE ORDER ME PATA CHAL RHA HAI
// KI KITNE SQ FT MAAL HUA AGAR CM ME HAI TO USKO DEKHE... RATE MANUAL KAR
// DO" — one vendor invoice commonly covers several PO/RF/RG orders. Search
// and add as many orders as the invoice covers, fill the vendor/invoice/
// rate ONCE (shared across all of them), and get one purchase_bills row
// per order. sq ft is suggested from each order's own Size field via
// src/lib/size-parser.ts (handles ft/in/cm/m + mixed compound notation)
// but stays a plain editable number — never silently trusted.
import { useState, useTransition } from "react";
import { useActionState } from "react";
import { lookupOrderForPurchaseBill, savePurchaseBillMulti, type PurchaseBillMultiState } from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { UnitSelect } from "@/components/unit-select";
import type { LengthUnit } from "@/lib/length-units";
import { GstSelect, type GstType } from "@/components/gst-select";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: PurchaseBillMultiState = { error: null, results: null };

type PickedOrder = {
  orderId: string;
  refNo: string;
  sizeLabel: string | null;
  categoryName: string | null;
  qty: number;
  sqFeetAuto: boolean; // true while sqFeetDisplay still reflects the parser's own suggestion, not a manual edit
  sqFeetDisplay: string; // the quantity as typed, in the form's ONE shared unit (see sharedUnit below)
  alreadyBilled: number;
};

export function PurchaseBillMultiForm({ parties }: { parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(savePurchaseBillMulti, initialState);
  const [query, setQuery] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();
  const [orders, setOrders] = useState<PickedOrder[]>([]);
  // 2026-08-17 — ONE shared unit for the whole invoice, not per-line: Unit
  // Rate below is a SINGLE rate shared across every order on this invoice
  // (that's the whole point of the multi-PO form — one vendor bill covers
  // many orders), and a rate only means one thing if every line's quantity
  // is in the same unit that rate was quoted in. Real bug found live (see
  // db/2026-08-17-purchase-bills-qty-unit.sql): letting each line pick its
  // own unit while sharing one rate silently mixed units under one price.
  const [sharedUnit, setSharedUnit] = useState<LengthUnit>("FT");
  // GST is also shared across the whole invoice, same reasoning as rate/unit.
  const [gstRatePct, setGstRatePct] = useState<number | null>(null);
  const [gstType, setGstType] = useState<GstType>("CGST_SGST");

  function handleAdd() {
    if (isLooking) return; // guard against a fast double-Enter firing two overlapping lookups for the same PO
    const q = query.trim();
    if (!q) return;
    startLookup(async () => {
      const r = await lookupOrderForPurchaseBill(q);
      if (r.error || !r.order) {
        setLookupError(r.error ?? "Not found.");
        return;
      }
      if (orders.some((o) => o.orderId === r.order!.id)) {
        setLookupError(`${r.order.ref_no} is already added below.`);
        return;
      }
      setLookupError(null);
      // suggested_sq_feet comes from the order's own Size field, parsed in
      // FEET (src/lib/size-parser.ts) — only usable as-is when the shared
      // unit is still FT; if the invoice's unit is something else, it's
      // not a safe auto-fill (the vendor's MTR/INCH/etc figure isn't the
      // same number as the order's feet-parsed size), so leave it blank
      // for a manual entry instead of quietly suggesting the wrong unit.
      const suggestedSqFeet = sharedUnit === "FT" ? r.order!.suggested_sq_feet ?? 0 : 0;
      setOrders((prev) => [
        ...prev,
        {
          orderId: r.order!.id,
          refNo: r.order!.ref_no,
          sizeLabel: r.order!.size_label,
          categoryName: r.order!.item_category_name,
          qty: r.order!.qty || 1,
          sqFeetAuto: sharedUnit === "FT" && r.order!.suggested_sq_feet != null,
          sqFeetDisplay: suggestedSqFeet ? String(suggestedSqFeet) : "",
          alreadyBilled: r.existingBillCount,
        },
      ]);
      setQuery("");
    });
  }

  function updateLine(orderId: string, patch: Partial<PickedOrder>) {
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, ...patch } : o)));
  }

  function removeLine(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
  }

  const linesJson = JSON.stringify(
    orders.map((o) => ({ orderId: o.orderId, qty: o.qty, sqFeet: Number(o.sqFeetDisplay) || 0 }))
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.results && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
          {state.results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {orders.find((o) => o.orderId === r.orderId)?.refNo ?? r.orderId} — {r.ok ? r.docNo : r.error}
            </p>
          ))}
        </div>
      )}

      <input type="hidden" name="lines_json" value={linesJson} />
      <input type="hidden" name="qty_unit" value={sharedUnit} />

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="mb-1 block text-xs font-medium text-slate-500">Add PO/RF/RG orders covered by this one vendor invoice</label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
            placeholder="e.g. PO-0001"
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isLooking}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isLooking ? "..." : "Add"}
          </button>
        </div>
        {lookupError && <p className="mt-1 text-xs text-red-600">{lookupError}</p>}
      </div>

      {orders.length > 0 && (
        <div className="space-y-2">
          {orders.map((o) => (
            <div key={o.orderId} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {o.refNo} <span className="font-normal text-slate-400">— {o.categoryName ?? "—"} — {o.sizeLabel ?? "no size"}</span>
                </p>
                <button type="button" onClick={() => removeLine(o.orderId)} className="text-red-500 hover:underline">Remove</button>
              </div>
              {o.alreadyBilled > 0 && (
                <p className="mt-0.5 text-amber-700">⚠ This order already has {o.alreadyBilled} Purchase Bill(s) — a new one under a different invoice no. is fine.</p>
              )}
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Qty</label>
                  <input
                    type="number"
                    value={o.qty}
                    onChange={(e) => updateLine(o.orderId, { qty: Number(e.target.value) || 1 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">
                    Qty ({sharedUnit}){o.sqFeetAuto && <span className="text-purple-600"> — auto from Size, editable</span>}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={o.sqFeetDisplay}
                    onChange={(e) => updateLine(o.orderId, { sqFeetDisplay: e.target.value, sqFeetAuto: false })}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="pbm_party">Vendor Party *</label>
          <select id="pbm_party" name="vendor_party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select vendor</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pbm_inv_no">Vendor Invoice No. * (shared across all orders above)</label>
          <input id="pbm_inv_no" name="vendor_invoice_no" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pbm_inv_date">Vendor Invoice Date</label>
          <input id="pbm_inv_date" name="vendor_invoice_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pbm_rate">Unit Rate (shared across all orders above)</label>
          <div className="flex gap-1.5">
            <input id="pbm_rate" name="unit_rate" type="number" step="0.01" className={inputClass} />
            <UnitSelect value={sharedUnit} onChange={setSharedUnit} />
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Rate is per {sharedUnit} — every order&apos;s Qty above is in the same unit.</p>
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pbm_desc">Work Description</label>
          <input id="pbm_desc" name="work_description" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pbm_gst_rate">GST (shared across all orders above)</label>
          <GstSelect ratePct={gstRatePct} onRateChange={setGstRatePct} gstType={gstType} onTypeChange={setGstType} idPrefix="pbm" />
          <input type="hidden" name="gst_rate_pct" value={gstRatePct ?? ""} />
          <input type="hidden" name="gst_type" value={gstRatePct != null ? gstType : ""} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || orders.length === 0}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : `Save Purchase Bill for ${orders.length || 0} order(s)`}
      </button>
    </form>
  );
}
