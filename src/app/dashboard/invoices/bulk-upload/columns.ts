// Bulk Invoice Generation via CSV (2026-08-08) — ONE shared column
// definition used both for the downloadable template
// (<DownloadTemplateButton />) and to read the uploaded file back
// (bulkGenerateInvoices() in ../actions.ts matches by these exact labels,
// case/asterisk-insensitive) — same pairing convention as
// orders/bulk-upload/columns.ts.
//
// One row = one ORDER to include in an invoice. Multiple rows sharing the
// same PO/RF/RG base number (e.g. "PO-0001-1/2" and "PO-0001-2/2") are
// automatically combined into ONE invoice, exactly like selecting a
// buyer-batch by hand on the main Invoices screen. Repeat the invoice-level
// columns (Invoice Date, Shipment Term, CSB Type, Courier Company, …)
// identically on every row of that batch — only the first row is actually
// read, but repeating keeps the CSV simple to prepare from a flat export.
export type BulkInvoiceColumn = {
  label: string;
  example: string;
  required: boolean;
  help?: string;
};

export const BULK_INVOICE_COLUMNS: BulkInvoiceColumn[] = [
  { label: "PO/RF/RG No.", example: "PO-0001", required: true, help: "Must exactly match an existing, not-yet-invoiced order." },
  { label: "Invoice Date", example: "2026-08-08", required: false, help: "YYYY-MM-DD. Defaults to today if left blank." },
  { label: "Shipment Term", example: "DAP", required: true },
  { label: "CSB Type", example: "CSB-V", required: true, help: "CSB-V or CSB-IV" },
  { label: "Courier Company", example: "FedEx", required: true },
  { label: "Destination Country", example: "USA", required: false },
  { label: "IOSS Number", example: "", required: false },
  { label: "Weight (kg)", example: "1.5", required: false },
  { label: "Length (cm)", example: "", required: false },
  { label: "Width (cm)", example: "", required: false },
  { label: "Height (cm)", example: "", required: false },
  { label: "Buyer Name & Address Override", example: "", required: false, help: "Leave blank to use the order's own buyer address." },
  { label: "Remark", example: "", required: false },
];
