"use client";

// 2026-10-24b — "SABHI PARKAR KE BILLS ME ROUND FIGR SE PAYMET ADD KARNE KA YA
// ROUND FIGURE SET KARNE KA OPTION AAYE ... BILL ME PAYABLE ROUND + DIFFERENCE
// ROUND-OFF ME".
//
// So the difference is never typed by hand: this takes the bill's own
// pre-round-off payable, offers the usual round figures, and returns the
// signed difference for the bill's round_off_amt field — the payable becomes
// exactly the round figure and the books still reconcile (gross + round-off =
// what is actually paid).
export function RoundFigureButtons({ payable, onApply }: { payable: number; onApply: (roundOff: number) => void }) {
  const steps = [1, 5, 10, 50, 100];
  const rounded = (step: number) => Math.round(payable / step) * step;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s) => {
        if (!(payable > 0)) return null;
        const target = rounded(s);
        const diff = Math.round((target - payable) * 100) / 100;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onApply(diff)}
            title={`Round ₹${payable.toFixed(2)} to ₹${target.toLocaleString("en-IN")} (difference ${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:border-amber-400 hover:bg-amber-50"
          >
            ₹{target.toLocaleString("en-IN")}
          </button>
        );
      })}
    </div>
  );
}
