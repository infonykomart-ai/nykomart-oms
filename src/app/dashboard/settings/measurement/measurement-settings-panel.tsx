"use client";

// 2026-11-05 — Measurement Settings form (OMS Settings → Measurement).
// Company-wide defaults only: the engine (src/lib/measurement.ts) and every
// saved row keep their own original units, so nothing historical changes.
//
// 2026-11-06 — admin-configurable available units, weight/count defaults,
// rounding mode and per-module billing defaults.
import { useState, useTransition } from "react";
import {
  AREA_UNITS,
  AREA_UNIT_LABEL,
  LENGTH_UNITS,
  LENGTH_UNIT_LABEL,
  QUANTITY_UNITS,
  QUANTITY_UNIT_LABEL,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABEL,
  type AreaUnit,
  type LengthUnit,
  type QuantityUnit,
  type RoundingMode,
  type WeightUnit,
} from "@/lib/measurement";
import { saveMeasurementSettings, type ModuleMeasurementDefaults } from "./actions";

export type MeasurementSettingsValues = {
  default_dimension_unit: string;
  default_area_unit: string;
  default_rate_unit: string;
  default_report_unit: string;
  decimal_precision: number;
  enabled_length_units: string[] | null;
  enabled_area_units: string[] | null;
  enabled_weight_units: string[] | null;
  enabled_quantity_units: string[] | null;
  default_weight_unit: string;
  default_quantity_unit: string;
  rounding_mode: string;
  module_defaults: ModuleMeasurementDefaults | null;
};

const selectClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

function toggleUnit<T extends string>(current: T[], unit: T, all: readonly T[]): T[] {
  const next = current.includes(unit) ? current.filter((u) => u !== unit) : [...current, unit];
  return next.length > 0 ? next : [...all];
}

function UnitToggles<T extends string>({
  label,
  units,
  labels,
  selected,
  onChange,
}: {
  label: string;
  units: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {units.map((u) => {
          const active = selected.includes(u);
          return (
            <button
              key={u}
              type="button"
              onClick={() => onChange(toggleUnit(selected, u, units))}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${active ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-400 line-through"}`}
            >
              {labels[u]}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Click to enable/disable. At least one unit always stays available.</p>
    </div>
  );
}

export function MeasurementSettingsPanel({ settings }: { settings: MeasurementSettingsValues }) {
  const [dimensionUnit, setDimensionUnit] = useState<LengthUnit>(settings.default_dimension_unit as LengthUnit);
  const [areaUnit, setAreaUnit] = useState<AreaUnit>(settings.default_area_unit as AreaUnit);
  const [rateUnit, setRateUnit] = useState<AreaUnit>(settings.default_rate_unit as AreaUnit);
  const [reportUnit, setReportUnit] = useState<AreaUnit>(settings.default_report_unit as AreaUnit);
  const [precision, setPrecision] = useState(settings.decimal_precision);
  const [lengthUnits, setLengthUnits] = useState<LengthUnit[]>((settings.enabled_length_units as LengthUnit[]) ?? [...LENGTH_UNITS]);
  const [areaUnits, setAreaUnits] = useState<AreaUnit[]>((settings.enabled_area_units as AreaUnit[]) ?? [...AREA_UNITS]);
  const [weightUnits, setWeightUnits] = useState<WeightUnit[]>((settings.enabled_weight_units as WeightUnit[]) ?? [...WEIGHT_UNITS]);
  const [quantityUnits, setQuantityUnits] = useState<QuantityUnit[]>((settings.enabled_quantity_units as QuantityUnit[]) ?? [...QUANTITY_UNITS]);
  const [defaultWeight, setDefaultWeight] = useState<WeightUnit>(settings.default_weight_unit as WeightUnit);
  const [defaultQuantity, setDefaultQuantity] = useState<QuantityUnit>(settings.default_quantity_unit as QuantityUnit);
  const [rounding, setRounding] = useState<RoundingMode>(settings.rounding_mode as RoundingMode);
  const [moduleDefaults, setModuleDefaults] = useState<ModuleMeasurementDefaults>({
    purchaseAreaUnit: settings.module_defaults?.purchaseAreaUnit ?? (settings.default_area_unit as AreaUnit),
    printingAreaUnit: settings.module_defaults?.printingAreaUnit ?? (settings.default_area_unit as AreaUnit),
    washingAreaUnit: settings.module_defaults?.washingAreaUnit ?? (settings.default_area_unit as AreaUnit),
    expenseQtyUnit: settings.module_defaults?.expenseQtyUnit ?? (settings.default_quantity_unit as QuantityUnit),
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveMeasurementSettings({
        dimensionUnit,
        areaUnit,
        rateUnit,
        reportUnit,
        precision,
        enabledLengthUnits: lengthUnits,
        enabledAreaUnits: areaUnits,
        enabledWeightUnits: weightUnits,
        enabledQuantityUnits: quantityUnits,
        defaultWeightUnit: defaultWeight,
        defaultQuantityUnit: defaultQuantity,
        roundingMode: rounding,
        moduleDefaults,
      });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        These are defaults for <strong>new entries only</strong>. Every saved transaction keeps the dimensions, units
        and display unit it was entered with — changing a preference here never re-prices or re-prints an old bill.
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Defaults</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ms_dimension">Default dimension entry unit</label>
            <select id="ms_dimension" value={dimensionUnit} onChange={(e) => setDimensionUnit(e.target.value as LengthUnit)} className={selectClass}>
              {LENGTH_UNITS.filter((u) => lengthUnits.includes(u)).map((u) => <option key={u} value={u}>{LENGTH_UNIT_LABEL[u]}</option>)}
            </select>
            <p className="mt-0.5 text-[11px] text-slate-400">Length and Width can still be mixed per entry.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_area">Default area calculation / display unit</label>
            <select
              id="ms_area"
              value={areaUnit}
              onChange={(e) => {
                const next = e.target.value as AreaUnit;
                setAreaUnit(next);
                if (rateUnit === areaUnit) setRateUnit(next);
              }}
              className={selectClass}
            >
              {AREA_UNITS.filter((u) => areaUnits.includes(u)).map((u) => <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_rate">Default rate unit</label>
            <select id="ms_rate" value={rateUnit} onChange={(e) => setRateUnit(e.target.value as AreaUnit)} className={selectClass}>
              {AREA_UNITS.filter((u) => areaUnits.includes(u)).map((u) => <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>)}
            </select>
            <p className="mt-0.5 text-[11px] text-slate-400">The amount uses the area converted to this unit.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_report">Default report / print unit</label>
            <select id="ms_report" value={reportUnit} onChange={(e) => setReportUnit(e.target.value as AreaUnit)} className={selectClass}>
              {AREA_UNITS.filter((u) => areaUnits.includes(u)).map((u) => <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_weight">Default weight unit</label>
            <select id="ms_weight" value={defaultWeight} onChange={(e) => setDefaultWeight(e.target.value as WeightUnit)} className={selectClass}>
              {WEIGHT_UNITS.filter((u) => weightUnits.includes(u)).map((u) => <option key={u} value={u}>{WEIGHT_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_quantity">Default quantity unit</label>
            <select id="ms_quantity" value={defaultQuantity} onChange={(e) => setDefaultQuantity(e.target.value as QuantityUnit)} className={selectClass}>
              {QUANTITY_UNITS.filter((u) => quantityUnits.includes(u)).map((u) => <option key={u} value={u}>{QUANTITY_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_precision">Decimal precision</label>
            <select id="ms_precision" value={precision} onChange={(e) => setPrecision(Number(e.target.value))} className={selectClass}>
              <option value={2}>2 decimal places</option>
              <option value={3}>3 decimal places</option>
              <option value={4}>4 decimal places</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ms_rounding">Rounding rule</label>
            <select id="ms_rounding" value={rounding} onChange={(e) => setRounding(e.target.value as RoundingMode)} className={selectClass}>
              <option value="HALF_UP">Half-up (standard)</option>
              <option value="UP">Always round up</option>
              <option value="DOWN">Always round down</option>
            </select>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Applies to new Purchase, Printing and Washing calculations. Existing saved bills keep the values they were saved with.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Available units</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UnitToggles label="Length" units={LENGTH_UNITS} labels={LENGTH_UNIT_LABEL} selected={lengthUnits} onChange={setLengthUnits} />
          <UnitToggles label="Area" units={AREA_UNITS} labels={AREA_UNIT_LABEL} selected={areaUnits} onChange={setAreaUnits} />
          <UnitToggles label="Weight" units={WEIGHT_UNITS} labels={WEIGHT_UNIT_LABEL} selected={weightUnits} onChange={setWeightUnits} />
          <UnitToggles label="Quantity" units={QUANTITY_UNITS} labels={QUANTITY_UNIT_LABEL} selected={quantityUnits} onChange={setQuantityUnits} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Default billing unit per module</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["purchaseAreaUnit", "Purchase"],
              ["printingAreaUnit", "Printing"],
              ["washingAreaUnit", "Washing"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className={labelClass}>{label} billing unit</label>
              <select
                value={moduleDefaults[key]}
                onChange={(e) => setModuleDefaults((prev) => ({ ...prev, [key]: e.target.value as AreaUnit }))}
                className={selectClass}
              >
                {AREA_UNITS.filter((u) => areaUnits.includes(u)).map((u) => <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className={labelClass}>Other expenses quantity unit</label>
            <select
              value={moduleDefaults.expenseQtyUnit}
              onChange={(e) => setModuleDefaults((prev) => ({ ...prev, expenseQtyUnit: e.target.value as QuantityUnit }))}
              className={selectClass}
            >
              {QUANTITY_UNITS.filter((u) => quantityUnits.includes(u)).map((u) => <option key={u} value={u}>{QUANTITY_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {saved && !error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Measurement settings saved. New entries will open with these defaults; old bills are unchanged.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save measurement settings"}
      </button>
    </div>
  );
}
