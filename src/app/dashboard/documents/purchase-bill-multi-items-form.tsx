"use client";

// 2026-08-26 — "agar purchase me ek se jyada item ho — item name Plain rug
// 3*90 ft qty 1 price/unit 7155.00 GST 357.75 amount 7512.75, item name
// Plain rug 3*50 ft qty 1 price/unit .............." — one vendor invoice
// commonly lists several DIFFERENT items, each its own size and its own
// price (so its own rate/sq ft — a 3X50 roll won't price the same per sq
// ft as a 3X90 one). This is deliberately a separate mode from "Multiple
// Orders, One Invoice" (purchase-bill-multi-form.tsx): that one shares ONE
// rate across every line on purpose (many orders billed at the same
// per-unit rate); here every item can have a completely different rate,
// so each item gets its own Sq. Feet + Unit Rate — only Vendor/Invoice
// No./Date/GST are shared. Not order-linked (general-stock purchase, same
// as leaving the order lookup blank on the Single Order form) — each item
// becomes its own purchase_bills row with order_id NULL.
import { useState } from "react";
import { useActionState } from "react";
import { savePurchaseBillMultiItems, type PurchaseBillMultiItemsState } from "./actions";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { UnitSelect } from "@/components/unit-select";
import type { LengthUnit } from "@/lib/length-units";
import { GstSelect, type GstType } from "@/components/gst-select";
import { PurchaseBillRateHelper } from "@/components/purchase-bill-rate-helper";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialState: PurchaseBillMultiItemsState = { error: null, results: null };

let nextClientId = 1;

type ItemLine = {
  clientId: number;
  workDescription: string;
  qty: string;
  sqFeetUnit: LengthUnit;
  sqFeetInput: string;
  unitRateInput: string;
};

function newItemLine(): ItemLine {
  return {
    clientId: nextClientId++,
    workDescription: "",
    qty: "1",
    sqFeetUnit: "FT",
    sqFeetInput: "",
    unitRateInput: "",
  };
}

export function PurchaseBillMultiItemsForm({ parties }: { parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(savePurchaseBillMultiItems, initialState);
  const [items, setItems] = useState<ItemLine[]>([newItemLine()]);

  const [gstRatePct, setGstRatePct] = useState<number | null>(null);
  const [gstType, setGstType] = useState<GstType>("CGST_SGST");

  function updateItem(clientId: number, patch: Partial<ItemLine>) {
    setItems((prev) => prev.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, newItemLine()]);
  }

  function removeItem(clientId: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.clientId !== clientId) : prev));
  }

  const itemsJson = JSON.stringify(
    items.map((it) => ({
      workDescription: it.workDescription || null,
      qty: Number(it.qty) || 1,
      sqFeet: Number(it.sqFeetInput) || 0,
      qtyUnit: it.sqFeetUnit,
      unitRate: Number(it.unitRateInput) || 0,
    }))
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.results && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
          {state.results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.label} — {r.ok ? r.docNo : r.error}
            </p>
          ))}
        </div>
      )}

      <input type="hidden" name="items_json" value={itemsJson} />

      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={it.clientId} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="font-semibold text-slate-900">Item {idx + 1}</p>
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(it.clientId)} className="text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-slate-400">Item / Work Description</label>
              <input
                value={it.workDescription}
                onChange={(e) => updateItem(it.clientId, { workDescription: e.target.value })}
                placeholder="e.g. Plain rug"
                className={inputClass}
              />
            </div>

            <div className="mt-1.5">
              <PurchaseBillRateHelper
                qty={Number(it.qty) || 0}
                unitIsFt={it.sqFeetUnit === "FT"}
                onApply={(sqFeet, unitRate) =>
                  updateItem(it.clientId, { sqFeetInput: String(sqFeet), unitRateInput: String(unitRate) })
                }
                idPrefix={`pbmi_${it.clientId}`}
              />
            </div>

            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Qty</label>
                <input
                  type="number"
                  value={it.qty}
                  onChange={(e) => updateItem(it.clientId, { qty: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Sq. Feet</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={it.sqFeetInput}
                    onChange={(e) => updateItem(it.clientId, { sqFeetInput: e.target.value })}
                    className={inputClass}
                  />
                  <UnitSelect value={it.sqFeetUnit} onChange={(u) => updateItem(it.clientId, { sqFeetUnit: u })} />
                </div>
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">
                  Unit Rate {it.sqFeetUnit !== "FT" && <span className="text-slate-400">(per {it.sqFeetUnit})</span>}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={it.unitRateInput}
                  onChange={(e) => updateItem(it.clientId, { unitRateInput: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      >
        + Add another item
      </button>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="pbmi_party">Vendor Party *</label>
          <select id="pbmi_party" name="vendor_party_id" required defaultValue="" className={inputClass}>
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
          <label className={labelClass} htmlFor="pbmi_inv_no">Vendor Invoice No. * (shared across all items above)</label>
          <input id="pbmi_inv_no" name="vendor_invoice_no" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pbmi_inv_date">Vendor Invoice Date</label>
          <input id="pbmi_inv_date" name="vendor_invoice_date" type="date" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pbmi_gst_rate">GST (shared across all items above)</label>
          <GstSelect ratePct={gstRatePct} onRateChange={setGstRatePct} gstType={gstType} onTypeChange={setGstType} idPrefix="pbmi" />
          <input type="hidden" name="gst_rate_pct" value={gstRatePct ?? ""} />
          <input type="hidden" name="gst_type" value={gstRatePct != null ? gstType : ""} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || items.length === 0}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : `Save Purchase Bill for ${items.length || 0} item(s)`}
      </button>
    </form>
  );
}
