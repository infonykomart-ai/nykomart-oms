"use client";

// 2026-10-02d — Quotation Engine client. Every figure recomputes live via
// @/lib/b2b/erp (computeCosting / estimateEnquiry math) as lines and cost
// inputs change; the server action persists the same inputs, so client and
// server can never disagree. Freight & incoterm cost are always explicit
// inputs — nothing here invents a rate.

import { useMemo, useState, useTransition } from "react";
import {
  computeCosting,
  fmtMoney,
  INCOTERMS,
  QUOTE_CURRENCIES,
} from "@/lib/b2b/erp";
import { saveEngineQuotation, type EngineLineInput } from "../erp-actions";
import { createSalesOrder, type OrderLineInput } from "../ops-actions";

export type EngineInquiry = {
  id: string;
  inquiryNo: string;
  inquiryDate: string;
  buyerName: string;
  buyerCountry: string;
  buyerId: string | null;
  requirementNotes: string;
};

export type EngineProduct = {
  id: string;
  sku: string;
  name: string;
  productType: string;
  unit: string;
  moq: number;
  productionDays: number;
  wholesalePrice: number;
  fobPrice: number;
  costPrice: number;
  piecesPerCarton: number;
};

export type EngineBuyer = {
  id: string;
  name: string;
  country: string;
  currency: string;
  paymentTerms: string;
  shippingTerms: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";

type Line = { productId: string | null; description: string; qty: string; unit: string; unitPrice: string; unitCost: string };

function emptyLine(): Line {
  return { productId: null, description: "", qty: "", unit: "pcs", unitPrice: "", unitCost: "" };
}

export function EngineClient({
  inquiries,
  products,
  buyers,
  rates,
}: {
  inquiries: EngineInquiry[];
  products: EngineProduct[];
  buyers: EngineBuyer[];
  rates: Record<string, number>;
}) {
  const [inquiryId, setInquiryId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [exchangeRate, setExchangeRate] = useState("");
  const [incoterm, setIncoterm] = useState("FOB");
  const [taxPercent, setTaxPercent] = useState("0");
  const [shippingAmount, setShippingAmount] = useState(""); // charged to buyer
  const [discount, setDiscount] = useState("");
  const [packingCost, setPackingCost] = useState("");
  const [freightCost, setFreightCost] = useState(""); // our cost — entered
  const [otherCosts, setOtherCosts] = useState("");
  const [targetMargin, setTargetMargin] = useState("25");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // convert-to-order panel
  const [showOrder, setShowOrder] = useState(false);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");

  const inquiry = inquiries.find((i) => i.id === inquiryId) ?? null;
  const buyer = buyers.find((b) => b.id === buyerId) ?? null;

  function pickInquiry(id: string) {
    setInquiryId(id);
    const inq = inquiries.find((i) => i.id === id);
    if (inq?.buyerId) {
      setBuyerId(inq.buyerId);
      const b = buyers.find((x) => x.id === inq.buyerId);
      if (b) {
        setCurrency(b.currency || "USD");
        setExchangeRate(String(rates[b.currency] ?? ""));
        setPaymentTerms(b.paymentTerms);
      }
    }
    setSavedNote(null);
  }

  function pickCurrency(c: string) {
    setCurrency(c);
    setExchangeRate(String(rates[c] ?? ""));
  }

  function applyProduct(lineIdx: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLines((rows) =>
      rows.map((r, i) =>
        i === lineIdx
          ? {
              ...r,
              productId: p ? p.id : null,
              description: p ? `${p.sku} ${p.name}` : r.description,
              unit: p?.unit || r.unit,
              unitPrice: p ? String(p.wholesalePrice || p.fobPrice || "") : r.unitPrice,
              unitCost: p ? String(p.costPrice || "") : r.unitCost,
            }
          : r
      )
    );
  }

  const costing = useMemo(
    () =>
      computeCosting({
        lines: lines
          .filter((l) => l.description.trim() || Number(l.qty))
          .map((l) => ({ qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, unitPrice: Number(l.unitPrice) || 0 })),
        packingCost: Number(packingCost) || 0,
        freight: Number(freightCost) || 0,
        otherCosts: Number(otherCosts) || 0,
        discount: Number(discount) || 0,
      }),
    [lines, packingCost, freightCost, otherCosts, discount]
  );

  // Spec §4's suggested price: cover total cost at the target margin.
  const target = Math.min(90, Math.max(0, Number(targetMargin) || 0)) / 100;
  const requiredSelling = target < 1 ? costing.totalCost / (1 - target) : 0;
  const uplift = round(costing.netSelling > 0 ? requiredSelling - costing.netSelling : 0);

  function save() {
    setError(null);
    setSavedNote(null);
    if (!inquiryId) {
      setError("Select an inquiry first (create it in the Register if it doesn't exist).");
      return;
    }
    const payloadLines: EngineLineInput[] = lines
      .filter((l) => l.description.trim() && Number(l.qty) > 0)
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
      }));
    startTransition(async () => {
      const res = await saveEngineQuotation({
        inquiryId,
        buyerId,
        currency,
        exchangeRate: exchangeRate || String(rates[currency] ?? 1),
        incoterm,
        taxPercent,
        shippingAmount,
        discount,
        packingCost,
        freightCost,
        otherCosts,
        validFrom,
        validUntil,
        lines: payloadLines,
      });
      if (!res.ok) setError(res.error);
      else setSavedNote(`Quotation ${"quoteNo" in res ? res.quoteNo ?? "" : ""} saved with costing engine numbers.`);
    });
  }

  function convertToOrder() {
    setError(null);
    const payloadLines: OrderLineInput[] = lines
      .filter((l) => l.description.trim() && Number(l.qty) > 0)
      .map((l) => ({
        productId: l.productId,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
      }));
    if (payloadLines.length === 0) {
      setError("Add at least one product line before converting.");
      return;
    }
    startTransition(async () => {
      const res = await createSalesOrder({
        buyerId,
        inquiryId,
        orderDate,
        deliveryDate,
        destinationCountry: buyer?.country || inquiry?.buyerCountry || "",
        incoterm,
        paymentTerms: paymentTerms,
        currency,
        exchangeRate: exchangeRate || String(rates[currency] ?? 1),
        packingCost,
        freightCost,
        otherCosts,
        notes: `Converted from ${inquiry?.inquiryNo ?? "quotation"}`,
        lines: payloadLines,
      });
      if (!res.ok) setError(res.error);
      else {
        setSavedNote(`Sales Order ${"orderNo" in res ? res.orderNo ?? "" : ""} created — payment schedule auto-generated.`);
        setShowOrder(false);
      }
    });
  }

  const lineCount = lines.filter((l) => l.description.trim() && Number(l.qty) > 0).length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ── inputs ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Deal</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Inquiry *</label>
              <select value={inquiryId} onChange={(e) => pickInquiry(e.target.value)} className={inputClass}>
                <option value="">— select open inquiry —</option>
                {inquiries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.inquiryNo} · {i.buyerName}
                    {i.buyerCountry ? ` (${i.buyerCountry})` : ""}
                  </option>
                ))}
              </select>
              {inquiry?.requirementNotes && <p className="mt-1 text-xs text-slate-500">{inquiry.requirementNotes}</p>}
            </div>
            <div>
              <label className={labelClass}>Buyer (linked)</label>
              <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className={inputClass}>
                <option value="">— none —</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.country ? ` · ${b.country}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <select value={currency} onChange={(e) => pickCurrency(e.target.value)} className={inputClass}>
                {QUOTE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>FX rate → INR (snapshot)</label>
              <input
                type="number"
                step="0.000001"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                placeholder={rates[currency] ? String(rates[currency]) : "e.g. 83.4"}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Incoterm</label>
              <select value={incoterm} onChange={(e) => setIncoterm(e.target.value)} className={inputClass}>
                {INCOTERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tax %</label>
              <input type="number" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Valid from</label>
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Product lines</h2>
            <button className={btnGhost} onClick={() => setLines((rows) => [...rows, emptyLine()])}>
              + Add line
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <span className="col-span-4">Product / description</span>
              <span className="col-span-2">Qty</span>
              <span className="col-span-2">Unit price</span>
              <span className="col-span-2">Unit cost</span>
              <span className="col-span-2 text-right">Line total</span>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-4 space-y-1">
                  <select value={l.productId ?? ""} onChange={(e) => applyProduct(i, e.target.value)} className={inputClass}>
                    <option value="">— custom description —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.description}
                    onChange={(e) => setLines((rows) => rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                    placeholder="Description"
                    className={inputClass}
                  />
                </div>
                <input
                  type="number"
                  step="1"
                  value={l.qty}
                  onChange={(e) => setLines((rows) => rows.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                  placeholder="Qty"
                  className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  value={l.unitPrice}
                  onChange={(e) => setLines((rows) => rows.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r)))}
                  placeholder="Price"
                  className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  value={l.unitCost}
                  onChange={(e) => setLines((rows) => rows.map((r, j) => (j === i ? { ...r, unitCost: e.target.value } : r)))}
                  placeholder="Cost"
                  className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <div className="col-span-2 flex items-center justify-end gap-1 text-sm font-semibold text-slate-800">
                  {fmtMoney((Number(l.qty) || 0) * (Number(l.unitPrice) || 0), currency)}
                  <button
                    className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setLines((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {products.some((p) => p.moq > 0) && (
            <p className="mt-2 text-[11px] text-slate-400">
              MOQ check: {lines
                .map((l) => {
                  const p = products.find((x) => x.id === l.productId);
                  return p && p.moq > 0 && Number(l.qty) > 0 && Number(l.qty) < p.moq ? `${p.sku} min ${p.moq}` : null;
                })
                .filter(Boolean)
                .join(" · ") || "all lines above MOQ ✓"}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Cost side (all entered — never guessed)</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className={labelClass}>Packing cost ({currency})</label>
              <input type="number" step="0.01" value={packingCost} onChange={(e) => setPackingCost(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Freight ({currency})</label>
              <input type="number" step="0.01" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Other costs ({currency})</label>
              <input type="number" step="0.01" value={otherCosts} onChange={(e) => setOtherCosts(e.target.value)} placeholder="doc+bank+misc" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Discount ({currency})</label>
              <input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Freight charged to buyer</label>
              <input type="number" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} className={inputClass} />
            </div>
          </div>
        </section>
      </div>

      {/* ── live costing panel ─────────────────────────────────────────── */}
      <aside className="space-y-4">
        <section className="sticky top-4 rounded-2xl border border-slate-900 bg-slate-900 p-5 text-white shadow-lg">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Costing engine — live</h2>
          <Row label="Product cost" value={fmtMoney(costing.productCost, currency)} />
          <Row label="Packing cost" value={fmtMoney(costing.packingCost, currency)} />
          <Row label="Freight" value={fmtMoney(costing.freightCost, currency)} />
          <Row label="Other costs" value={fmtMoney(costing.otherCosts, currency)} />
          <Row label="Total cost" value={fmtMoney(costing.totalCost, currency)} strong />
          <hr className="my-2 border-slate-700" />
          <Row label="Selling value" value={fmtMoney(costing.sellingValue, currency)} />
          <Row label="Discount" value={`− ${fmtMoney(costing.discount, currency)}`} />
          <Row label="Net selling" value={fmtMoney(costing.netSelling, currency)} strong />
          <div className={`mt-3 rounded-xl p-3 ${costing.grossProfit >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
            <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">Gross profit</div>
            <div className="text-2xl font-bold">{fmtMoney(costing.grossProfit, currency)}</div>
            <div className="text-sm font-semibold">{costing.marginPct.toFixed(2)}% margin</div>
          </div>

          <div className="mt-3 rounded-xl bg-white/10 p-3">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-300">Target margin % (enquiry estimate)</label>
            <div className="flex items-center gap-2">
              <input type="number" step="1" value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)} className="w-20 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white" />
              <span className="text-xs text-slate-300">
                → required selling <b>{fmtMoney(requiredSelling, currency)}</b>
              </span>
            </div>
            <p className={`mt-1 text-xs ${uplift >= 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {uplift >= 0 ? `Need +${fmtMoney(uplift, currency)} more than current ask.` : `Current ask is ${fmtMoney(-uplift, currency)} above target — room to negotiate.`}
            </p>
          </div>

          {error && <p className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p>}
          {savedNote && <p className="mt-3 rounded-lg bg-emerald-500/20 px-3 py-2 text-sm text-emerald-200">{savedNote}</p>}

          <div className="mt-4 space-y-2">
            <button className={`${btnClass} w-full`} disabled={pending || lineCount === 0} onClick={save}>
              {pending ? "Saving…" : "Save quotation with costing"}
            </button>
            <button className={`${btnGhost} w-full`} disabled={pending || lineCount === 0} onClick={() => setShowOrder((v) => !v)}>
              {showOrder ? "Close convert panel" : "Convert to Sales Order →"}
            </button>
          </div>

          {showOrder && (
            <div className="mt-3 space-y-2 rounded-xl bg-white/10 p-3">
              <div>
                <label className={labelClass}>Order date *</label>
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Delivery date</label>
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Payment terms (auto schedule)</label>
                <input
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder={buyer?.paymentTerms || "50/50, Net 30…"}
                  className={inputClass}
                />
              </div>
              <button className={`${btnClass} w-full`} disabled={pending} onClick={convertToOrder}>
                {pending ? "Creating…" : `Create SO (${lineCount} line${lineCount === 1 ? "" : "s"})`}
              </button>
              <p className="text-[10px] leading-tight text-slate-400">
                Order number, payment schedule and status pipeline are created automatically.
              </p>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 text-sm ${strong ? "font-bold" : "text-slate-300"}`}>
      <span>{label}</span>
      <span className={strong ? "text-white" : ""}>{value}</span>
    </div>
  );
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
