"use client";

// 2026-10-02d — Sales Orders client: pipeline table + detail dialog.
// The detail dialog is where the spec's three money views live:
//   1. Order P&L with the "why is profit low?" drill-down — every cost
//      bucket as a % of sales (computeOrderPnl), editable cost buckets;
//   2. Packing calculator — cartons / net / gross / CBM (computePacking),
//      saved back onto the order;
//   3. Payment schedule — the terms engine's instalments, receive money,
//      add/remove rows. Receivable + overdue badges derive from here.

import { useMemo, useState, useTransition } from "react";
import type { Database } from "@/types/database";
import {
  computeOrderPnl,
  fmtMoney,
  ORDER_STATUSES,
  PAYMENT_MODES,
  round2,
  statusTone,
} from "@/lib/b2b/erp";
import {
  addOrderPaymentRow,
  deleteOrderPayment,
  receiveOrderPayment,
  saveOrderCosts,
  saveOrderPacking,
  updateOrderStatus,
} from "../ops-actions";
import { createFollowup } from "../erp-actions";

type OrderRow = Database["public"]["Tables"]["b2b_sales_orders"]["Row"];
type ItemRow = Database["public"]["Tables"]["b2b_sales_order_items"]["Row"] & { line_total: number; line_cost: number };
export type OrderPaymentView = Database["public"]["Tables"]["b2b_order_payments"]["Row"];
export type OrderListItem = OrderRow & {
  buyerName: string | null;
  order_items: ItemRow[];
  payments: OrderPaymentView[];
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";

const num = (v: number | null | undefined) => Number(v ?? 0) || 0;

export function OrdersClient({ orders }: { orders: OrderListItem[] }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // detail-dialog sub-state
  const [editCosts, setEditCosts] = useState(false);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [pack, setPack] = useState<Record<string, string>>({});
  const [recv, setRecv] = useState<Record<string, { amount: string; mode: string; ref: string }>>({});
  const [newRow, setNewRow] = useState({ label: "", dueDate: "", amount: "" });
  const [fuDate, setFuDate] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!statusFilter || o.status === statusFilter) &&
        (!q || o.order_no.toLowerCase().includes(q) || (o.buyerName ?? "").toLowerCase().includes(q) || (o.destination_country ?? "").toLowerCase().includes(q))
    );
  }, [orders, statusFilter, search]);

  const open = orders.find((o) => o.id === openId) ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  function beginEditCosts(o: OrderListItem) {
    setCosts({
      productCost: String(num(o.product_cost)),
      labourCost: String(num(o.labour_cost)),
      packingCost: String(num(o.packing_cost)),
      freightCost: String(num(o.freight_cost)),
      documentationCost: String(num(o.documentation_cost)),
      bankCharges: String(num(o.bank_charges)),
      otherCosts: String(num(o.other_costs)),
      deliveryDate: o.delivery_date ?? "",
      paymentTerms: o.payment_terms ?? "",
      incoterm: o.incoterm ?? "",
      destinationCountry: o.destination_country ?? "",
      notes: o.notes ?? "",
    });
    setEditCosts(true);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order / buyer / country…" className={`${inputClass} w-72`} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-48`}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} orders</span>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pl-4 pr-3">Order</th>
              <th className="py-2.5 pr-3">Buyer</th>
              <th className="py-2.5 pr-3">Date</th>
              <th className="py-2.5 pr-3">Delivery</th>
              <th className="py-2.5 pr-3">Status</th>
              <th className="py-2.5 pr-3 text-right">Value</th>
              <th className="py-2.5 pr-3 text-right">Received</th>
              <th className="py-2.5 pr-3 text-right">Outstanding</th>
              <th className="py-2.5 pr-3 text-right">Margin</th>
              <th className="py-2.5 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-500">
                  No sales orders yet — convert a quotation from the Quotation Engine.
                </td>
              </tr>
            )}
            {filtered.map((o) => {
              const received = round2(o.payments.reduce((s, p) => s + num(p.received_amount), 0));
              const outstanding = round2(Math.max(0, num(o.sales_value) - received));
              const pnl = computeOrderPnl({
                salesValue: num(o.sales_value),
                productCost: num(o.product_cost),
                labourCost: num(o.labour_cost),
                packingCost: num(o.packing_cost),
                freightCost: num(o.freight_cost),
                documentationCost: num(o.documentation_cost),
                bankCharges: num(o.bank_charges),
                otherCosts: num(o.other_costs),
              });
              const overdue = o.payments.some((p) => p.due_date < new Date().toISOString().slice(0, 10) && num(p.received_amount) < num(p.amount));
              return (
                <tr key={o.id} className={`border-b border-slate-100 last:border-0 ${o.status === "Cancelled" ? "opacity-50" : ""}`}>
                  <td className="py-2 pl-4 pr-3 font-mono text-xs font-semibold text-slate-700">{o.order_no}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">{o.buyerName ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-600">{o.order_date}</td>
                  <td className="py-2 pr-3 text-slate-600">{o.delivery_date ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusTone(o.status)}`}>{o.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-900">{fmtMoney(num(o.sales_value), o.currency)}</td>
                  <td className="py-2 pr-3 text-right text-emerald-600">{fmtMoney(received, o.currency)}</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${overdue ? "text-red-600" : outstanding > 0 ? "text-amber-600" : "text-slate-400"}`}>
                    {fmtMoney(outstanding, o.currency)}
                  </td>
                  <td className={`py-2 pr-3 text-right ${pnl.marginPct >= 0 ? "text-slate-700" : "text-red-600"}`}>{pnl.marginPct.toFixed(1)}%</td>
                  <td className="py-2 pr-3">
                    <button className={btnGhost} onClick={() => { setOpenId(o.id); setEditCosts(false); setError(null); }}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── detail modal ─────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-6 w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {open.order_no} <span className="text-sm font-medium text-slate-500">— {open.buyerName ?? "No buyer"}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {open.order_date} → {open.delivery_date ?? "no delivery date"} · {open.destination_country || "—"} · {open.incoterm || "no incoterm"} · FX {num(open.exchange_rate)}{" "}
                  {open.currency}/INR
                </p>
              </div>
              <button onClick={() => setOpenId(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                ✕
              </button>
            </div>

            {/* status pipeline */}
            <div className="mb-4">
              <label className={labelClass}>Status — click to move the order</label>
              <div className="flex flex-wrap gap-1.5">
                {ORDER_STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={pending || open.status === s}
                    onClick={() => run(() => updateOrderStatus(open.id, s))}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      open.status === s ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* lines */}
            <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pl-3 pr-3">Item</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 pr-3 text-right">Cost</th>
                    <th className="py-2 pr-3 text-right">Line total</th>
                    <th className="py-2 pr-3 text-right">Line profit</th>
                  </tr>
                </thead>
                <tbody>
                  {open.order_items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pl-3 pr-3 text-slate-800">{it.description}</td>
                      <td className="py-1.5 pr-3 text-right">{num(it.qty)}</td>
                      <td className="py-1.5 pr-3 text-right">{fmtMoney(num(it.unit_price), open.currency)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-500">{fmtMoney(num(it.unit_cost), open.currency)}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold">{fmtMoney(it.line_total, open.currency)}</td>
                      <td className={`py-1.5 pr-3 text-right font-semibold ${it.line_total - it.line_cost >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtMoney(it.line_total - it.line_cost, open.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              {/* ── P&L + drill-down ─────────────────────────────────── */}
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Order P&amp;L — why is profit low?</h4>
                  <button className={btnGhost} onClick={() => (editCosts ? setEditCosts(false) : beginEditCosts(open))}>
                    {editCosts ? "Close" : "Edit costs"}
                  </button>
                </div>
                {!editCosts ? (
                  <>
                    {(() => {
                      const pnl = computeOrderPnl({
                        salesValue: num(open.sales_value),
                        productCost: num(open.product_cost),
                        labourCost: num(open.labour_cost),
                        packingCost: num(open.packing_cost),
                        freightCost: num(open.freight_cost),
                        documentationCost: num(open.documentation_cost),
                        bankCharges: num(open.bank_charges),
                        otherCosts: num(open.other_costs),
                      });
                      return (
                        <>
                          <div className="mb-2 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-slate-50 p-2">
                              <div className="text-[10px] font-bold uppercase text-slate-500">Sales</div>
                              <div className="text-lg font-bold text-slate-900">{fmtMoney(num(open.sales_value), open.currency)}</div>
                            </div>
                            <div className={`rounded-lg p-2 ${pnl.grossProfit >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                              <div className="text-[10px] font-bold uppercase opacity-70">Profit ({pnl.marginPct.toFixed(1)}%)</div>
                              <div className={`text-lg font-bold ${pnl.grossProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                                {fmtMoney(pnl.grossProfit, open.currency)}
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {pnl.breakdown.map((row) => (
                              <div key={row.label}>
                                <div className="flex items-center justify-between text-xs">
                                  <span className={row.label === "Gross profit" ? "font-bold text-slate-700" : "text-slate-600"}>{row.label}</span>
                                  <span className="font-medium text-slate-700">
                                    {fmtMoney(row.value, open.currency)} · {row.pctOfSales.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded bg-slate-100">
                                  <div
                                    className={`h-1.5 rounded ${row.label === "Gross profit" ? (row.value >= 0 ? "bg-emerald-500" : "bg-red-500") : "bg-amber-400"}`}
                                    style={{ width: `${Math.min(100, Math.abs(row.pctOfSales))}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["productCost", "Product cost"],
                      ["labourCost", "Labour"],
                      ["packingCost", "Packing"],
                      ["freightCost", "Freight"],
                      ["documentationCost", "Documentation"],
                      ["bankCharges", "Bank charges"],
                      ["otherCosts", "Other expenses"],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className={labelClass}>{label}</label>
                        <input
                          type="number"
                          step="0.01"
                          value={costs[key] ?? ""}
                          onChange={(e) => setCosts((c) => ({ ...c, [key]: e.target.value }))}
                          className={inputClass}
                        />
                      </div>
                    ))}
                    <div>
                      <label className={labelClass}>Delivery date</label>
                      <input type="date" value={costs.deliveryDate ?? ""} onChange={(e) => setCosts((c) => ({ ...c, deliveryDate: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Payment terms</label>
                      <input value={costs.paymentTerms ?? ""} onChange={(e) => setCosts((c) => ({ ...c, paymentTerms: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Incoterm</label>
                      <input value={costs.incoterm ?? ""} onChange={(e) => setCosts((c) => ({ ...c, incoterm: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Destination</label>
                      <input
                        value={costs.destinationCountry ?? ""}
                        onChange={(e) => setCosts((c) => ({ ...c, destinationCountry: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <button className={btnGhost} onClick={() => setEditCosts(false)}>
                        Cancel
                      </button>
                      <button
                        className={btnClass}
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const res = await saveOrderCosts(open.id, {
                              productCost: costs.productCost,
                              labourCost: costs.labourCost,
                              packingCost: costs.packingCost,
                              freightCost: costs.freightCost,
                              documentationCost: costs.documentationCost,
                              bankCharges: costs.bankCharges,
                              otherCosts: costs.otherCosts,
                              deliveryDate: costs.deliveryDate,
                              paymentTerms: costs.paymentTerms,
                              incoterm: costs.incoterm,
                              destinationCountry: costs.destinationCountry,
                              notes: costs.notes,
                            });
                            if (res.ok) setEditCosts(false);
                            return res;
                          })
                        }
                      >
                        Save costs
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ── packing calculator ───────────────────────────────── */}
              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Packing calculator</h4>
                {open.pack_cartons !== null && (
                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                    <Badge label="Cartons" value={String(open.pack_cartons ?? 0)} />
                    <Badge label="Pcs/carton" value={String(open.pack_pcs_per_carton ?? "—")} />
                    <Badge label="Net weight" value={`${num(open.pack_net_weight_kg)} kg`} />
                    <Badge label="Gross weight" value={`${num(open.pack_gross_weight_kg)} kg`} />
                    <Badge label="CBM" value={String(num(open.pack_cbm))} />
                    <Badge label="Packages" value={String(open.pack_cartons ?? 0)} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Total qty</label>
                    <input
                      type="number"
                      value={pack.qty ?? round2(open.order_items.reduce((s, i) => s + num(i.qty), 0))}
                      onChange={(e) => setPack((p) => ({ ...p, qty: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Pcs / carton</label>
                    <input type="number" value={pack.pcsPerCarton ?? ""} onChange={(e) => setPack((p) => ({ ...p, pcsPerCarton: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Carton L (cm)</label>
                    <input type="number" value={pack.cartonLengthCm ?? ""} onChange={(e) => setPack((p) => ({ ...p, cartonLengthCm: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Carton W (cm)</label>
                    <input type="number" value={pack.cartonWidthCm ?? ""} onChange={(e) => setPack((p) => ({ ...p, cartonWidthCm: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Carton H (cm)</label>
                    <input type="number" value={pack.cartonHeightCm ?? ""} onChange={(e) => setPack((p) => ({ ...p, cartonHeightCm: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Piece weight (kg)</label>
                    <input type="number" step="0.001" value={pack.netWeightEachKg ?? ""} onChange={(e) => setPack((p) => ({ ...p, netWeightEachKg: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Carton tare (kg)</label>
                    <input type="number" step="0.01" value={pack.cartonTareKg ?? ""} onChange={(e) => setPack((p) => ({ ...p, cartonTareKg: e.target.value }))} className={inputClass} />
                  </div>
                  <div className="flex items-end">
                    <button
                      className={`${btnClass} w-full`}
                      disabled={pending || !Number(pack.qty) || !Number(pack.pcsPerCarton)}
                      onClick={() =>
                        run(() =>
                          saveOrderPacking(open.id, {
                            qty: pack.qty ?? "",
                            pcsPerCarton: pack.pcsPerCarton ?? "",
                            cartonLengthCm: pack.cartonLengthCm,
                            cartonWidthCm: pack.cartonWidthCm,
                            cartonHeightCm: pack.cartonHeightCm,
                            netWeightEachKg: pack.netWeightEachKg,
                            cartonTareKg: pack.cartonTareKg,
                          })
                        )
                      }
                    >
                      Save packing
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Cartons = CEILING(qty ÷ pcs/carton) · CBM = L×W×H(m) × cartons · gross = net + tare.
                </p>
              </section>
            </div>

            {/* ── payment schedule ────────────────────────────────────── */}
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Payment schedule</h4>
                <span className="text-xs text-slate-500">
                  Received {fmtMoney(round2(open.payments.reduce((s, p) => s + num(p.received_amount), 0)), open.currency)} of{" "}
                  {fmtMoney(round2(open.payments.reduce((s, p) => s + num(p.amount), 0)), open.currency)}
                </span>
              </div>
              {open.payments.length === 0 ? (
                <p className="text-sm text-slate-500">No instalments — payment terms weren&apos;t machine-readable at order creation. Add one below.</p>
              ) : (
                <div className="space-y-2">
                  {open.payments.map((p) => {
                    const short = round2(num(p.amount) - num(p.received_amount));
                    const isOverdue = short > 0 && p.due_date < new Date().toISOString().slice(0, 10);
                    const state = recv[p.id] ?? { amount: "", mode: "", ref: "" };
                    return (
                      <div key={p.id} className="grid grid-cols-12 items-end gap-2 rounded-lg bg-slate-50 p-2">
                        <div className="col-span-3">
                          <div className="text-sm font-semibold text-slate-800">{p.label}</div>
                          <div className={`text-xs ${isOverdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                            due {p.due_date}
                            {isOverdue ? " · OVERDUE" : ""}
                          </div>
                        </div>
                        <div className="col-span-2 text-sm text-slate-700">
                          {fmtMoney(num(p.amount), open.currency)}
                          <div className="text-xs text-emerald-600">recv {fmtMoney(num(p.received_amount), open.currency)}</div>
                        </div>
                        <div className="col-span-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder={`receive ${short}`}
                            value={state.amount}
                            onChange={(e) => setRecv((r) => ({ ...r, [p.id]: { ...state, amount: e.target.value } }))}
                            className={inputClass}
                          />
                        </div>
                        <div className="col-span-2">
                          <select
                            value={state.mode}
                            onChange={(e) => setRecv((r) => ({ ...r, [p.id]: { ...state, mode: e.target.value } }))}
                            className={inputClass}
                          >
                            <option value="">Mode…</option>
                            {PAYMENT_MODES.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3 flex justify-end gap-1.5">
                          <button
                            className={btnClass}
                            disabled={pending || !Number(state.amount)}
                            onClick={() =>
                              run(() =>
                                receiveOrderPayment(p.id, {
                                  amount: state.amount,
                                  mode: state.mode,
                                  referenceNo: state.ref,
                                })
                              )
                            }
                          >
                            Receive
                          </button>
                          <button
                            className={btnGhost}
                            disabled={pending || short <= 0}
                            onClick={() =>
                              run(() =>
                                receiveOrderPayment(p.id, {
                                  amount: String(short),
                                  mode: state.mode,
                                  referenceNo: state.ref,
                                })
                              )
                            }
                          >
                            All
                          </button>
                          <button className={btnGhost} disabled={pending} onClick={() => run(() => deleteOrderPayment(p.id))}>
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <label className={labelClass}>New instalment label</label>
                  <input value={newRow.label} onChange={(e) => setNewRow((r) => ({ ...r, label: e.target.value }))} placeholder="Balance" className={inputClass} />
                </div>
                <div className="col-span-3">
                  <label className={labelClass}>Due date</label>
                  <input type="date" value={newRow.dueDate} onChange={(e) => setNewRow((r) => ({ ...r, dueDate: e.target.value }))} className={inputClass} />
                </div>
                <div className="col-span-3">
                  <label className={labelClass}>Amount</label>
                  <input type="number" step="0.01" value={newRow.amount} onChange={(e) => setNewRow((r) => ({ ...r, amount: e.target.value }))} className={inputClass} />
                </div>
                <div className="col-span-2">
                  <button
                    className={`${btnGhost} w-full`}
                    disabled={pending || !newRow.dueDate || !Number(newRow.amount)}
                    onClick={() =>
                      run(async () => {
                        const res = await addOrderPaymentRow(open.id, newRow);
                        if (res.ok) setNewRow({ label: "", dueDate: "", amount: "" });
                        return res;
                      })
                    }
                  >
                    + Add
                  </button>
                </div>
              </div>
            </section>

            {/* ── quick follow-up ─────────────────────────────────────── */}
            <section className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div>
                <label className={labelClass}>Follow-up for this order</label>
                <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} className={`${inputClass} w-40`} />
              </div>
              <button
                className={btnClass}
                disabled={pending || !fuDate}
                onClick={() => {
                  run(() =>
                    createFollowup({
                      entityType: "Order",
                      entityId: open.id,
                      entityLabel: open.order_no,
                      dueDate: fuDate,
                      note: "",
                    })
                  );
                  setFuDate("");
                }}
              >
                Schedule
              </button>
              <span className="text-xs text-amber-700">Reminder appears on the Control Center&apos;s alerts panel.</span>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}
