import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { getLookups, listLedger } from "@/lib/inventory/queries";
import { stageLabel, txTypeLabel } from "@/lib/inventory/stages";
import { EmptyRow, InventoryTabs, PageHeading, cardClass, inputClass, labelClass, td, th } from "../ui";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("inventory_view");
  const sp = await searchParams;
  const variantId = typeof sp.sku === "string" ? sp.sku : "";
  const stage = typeof sp.stage === "string" ? sp.stage : "";
  const txType = typeof sp.tx === "string" ? sp.tx : "";
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, employee.currentCompanyId);
  const rows = await listLedger(db, employee.currentCompanyId, lookups, {
    variantId,
    stage,
    txType,
    from,
    to,
    limit: 500,
  });
  const txTypes = Array.from(new Set(rows.map((r) => r.txType))).sort();

  const exportQuery = new URLSearchParams({ type: "ledger" });
  if (variantId) exportQuery.set("sku", variantId);
  if (stage) exportQuery.set("stage", stage);
  if (txType) exportQuery.set("tx", txType);
  if (from) exportQuery.set("from", from);
  if (to) exportQuery.set("to", to);

  return (
    <div>
      <PageHeading
        title="Stock Ledger"
        subtitle="Append-only history: every movement shows the balance before and after. Rows can never be edited or deleted."
      />
      <InventoryTabs active="/dashboard/inventory/ledger" />

      <form method="get" className={`${cardClass} mb-4 flex flex-wrap items-end gap-3 p-3`}>
        <div className="min-w-[170px]">
          <label className={labelClass} htmlFor="sku">SKU</label>
          <select id="sku" name="sku" defaultValue={variantId} className={inputClass}>
            <option value="">All</option>
            {lookups.variants.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className={labelClass} htmlFor="stage">Stage</label>
          <select id="stage" name="stage" defaultValue={stage} className={inputClass}>
            <option value="">All</option>
            {["RAW", "PRINTING", "WASHING", "MANUFACTURING", "QC", "READY", "REJECTED", "DISPATCHED"].map((s) => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className={labelClass} htmlFor="tx">Transaction</label>
          <select id="tx" name="tx" defaultValue={txType} className={inputClass}>
            <option value="">All</option>
            {txTypes.map((t) => <option key={t} value={t}>{txTypeLabel(t)}</option>)}
          </select>
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
        <Link href="/dashboard/inventory/ledger" className="text-xs text-slate-400 underline">Clear</Link>
        <a
          href={`/api/inventory/reports/export?${exportQuery.toString()}`}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </a>
      </form>

      <div className={`${cardClass} overflow-x-auto`}>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className={th()}>When</th><th className={th()}>SKU</th><th className={th()}>Warehouse</th><th className={th()}>Stage</th>
              <th className={th()}>Transaction</th><th className={th("text-right")}>PCS ±</th><th className={th("text-right")}>PCS after</th>
              <th className={th("text-right")}>SQ FT ±</th><th className={th("text-right")}>SQ FT after</th>
              <th className={th()}>Reference</th><th className={th()}>Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className={td("text-slate-500")}>{new Date(l.createdAt).toLocaleString("en-IN")}</td>
                <td className={td("font-medium")}>{l.meta.sku}</td>
                <td className={td()}>{l.warehouseName}</td>
                <td className={td()}>{stageLabel(l.stage)}</td>
                <td className={td()}>{txTypeLabel(l.txType)}</td>
                <td className={td(l.pcsDelta < 0 ? "text-right text-rose-600" : "text-right text-emerald-700")}>{l.pcsDelta > 0 ? "+" : ""}{l.pcsDelta}</td>
                <td className={td("text-right font-semibold")}>{l.newPcs}</td>
                <td className={td(l.sqftDelta < 0 ? "text-right text-rose-600" : "text-right text-emerald-700")}>{l.sqftDelta > 0 ? "+" : ""}{l.sqftDelta}</td>
                <td className={td("text-right font-semibold")}>{l.newSqft}</td>
                <td className={td("text-slate-500")}>{l.refNo ?? "—"}</td>
                <td className={td("max-w-[240px] truncate text-slate-500")}>{l.remarks ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <EmptyRow colSpan={11} message="No ledger entries for this filter." />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
