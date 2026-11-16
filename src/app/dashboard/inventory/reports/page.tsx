import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listChallans, listLedger, listReservations, listStock } from "@/lib/inventory/queries";
import { stageLabel } from "@/lib/inventory/stages";
import { EmptyRow, InventoryTabs, PageHeading, cardClass, td, th } from "../ui";

function sumBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => number): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + value(row));
  return map;
}

export default async function ReportsPage() {
  const employee = await requireCapability("inventory_view");
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const [stock, reservations, challans, ledger] = await Promise.all([
    listStock(db, employee.currentCompanyId, lookups, {}),
    listReservations(db, employee.currentCompanyId, lookups, "ACTIVE"),
    listChallans(db, employee.currentCompanyId, lookups, 200),
    listLedger(db, employee.currentCompanyId, lookups, { limit: 100 }),
  ]);

  const warehouseName = new Map(lookups.warehouses.map((w) => [w.id, w.name]));
  const categoryTotals = sumBy(stock, (l) => l.meta.categoryName, (l) => l.pcs);
  const categorySqft = sumBy(stock, (l) => l.meta.categoryName, (l) => l.sqft);
  const warehouseTotals = sumBy(stock, (l) => warehouseName.get(l.warehouseId) ?? "—", (l) => l.pcs);
  const rejected = stock.filter((l) => l.stage === "REJECTED" && l.pcs > 0);
  const ready = stock.filter((l) => l.stage === "READY");
  const issued = challans.filter((c) => c.status === "ISSUED");

  const exportLink = (type: string) => `/api/inventory/reports/export?type=${type}`;

  return (
    <div>
      <PageHeading title="Inventory Reports" subtitle="Every table is live data. Use Export CSV for Excel; the ledger export honours its filters." />
      <InventoryTabs active="/dashboard/inventory/reports" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["current-stock", "Current Stock Report"],
          ["low-stock", "Low Stock Report"],
          ["reserved", "Reserved Stock Report"],
          ["rejected", "Rejected Stock Report"],
          ["challans", "Challan-wise Deduction"],
          ["adjustments", "Stock Adjustment Report"],
          ["stock-movement", "Stock Movement Ledger"],
          ["warehouse", "Warehouse-wise Stock"],
        ].map(([type, label]) => (
          <a key={type} href={exportLink(type)} className={`${cardClass} px-3 py-2 text-sm font-medium text-slate-700 hover:border-amber-400`}>
            ⬇️ {label}
          </a>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Category-wise stock</h2>
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50"><tr><th className={th()}>Category</th><th className={th("text-right")}>PCS</th><th className={th("text-right")}>SQ FT</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from(categoryTotals.entries()).map(([name, pcs]) => (
                  <tr key={name}><td className={td()}>{name}</td><td className={td("text-right font-semibold")}>{pcs}</td><td className={td("text-right")}>{categorySqft.get(name) ?? 0}</td></tr>
                ))}
                {categoryTotals.size === 0 && <EmptyRow colSpan={3} message="No stock yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Warehouse-wise stock</h2>
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50"><tr><th className={th()}>Warehouse</th><th className={th("text-right")}>PCS</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from(warehouseTotals.entries()).map(([name, pcs]) => (
                  <tr key={name}><td className={td()}>{name}</td><td className={td("text-right font-semibold")}>{pcs}</td></tr>
                ))}
                {warehouseTotals.size === 0 && <EmptyRow colSpan={2} message="No stock yet." />}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">PCS &amp; SQ FT by SKU (ready)</h2>
          <div className={`${cardClass} max-h-80 overflow-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-slate-50"><tr><th className={th()}>SKU</th><th className={th()}>Size</th><th className={th("text-right")}>PCS</th><th className={th("text-right")}>SQ FT</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ready.map((l) => (
                  <tr key={`${l.variantId}-${l.warehouseId}`}><td className={td("font-medium")}>{l.meta.sku}</td><td className={td()}>{l.meta.sizeLabel || "—"}</td><td className={td("text-right")}>{l.pcs}</td><td className={td("text-right")}>{l.sqft}</td></tr>
                ))}
                {ready.length === 0 && <EmptyRow colSpan={4} message="No ready stock." />}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Reserved stock</h2>
          <div className={`${cardClass} max-h-80 overflow-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-slate-50"><tr><th className={th()}>Order</th><th className={th()}>SKU</th><th className={th("text-right")}>Open PCS</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {reservations.map((r) => (
                  <tr key={r.id}><td className={td()}>{r.orderRef}</td><td className={td("font-medium")}>{r.meta.sku}</td><td className={td("text-right")}>{r.pcs - r.fulfilledPcs}</td></tr>
                ))}
                {reservations.length === 0 && <EmptyRow colSpan={3} message="No active reservations." />}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">QC rejected stock</h2>
          <div className={`${cardClass} max-h-80 overflow-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-slate-50"><tr><th className={th()}>SKU</th><th className={th()}>Warehouse</th><th className={th("text-right")}>PCS</th><th className={th("text-right")}>SQ FT</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rejected.map((l) => (
                  <tr key={`${l.variantId}-${l.warehouseId}`}><td className={td("font-medium")}>{l.meta.sku}</td><td className={td()}>{warehouseName.get(l.warehouseId) ?? "—"}</td><td className={td("text-right text-rose-600")}>{l.pcs}</td><td className={td("text-right")}>{l.sqft}</td></tr>
                ))}
                {rejected.length === 0 && <EmptyRow colSpan={4} message="Nothing rejected." />}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Challan-wise deduction</h2>
          <div className={`${cardClass} max-h-80 overflow-auto`}>
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="sticky top-0 bg-slate-50"><tr><th className={th()}>Challan</th><th className={th()}>Issued</th><th className={th("text-right")}>PCS</th><th className={th("text-right")}>SQ FT</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {issued.map((c) => {
                  const pcs = c.lines.reduce((a, l) => a + l.pcs, 0);
                  const sqft = c.lines.reduce((a, l) => a + l.sqft, 0);
                  return <tr key={c.id}><td className={td("font-medium")}>{c.chalanNo}</td><td className={td()}>{c.issueDate ?? "—"}</td><td className={td("text-right")}>{pcs}</td><td className={td("text-right")}>{sqft}</td></tr>;
                })}
                {issued.length === 0 && <EmptyRow colSpan={4} message="No issued challans." />}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Recent stock movement</h2>
      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><th className={th()}>When</th><th className={th()}>SKU</th><th className={th()}>Stage</th><th className={th("text-right")}>PCS</th><th className={th("text-right")}>SQ FT</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {ledger.map((l) => (
              <tr key={l.id}><td className={td("text-slate-500")}>{new Date(l.createdAt).toLocaleDateString("en-IN")}</td><td className={td("font-medium")}>{l.meta.sku}</td><td className={td()}>{stageLabel(l.stage)}</td><td className={td("text-right")}>{l.pcsDelta}</td><td className={td("text-right")}>{l.sqftDelta}</td></tr>
            ))}
            {ledger.length === 0 && <EmptyRow colSpan={5} message="No movements yet." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
