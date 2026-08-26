"use client";

// 2026-08-12 (round 10): "JIS JIS PO RF RG NO KO SELECT KARE UNKE LIYE JO
// PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE ORDER ME PATA CHAL RHA HAI
// KI KITNE SQ FT MAAL HUA AGAR CM ME HAI TO USKO DEKHE... RATE MANUAL KAR
// DO" — one vendor invoice commonly covers several PO/RF/RG orders. Search
// and add as many orders as the invoice covers, fill the vendor/invoice
// ONCE (shared across all of them), and get one purchase_bills row per
// order. sq ft is suggested from each order's own Size field via
// src/lib/size-parser.ts (handles ft/in/cm/m + mixed compound notation)
// but stays a plain editable number — never silently trusted.
//
// 2026-08-26 — two real complaints on this form: (1) "PO NO select karne
// ka option nahi aata ek ek kar ke karna padta hai jisse kaafi time
// consume hota hai" — adding an order required typing its FULL exact
// ref_no (lookupOrderForPurchaseBill is an exact ILIKE match, no
// wildcards); now typing 2+ characters shows a dropdown of matches to
// click instead of needing the whole number memorized. (2) "har PO me alag
// alag rate aayegi baaki fourmula vahi rahega" — Unit Rate used to be ONE
// value shared across every order (see the 2026-08-17 note below, now
// superseded); real vendor invoices don't always price every PO the same
// per sq ft, so each order now gets its own rate. qty_unit is still
// shared — that part of the 2026-08-17 fix (don't silently mix units
// under one shared invoice) is a separate concern and still holds.
import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import {
  lookupOrderForPurchaseBill,
  savePurchaseBillMulti,
  searchOrdersForPurchaseBill,
  type PurchaseBillMultiState,
  type PurchaseOrderSearchHit,
} from "./actions";
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
  unitRateInput: string; // 2026-08-26 — per-order now, no longer one shared rate
  alreadyBilled: number;
};

export function PurchaseBillMultiForm({ parties }: { parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(savePurchaseBillMulti, initialState);
  const [query, setQuery] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();
  const [isSearching, startSearch] = useTransition();
  const [searchResults, setSearchResults] = useState<PurchaseOrderSearchHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orders, setOrders] = useState<PickedOrder[]>([]);
  // 2026-08-17 — ONE shared unit for the whole invoice, not per-line: every
  // order's Sq. Feet quantity is in this same unit — mixing units under one
  // invoice silently produced wrong totals before this was shared (real bug
  // found live, see db/2026-08-17-purchase-bills-qty-unit.sql). Unit Rate
  // itself is no longer shared (2026-08-26) — only the unit is.
  const [sharedUnit, setSharedUnit] = useState<LengthUnit>("FT");
  // GST is also shared across the whole invoice, same reasoning as unit.
  const [gstRatePct, setGstRatePct] = useState<number | null>(null);
  const [gstType, setGstType] = useState<GstType>("CGST_SGST");
  const [bulkRate, setBulkRate] = useState("");

  function addOrder(order: {
    id: string;
    ref_no: string;
    size_label: string | null;
    qty: number;
    item_category_name: string | null;
    suggested_sq_feet: number | null;
  }, existingBillCount: number) {
    // suggested_sq_feet comes from the order's own Size field, parsed in
    // FEET (src/lib/size-parser.ts) — only usable as-is when the shared
    // unit is still FT; if the invoice's unit is something else, it's
    // not a safe auto-fill (the vendor's MTR/INCH/etc figure isn't the
    // same number as the order's feet-parsed size), so leave it blank
    // for a manual entry instead of quietly suggesting the wrong unit.
    const suggestedSqFeet = sharedUnit === "FT" ? order.suggested_sq_feet ?? 0 : 0;
    setOrders((prev) => [
      ...prev,
      {
        orderId: order.id,
        refNo: order.ref_no,
        sizeLabel: order.size_label,
        categoryName: order.item_category_name,
        qty: order.qty || 1,
        sqFeetAuto: sharedUnit === "FT" && order.suggested_sq_feet != null,
        sqFeetDisplay: suggestedSqFeet ? String(suggestedSqFeet) : "",
        unitRateInput: "",
        alreadyBilled: existingBillCount,
      },
    ]);
  }

  function handleAdd(refNoParam?: string) {
    if (isLooking) return; // guard against a fast double-Enter firing two overlapping lookups for the same PO
    const q = (refNoParam ?? query).trim();
    if (!q) return;
    setShowDropdown(false);
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
      addOrder(r.order, r.existingBillCount);
      setQuery("");
      setSearchResults([]);
    });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setLookupError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimer.current = setTimeout(() => {
      startSearch(async () => {
        const hits = await searchOrdersForPurchaseBill(trimmed);
        setSearchResults(hits);
        setShowDropdown(true);
      });
    }, 300);
  }

  function updateLine(orderId: string, patch: Partial<PickedOrder>) {
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, ...patch } : o)));
  }

  function removeLine(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
  }

  function applyBulkRate() {
    if (!bulkRate.trim()) return;
    setOrders((prev) => prev.map((o) => ({ ...o, unitRateInput: bulkRate })));
  }

  const linesJson = JSON.stringify(
    orders.map((o) => ({
      orderId: o.orderId,
      qty: o.qty,
      sqFeet: Number(o.sqFeetDisplay) || 0,
      unitRate: Number(o.unitRateInput) || 0,
    }))
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
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500">Add PO/RF/RG orders covered by this one vendor invoice</label>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            Sq. Feet unit for all orders below
            <UnitSelect value={sharedUnit} onChange={setSharedUnit} />
          </div>
        </div>
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Type 2+ letters of a PO/RF/RG no. — e.g. A525"
              className={inputClass}
            />
            {showDropdown && (
              <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {isSearching && <p className="px-3 py-2 text-xs text-slate-400">Searching...</p>}
                {!isSearching && searchResults.length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-400">No matching orders.</p>
                )}
                {!isSearching &&
                  searchResults.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      // onMouseDown (not onClick) fires before the input's onBlur closes the dropdown
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleAdd(hit.ref_no);
                      }}
                      disabled={orders.some((o) => o.orderId === hit.id)}
                      className="block w-full border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="font-semibold text-slate-900">{hit.ref_no}</span>{" "}
                      <span className="text-slate-400">
                        — {hit.item_category_name ?? "—"} — {hit.size_label ?? "no size"}
                        {orders.some((o) => o.orderId === hit.id) ? " (already added)" : ""}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleAdd()}
            disabled={isLooking}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isLooking ? "..." : "Add"}
          </button>
        </div>
        {lookupError && <p className="mt-1 text-xs text-red-600">{lookupError}</p>}
      </div>

      {orders.length > 1 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-2">
          <label className="text-[11px] text-slate-500 shrink-0">Fill the same rate on every order below</label>
          <input
            type="number"
            step="0.01"
            value={bulkRate}
            onChange={(e) => setBulkRate(e.target.value)}
            placeholder="e.g. 26.5"
            className={inputClass}
          />
          <button
            type="button"
            onClick={applyBulkRate}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Apply to all
          </button>
        </div>
      )}

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
              <div className="mt-1.5 grid grid-cols-3 gap-2">
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
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Unit Rate (per {sharedUnit})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={o.unitRateInput}
                    onChange={(e) => updateLine(o.orderId, { unitRateInput: e.target.value })}
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
