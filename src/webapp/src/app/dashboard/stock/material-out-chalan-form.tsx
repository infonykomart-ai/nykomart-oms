"use client";

// Material OUT Chalan — 2026-08-17: "KACHA MAAL BAHR KISI PARTY KO DIYA TO
// USKA CHALAN KESE KATENGE JIS SE YE PATA CHAL JAYE KI KONSA MAAL AAYA
// KONSA GAYA" — same multi-line-under-one-header idea as Purchase Bill
// Multi, but for raw material going OUT: pick the party once, add as many
// SKU/qty lines as are physically going out together, save once and get
// one auto-numbered chalan (see actions.ts's createMaterialOutChalan) plus
// one stock_out row per line. Same FT/MTR/INCH/YARD/CM unit picker as
// every other quantity field this round — see src/lib/length-units.ts.
import { useActionState, useState } from "react";
import { createMaterialOutChalan, type MaterialOutChalanState } from "./actions";
import { UnitSelect } from "@/components/unit-select";
import { toFeet, type LengthUnit } from "@/lib/length-units";

const initialState: MaterialOutChalanState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Line = {
  key: number;
  skuCode: string;
  productName: string;
  qtyDisplay: string;
  qtyUnit: LengthUnit;
};

let nextKey = 1;
function blankLine(): Line {
  return { key: nextKey++, skuCode: "", productName: "", qtyDisplay: "", qtyUnit: "FT" };
}

export function MaterialOutChalanForm({ parties, skuOptions }: { parties: { id: string; name: string }[]; skuOptions: string[] }) {
  const [state, formAction, pending] = useActionState(createMaterialOutChalan, initialState);
  const [lines, setLines] = useState<Line[]>([blankLine()]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const linesJson = JSON.stringify(
    lines
      .filter((l) => l.skuCode.trim())
      .map((l) => ({
        skuCode: l.skuCode.trim(),
        productName: l.productName.trim() || null,
        quantityOut: toFeet(Number(l.qtyDisplay) || 0, l.qtyUnit),
      }))
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <div className="space-y-1 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          <p className="font-semibold">Chalan {state.success.chalanNo} created.</p>
          {state.success.results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.sku} {r.error ? `— ${r.error}` : ""}
            </p>
          ))}
        </div>
      )}

      <input type="hidden" name="lines_json" value={linesJson} />

      <datalist id="moc-sku-options">
        {skuOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="moc_party">Party (given to) *</label>
          <select id="moc_party" name="party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="moc_date">Chalan Date</label>
          <input id="moc_date" name="chalan_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500">Items going out on this chalan</label>
          <button type="button" onClick={addLine} className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700">
            + Add item
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">SKU Code *</label>
                  <input
                    value={l.skuCode}
                    onChange={(e) => updateLine(l.key, { skuCode: e.target.value })}
                    list="moc-sku-options"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Product Name</label>
                  <input
                    value={l.productName}
                    onChange={(e) => updateLine(l.key, { productName: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-0.5 block text-[11px] text-slate-400">Quantity Out *</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={l.qtyDisplay}
                      onChange={(e) => updateLine(l.key, { qtyDisplay: e.target.value })}
                      className={inputClass}
                    />
                    <UnitSelect value={l.qtyUnit} onChange={(unit) => updateLine(l.key, { qtyUnit: unit })} />
                  </div>
                  {l.qtyUnit !== "FT" && l.qtyDisplay && (
                    <p className="mt-0.5 text-[11px] text-purple-600">
                      = {toFeet(Number(l.qtyDisplay) || 0, l.qtyUnit).toFixed(2)} Ft (saved)
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                  className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-1.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="moc_remark">Remark</label>
        <textarea id="moc_remark" name="remark" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : `Save Chalan (${lines.filter((l) => l.skuCode.trim()).length} item(s))`}
      </button>
    </form>
  );
}
