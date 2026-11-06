"use client";

import { useActionState, useState } from "react";
import { saveWashingEntry, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { RoundOffField } from "./round-off-field";
import { PurchaseDimensionFields } from "@/components/purchase-dimension-fields";
import {
  derivePurchaseMeasurement,
  purchaseDimensionDefaults,
  type PurchaseDimensionState,
  type PurchaseMeasurementDefaults,
} from "@/lib/purchase-measurement";
import { isRoundingMode, roundTo, type RoundingMode } from "@/lib/measurement";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function WashingEntryForm({
  companies,
  parties,
  stores,
  measurementDefaults,
  measurementPrecision = 2,
  measurementRounding = "HALF_UP",
}: {
  companies: { id: string; name: string }[];
  parties: { id: string; name: string }[];
  stores: { id: string; name: string; company_id: string }[];
  measurementDefaults?: PurchaseMeasurementDefaults | null;
  measurementPrecision?: number;
  measurementRounding?: string;
}) {
  const rounding: RoundingMode = isRoundingMode(measurementRounding) ? measurementRounding : "HALF_UP";
  const [state, formAction, pending] = useActionState(saveWashingEntry, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  // 2026-10-28 — "washing ... round off karne ke liye option ... + & -":
  // the payable is the stored formula amount + debit charges, so the
  // round-off control can show what it is rounding.
  const [sqMtr, setSqMtr] = useState("");
  const [pcs, setPcs] = useState("");
  const [rate, setRate] = useState("");
  const [debit, setDebit] = useState("");
  const [dimensions, setDimensions] = useState<PurchaseDimensionState>(() =>
    purchaseDimensionDefaults(measurementDefaults)
  );
  const amountOr0 = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const measurement = derivePurchaseMeasurement(dimensions, amountOr0(pcs), rate, measurementPrecision, rounding);
  const measured = measurement.active && !measurement.error && measurement.totalArea > 0;
  const billableQty = measured ? roundTo(measurement.totalArea, 4, rounding) : amountOr0(sqMtr);
  const billableRate = measured ? measurement.unitRate : amountOr0(rate);
  const preRoundPayable = Math.round((billableQty * billableRate + amountOr0(debit)) * 100) / 100;

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
  }

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Washing Entry created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />

      <OrderLookupBox label="Find order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="we_company">Company *</label>
          <select id="we_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_party">Party *</label>
          <select id="we_party" name="party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_date">Chalan Date *</label>
          <input id="we_date" name="chalan_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_store">Store</label>
          <select id="we_store" name="store_id" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {stores.filter((s) => s.company_id === companyId).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="we_size">Item Size</label>
          <input id="we_size" name="item_size" className={inputClass} />
        </div>
        <PurchaseDimensionFields
          value={dimensions}
          onChange={setDimensions}
          derived={measurement}
          qty={amountOr0(pcs)}
          rateInput={rate}
          precision={measurementPrecision}
          idPrefix="we"
          enabledLengthUnits={measurementDefaults?.enabledLengthUnits}
          enabledAreaUnits={measurementDefaults?.enabledAreaUnits}
        />
        <div>
          <label className={labelClass} htmlFor="we_pcs">Pcs</label>
          <input id="we_pcs" name="pcs" type="number" value={pcs} onChange={(e) => setPcs(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="we_sqmtr">Billable Qty (Sq. Mtr / Ft)</label>
          <input
            id="we_sqmtr"
            type="number"
            step="0.01"
            value={measured ? String(billableQty) : sqMtr}
            onChange={(e) => setSqMtr(e.target.value)}
            readOnly={measured}
            title={measured ? "Calculated from Length × Width × Pcs in the selected billing unit." : undefined}
            className={`${inputClass} ${measured ? "bg-slate-50 text-slate-500" : ""}`}
          />
          {!measured ? <input type="hidden" name="sq_mtr_ft" value={sqMtr} /> : null}
        </div>
        <div>
          <label className={labelClass} htmlFor="we_rate">Rate</label>
          <input id="we_rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />
          {!measured ? <input type="hidden" name="rate" value={rate} /> : null}
        </div>
        {measured ? (
          <>
            <input type="hidden" name="sq_mtr_ft" value={String(billableQty)} />
            {/* Original quoted rate — the server converts it from rate_unit. */}
            <input type="hidden" name="rate" value={rate} />
            <input type="hidden" name="length_value" value={dimensions.length} />
            <input type="hidden" name="length_unit" value={dimensions.lengthUnit} />
            <input type="hidden" name="width_value" value={dimensions.width} />
            <input type="hidden" name="width_unit" value={dimensions.widthUnit} />
            <input type="hidden" name="area_unit" value={dimensions.areaUnit} />
            <input type="hidden" name="rate_unit" value={dimensions.rateUnit} />
            <input type="hidden" name="measurement_precision" value={String(measurementPrecision)} />
            <input type="hidden" name="measurement_rounding" value={rounding} />
          </>
        ) : null}
        <div>
          <label className={labelClass} htmlFor="we_debit">Debit Charges</label>
          <input id="we_debit" name="debit_charges" type="number" step="0.01" value={debit} onChange={(e) => setDebit(e.target.value)} className={inputClass} />
        </div>
        {/* 2026-10-24b — "ROUND FIGURE SET KARNE KA OPTION ... WASHING": the
            difference goes in round-off so the payable lands on the round
            figure while amount × rate stays exactly as computed.
            2026-10-28 — now the shared +/− control. */}
        <RoundOffField id="we_round_new" payable={preRoundPayable} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Washing Entry"}
      </button>
    </form>
  );
}
