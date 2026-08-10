// Stock bulk CSV upload (2026-08-10) — column labels match exactly what
// cellStr()/cellNum() calls in ../actions.ts expect. Two separate column
// sets since Stock In and Stock Out are different ledgers (old sheets:
// "Stock In" / "Stock Out").
export type StockColumn = { label: string; example: string; required: boolean; help?: string };

export const STOCK_IN_COLUMNS: StockColumn[] = [
  { label: "Source (Party Name)", example: "JK", required: true, help: "Must already exist in Party Master — add it there first." },
  { label: "SKU Code", example: "JK-1001", required: true },
  { label: "Product Name", example: "", required: false },
  { label: "Chalan No", example: "CH-0001", required: false, help: "Not required for bulk backfill of historical stock; required on the live single-entry form." },
  { label: "In Date", example: "2026-08-10", required: false },
  { label: "Quantity In", example: "100", required: true },
  { label: "Rate Per Qty", example: "45.50", required: false },
  { label: "Party Chalan No", example: "", required: false },
  { label: "Our Chalan No", example: "", required: false },
  { label: "Bill No", example: "", required: false },
  { label: "Bill Date", example: "", required: false },
  { label: "Paid Date", example: "", required: false },
  { label: "Remark", example: "", required: false },
];

export const STOCK_OUT_COLUMNS: StockColumn[] = [
  { label: "Source (Party Name)", example: "JK", required: true, help: "Must already exist in Party Master — add it there first." },
  { label: "SKU Code", example: "JK-1001", required: true },
  { label: "Product Name", example: "", required: false },
  { label: "Chalan No", example: "CH-0001", required: false, help: "Not required for bulk backfill of historical stock; required on the live single-entry form." },
  { label: "Out Date", example: "2026-08-10", required: false },
  { label: "Quantity Out", example: "10", required: true },
  { label: "Remark", example: "", required: false },
];
