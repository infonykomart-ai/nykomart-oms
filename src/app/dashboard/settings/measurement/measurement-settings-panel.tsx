"use client";

// 2026-11-05 — Measurement Settings form (OMS Settings → Measurement).
// Company-wide defaults only: the engine (src/lib/measurement.ts) and every
// saved row keep their own original units, so nothing historical changes.
import { useState, useTransition } from "react";
import {
  AREA_UNITS,
  AREA_UNIT_LABEL,
  LENGTH_UNITS,
  LENGTH_UNIT_LABEL,
  type AreaUnit,
  type LengthUnit,
} from "@/lib/measurement";
import { saveMeasurementSettings } from "./actions";

export type MeasurementSettingsValues = {
  default_dimension_unit: string;
  default_area_unit: string;
  default_rate_unit: string;
  default_report_unit: string;
  decimal_precision: number;
};

const selectClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function MeasurementSettingsPanel({ settings }: { settings: MeasurementSettingsValues }) {
  const [dimensionUnit, setDimensionUnit] = useState<LengthUnit>(settings.default_dimension_unit as LengthUnit);
  const [areaUnit, setAreaUnit] = useState<AreaUnit>(settings.default_area_unit as AreaUnit);
  const [rateUnit, setRateUnit] = useState<AreaUnit>(settings.default_rate_unit as AreaUnit);
  const [reportUnit, setReportUnit] = useState<AreaUnit>(settings.default_report_unit as AreaUnit);
  const [precision, setPrecision] = useState(settings.decimal_precision);
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
      });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        These are defaults for <strong>new entries only</strong>. Every saved transaction keeps the dimensions, units
        and display unit it was entered with — changing a preference here never re-prices or re-prints an old bill.
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ms_dimension">Default dimension entry unit</label>
          <select id="ms_dimension" value={dimensionUnit} onChange={(e) => setDimensionUnit(e.target.value as LengthUnit)} className={selectClass}>
            {LENGTH_UNITS.map((u) => (
              <option key={u} value={u}>{LENGTH_UNIT_LABEL[u]}</option>
            ))}
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
            {AREA_UNITS.map((u) => (
              <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ms_rate">Default rate unit</label>
          <select id="ms_rate" value={rateUnit} onChange={(e) => setRateUnit(e.target.value as AreaUnit)} className={selectClass}>
            {AREA_UNITS.map((u) => (
              <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">The amount uses the area converted to this unit.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="ms_report">Default report / print unit</label>
          <select id="ms_report" value={reportUnit} onChange={(e) => setReportUnit(e.target.value as AreaUnit)} className={selectClass}>
            {AREA_UNITS.map((u) => (
              <option key={u} value={u}>{AREA_UNIT_LABEL[u]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ms_precision">Decimal precision</label>
          <select id="ms_precision" value={precision} onChange={(e) => setPrecision(Number(e.target.value))} className={selectClass}>
            <option value={2}>2 decimal places</option>
            <option value={3}>3 decimal places</option>
            <option value={4}>4 decimal places</option>
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Display precision. Calculations always keep full precision internally (area stored to 6 dp).
          </p>
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      {saved && !error && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Measurement settings saved. New purchase entries will open with these units.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={pending}
        className="mt-4 rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save measurement settings"}
      </button>
    </div>
  );
}
