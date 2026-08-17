"use client";

import { LENGTH_UNITS, type LengthUnit } from "@/lib/length-units";

// Small shared dropdown for the FT/MTR/INCH/YARD/CM unit picker — see
// src/lib/length-units.ts's header comment for why this exists. Used
// alongside a quantity input wherever a raw-material measurement is
// entered (Purchase Bill's Sq. Feet, Stock In/Out's Quantity); the caller
// owns the actual value + conversion, this is just the picker UI.
export function UnitSelect({
  value,
  onChange,
  className,
  id,
}: {
  value: LengthUnit;
  onChange: (unit: LengthUnit) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as LengthUnit)}
      className={
        className ??
        "shrink-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-600 outline-none focus:border-amber-500"
      }
    >
      {LENGTH_UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}
