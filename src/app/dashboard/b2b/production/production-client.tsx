"use client";

// 2026-10-02d — Production board + QC desk client. Completion % and QC
// percentages recompute from the stored counters on every render (never
// stored), progress bars use them directly, and every write goes through
// ../ops-actions.ts (which also runs the pipeline auto-advance triggers).

import { useMemo, useState, useTransition } from "react";
import type { Database } from "@/types/database";
import { computeQc, DEFAULT_STAGES, fmtPct, productionPct, PRODUCTION_STATUSES, statusTone } from "@/lib/b2b/erp";
import { addProductionEntry, createProduction, createQcInspection, updateProductionMeta } from "../ops-actions";

type ProductionRow = Database["public"]["Tables"]["b2b_productions"]["Row"];
type QcRow = Database["public"]["Tables"]["b2b_qc_inspections"]["Row"];

export type ProductionListItem = ProductionRow & { orderNo: string | null; productLabel: string | null; stages: string[] };
export type QcListItem = QcRow & { orderNo: string | null; productionNo: string | null };
export type ProdOrderOption = { id: string; orderNo: string; status: string; deliveryDate: string | null; destination: string };
export type ProdProductOption = { id: string; sku: string; name: string; productType: string };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";

const num = (v: number | null | undefined) => Number(v ?? 0) || 0;

export function ProductionClient({
  productions,
  inspections,
  orders,
  products,
}: {
  productions: ProductionListItem[];
  inspections: QcListItem[];
  orders: ProdOrderOption[];
  products: ProdProductOption[];
}) {
  const [showProdForm, setShowProdForm] = useState(false);
  const [prod, setProd] = useState({
    orderId: "",
    productId: "",
    description: "",
    plannedQty: "",
    startDate: "",
    dueDate: "",
    priority: "Normal",
    stages: "",
    notes: "",
  });
  const [showQcForm, setShowQcForm] = useState(false);
  const [qc, setQc] = useState({
    orderId: "",
    productionId: "",
    inspectedQty: "",
    passedQty: "",
    rejectedQty: "",
    reworkQty: "",
    inspectionDate: new Date().toISOString().slice(0, 10),
    inspector: "",
    remarks: "",
  });
  const [entries, setEntries] = useState<Record<string, { qty: string; stage: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openProductions = useMemo(() => productions.filter((p) => p.status !== "Completed"), [productions]);
  const overdueProductions = openProductions.filter((p) => p.due_date && p.due_date < new Date().toISOString().slice(0, 10));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else after?.();
    });
  }

  function submitProduction() {
    const stages = prod.stages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    run(
      () =>
        createProduction({
          orderId: prod.orderId || undefined,
          productId: prod.productId || undefined,
          description: prod.description || products.find((p) => p.id === prod.productId)?.name || "",
          plannedQty: prod.plannedQty,
          startDate: prod.startDate,
          dueDate: prod.dueDate,
          priority: prod.priority,
          stages: stages.length > 0 ? stages : undefined,
          notes: prod.notes,
        }),
      () => {
        setProd({ orderId: "", productId: "", description: "", plannedQty: "", startDate: "", dueDate: "", priority: "Normal", stages: "", notes: "" });
        setShowProdForm(false);
      }
    );
  }

  function submitQc() {
    run(
      () =>
        createQcInspection({
          orderId: qc.orderId || undefined,
          productionId: qc.productionId || undefined,
          inspectedQty: qc.inspectedQty,
          passedQty: qc.passedQty,
          rejectedQty: qc.rejectedQty,
          reworkQty: qc.reworkQty,
          inspectionDate: qc.inspectionDate,
          inspector: qc.inspector,
          remarks: qc.remarks,
        }),
      () =>
        setQc({
          orderId: "",
          productionId: "",
          inspectedQty: "",
          passedQty: "",
          rejectedQty: "",
          reworkQty: "",
          inspectionDate: new Date().toISOString().slice(0, 10),
          inspector: "",
          remarks: "",
        })
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* ── production ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Production ({openProductions.length} open)
          </h2>
          {overdueProductions.length > 0 && (
            <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
              🔴 {overdueProductions.length} past due
            </span>
          )}
          <button className={`${btnClass} ml-auto`} onClick={() => setShowProdForm((v) => !v)}>
            {showProdForm ? "Close" : "+ New production"}
          </button>
        </div>

        {showProdForm && (
          <div className="mb-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className={labelClass}>Against sales order (optional)</label>
              <select
                value={prod.orderId}
                onChange={(e) => {
                  const o = orders.find((x) => x.id === e.target.value);
                  setProd((p) => ({
                    ...p,
                    orderId: e.target.value,
                    dueDate: p.dueDate || (o?.deliveryDate ?? ""),
                  }));
                }}
                className={inputClass}
              >
                <option value="">— none —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} · {o.destination || o.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Product (fills description)</label>
              <select
                value={prod.productId}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  setProd((s) => ({ ...s, productId: e.target.value, description: p ? `${p.sku} ${p.name}` : s.description }));
                }}
                className={inputClass}
              >
                <option value="">— none —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Description *</label>
              <input value={prod.description} onChange={(e) => setProd((p) => ({ ...p, description: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Planned qty *</label>
              <input type="number" value={prod.plannedQty} onChange={(e) => setProd((p) => ({ ...p, plannedQty: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select value={prod.priority} onChange={(e) => setProd((p) => ({ ...p, priority: e.target.value }))} className={inputClass}>
                <option>High</option>
                <option>Normal</option>
                <option>Low</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Start date</label>
              <input type="date" value={prod.startDate} onChange={(e) => setProd((p) => ({ ...p, startDate: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Due date</label>
              <input type="date" value={prod.dueDate} onChange={(e) => setProd((p) => ({ ...p, dueDate: e.target.value }))} className={inputClass} />
            </div>
            <div className="md:col-span-4">
              <label className={labelClass}>Stages (comma-separated — defaults to the standard routing; product-specific routing allowed)</label>
              <input
                value={prod.stages}
                onChange={(e) => setProd((p) => ({ ...p, stages: e.target.value }))}
                placeholder={DEFAULT_STAGES.join(", ")}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button className={btnClass} disabled={pending || !prod.description.trim() || !Number(prod.plannedQty)} onClick={submitProduction}>
                {pending ? "Saving…" : "Create production"}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {productions.length === 0 && <p className="text-sm text-slate-500">No production plans yet.</p>}
          {productions.map((p) => {
            const pct = productionPct(num(p.planned_qty), num(p.produced_qty));
            const balance = Math.max(0, num(p.planned_qty) - num(p.produced_qty));
            const isOverdue = p.status !== "Completed" && p.due_date && p.due_date < new Date().toISOString().slice(0, 10);
            const entry = entries[p.id] ?? { qty: "", stage: p.current_stage };
            const stages = p.stages.length > 0 ? p.stages : [...DEFAULT_STAGES];
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${isOverdue ? "border-red-300 bg-red-50/50" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs font-semibold text-slate-600">{p.production_no}</span>
                  <span className="font-medium text-slate-900">{p.description}</span>
                  {p.orderNo && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">→ {p.orderNo}</span>}
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusTone(p.status)}`}>{p.status}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${p.priority === "High" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                    {p.priority}
                  </span>
                  {p.due_date && (
                    <span className={`text-xs ${isOverdue ? "font-bold text-red-600" : "text-slate-500"}`}>
                      due {p.due_date} {isOverdue ? "· LATE" : ""}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-500">
                    {num(p.produced_qty)} / {num(p.planned_qty)} (balance {balance})
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2.5 flex-1 rounded bg-slate-100">
                    <div className={`h-2.5 rounded ${pct >= 100 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-14 text-right text-sm font-bold text-slate-800">{fmtPct(pct)}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="w-44">
                    <label className={labelClass}>Stage</label>
                    <select value={entry.stage} onChange={(e) => setEntries((s) => ({ ...s, [p.id]: { ...entry, stage: e.target.value } }))} className={inputClass}>
                      {stages.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className={labelClass}>+ qty</label>
                    <input
                      type="number"
                      value={entry.qty}
                      onChange={(e) => setEntries((s) => ({ ...s, [p.id]: { ...entry, qty: e.target.value } }))}
                      className={inputClass}
                    />
                  </div>
                  <button
                    className={btnClass}
                    disabled={pending || !Number(entry.qty)}
                    onClick={() =>
                      run(() => addProductionEntry(p.id, { qty: entry.qty, stage: entry.stage }), () =>
                        setEntries((s) => ({ ...s, [p.id]: { qty: "", stage: entry.stage } }))
                      )
                    }
                  >
                    Add entry
                  </button>
                  <select
                    value={p.status}
                    disabled={pending}
                    onChange={(e) => run(() => updateProductionMeta(p.id, { status: e.target.value }))}
                    className={`${inputClass} w-36`}
                  >
                    {PRODUCTION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── QC ────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Quality control ({inspections.length} inspections)</h2>
          <button className={`${btnClass} ml-auto`} onClick={() => setShowQcForm((v) => !v)}>
            {showQcForm ? "Close" : "+ New inspection"}
          </button>
        </div>

        {showQcForm && (
          <div className="mb-4 grid gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className={labelClass}>Against order</label>
              <select value={qc.orderId} onChange={(e) => setQc((q) => ({ ...q, orderId: e.target.value }))} className={inputClass}>
                <option value="">— none —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Against production</label>
              <select value={qc.productionId} onChange={(e) => setQc((q) => ({ ...q, productionId: e.target.value }))} className={inputClass}>
                <option value="">— none —</option>
                {productions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.production_no} · {p.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Inspected *</label>
              <input type="number" value={qc.inspectedQty} onChange={(e) => setQc((q) => ({ ...q, inspectedQty: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Passed</label>
              <input type="number" value={qc.passedQty} onChange={(e) => setQc((q) => ({ ...q, passedQty: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Rejected</label>
              <input type="number" value={qc.rejectedQty} onChange={(e) => setQc((q) => ({ ...q, rejectedQty: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Rework</label>
              <input type="number" value={qc.reworkQty} onChange={(e) => setQc((q) => ({ ...q, reworkQty: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" value={qc.inspectionDate} onChange={(e) => setQc((q) => ({ ...q, inspectionDate: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Inspector</label>
              <input value={qc.inspector} onChange={(e) => setQc((q) => ({ ...q, inspector: e.target.value }))} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Remarks</label>
              <input value={qc.remarks} onChange={(e) => setQc((q) => ({ ...q, remarks: e.target.value }))} className={inputClass} />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button
                className={btnClass}
                disabled={
                  pending ||
                  !Number(qc.inspectedQty) ||
                  Number(qc.passedQty || 0) + Number(qc.rejectedQty || 0) + Number(qc.reworkQty || 0) > Number(qc.inspectedQty)
                }
                onClick={submitQc}
              >
                {pending ? "Saving…" : "Record inspection"}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">QC No</th>
                <th className="py-2 pr-3">Order / Production</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3 text-right">Inspected</th>
                <th className="py-2 pr-3 text-right">Passed</th>
                <th className="py-2 pr-3 text-right">Rejected</th>
                <th className="py-2 pr-3 text-right">Rework</th>
                <th className="py-2 pr-3 text-right">Pass %</th>
                <th className="py-2 pr-3 text-right">Defect %</th>
                <th className="py-2 pr-3">Inspector</th>
              </tr>
            </thead>
            <tbody>
              {inspections.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    No inspections recorded yet.
                  </td>
                </tr>
              )}
              {inspections.map((q) => {
                const r = computeQc({
                  inspected: num(q.inspected_qty),
                  passed: num(q.passed_qty),
                  rejected: num(q.rejected_qty),
                  rework: num(q.rework_qty),
                });
                return (
                  <tr key={q.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs font-semibold text-slate-700">{q.qc_no}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {[q.orderNo, q.productionNo].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{q.inspection_date}</td>
                    <td className="py-2 pr-3 text-right">{num(q.inspected_qty)}</td>
                    <td className="py-2 pr-3 text-right text-emerald-600">{num(q.passed_qty)}</td>
                    <td className={`py-2 pr-3 text-right ${num(q.rejected_qty) > 0 ? "font-semibold text-red-600" : "text-slate-400"}`}>{num(q.rejected_qty)}</td>
                    <td className="py-2 pr-3 text-right text-amber-600">{num(q.rework_qty)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{r.passPct.toFixed(1)}%</td>
                    <td className={`py-2 pr-3 text-right font-medium ${r.defectPct > 0 ? "text-red-600" : "text-slate-500"}`}>{r.defectPct.toFixed(1)}%</td>
                    <td className="py-2 pr-3 text-slate-600">{q.inspector || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
