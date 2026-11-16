import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getDashboard, getLookups, listChallans, listPurchaseRequirements } from "@/lib/inventory/queries";
import { closeRequirementAction } from "./actions";
import { stageLabel, txTypeLabel } from "@/lib/inventory/stages";
import { EmptyRow, InventoryTabs, MessageBanner, PageHeading, Stat, cardClass, inputClass, labelClass, td, th } from "./ui";

// Inventory dashboard — every number is a live query (no demo figures). The
// available figure is READY minus live reservations; WIP stages are shown so
// the team can see where goods actually are.
export default async function InventoryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCapability("inventory_view");
  const sp = await searchParams;
  const categoryId = typeof sp.category === "string" ? sp.category : "";
  const warehouseId = typeof sp.warehouse === "string" ? sp.warehouse : "";
  const stage = typeof sp.stage === "string" ? sp.stage : "";
  const search = typeof sp.q === "string" ? sp.q : "";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";

  const db = createServiceRoleClientUnchecked();
  const employee = await requireCapability("inventory_view");
  const lookups = await getLookups(db, employee.currentCompanyId);
  const [dash, challans, requirements] = await Promise.all([
    getDashboard(db, employee.currentCompanyId, lookups, { categoryId, warehouseId, stage, search }),
    listChallans(db, employee.currentCompanyId, lookups, 200),
    listPurchaseRequirements(db, employee.currentCompanyId, lookups),
  ]);

  const t = dash.totals;
  const issuedInRange = challans.filter(
    (c) =>
      c.status === "ISSUED" &&
      (!from || (c.issueDate ?? "") >= from) &&
      (!to || (c.issueDate ?? "") <= to)
  );
  const alerts = [
    dash.lowStock.length ? `${dash.lowStock.length} SKU(s) below minimum stock` : null,
    dash.outOfStock.length ? `${dash.outOfStock.length} SKU(s) out of ready stock` : null,
    dash.overdueJobs ? `${dash.overdueJobs} processing job(s) past their expected date` : null,
    t.qcRejectedPcs > 0 ? `${t.qcRejectedPcs} PCS sitting in QC rejected` : null,
    dash.reconcileMismatches ? `${dash.reconcileMismatches} balance(s) disagree with the ledger — run reconciliation` : null,
    dash.pendingProcessing ? `${dash.pendingProcessing} processing job(s) open` : null,
    dash.pendingManufacturing ? `${dash.pendingManufacturing} manufacturing job(s) open` : null,
    requirements.length ? `${requirements.length} open purchase requirement(s) from confirmed orders` : null,
  ].filter((a): a is string => Boolean(a));

  return (
    <div>
      <PageHeading
        title="📦 Inventory Management"
        subtitle="Live stock by stage, PCS and SQ FT — ready stock less active reservations is what can actually be promised."
      />
      <MessageBanner ok={typeof sp.ok === "string" ? sp.ok : undefined} error={typeof sp.error === "string" ? sp.error : undefined} />
      <InventoryTabs active="/dashboard/inventory" />

      <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-3`}>
        <div className="min-w-[150px]">
          <label className={labelClass} htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={categoryId} className={inputClass}>
            <option value="">All</option>
            {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className={labelClass} htmlFor="warehouse">Warehouse</label>
          <select id="warehouse" name="warehouse" defaultValue={warehouseId} className={inputClass}>
            <option value="">All</option>
            {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className={labelClass} htmlFor="stage">Stock stage</label>
          <select id="stage" name="stage" defaultValue={stage} className={inputClass}>
            <option value="">All stages</option>
            {["RAW", "PRINTING", "WASHING", "MANUFACTURING", "QC", "READY", "REJECTED"].map((s) => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className={labelClass} htmlFor="q">SKU / product</label>
          <input id="q" name="q" defaultValue={search} className={inputClass} placeholder="e.g. JUTE-001" />
        </div>
        <div>
          <label className={labelClass} htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className={inputClass} />
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">Filter</button>
        <Link href="/dashboard/inventory" className="text-xs text-slate-400 underline">Clear</Link>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Physical stock" value={t.physicalPcs} unit="PCS" />
        <Stat label="Physical area" value={t.physicalSqft} unit="SQ FT" />
        <Stat label="Available (ready − reserved)" value={t.availablePcs} unit="PCS" tone="teal" />
        <Stat label="Available area" value={t.availableSqft} unit="SQ FT" tone="teal" />
        <Stat label="Reserved" value={t.reservedPcs} unit="PCS" tone="indigo" />
        <Stat label="Printing WIP" value={t.printingPcs} unit="PCS" tone="amber" />
        <Stat label="Washing WIP" value={t.washingPcs} unit="PCS" tone="amber" />
        <Stat label="Manufacturing WIP" value={t.manufacturingPcs} unit="PCS" tone="amber" />
        <Stat label="Ready to dispatch" value={t.readyPcs} unit="PCS" tone="teal" />
        <Stat label="QC rejected" value={t.qcRejectedPcs} unit="PCS" tone="rose" />
        <Stat label="Dispatched (challans)" value={issuedInRange.reduce((a, c) => a + c.lines.reduce((x, l) => x + l.pcs, 0), 0)} unit="PCS" />
        <Stat label="Low stock SKUs" value={dash.lowStock.length} tone="amber" />
        <Stat label="Out of stock SKUs" value={dash.outOfStock.length} tone="rose" />
        <Stat label="Processing pending" value={dash.pendingProcessing} />
        <Stat label="Purchase requirements" value={requirements.length} tone={requirements.length ? "amber" : "slate"} />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className={`${cardClass} p-3 lg:col-span-2`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Alerts</h2>
          {alerts.length === 0 ? (
            <p className="text-xs text-slate-400">Nothing needs attention right now.</p>
          ) : (
            <ul className="space-y-1 text-xs text-slate-700">
              {alerts.map((a) => (
                <li key={a} className="flex gap-2"><span className="text-amber-500">●</span>{a}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Purchase requirements are raised automatically when a confirmed order cannot be covered by READY stock. There is no purchase-order entry yet, so the list below is the “what to buy” record — close a row once the goods are received or the need is over.
          </p>
        </div>
        <div className={`${cardClass} p-3`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Shortcuts</h2>
          <div className="grid gap-1.5 text-xs">
            <Link className="rounded-md bg-slate-50 px-2.5 py-1.5 hover:bg-slate-100" href="/dashboard/inventory/stock">➕ Stock inward</Link>
            <Link className="rounded-md bg-slate-50 px-2.5 py-1.5 hover:bg-slate-100" href="/dashboard/inventory/challans">🚚 Issue a challan</Link>
            <Link className="rounded-md bg-slate-50 px-2.5 py-1.5 hover:bg-slate-100" href="/dashboard/inventory/reports">📊 Reports &amp; export</Link>
            <Link className="rounded-md bg-slate-50 px-2.5 py-1.5 hover:bg-slate-100" href="/dashboard/inventory/finished-goods">♻️ Legacy finished-goods view</Link>
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Purchase requirements (open)</h2>
      <div className={`${cardClass} mb-5 overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>Order</th><th className={th()}>SKU</th><th className={th()}>Product</th>
              <th className={th()}>Size</th><th className={th()}>To buy</th><th className={th()}>Raised</th><th className={th()}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requirements.map((r) => (
              <tr key={r.id}>
                <td className={td("font-medium")}>
                  {r.orderId ? (
                    <Link className="underline" href={`/dashboard/orders/${r.orderId}`}>{r.orderRef ?? "Order"}</Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={td("font-medium")}>{r.meta.sku}</td>
                <td className={td()}>{r.meta.productName}</td>
                <td className={td()}>{r.meta.sizeLabel || "—"}</td>
                <td className={td("text-amber-600")}>{r.requiredPcs} PCS</td>
                <td className={td("text-slate-500")}>{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                <td className={td()}>
                  <form action={closeRequirementAction}>
                    <input type="hidden" name="requirement_id" value={r.id} />
                    <input type="hidden" name="return_to" value="/dashboard/inventory" />
                    <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-50">
                      Close
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {requirements.length === 0 && <EmptyRow colSpan={7} message="No open requirements — every confirmed order is covered by READY stock." />}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Low stock (below minimum)</h2>
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50"><tr><th className={th()}>SKU</th><th className={th()}>Product</th><th className={th()}>Ready</th><th className={th()}>Minimum</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {dash.lowStock.map((l) => (
                  <tr key={`${l.variantId}-${l.warehouseId}`}>
                    <td className={td("font-medium")}>{l.meta.sku}</td>
                    <td className={td()}>{l.meta.productName}</td>
                    <td className={td("text-amber-600")}>{l.pcs}</td>
                    <td className={td()}>{l.meta.minStockPcs}</td>
                  </tr>
                ))}
                {dash.lowStock.length === 0 && <EmptyRow colSpan={4} message="No SKU is below its minimum." />}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Out of stock (no READY)</h2>
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50"><tr><th className={th()}>SKU</th><th className={th()}>Product</th><th className={th()}>On hand</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {dash.outOfStock.map((l) => (
                  <tr key={`${l.variantId}-${l.warehouseId}`}>
                    <td className={td("font-medium")}>{l.meta.sku}</td>
                    <td className={td()}>{l.meta.productName}</td>
                    <td className={td("text-rose-600")}>{l.pcs}</td>
                  </tr>
                ))}
                {dash.outOfStock.length === 0 && <EmptyRow colSpan={3} message="Every SKU with a balance has ready stock." />}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Recent stock movements</h2>
      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>When</th><th className={th()}>SKU</th><th className={th()}>Stage</th>
              <th className={th()}>Movement</th><th className={th()}>PCS</th><th className={th()}>SQ FT</th><th className={th()}>Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dash.recentLedger.map((l) => (
              <tr key={l.id}>
                <td className={td("text-slate-500")}>{new Date(l.createdAt).toLocaleString("en-IN")}</td>
                <td className={td("font-medium")}>{l.meta.sku}</td>
                <td className={td()}>{stageLabel(l.stage)}</td>
                <td className={td()}>{txTypeLabel(l.txType)}</td>
                <td className={td(l.pcsDelta < 0 ? "text-rose-600" : "text-emerald-700")}>{l.pcsDelta > 0 ? "+" : ""}{l.pcsDelta}</td>
                <td className={td(l.sqftDelta < 0 ? "text-rose-600" : "text-emerald-700")}>{l.sqftDelta > 0 ? "+" : ""}{l.sqftDelta}</td>
                <td className={td("text-slate-500")}>{l.refNo ?? l.remarks ?? "—"}</td>
              </tr>
            ))}
            {dash.recentLedger.length === 0 && <EmptyRow colSpan={7} message="No stock movement yet — start with Stock Inward." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
