"use client";

import { useState } from "react";
import {
  formatAreaNumber,
  normalizeCount,
  PCS_PER_SET_PRESETS,
  stairArea,
  STAIR_DIMENSION_UNITS,
  stairSizeLabel,
  stairTotalPieces,
  type StairDimensionUnit,
} from "@/lib/orders/stair-rug";

/**
 * 2026-11-02 — Set-based quantity for a Stair Rug, rendered INSTEAD of the
 * plain Quantity box (Cotton/Jute/Tufted keep that box untouched — nothing
 * here is loaded for them).
 *
 * Three behaviours the owner asked for, and why they're built this way:
 *
 *  1. Pieces Per Set is free text with suggestions, not a fixed dropdown —
 *     `datalist` gives 2 / 4 / 6 / 12 / 14 / 18 / 24 / 50 / 100 / 125 / 150 /
 *     200 as hints while the input itself accepts ANY whole number (137,
 *     1000, …). Minimum 1 is enforced by `min` + normalizeCount, and there is
 *     deliberately no maximum.
 *  2. Total Pieces is derived (sets × pieces) and is the ONLY quantity that
 *     gets saved — it goes into the order's existing `qty` field, so stock,
 *     invoices, bills, reports and margin need no change at all. It is
 *     readOnly on screen because it is a result, not an input.
 *  3. Per-piece dimensions + area are live: length/width in FT, INCH or CM,
 *     showing per-piece sq inch and total sq inch / sq ft / sq cm for the
 *     current total pieces. Full precision internally; only the display
 *     rounds (see src/lib/orders/stair-rug.ts).
 *
 * Field names are what the server actions read (`sets_count…`,
 * `pieces_per_set…`, `dimension_*…`, plus the parent's own qty field name) —
 * this component deliberately owns no submit logic of its own, so both the
 * new-order form and the Orders-hub edit form can use it unchanged.
 */
export function StairRugFields({
  suffix,
  qtyName,
  inputClass,
  labelClass,
  initial,
}: {
  /** Empty for the edit form; the item block key for the multi-item new-order form. */
  suffix: string;
  /** The parent form's existing quantity field name — carries Total Pieces. */
  qtyName: string;
  inputClass: string;
  labelClass: string;
  initial?: {
    sets?: number | null;
    piecesPerSet?: number | null;
    length?: number | null;
    width?: number | null;
    unit?: string | null;
    /** Used only when piecesPerSet is missing (orders saved before this feature). */
    qty?: number | null;
  };
}) {
  const field = (name: string) => (suffix ? `${name}_${suffix}` : name);
  const presetListId = `pcs-presets-${suffix || "edit"}`;

  const [setsRaw, setSetsRaw] = useState(String(initial?.sets ?? 1));
  const [pcsRaw, setPcsRaw] = useState(
    String(initial?.piecesPerSet ?? (initial?.qty && initial.qty > 0 ? initial.qty : 1))
  );
  const [lengthRaw, setLengthRaw] = useState(initial?.length != null ? String(initial.length) : "");
  const [widthRaw, setWidthRaw] = useState(initial?.width != null ? String(initial.width) : "");
  const [unit, setUnit] = useState<StairDimensionUnit>(
    (STAIR_DIMENSION_UNITS as readonly string[]).includes(initial?.unit ?? "")
      ? (initial?.unit as StairDimensionUnit)
      : "INCH"
  );

  const totalPieces = stairTotalPieces(normalizeCount(setsRaw, 1), normalizeCount(pcsRaw, 1));
  const area = stairArea({ length: lengthRaw, width: widthRaw, unit, totalPieces });
  const sizeLabel = stairSizeLabel(lengthRaw, widthRaw, unit);
  const areaInputsMissing = !lengthRaw.trim() || !widthRaw.trim();

  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:col-span-2 sm:grid-cols-3">
      <p className="text-xs text-amber-800 sm:col-span-3">
        <span className="font-semibold">Set-based quantity (Stair Rug)</span> — 1 set = how many PCS is your choice.
        Total Pieces is calculated automatically and is what the order actually books.
      </p>

      <div>
        <label className={labelClass} htmlFor={field("sets_count")}>Number of Sets *</label>
        <input
          id={field("sets_count")}
          name={field("sets_count")}
          type="number"
          min={1}
          step={1}
          required
          value={setsRaw}
          onChange={(e) => setSetsRaw(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={field("pieces_per_set")}>Pieces Per Set *</label>
        <input
          id={field("pieces_per_set")}
          name={field("pieces_per_set")}
          type="number"
          min={1}
          step={1}
          required
          list={presetListId}
          value={pcsRaw}
          onChange={(e) => setPcsRaw(e.target.value)}
          className={inputClass}
          placeholder="e.g. 12, 50, 125…"
        />
        <datalist id={presetListId}>
          {PCS_PER_SET_PRESETS.map((p) => (
            <option key={p} value={p}>{p} PCS</option>
          ))}
        </datalist>
        <p className="mt-1 text-xs text-slate-500">Any whole number — 2, 12, 50, 125, 1000… (no upper limit).</p>
      </div>

      <div>
        <label className={labelClass} htmlFor={qtyName}>Total Pieces (auto)</label>
        <input
          id={qtyName}
          name={qtyName}
          type="number"
          readOnly
          required
          value={totalPieces}
          className={`${inputClass} bg-slate-100 font-semibold`}
        />
        <p className="mt-1 text-xs text-slate-500">
          {normalizeCount(setsRaw, 1)} set{normalizeCount(setsRaw, 1) === 1 ? "" : "s"} × {normalizeCount(pcsRaw, 1)} PCS
        </p>
      </div>

      <div className="sm:col-span-3">
        <label className={labelClass}>Per-piece size &amp; area (optional)</label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <span className="mb-0.5 block text-[11px] text-slate-500">Length</span>
            <input
              id={field("dimension_length")}
              name={field("dimension_length")}
              type="number"
              min={0}
              step="any"
              value={lengthRaw}
              onChange={(e) => setLengthRaw(e.target.value)}
              className={inputClass}
              placeholder="9"
            />
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] text-slate-500">Width</span>
            <input
              id={field("dimension_width")}
              name={field("dimension_width")}
              type="number"
              min={0}
              step="any"
              value={widthRaw}
              onChange={(e) => setWidthRaw(e.target.value)}
              className={inputClass}
              placeholder="29"
            />
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] text-slate-500">Unit</span>
            <select
              id={field("dimension_unit")}
              name={field("dimension_unit")}
              value={unit}
              onChange={(e) => setUnit(e.target.value as StairDimensionUnit)}
              className={inputClass}
            >
              {STAIR_DIMENSION_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-0.5 block text-[11px] text-slate-500">Size label (auto-filled on save)</span>
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              {sizeLabel || "—"}
            </p>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-slate-700">
          {area ? (
            <>
              <span className="font-semibold">Area per piece:</span> {formatAreaNumber(area.perPieceSqIn)} SQ INCH
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold">Total area ({totalPieces} PCS):</span>{" "}
              {formatAreaNumber(area.totalSqIn)} SQ INCH = {formatAreaNumber(area.totalSqFt)} SQ FT ={" "}
              {formatAreaNumber(area.totalSqCm)} SQ CM
            </>
          ) : (
            <span className="text-slate-500">
              {areaInputsMissing
                ? "Enter length + width to see per-piece and total area."
                : "Area needs a positive length and width."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
