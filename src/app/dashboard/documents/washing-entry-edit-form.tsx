"use client";

import { useActionState, useEffect, useState } from "react";
import { updateWashingEntry, type DocEditState } from "./actions";
import { RoundOffField } from "./round-off-field";
import { PurchaseDimensionFields } from "@/components/purchase-dimension-fields";
import {
  derivePurchaseMeasurement,
  purchaseDimensionDefaults,
  type PurchaseDimensionState,
  type PurchaseMeasurementDefaults,
} from "@/lib/purchase-measurement";
import { isRoundingMode, roundTo, type AreaUnit, type LengthUnit, type RoundingMode } from "@/lib/measurement";

const initialState: DocEditState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableWashingEntry = {
  id: string;
  chalan_no: string | null;
  chalan_date: string;
  company_id: string;
  party_id: string;
  store_id: string | null;
  item_size: string | null;
  pcs: number | null;
  sq_mtr_ft: number | null;
  rate: number | null;
  debit_charges: number | null;
  /** 2026-10-24b — round-figure adjustment; payable = amount + debit + this. */
  round_off_amt?: number | null;
  // 2026-11-06 — original dimensions/billing unit, when measured.
  length_value?: number | null;
  length_unit?: string | null;
  width_value?: number | null;
  width_unit?: string | null;
  area_value?: number | null;
  area_display_unit?: string | null;
  rate_input_value?: number | null;
  rate_unit?: string | null;
  measurement_precision?: number | null;
  measurement_rounding?: string | null;
};

export function WashingEntryEditForm({
  entry,
  parties,
  stores,
  measurementDefaults,
  measurementPrecision = 2,
  measurementRounding = "HALF_UP",
  onDone,
}: {
  entry: EditableWashingEntry;
  parties: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  measurementDefaults?: PurchaseMeasurementDefaults | null;
  measurementPrecision?: number;
  measurementRounding?: string;
  onDone: () => void;
}) {
  // Use the entry's own saved precision/rounding first. A settings change made
  // after the entry was saved must not silently re-round it on an unrelated
  // edit (party/date/debit charges).
  const precision =
    entry.measurement_precision != null && Number.isFinite(entry.measurement_precision)
      ? Math.max(0, Math.min(6, entry.measurement_precision))
      : measurementPrecision;
  const effectiveRounding = isRoundingMode(entry.measurement_rounding)
    ? entry.measurement_rounding
    : measurementRounding;
  const rounding: RoundingMode = isRoundingMode(effectiveRounding) ? effectiveRounding : "HALF_UP";
  const [state, formAction, pending] = useActionState(updateWashingEntry, initialState);
  // 2026-10-28 — same live round-off preview as the create form.
  const [sqMtr, setSqMtr] = useState(entry.sq_mtr_ft != null ? String(entry.sq_mtr_ft) : "");
  const [pcs, setPcs] = useState(entry.pcs != null ? String(entry.pcs) : "");
  const [rate, setRate] = useState(
    entry.rate_input_value != null
      ? String(entry.rate_input_value)
      : entry.rate != null
        ? String(entry.rate)
        : ""
  );
  const [debit, setDebit] = useState(entry.debit_charges != null ? String(entry.debit_charges) : "");
  const [dimensions, setDimensions] = useState<PurchaseDimensionState>(() => {
    const defaults = purchaseDimensionDefaults(measurementDefaults);
    return {
      ...defaults,
      length: entry.length_value != null ? String(entry.length_value) : "",
      lengthUnit: (entry.length_unit as LengthUnit | null) ?? defaults.lengthUnit,
      width: entry.width_value != null ? String(entry.width_value) : "",
      widthUnit: (entry.width_unit as LengthUnit | null) ?? defaults.widthUnit,
      areaUnit: (entry.area_display_unit as AreaUnit | null) ?? defaults.areaUnit,
      // A row with rate_input_value has the ORIGINAL quoted rate; a legacy
      // measured row only has the converted rate in area_display_unit.
      rateUnit:
        entry.rate_input_value != null
          ? (entry.rate_unit as AreaUnit | null) ?? defaults.rateUnit
          : (entry.area_display_unit as AreaUnit | null) ?? defaults.rateUnit,
    };
  });
  const amountOr0 = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const measurement = derivePurchaseMeasurement(dimensions, amountOr0(pcs), rate, precision, rounding);
  const measured = measurement.active && !measurement.error && measurement.totalArea > 0;
  const billableQty = measured ? roundTo(measurement.totalArea, 4, rounding) : amountOr0(sqMtr);
  const billableRate = measured ? measurement.unitRate : amountOr0(rate);
  const preRoundPayable = Math.round((billableQty * billableRate + amountOr0(debit)) * 100) / 100;

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <input type="hidden" name="id" value={entry.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {entry.chalan_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">Cancel</button>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`we_party_${entry.id}`}>Party *</label>
          <select id={`we_party_${entry.id}`} name="party_id" required defaultValue={entry.party_id} className={inputClass}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_date_${entry.id}`}>Chalan Date *</label>
          <input id={`we_date_${entry.id}`} name="chalan_date" type="date" required defaultValue={entry.chalan_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_store_${entry.id}`}>Store</label>
          <select id={`we_store_${entry.id}`} name="store_id" defaultValue={entry.store_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_size_${entry.id}`}>Item Size</label>
          <input id={`we_size_${entry.id}`} name="item_size" defaultValue={entry.item_size ?? ""} className={inputClass} />
        </div>
        <PurchaseDimensionFields
          value={dimensions}
          onChange={setDimensions}
          derived={measurement}
          qty={amountOr0(pcs)}
          rateInput={rate}
          precision={precision}
          idPrefix={`we_${entry.id}`}
          enabledLengthUnits={measurementDefaults?.enabledLengthUnits}
          enabledAreaUnits={measurementDefaults?.enabledAreaUnits}
        />
        <div>
          <label className={labelClass} htmlFor={`we_pcs_${entry.id}`}>Pcs</label>
          <input id={`we_pcs_${entry.id}`} name="pcs" type="number" value={pcs} onChange={(e) => setPcs(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_sqmtr_${entry.id}`}>Billable Qty (Sq. Mtr / Ft)</label>
          <input
            id={`we_sqmtr_${entry.id}`}
            type="number"
            step="0.01"
            value={measured ? String(billableQty) : sqMtr}
            onChange={(e) => setSqMtr(e.target.value)}
            readOnly={measured}
            className={`${inputClass} ${measured ? "bg-slate-50 text-slate-500" : ""}`}
          />
          {!measured ? <input type="hidden" name="sq_mtr_ft" value={sqMtr} /> : null}
        </div>
        <div>
          <label className={labelClass} htmlFor={`we_rate_${entry.id}`}>Rate</label>
          <input id={`we_rate_${entry.id}`} type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={inputClass} />
          {!measured ? <input type="hidden" name="rate" value={rate} /> : null}
        </div>
        {measured ? (
          <>
            <input type="hidden" name="sq_mtr_ft" value={String(billableQty)} />
            <input type="hidden" name="rate" value={rate} />
            <input type="hidden" name="length_value" value={dimensions.length} />
            <input type="hidden" name="length_unit" value={dimensions.lengthUnit} />
            <input type="hidden" name="width_value" value={dimensions.width} />
            <input type="hidden" name="width_unit" value={dimensions.widthUnit} />
            <input type="hidden" name="area_unit" value={dimensions.areaUnit} />
            <input type="hidden" name="rate_unit" value={dimensions.rateUnit} />
            <input type="hidden" name="measurement_precision" value={String(precision)} />
            <input type="hidden" name="measurement_rounding" value={rounding} />
          </>
        ) : null}
        <div>
          <label className={labelClass} htmlFor={`we_debit_${entry.id}`}>Debit Charges</label>
          <input id={`we_debit_${entry.id}`} name="debit_charges" type="number" step="0.01" value={debit} onChange={(e) => setDebit(e.target.value)} className={inputClass} />
        </div>
        {/* 2026-10-24b — see washing-entry-form.tsx; 2026-10-28 +/− control. */}
        <RoundOffField id={`we_round_${entry.id}`} payable={preRoundPayable} defaultValue={entry.round_off_amt ?? 0} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
