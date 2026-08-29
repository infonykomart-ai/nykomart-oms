// Document Entry bulk CSV upload (2026-08-08) — ONE column list per doc
// type, used both for the downloadable template (<DownloadTemplateButton
// columns={...} />) and to read the uploaded file back (each bulkSave*
// action in ../actions.ts matches by these exact labels, case/asterisk-
// insensitive) — same pairing convention as orders/bulk-upload/columns.ts
// and invoices/bulk-upload/columns.ts.
export type BulkDocColumn = { label: string; example: string; required: boolean; help?: string };

export const CREDIT_NOTE_COLUMNS: BulkDocColumn[] = [
  { label: "PO/RF/RG No", example: "PO-0001", required: true, help: "Must match an existing order — buyer/invoice details are pulled from it automatically." },
  { label: "Credit Note Date", example: "2026-08-08", required: true, help: "YYYY-MM-DD" },
  { label: "Refund Amount", example: "500", required: true },
  { label: "Refund Currency", example: "INR", required: false, help: "USD or INR — defaults to INR." },
  { label: "Refund Date", example: "", required: false },
  { label: "Item Name", example: "", required: false },
  { label: "Item Price", example: "", required: false },
  { label: "Refund Type", example: "", required: false, help: "FULL REFUND or PARTIAL REFUND — auto-computed vs the order value if left blank." },
  { label: "Remark", example: "", required: false },
];

// Refund (2026-08-27) — "jese order ki sheet bani hai vesi har section ki
// sheet banegi ... refund and any other all": drives the exact same
// saveOrderRefundCore the manual Cancel/Return refund screen uses — see
// bulkSaveRefunds in ../actions.ts.
export const REFUND_COLUMNS: BulkDocColumn[] = [
  { label: "PO/RF/RG No", example: "PO-0001", required: true, help: "Must match an existing order." },
  { label: "Refund Amount", example: "50", required: true },
  { label: "Refund Currency", example: "USD", required: false, help: "USD or INR — defaults to USD." },
  { label: "Refund Date", example: "2026-08-27", required: true, help: "YYYY-MM-DD" },
  { label: "Reason", example: "", required: false },
];

export const DEBIT_NOTE_COLUMNS: BulkDocColumn[] = [
  { label: "Company Name", example: "Nyko Mart", required: true },
  { label: "Party Name", example: "", required: true, help: "Must match an existing Party Master entry." },
  { label: "Debit Note Date", example: "2026-08-08", required: true },
  { label: "PO/RF/RG No", example: "", required: false, help: "Optional — links this Debit Note back to an order." },
  { label: "Against Invoice/Bill No", example: "", required: false },
  { label: "Particulars", example: "", required: false },
  { label: "Bill No", example: "", required: false },
  { label: "Bill Date", example: "", required: false },
  { label: "SQ FT", example: "", required: false },
  { label: "Qty", example: "", required: false },
  { label: "Rate", example: "", required: false },
  { label: "PO Rate", example: "", required: false, help: "Agreed/PO rate per unit — optional, only for a rate-difference debit. Leave blank if you're filling Debit Amount directly." },
  { label: "Billed Rate", example: "", required: false, help: "Rate the vendor actually billed per unit — optional, pairs with PO Rate." },
  { label: "Debit Amount", example: "500", required: true },
  { label: "Remark", example: "", required: false },
];

export const WASHING_ENTRY_COLUMNS: BulkDocColumn[] = [
  { label: "Company Name", example: "Nyko Mart", required: true },
  { label: "Party Name", example: "", required: true, help: "The washing/dyeing vendor — must match an existing Party Master entry." },
  { label: "Chalan Date", example: "2026-08-08", required: true },
  { label: "PO/RF/RG No", example: "", required: false, help: "Optional — links this Washing Entry back to an order." },
  { label: "Store Name", example: "", required: false },
  { label: "Item Size", example: "", required: false },
  { label: "Pcs", example: "", required: false },
  { label: "SQ MTR/FT", example: "", required: false },
  { label: "Rate", example: "", required: false },
  { label: "Debit Charges", example: "", required: false },
];

export const PURCHASE_BILL_COLUMNS: BulkDocColumn[] = [
  { label: "Vendor Party Name", example: "", required: true, help: "Must match an existing Party Master entry." },
  { label: "PO/RF/RG No", example: "PO-0001", required: true, help: "Every Purchase Bill must be tied to the order it was bought for." },
  { label: "Vendor Invoice No", example: "", required: true },
  { label: "Vendor Invoice Date", example: "", required: false },
  { label: "Qty", example: "1", required: false },
  { label: "SQ Feet", example: "", required: false },
  { label: "Work Description", example: "", required: false },
  { label: "Unit Rate", example: "", required: false },
];

export const COURIER_BILL_COLUMNS: BulkDocColumn[] = [
  { label: "Invoice No", example: "", required: true },
  { label: "Invoice Date", example: "", required: false },
  { label: "Bill Weight (kg)", example: "", required: false },
  { label: "Freight Amount", example: "", required: false },
  { label: "Fuel Amount", example: "", required: false },
  { label: "Other Charges", example: "", required: false },
];

export const DUTY_TAX_BILL_COLUMNS: BulkDocColumn[] = [
  { label: "Invoice No", example: "", required: true },
  { label: "Invoice Date", example: "", required: false },
  { label: "Duty/Tax Amount USD", example: "", required: false },
  { label: "Duty/Tax Amount INR", example: "", required: false },
  { label: "GST 18% Amount", example: "", required: false },
];

// CSB Filing (2026-08-14) — columns B-L of the user's "NYKO_MART_Output.xlsx"
// (an OCR/PDF-extraction output of Indian customs CSB-V filing confirmation
// PDFs). Column A "File Name" and column M "Goods Description" are
// intentionally NOT listed here (per the user's explicit instruction) — a
// file that still has those columns uploads fine, since matching is by
// header text (see cellStr in ../actions.ts), not fixed position.
export const CSB_FILING_COLUMNS: BulkDocColumn[] = [
  { label: "CSB Number", example: "CSBV_DEL_2026-2027_30_07_18608", required: true, help: "The government CSB-V filing reference — must be unique." },
  { label: "Exchange Rate", example: "95.45", required: false },
  { label: "Total Taxable Value", example: "211.07", required: false },
  { label: "Taxable Value Currency", example: "USD", required: false },
  { label: "FOB Value (In INR)", example: "20146.63", required: false },
  { label: "Filing Date", example: "30/07/2026", required: false },
  { label: "EGM Number", example: "1064896", required: false },
  { label: "EGM Date", example: "31/07/2026", required: false },
  { label: "HAWB Number", example: "875033538890", required: false },
  { label: "Invoice Number", example: "ARG-59-26-27", required: false },
  { label: "Invoice Date", example: "29/07/2026", required: false },
];
