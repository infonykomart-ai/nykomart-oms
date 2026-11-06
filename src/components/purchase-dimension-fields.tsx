"use client";

// 2026-11-05 — "4 × 8 FT" / "30 INCH × 5 FT" style size entry for Purchase
// Bills. Length and Width have their OWN unit selectors (mixed units are the
// point), the calculated area is shown in the chosen output unit and the rate
// can be quoted in a different area unit than the one displayed. Every value
// is derived by src/lib/purchase-measurement.ts → src/lib/measurement.ts, the
// same code the server re-runs before saving.
import {
  AREA_UNITS,
  AREA_UNIT_LABEL,
  LENGTH_UNITS,
  LENGTH_UNIT_LABEL,
  formatMeasurement,
  type AreaUnit,
  type LengthUnit,
} from "@/lib/measurement";
import {
  measurementReference,
  type PurchaseDimensionState,
  type PurchaseMeasurementDerived,
} from "@/lib/purchase-measurement";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const unitClass =
  "shrink-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-600 outline-none focus:border-amber-500";

export function PurchaseDimensionFields({
  value,
  onChange,
  derived,
  qty,
  rateInput,
  precision,
  idPrefix,
  enabledLengthUnits,
  enabledAreaUnits,
}: {
  value: PurchaseDimensionState;
  onChange: (next: PurchaseDimensionState) => void;
  derived: PurchaseMeasurementDerived;
  qty: number;
  rateInput: string;
  precision: number;
  idPrefix: string;
  /** 2026-11-06 — admin's enabled units; current value is always kept visible. */
  enabledLengthUnits?: string[] | null;
  enabledAreaUnits?: string[] | null;
}) {
  function patch(next: Partial<PurchaseDimensionState>) {
    onChange({ ...value, ...next });
  }

  const label = AREA_UNIT_LABEL[value.areaUnit];
  const lengthUnitOptions = LENGTH_UNITS.filter(
    (u) => (!enabledLengthUnits || enabledLengthUnits.length === 0 || enabledLengthUnits.includes(u)) || value.lengthUnit === u || value.widthUnit === u
  );
  const areaUnitOptions = AREA_UNITS.filter(
    (u) => (!enabledAreaUnits || enabledAreaUnits.length === 0 || enabledAreaUnits.includes(u)) || value.areaUnit === u || value.rateUnit === u
  );

  return (
    <div className="col-span-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-700">Size — Length × Width (any units, mixed allowed)</p>
          <p className="text-[11px] text-slate-500">
            Both dimensions are converted to a common base before the area is calculated, then multiplied by Qty.
            Enter a rate per the unit you quote it in — the amount follows the selected area unit.
          </p>
        </div>
        {derived.active && (
          <button
            type="button"
            onClick={() => patch({ length: "", width: "" })}
            className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
          >
            Clear (type area directly)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-0.5 block text-[10px] text-slate-400" htmlFor={`${idPrefix}_length`}>
            Length
          </label>
          <div className="flex gap-1">
            <input
              id={`${idPrefix}_length`}
              type="number"
              min="0"
              step="0.01"
              value={value.length}
              onChange={(e) => patch({ length: e.target.value })}
              placeholder="4"
              className={inputClass}
            />
            <select
              aria-label="Length unit"
              value={value.lengthUnit}
              onChange={(e) => patch({ lengthUnit: e.target.value as LengthUnit })}
              className={unitClass}
            >
              {lengthUnitOptions.map((u) => (
                <option key={u} value={u}>
                  {LENGTH_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-slate-400" htmlFor={`${idPrefix}_width`}>
            Width
          </label>
          <div className="flex gap-1">
            <input
              id={`${idPrefix}_width`}
              type="number"
              min="0"
              step="0.01"
              value={value.width}
              onChange={(e) => patch({ width: e.target.value })}
              placeholder="8"
              className={inputClass}
            />
            <select
              aria-label="Width unit"
              value={value.widthUnit}
              onChange={(e) => patch({ widthUnit: e.target.value as LengthUnit })}
              className={unitClass}
            >
              {lengthUnitOptions.map((u) => (
                <option key={u} value={u}>
                  {LENGTH_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-slate-400" htmlFor={`${idPrefix}_area_unit`}>
            Show / save area in
          </label>
          <select
            id={`${idPrefix}_area_unit`}
            value={value.areaUnit}
            onChange={(e) => patch({ areaUnit: e.target.value as AreaUnit, rateUnit: e.target.value as AreaUnit })}
            className={inputClass}
          >
            {areaUnitOptions.map((u) => (
              <option key={u} value={u}>
                {AREA_UNIT_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-slate-400" htmlFor={`${idPrefix}_rate_unit`}>
            Rate quoted per
          </label>
          <select
            id={`${idPrefix}_rate_unit`}
            value={value.rateUnit}
            onChange={(e) => patch({ rateUnit: e.target.value as AreaUnit })}
            className={inputClass}
          >
            {areaUnitOptions.map((u) => (
              <option key={u} value={u}>
                {AREA_UNIT_LABEL[u]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {derived.active && derived.error && <p className="mt-1.5 text-[11px] font-medium text-red-600">{derived.error}</p>}

      {derived.active && !derived.error && (
        <div className="mt-1.5 space-y-0.5 rounded bg-white/80 px-2 py-1.5 text-[11px] text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">
              Area: {formatMeasurement(derived.totalArea, Math.min(4, Math.max(2, precision)))} {label}
            </span>{" "}
            <span className="text-slate-400">
              (Length × Width × Qty {qty || 0}; per piece {formatMeasurement(derived.storedArea, 4)} {label}, saved to 6 dp)
            </span>
          </p>
          <p className="text-slate-500">{measurementReference(derived, Math.min(4, Math.max(2, precision)))}</p>
          {Number(rateInput) > 0 && derived.unitRate > 0 && (
            <p>
              Rate: ₹{Number(rateInput).toFixed(2)} per {AREA_UNIT_LABEL[value.rateUnit]}
              {value.rateUnit !== value.areaUnit && (
                <>
                  {" "}→ <span className="font-semibold">₹{derived.unitRate.toFixed(2)} per {label}</span>
                </>
              )}{" "}
              · Amount ≈ ₹{((Number(qty) || 0) * derived.area * derived.unitRate).toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
