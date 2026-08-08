// Bulk Order Entry via CSV (2026-08-08, pending item 7) — ONE shared column
// definition used both to generate the downloadable template
// (<DownloadTemplateButton />) and to read the uploaded file back
// (bulkCreateOrders() in ../new/actions.ts matches by these exact labels,
// case/asterisk-insensitive) — so the template and the parser can never
// drift out of sync with each other.
//
// One row = one order LINE ITEM (same grain as one "Item" block on the
// normal /dashboard/orders/new form). Multiple rows for the same Buyer
// Name & Address / Contact No on the same Order Date are automatically
// batched under one PO/RF/RG number with "-1/2, -2/2" suffixes, exactly
// like adding them one at a time by hand.
export type BulkOrderColumn = {
  label: string;
  example: string;
  required: boolean;
  help?: string;
};

export const BULK_ORDER_COLUMNS: BulkOrderColumn[] = [
  { label: "Store", example: "Main Store", required: true, help: "Must exactly match an existing Store name for your company." },
  { label: "Order Date", example: "2026-08-08", required: true, help: "YYYY-MM-DD" },
  { label: "Item Category", example: "HAND BRAIDED JUTE RUG", required: true, help: "Must exactly match an existing Item Category name." },
  { label: "Qty", example: "1", required: true },
  { label: "Order Value", example: "100", required: true, help: "Numeric value only, no currency symbol." },
  { label: "Currency", example: "USD", required: true },
  { label: "Buyer Name & Address", example: "Jane Doe, 123 Main St, City, ST 12345, USA", required: false },
  { label: "Contact No", example: "9876543210", required: false },
  { label: "Marketplace Order No", example: "", required: false },
  { label: "Manual Ref No", example: "", required: false, help: "Leave blank to auto-assign the next PO/RF/RG number." },
  { label: "SKU", example: "", required: false },
  { label: "Size", example: "5X7 FT", required: false },
  { label: "Colour", example: "", required: false },
  { label: "Photo Type", example: "Dispatch", required: false, help: "Dispatch or Website" },
  { label: "Photo URL", example: "", required: false },
  { label: "Tassel/Fringes", example: "No", required: false, help: "Yes or No" },
  { label: "PO Date", example: "", required: false },
  { label: "Delivery Date", example: "", required: false },
  { label: "Email", example: "", required: false },
  { label: "Tax ID", example: "", required: false },
  { label: "Address Type", example: "Residential", required: false, help: "Residential or Commercial" },
  { label: "Remark", example: "", required: false },
];
