"use client";

// 2026-10-28 — "purchase ki entry ho ya freight ki duty ho ya washing ya
// printing, per last me jaha invoice submit karte hai to round off karne ke
// liye option hona chahiye ki + & - ke liye".
//
// Purchase / Printing bills already had a round-off box plus the
// RoundFigureButtons shortcut (2026-10-24b). Courier, Duty and Washing had
// only a bare number input: you had to KNOW that a minus sign was allowed,
// and there was no hint of which side of zero you were on. This is the same
// control for every bill form:
//
//   [−] [+]  |  0.40  |  [Clear]
//   ₹12,433.60 → ₹12,433.20   (round off −0.40)
//   quick round: ₹12,434 · ₹12,435 · ₹12,440 · ₹12,450 · ₹12,500
//
// The signed difference is what the server action already expects
// (`round_off_amt`, + adds to the payable, − subtracts from it), so no
// server-side change and no new column is involved — only the way the number
// is entered. `payable` is the bill's own pre-round-off payable, computed by
// the form from the fields the user is typing into, so the preview can never
// disagree with what will be saved.
import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function RoundOffField({
  id,
  payable,
  defaultValue = 0,
  label = "Round Off",
  className,
  hint,
}: {
  /** Unique id prefix — bill edit forms render one per row. */
  id: string;
  /** Payable BEFORE this round-off (gross + whatever else). Omit if unknown. */
  payable?: number;
  /** Existing round_off_amt when editing. */
  defaultValue?: number;
  label?: string;
  className?: string;
  /** Extra line under the control (form-specific wording). */
  hint?: string;
}) {
  const start = Number(defaultValue) || 0;
  const [sign, setSign] = useState<1 | -1>(start < 0 ? -1 : 1);
  const [magnitude, setMagnitude] = useState(start === 0 ? "" : Math.abs(start).toFixed(2));

  const mag = Number(magnitude);
  const value = (Number.isFinite(mag) ? mag : 0) * sign;
  const rounded = Math.round(value * 100) / 100;
  const before = Number.isFinite(payable) ? Number(payable) : null;
  const after = before == null ? null : Math.round((before + rounded) * 100) / 100;

  const steps = [1, 5, 10, 50, 100];

  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor={`${id}_ro`}>
        {label} <span className="text-slate-400">(+ adds / − deducts)</span>
      </label>
      {/* The form field itself is the hidden signed value — the visible parts
          are just a friendlier way to type the same number. */}
      <input type="hidden" name="round_off_amt" value={rounded ? rounded.toFixed(2) : "0"} />

      <div className="flex items-stretch gap-1">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          <button
            type="button"
            aria-pressed={sign === -1}
            onClick={() => setSign(-1)}
            title="Subtract this amount from the payable (round down)"
            className={`px-2.5 text-sm font-bold ${sign === -1 ? "bg-rose-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            −
          </button>
          <button
            type="button"
            aria-pressed={sign === 1}
            onClick={() => setSign(1)}
            title="Add this amount to the payable (round up)"
            className={`border-l border-slate-300 px-2.5 text-sm font-bold ${sign === 1 ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            +
          </button>
        </div>
        <input
          id={`${id}_ro`}
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={magnitude}
          onChange={(e) => setMagnitude(e.target.value)}
          placeholder="0.00"
          className={inputClass}
        />
        {rounded !== 0 && (
          <button
            type="button"
            onClick={() => {
              setMagnitude("");
              setSign(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 text-[11px] text-slate-500 hover:border-rose-300 hover:text-rose-600"
            title="Clear the round-off"
          >
            Clear
          </button>
        )}
      </div>

      {before != null && before > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {steps.map((s) => {
            const target = Math.round(before / s) * s;
            const diff = Math.round((target - before) * 100) / 100;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSign(diff < 0 ? -1 : 1);
                  setMagnitude(Math.abs(diff).toFixed(2));
                }}
                title={`Round ₹${before.toFixed(2)} to ₹${target.toLocaleString("en-IN")} (round off ${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:border-amber-400 hover:bg-amber-50"
              >
                ₹{target.toLocaleString("en-IN")}
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-0.5 text-[11px] text-slate-400">
        {before != null && before > 0 ? (
          <>
            Payable before round-off ₹{before.toFixed(2)} → after ₹{(after ?? before).toFixed(2)} (round off{" "}
            {rounded >= 0 ? "+" : "−"}
            {Math.abs(rounded).toFixed(2)})
          </>
        ) : (
          hint ?? "e.g. +0.40 to round up, −0.30 to match the vendor's exact total."
        )}
      </p>
    </div>
  );
}
