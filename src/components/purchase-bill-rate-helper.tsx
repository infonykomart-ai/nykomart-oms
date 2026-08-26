"use client";

// 2026-08-26 — "jese kisi purchase party ke bill ki entry kar rahe hai...
// ab kai party ke bill is tarike se aate hai ki item name Plain rug 3*90 ft
// qty 1 price/unit 7155.00 GST 357.75 amount 7512.75, ab ese bill me pahle
// ye nikalna padta hai ki per sq ft kitna hai" — some vendor bills quote one
// lump price for the whole piece (e.g. a rug roll, sized 3X90 FT) rather
// than a per-sq-ft rate, so entering them into Purchase Bill's Sq. Feet +
// Unit Rate fields meant working out sq ft and rate by hand first, every
// time. This is that calculator, inline: type the item's size the same way
// Orders' own Size field is written (reuses src/lib/size-parser.ts, same
// ft/in/cm/mtr/compound parsing already trusted for that) and the vendor's
// one lump price, and it fills Sq. Feet + Unit Rate in below — still a
// plain editable value afterward, never locked, same "suggest, don't
// silently apply" rule size-parser.ts itself follows.
//
// Only usable when the bill's own unit is FT: parseSizeToSqFt always
// resolves a dimension string to feet, so a suggested number can only be
// dropped straight into Sq. Feet when Sq. Feet is itself in feet — same
// guard purchase-bill-multi-form.tsx already applies for its own
// order-Size auto-suggestion (`sharedUnit === "FT"`), same reasoning.
import { useState } from "react";
import { parseSizeToSqFt } from "@/lib/size-parser";

export function PurchaseBillRateHelper({
  qty,
  unitIsFt,
  onApply,
  idPrefix,
}: {
  qty: number;
  unitIsFt: boolean;
  onApply: (sqFeet: number, unitRate: number) => void;
  idPrefix: string;
}) {
  const [sizeText, setSizeText] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function recompute(nextSizeText: string, nextTotalPrice: string) {
    const text = nextSizeText.trim();
    const price = Number(nextTotalPrice) || 0;
    if (!text && !price) {
      setNote(null);
      return;
    }
    if (!unitIsFt) {
      setNote("Switch the unit above to FT to use this — sizes here are always read in feet.");
      return;
    }
    if (!text || price <= 0) {
      setNote(null); // still typing, not enough entered yet — stay quiet
      return;
    }
    const { sqFt } = parseSizeToSqFt(text);
    if (sqFt == null || sqFt <= 0) {
      setNote("Couldn't read that size — enter Sq. Feet and Unit Rate manually below instead.");
      return;
    }
    if (!qty || qty <= 0) {
      setNote("Enter Qty above first, then re-check here.");
      return;
    }
    const rate = price / (qty * sqFt);
    const roundedSqFt = Math.round(sqFt * 1000) / 1000;
    const roundedRate = Math.round(rate * 100) / 100;
    onApply(roundedSqFt, roundedRate);
    setNote(
      `${roundedSqFt} sq ft × ${qty} qty → ₹${roundedRate}/sq ft — filled in below, still editable. Small mismatch vs the vendor's exact total? Use Round Off below to match it.`
    );
  }

  return (
    <div className="col-span-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          Bill gives one lump price for the item (e.g. &quot;Plain rug 3X90 FT&quot;, qty 1, ₹7,155)? Work out the rate/sq ft here.
        </p>
        <button
          type="button"
          onClick={() => recompute(sizeText, totalPrice)}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
        >
          ↻ Recalculate
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[11px] text-slate-400" htmlFor={`${idPrefix}_size_text`}>
            Item Size (e.g. 3X90 FT)
          </label>
          <input
            id={`${idPrefix}_size_text`}
            value={sizeText}
            onChange={(e) => {
              setSizeText(e.target.value);
              recompute(e.target.value, totalPrice);
            }}
            placeholder="3X90 FT"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] text-slate-400" htmlFor={`${idPrefix}_total_price`}>
            Total Price for this item (before GST)
          </label>
          <input
            id={`${idPrefix}_total_price`}
            type="number"
            step="0.01"
            value={totalPrice}
            onChange={(e) => {
              setTotalPrice(e.target.value);
              recompute(sizeText, e.target.value);
            }}
            placeholder="7155"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
      </div>
      {note && <p className="mt-1 text-[11px] text-purple-700">{note}</p>}
    </div>
  );
}
