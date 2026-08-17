"use client";

// 2026-08-17 — "CGST & SGST KA OPTION IGST KA OPTION JO AUTO MATICLY RAHE
// ACCORDING TO GST POLICY 2.5% 3% 4% 9%" — Purchase Bill GST, confirmed via
// AskUserQuestion as a MANUAL per-bill choice (checked live: most vendor
// parties have no GST number on file, so an automatic CGST+SGST-vs-IGST
// decision from vendor state isn't reliable data yet). gstRatePct is the
// CGST/SGST INDIVIDUAL rate (2.5/3/4/9) — total GST is always double this,
// however it's itemized; see db/2026-08-17-purchase-bills-gst.sql.
export const GST_RATES = [2.5, 3, 4, 9] as const;
export type GstType = "CGST_SGST" | "IGST";

export function GstSelect({
  ratePct,
  onRateChange,
  gstType,
  onTypeChange,
  idPrefix,
}: {
  ratePct: number | null;
  onRateChange: (v: number | null) => void;
  gstType: GstType;
  onTypeChange: (v: GstType) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex gap-1.5">
      <select
        id={`${idPrefix}_gst_rate`}
        value={ratePct ?? ""}
        onChange={(e) => onRateChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
      >
        <option value="">No GST</option>
        {GST_RATES.map((r) => (
          <option key={r} value={r}>
            {r}% + {r}% ({r * 2}% total)
          </option>
        ))}
      </select>
      {ratePct != null && (
        <select
          id={`${idPrefix}_gst_type`}
          value={gstType}
          onChange={(e) => onTypeChange(e.target.value as GstType)}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-600 outline-none focus:border-amber-500"
        >
          <option value="CGST_SGST">CGST+SGST</option>
          <option value="IGST">IGST</option>
        </select>
      )}
    </div>
  );
}
