"use client";

import { useState, useTransition } from "react";
import { downloadXLSX, type ExportColumn } from "@/lib/export/export-table";
import { getBackupExportRows, type BackupExportRow } from "./actions";

// Single "Export All Orders + Invoices" button — reuses the same
// xlsx-writing helper (downloadXLSX, via the `xlsx`/SheetJS package
// already a dependency — see src/lib/export/export-table.ts's header
// comment) every other Excel export button in this app uses. No new
// export mechanism, no new dependency.
const COLUMNS: ExportColumn<BackupExportRow>[] = [
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "refNo", label: "PO/RF/RG No.", value: (r) => r.refNo },
  { key: "orderDate", label: "Order Date", value: (r) => r.orderDate },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "dispatchDate", label: "Dispatch Date", value: (r) => r.dispatchDate },
  { key: "marketplaceOrderNo", label: "Marketplace Order No.", value: (r) => r.marketplaceOrderNo },
  { key: "itemCategory", label: "Item Category", value: (r) => r.itemCategory },
  { key: "skuLabel", label: "SKU", value: (r) => r.skuLabel },
  { key: "sizeLabel", label: "Size", value: (r) => r.sizeLabel },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "buyerNameAddress", label: "Buyer Name & Address", value: (r) => r.buyerNameAddress },
  { key: "contactNo", label: "Contact No.", value: (r) => r.contactNo },
  { key: "emailId", label: "Email", value: (r) => r.emailId },
  { key: "orderCurrency", label: "Order Currency", value: (r) => r.orderCurrency },
  { key: "orderValueOriginal", label: "Order Value (Original)", value: (r) => r.orderValueOriginal },
  { key: "orderValueUsd", label: "Order Value (USD)", value: (r) => r.orderValueUsd },
  { key: "orderValueInr", label: "Order Value (INR)", value: (r) => r.orderValueInr },
  { key: "invInvoiceNo", label: "Invoice No.", value: (r) => r.invInvoiceNo },
  { key: "invMasterInvoiceNo", label: "Master Invoice No.", value: (r) => r.invMasterInvoiceNo },
  { key: "invInvoiceDate", label: "Invoice Date", value: (r) => r.invInvoiceDate },
  { key: "invCsbType", label: "CSB Type", value: (r) => r.invCsbType },
  { key: "invCourierCompany", label: "Invoice Courier Company", value: (r) => r.invCourierCompany },
  { key: "invDestinationCountry", label: "Destination Country", value: (r) => r.invDestinationCountry },
  { key: "invInvoiceValueUsd", label: "Invoice Value (USD)", value: (r) => r.invInvoiceValueUsd },
  { key: "invTaxableValueInr", label: "Taxable Value (INR)", value: (r) => r.invTaxableValueInr },
  { key: "diInvoiceNo", label: "Dispatch Invoice No.", value: (r) => r.diInvoiceNo },
  { key: "diInvoiceDate", label: "Dispatch Invoice Date", value: (r) => r.diInvoiceDate },
  { key: "diAwbNo", label: "AWB No.", value: (r) => r.diAwbNo },
  { key: "diBuyerCountry", label: "Buyer Country", value: (r) => r.diBuyerCountry },
  { key: "diCourierName", label: "Courier Name", value: (r) => r.diCourierName },
  { key: "diOrgSaleAmtUsd", label: "Org. Sale Amt (USD)", value: (r) => r.diOrgSaleAmtUsd },
  { key: "diOrgSaleAmtInr", label: "Org. Sale Amt (INR)", value: (r) => r.diOrgSaleAmtInr },
  { key: "diInvoiceAmtUsd", label: "Invoice Amt (USD)", value: (r) => r.diInvoiceAmtUsd },
  { key: "diInvoiceAmtInr", label: "Invoice Amt (INR)", value: (r) => r.diInvoiceAmtInr },
  { key: "diTotalAmt", label: "Total Amt", value: (r) => r.diTotalAmt },
  { key: "diDeliveredStatus", label: "Delivered Status", value: (r) => r.diDeliveredStatus },
  { key: "diDeliveredDate", label: "Delivered Date", value: (r) => r.diDeliveredDate },
];

export function BackupExportButton() {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function run() {
    setNotice(null);
    startTransition(async () => {
      try {
        const rows = await getBackupExportRows();
        const stamp = new Date().toISOString().slice(0, 10);
        await downloadXLSX(`backup-all-orders-invoices-${stamp}`, "Orders + Invoices", COLUMNS, rows);
        setNotice(`Downloaded ${rows.length} order${rows.length === 1 ? "" : "s"}.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Export failed — please try again.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Preparing workbook…" : "⬇️ Export All Orders + Invoices"}
      </button>
      {notice && <p className="mt-2 text-xs text-slate-500">{notice}</p>}
    </div>
  );
}
