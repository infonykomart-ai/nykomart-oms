"use client";

// 2026-10-13 — "DAILY ORDER SHEET KESE DIKHEGI KI AAJ SABHI STORE PAR
// KITNE ORDER AMMOUNT QTY BAKI SAB COUNTRY WISE, SKU WISE, SIZE WISE
// (AGAR NAHI BANA HUA TO BANAO ISME)": one sheet for one day (defaults to
// today IST) over the SAME store scoping as the Report tab — headline
// totals, then store-wise / country-wise / SKU-wise / size-wise tables,
// each exportable via the shared ExportBar (CSV/Excel/Word/PDF/WhatsApp…)
// and all inside one print area for the PDF/Print path.
//
// 2026-10-13 (part 2) — "1/2 2/2 4/4 JESE ORDER EK HI MANA JAYE OR
// QUANTITY ME HO" + "DAILY ORDER KE BASE PAR ORDER FILE GENERATE KARNE
// KA OPTION ... PURI FILE PDF A4 SIZE": orders now count per BASE PO
// (PO-A926-1/2 + -2/2 = 1 order, qty/amount still summed — see
// daily-sheet-stats.ts), and a Generate PO File button opens the day's
// full order file through /dashboard/orders/print — the exact stacked-
// sheet A4 file the Orders page generates.
//
// The page (page.tsx) does ALL the aggregation — like the rest of this
// module, this component only renders what it is handed, so screen, PDF
// and exports can never disagree.

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { PrintArea } from "@/components/print-view";

export type DailyOrderBucket = { orders: number; qty: number; usd: number };

export type DailyOrderStoreRow = DailyOrderBucket & {
  storeId: string;
  storeName: string;
  companyName: string;
};

/** One dimension row — country / SKU / size all render through the same shape. */
export type DailyOrderGroupRow = DailyOrderBucket & { label: string };

export type DailyOrderSheetData = {
  date: string;
  totals: DailyOrderBucket;
  /** Every order of the day in PO order — feeds the Generate PO File link. */
  orderIds: string[];
  storeRows: DailyOrderStoreRow[];
  countryRows: DailyOrderGroupRow[];
  skuRows: DailyOrderGroupRow[];
  sizeRows: DailyOrderGroupRow[];
};

const STORE_COLUMNS: ExportColumn<DailyOrderStoreRow>[] = [
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "orders", label: "ORDERS", value: (r) => r.orders },
  { key: "qty", label: "QTY", value: (r) => r.qty },
  { key: "usd", label: "AMOUNT (USD)", value: (r) => r.usd.toFixed(2) },
];

function groupColumns(firstLabel: string): ExportColumn<DailyOrderGroupRow>[] {
  return [
    { key: "label", label: firstLabel, value: (r) => r.label },
    { key: "orders", label: "ORDERS", value: (r) => r.orders },
    { key: "qty", label: "QTY", value: (r) => r.qty },
    { key: "usd", label: "AMOUNT (USD)", value: (r) => r.usd.toFixed(2) },
  ];
}

function GroupTable({
  columns,
  rows,
  emptyText,
}: {
  columns: ExportColumn<DailyOrderGroupRow>[];
  rows: DailyOrderGroupRow[];
  emptyText: string;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50">
        <tr>
          {columns.map((c) => (
            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.label} className="hover:bg-slate-50">
            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{r.label}</td>
            <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.orders}</td>
            <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.qty}</td>
            <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.usd.toFixed(2)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-slate-400">{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function DailyOrderSheet({
  companies,
  filters,
  data,
}: {
  companies: { id: string; name: string }[];
  filters: { date: string; companyId: string };
  data: DailyOrderSheetData | null;
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
  const countryColumns = groupColumns("Country");
  const skuColumns = groupColumns("SKU");
  const sizeColumns = groupColumns("Size");

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <input type="hidden" name="tab" value="sheet" />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="sheet-date">Date</label>
          <input id="sheet-date" name="date" type="date" defaultValue={filters.date} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="sheet-company">Company</label>
          <select id="sheet-company" name="company" defaultValue={filters.companyId} className={inputClass}>
            <option value="">All</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/ad-spend?tab=sheet" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      {!data ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          No store is in scope for this view — pick a company, or ask an Admin to assign your store(s) under Employees → Store Access.
        </div>
      ) : (
        <>
          <p className="-mt-3 text-[11px] text-slate-400">
            Orders counted on the day their <b>PO date</b> falls (blank PO date falls back to the order/entry date) — the same rule
            the Monthly Roll-up uses. Multi-part POs like <b>PO-A926-1/2</b> + <b>PO-A926-2/2</b> count as <b>ONE order</b> (their
            quantities and amounts still add up).
          </p>

          <div className="flex flex-wrap items-stretch justify-between gap-3">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Total orders" value={String(data.totals.orders)} sub={data.date} />
              <StatCard label="Total qty" value={String(data.totals.qty)} />
              <StatCard label="Total amount" value={`$${data.totals.usd.toFixed(2)}`} sub="USD" />
            </div>
            {data.orderIds.length > 0 && (
              <a
                href={`/dashboard/orders/print?ids=${data.orderIds.join(",")}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Din ka poora order file (PO) — wahi file jo Order page se banti hai, A4 PDF"
                className="print:hidden flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
              >
                📄 Generate PO File (A4)
              </a>
            )}
          </div>

          <PrintArea id="daily-order-sheet-print"><div className="space-y-8">
            <section>
              <div className="mb-2 flex items-center justify-between print:hidden">
                <h2 className="text-sm font-semibold text-slate-700">Store-wise — {data.date}</h2>
                <ExportBar title="Daily Order Sheet — Store-wise" filenameBase="daily-order-sheet-stores" columns={STORE_COLUMNS} rows={data.storeRows} printAreaId="daily-order-sheet-print" />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {STORE_COLUMNS.map((c) => (
                        <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.storeRows.map((r) => (
                      <tr key={r.storeId} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.companyName}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{r.storeName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.orders}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.qty}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.usd.toFixed(2)}</td>
                      </tr>
                    ))}
                    {data.storeRows.length === 0 && (
                      <tr>
                        <td colSpan={STORE_COLUMNS.length} className="px-3 py-8 text-center text-slate-400">No orders on this date.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between print:hidden">
                <h2 className="text-sm font-semibold text-slate-700">Country-wise — {data.date}</h2>
                <ExportBar title="Daily Order Sheet — Country-wise" filenameBase="daily-order-sheet-country" columns={countryColumns} rows={data.countryRows} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <GroupTable columns={countryColumns} rows={data.countryRows} emptyText="No orders on this date." />
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between print:hidden">
                <h2 className="text-sm font-semibold text-slate-700">SKU-wise — {data.date}</h2>
                <ExportBar title="Daily Order Sheet — SKU-wise" filenameBase="daily-order-sheet-sku" columns={skuColumns} rows={data.skuRows} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <GroupTable columns={skuColumns} rows={data.skuRows} emptyText="No orders on this date." />
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between print:hidden">
                <h2 className="text-sm font-semibold text-slate-700">Size-wise — {data.date}</h2>
                <ExportBar title="Daily Order Sheet — Size-wise" filenameBase="daily-order-sheet-size" columns={sizeColumns} rows={data.sizeRows} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <GroupTable columns={sizeColumns} rows={data.sizeRows} emptyText="No orders on this date." />
              </div>
            </section>
          </div></PrintArea>
        </>
      )}
    </div>
  );
}
