"use client";

// 2026-10-02d — Product Master client surface: list + filter, add/edit form
// (common trade fields + the per-type spec fields from PRODUCT_SPECS),
// stock adjust, and the BOM editor with the live requirement engine
// (qty × consumption × 1+wastage/100 — spec §7/§10). Writes go through
// ../erp-actions.ts; this file only orchestrates UI state.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  computeBomRequirement,
  fmtMoney,
  PRODUCT_SPECS,
  PRODUCT_TYPES,
  type ProductType,
} from "@/lib/b2b/erp";
import { adjustProductStock, saveBomItems, saveProduct, type BomItemInput, type ProductInput } from "../erp-actions";

export type ProductView = {
  id: string;
  sku: string;
  name: string;
  productType: string;
  category: string;
  collection: string;
  material: string;
  design: string;
  color: string;
  sizeLabel: string;
  lengthCm: number;
  widthCm: number;
  gsm: number;
  pieceWeightKg: number;
  specs: Record<string, string>;
  unit: string;
  moq: number;
  productionDays: number;
  packingType: string;
  piecesPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  fobPrice: number;
  exwPrice: number;
  wholesalePrice: number;
  costPrice: number;
  stockQty: number;
  minStockQty: number;
  active: boolean;
};

export type BomView = {
  id: string;
  productId: string;
  material: string;
  consumption: number;
  unit: string;
  wastagePercent: number;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";

type Draft = {
  id?: string;
  sku: string;
  name: string;
  productType: ProductType;
  category: string;
  collection: string;
  material: string;
  design: string;
  color: string;
  sizeLabel: string;
  lengthCm: string;
  widthCm: string;
  gsm: string;
  pieceWeightKg: string;
  specs: Record<string, string>;
  unit: string;
  moq: string;
  productionDays: string;
  packingType: string;
  piecesPerCarton: string;
  cartonLengthCm: string;
  cartonWidthCm: string;
  cartonHeightCm: string;
  fobPrice: string;
  exwPrice: string;
  wholesalePrice: string;
  costPrice: string;
  stockQty: string;
  minStockQty: string;
  active: boolean;
};

function emptyDraft(): Draft {
  return {
    sku: "",
    name: "",
    productType: "Cotton Dhurrie",
    category: "",
    collection: "",
    material: "",
    design: "",
    color: "",
    sizeLabel: "",
    lengthCm: "",
    widthCm: "",
    gsm: "",
    pieceWeightKg: "",
    specs: {},
    unit: "pcs",
    moq: "",
    productionDays: "",
    packingType: "",
    piecesPerCarton: "",
    cartonLengthCm: "",
    cartonWidthCm: "",
    cartonHeightCm: "",
    fobPrice: "",
    exwPrice: "",
    wholesalePrice: "",
    costPrice: "",
    stockQty: "",
    minStockQty: "",
    active: true,
  };
}

function toDraft(p: ProductView): Draft {
  const s = (v: number) => (v ? String(v) : "");
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    productType: (PRODUCT_TYPES.find((t) => t === p.productType) ?? "Cotton Dhurrie") as ProductType,
    category: p.category,
    collection: p.collection,
    material: p.material,
    design: p.design,
    color: p.color,
    sizeLabel: p.sizeLabel,
    lengthCm: s(p.lengthCm),
    widthCm: s(p.widthCm),
    gsm: s(p.gsm),
    pieceWeightKg: s(p.pieceWeightKg),
    specs: { ...p.specs },
    unit: p.unit,
    moq: s(p.moq),
    productionDays: s(p.productionDays),
    packingType: p.packingType,
    piecesPerCarton: s(p.piecesPerCarton),
    cartonLengthCm: s(p.cartonLengthCm),
    cartonWidthCm: s(p.cartonWidthCm),
    cartonHeightCm: s(p.cartonHeightCm),
    fobPrice: s(p.fobPrice),
    exwPrice: s(p.exwPrice),
    wholesalePrice: s(p.wholesalePrice),
    costPrice: s(p.costPrice),
    stockQty: s(p.stockQty),
    minStockQty: s(p.minStockQty),
    active: p.active,
  };
}

function marginPct(cost: number, price: number): string {
  if (price <= 0 || cost <= 0) return "—";
  return `${(((price - cost) / price) * 100).toFixed(1)}%`;
}

export function ProductsClient({ products, bom }: { products: ProductView[]; bom: BomView[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bomFor, setBomFor] = useState<ProductView | null>(null);
  const [bomRows, setBomRows] = useState<BomItemInput[]>([]);
  const [sampleQty, setSampleQty] = useState("1000");
  const [stockDeltas, setStockDeltas] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!typeFilter || p.productType === typeFilter) &&
        (!q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.material.toLowerCase().includes(q))
    );
  }, [products, search, typeFilter]);

  function submitDraft() {
    if (!draft) return;
    setError(null);
    const payload: ProductInput = {
      productId: draft.id,
      sku: draft.sku,
      name: draft.name,
      productType: draft.productType,
      category: draft.category,
      collection: draft.collection,
      material: draft.material,
      design: draft.design,
      color: draft.color,
      sizeLabel: draft.sizeLabel,
      lengthCm: draft.lengthCm,
      widthCm: draft.widthCm,
      gsm: draft.gsm,
      pieceWeightKg: draft.pieceWeightKg,
      specs: draft.specs,
      unit: draft.unit,
      moq: draft.moq,
      productionDays: draft.productionDays,
      packingType: draft.packingType,
      piecesPerCarton: draft.piecesPerCarton,
      cartonLengthCm: draft.cartonLengthCm,
      cartonWidthCm: draft.cartonWidthCm,
      cartonHeightCm: draft.cartonHeightCm,
      fobPrice: draft.fobPrice,
      exwPrice: draft.exwPrice,
      wholesalePrice: draft.wholesalePrice,
      costPrice: draft.costPrice,
      stockQty: draft.stockQty,
      minStockQty: draft.minStockQty,
      active: draft.active,
    };
    startTransition(async () => {
      const res = await saveProduct(payload);
      if (!res.ok) setError(res.error);
      else setDraft(null);
    });
  }

  function adjust(productId: string, delta: number) {
    setError(null);
    startTransition(async () => {
      const res = await adjustProductStock(productId, delta);
      if (!res.ok) setError(res.error);
    });
  }

  function openBom(p: ProductView) {
    const existing = bom
      .filter((b) => b.productId === p.id)
      .map<BomItemInput>((b) => ({
        material: b.material,
        consumption: String(b.consumption),
        unit: b.unit,
        wastagePercent: String(b.wastagePercent),
      }));
    setBomRows(existing.length > 0 ? existing : [{ material: "", consumption: "", unit: "m", wastagePercent: "5" }]);
    setBomFor(p);
  }

  function saveBom() {
    if (!bomFor) return;
    setError(null);
    const productId = bomFor.id;
    startTransition(async () => {
      const res = await saveBomItems(productId, bomRows);
      if (!res.ok) setError(res.error);
      else setBomFor(null);
    });
  }

  const requirementPreview = useMemo(() => {
    const qty = Number(sampleQty) || 0;
    return computeBomRequirement(
      bomRows
        .filter((r) => r.material.trim())
        .map((r) => ({
          material: r.material,
          consumption: Number(r.consumption) || 0,
          unit: r.unit,
          wastagePercent: Number(r.wastagePercent) || 0,
        })),
      qty
    );
  }, [bomRows, sampleQty]);

  return (
    <div>
      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU / name / material…"
          className={`${inputClass} w-64`}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputClass} w-48`}>
          <option value="">All product types</option>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} of {products.length} products</span>
        <button className={`${btnClass} ml-auto`} onClick={() => { setDraft(emptyDraft()); setError(null); }}>
          + New product
        </button>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* list */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pl-4 pr-3">SKU</th>
              <th className="py-2.5 pr-3">Product</th>
              <th className="py-2.5 pr-3">Type</th>
              <th className="py-2.5 pr-3">Size / Material</th>
              <th className="py-2.5 pr-3 text-right">MOQ</th>
              <th className="py-2.5 pr-3 text-right">Cost</th>
              <th className="py-2.5 pr-3 text-right">Wholesale</th>
              <th className="py-2.5 pr-3 text-right">Margin</th>
              <th className="py-2.5 pr-3">Stock</th>
              <th className="py-2.5 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-500">
                  No products yet — add the first SKU (auto-numbered CD-1001 style).
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const low = p.minStockQty > 0 && p.stockQty < p.minStockQty;
              return (
                <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${p.active ? "" : "opacity-50"}`}>
                  <td className="py-2 pl-4 pr-3 font-mono text-xs font-semibold text-slate-700">{p.sku}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">
                    {p.name}
                    {!p.active && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-500">inactive</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{p.productType}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {[p.sizeLabel, p.material].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">{p.moq || "—"}</td>
                  <td className="py-2 pr-3 text-right">{p.costPrice > 0 ? fmtMoney(p.costPrice) : "—"}</td>
                  <td className="py-2 pr-3 text-right">{p.wholesalePrice > 0 ? fmtMoney(p.wholesalePrice) : "—"}</td>
                  <td className="py-2 pr-3 text-right font-medium text-slate-700">{marginPct(p.costPrice, p.wholesalePrice)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${low ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                      {p.stockQty}
                      {low ? " ⚠" : ""}
                    </span>
                    <span className="ml-1 text-[10px] text-slate-400">/ min {p.minStockQty}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button className={btnGhost} onClick={() => { setDraft(toDraft(p)); setError(null); }}>
                        Edit
                      </button>
                      <button className={btnGhost} onClick={() => openBom(p)}>
                        BOM
                      </button>
                      <input
                        type="number"
                        value={stockDeltas[p.id] ?? ""}
                        onChange={(e) => setStockDeltas((s) => ({ ...s, [p.id]: e.target.value }))}
                        placeholder="+/−"
                        className="w-16 rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
                      />
                      <button className={btnGhost} disabled={pending || !Number(stockDeltas[p.id])} onClick={() => adjust(p.id, Number(stockDeltas[p.id] ?? 0))}>
                        +
                      </button>
                      <button className={btnGhost} disabled={pending || !Number(stockDeltas[p.id])} onClick={() => adjust(p.id, -Number(stockDeltas[p.id] ?? 0))}>
                        −
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── product form modal ─────────────────────────────────────────── */}
      {draft && (
        <Modal title={draft.id ? `Edit ${draft.sku}` : "New product (auto SKU)"} onClose={() => setDraft(null)} wide>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Product type *">
              <select
                value={draft.productType}
                onChange={(e) => setDraft({ ...draft, productType: e.target.value as ProductType, specs: {} })}
                className={inputClass}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name *">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
            </Field>
            <Field label={draft.id ? "SKU" : "SKU (blank = auto CD-1001…)"}>
              <input
                value={draft.sku}
                onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                disabled={!draft.id}
                placeholder="auto-generated"
                className={inputClass}
              />
            </Field>
            <Field label="Category">
              <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Collection">
              <input value={draft.collection} onChange={(e) => setDraft({ ...draft, collection: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Material / Fabric">
              <input value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Design">
              <input value={draft.design} onChange={(e) => setDraft({ ...draft, design: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Color">
              <input value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Size">
              <input value={draft.sizeLabel} onChange={(e) => setDraft({ ...draft, sizeLabel: e.target.value })} placeholder="4 x 6 ft / One Size" className={inputClass} />
            </Field>
            <Field label="Length (cm)">
              <input type="number" value={draft.lengthCm} onChange={(e) => setDraft({ ...draft, lengthCm: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Width (cm)">
              <input type="number" value={draft.widthCm} onChange={(e) => setDraft({ ...draft, widthCm: e.target.value })} className={inputClass} />
            </Field>
            <Field label="GSM">
              <input type="number" value={draft.gsm} onChange={(e) => setDraft({ ...draft, gsm: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Piece weight (kg)">
              <input type="number" step="0.001" value={draft.pieceWeightKg} onChange={(e) => setDraft({ ...draft, pieceWeightKg: e.target.value })} className={inputClass} />
            </Field>

            {/* type-specific spec fields (jsonb) */}
            {PRODUCT_SPECS[draft.productType].map((f) => (
              <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                {f.options ? (
                  <select
                    value={draft.specs[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, specs: { ...draft.specs, [f.key]: e.target.value } })}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={draft.specs[f.key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, specs: { ...draft.specs, [f.key]: e.target.value } })}
                    className={inputClass}
                  />
                )}
              </Field>
            ))}

            <Field label="MOQ">
              <input type="number" value={draft.moq} onChange={(e) => setDraft({ ...draft, moq: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Production lead time (days)">
              <input type="number" value={draft.productionDays} onChange={(e) => setDraft({ ...draft, productionDays: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Packing type">
              <input value={draft.packingType} onChange={(e) => setDraft({ ...draft, packingType: e.target.value })} placeholder="Polybag + Carton" className={inputClass} />
            </Field>
            <Field label="Pieces / carton">
              <input type="number" value={draft.piecesPerCarton} onChange={(e) => setDraft({ ...draft, piecesPerCarton: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Carton L × W × H (cm)">
              <div className="grid grid-cols-3 gap-1.5">
                <input type="number" value={draft.cartonLengthCm} onChange={(e) => setDraft({ ...draft, cartonLengthCm: e.target.value })} className={inputClass} placeholder="L" />
                <input type="number" value={draft.cartonWidthCm} onChange={(e) => setDraft({ ...draft, cartonWidthCm: e.target.value })} className={inputClass} placeholder="W" />
                <input type="number" value={draft.cartonHeightCm} onChange={(e) => setDraft({ ...draft, cartonHeightCm: e.target.value })} className={inputClass} placeholder="H" />
              </div>
            </Field>
            <Field label="Unit">
              <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className={inputClass} />
            </Field>
            <Field label="FOB price">
              <input type="number" step="0.01" value={draft.fobPrice} onChange={(e) => setDraft({ ...draft, fobPrice: e.target.value })} className={inputClass} />
            </Field>
            <Field label="EXW price">
              <input type="number" step="0.01" value={draft.exwPrice} onChange={(e) => setDraft({ ...draft, exwPrice: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Wholesale price">
              <input type="number" step="0.01" value={draft.wholesalePrice} onChange={(e) => setDraft({ ...draft, wholesalePrice: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Cost price">
              <input type="number" step="0.01" value={draft.costPrice} onChange={(e) => setDraft({ ...draft, costPrice: e.target.value })} className={inputClass} />
            </Field>
            <Field label={`Profit margin (${marginPct(Number(draft.costPrice) || 0, Number(draft.wholesalePrice) || 0)})`}>
              <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-600">
                auto from wholesale − cost
              </div>
            </Field>
            <Field label="Min stock (reorder level)">
              <input type="number" value={draft.minStockQty} onChange={(e) => setDraft({ ...draft, minStockQty: e.target.value })} className={inputClass} />
            </Field>
            {!draft.id && (
              <Field label="Opening stock">
                <input type="number" value={draft.stockQty} onChange={(e) => setDraft({ ...draft, stockQty: e.target.value })} className={inputClass} />
              </Field>
            )}
            <Field label="Status">
              <select value={draft.active ? "1" : "0"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })} className={inputClass}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className={btnClass} disabled={pending || !draft.name.trim()} onClick={submitDraft}>
              {pending ? "Saving…" : draft.id ? "Save product" : "Create product"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── BOM modal ──────────────────────────────────────────────────── */}
      {bomFor && (
        <Modal title={`BOM — ${bomFor.sku} ${bomFor.name}`} onClose={() => setBomFor(null)} wide>
          <p className="mb-3 text-xs text-slate-500">
            Consumption is per 1 finished unit. Requirement = Order Qty × Consumption × (1 + wastage%) — preview below updates live.
          </p>
          <div className="mb-3 flex items-center gap-2">
            <label className={labelClass}>Order qty for preview</label>
            <input type="number" value={sampleQty} onChange={(e) => setSampleQty(e.target.value)} className={`${inputClass} w-28`} />
          </div>
          <div className="space-y-2">
            {bomRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <input
                    value={r.material}
                    placeholder="Cotton Fabric"
                    onChange={(e) => setBomRows((rows) => rows.map((x, j) => (j === i ? { ...x, material: e.target.value } : x)))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.001"
                    value={r.consumption}
                    placeholder="2.5"
                    onChange={(e) => setBomRows((rows) => rows.map((x, j) => (j === i ? { ...x, consumption: e.target.value } : x)))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <input
                    value={r.unit}
                    placeholder="m"
                    onChange={(e) => setBomRows((rows) => rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.1"
                    value={r.wastagePercent}
                    onChange={(e) => setBomRows((rows) => rows.map((x, j) => (j === i ? { ...x, wastagePercent: e.target.value } : x)))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2 flex justify-end">
                  <button className={btnGhost} onClick={() => setBomRows((rows) => rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            className={`${btnGhost} mt-2`}
            onClick={() => setBomRows((rows) => [...rows, { material: "", consumption: "", unit: "pcs", wastagePercent: "0" }])}
          >
            + Add material
          </button>

          {requirementPreview.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Requirement for {Number(sampleQty) || 0} pcs
              </h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1">Material</th>
                    <th className="py-1 text-right">Base</th>
                    <th className="py-1 text-right">+Wastage</th>
                    <th className="py-1 text-right">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {requirementPreview.map((r, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-1 font-medium text-slate-800">
                        {r.material} <span className="text-xs text-slate-400">({r.unit})</span>
                      </td>
                      <td className="py-1 text-right">{r.baseRequired}</td>
                      <td className="py-1 text-right text-amber-600">+{r.wastage}</td>
                      <td className="py-1 text-right font-semibold text-slate-900">{r.required}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setBomFor(null)}>
              Cancel
            </button>
            <button className={btnClass} disabled={pending} onClick={saveBom}>
              {pending ? "Saving…" : "Save BOM"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── shared tiny UI atoms (same shape as the register's client) ──────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className={`my-6 w-full rounded-2xl bg-white p-5 shadow-xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
