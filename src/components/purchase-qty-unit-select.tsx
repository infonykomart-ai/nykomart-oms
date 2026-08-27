"use client";

import { PURCHASE_QTY_UNITS, type PurchaseQtyUnit } from "@/lib/length-units";

// 2026-08-27 — same FT/MTR/INCH/YARD/CM picker as UnitSelect
// (src/components/unit-select.tsx), plus a 6th option: PCS. Deliberately a
// separate component/type (PurchaseQtyUnit, not LengthUnit) rather than
// adding PCS to UnitSelect itself — see src/lib/length-units.ts's comment
// on PURCHASE_QTY_UNITS for why (Stock In/Out and Material Out Chalan share
// UnitSelect/LengthUnit and convert every quantity to feet; PCS has no
// feet-equivalent). Used only on the 4 Purchase Bill forms.
export function PurchaseQtyUnitSelect({
  value,
  onChange,
  className,
  id,
}: {
  value: PurchaseQtyUnit;
  onChange: (unit: PurchaseQtyUnit) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as PurchaseQtyUnit)}
      className={
        className ??
        "shrink-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-600 outline-none focus:border-amber-500"
      }
    >
      {PURCHASE_QTY_UNITS.map((u) => (
        <option key={u} value={u}>
          {u === "PCS" ? "PCS (per piece)" : u}
        </option>
      ))}
    </select>
  );
}
