// Party Master bulk CSV upload (2026-08-10) — column labels match exactly
// what cellStr(raw, byHeader, "...") calls in ../actions.ts expect.
export type PartyColumn = { label: string; example: string; required: boolean; help?: string };

export const PARTY_COLUMNS: PartyColumn[] = [
  { label: "Party Name", example: "ABC Textiles", required: true, help: "Uploading an existing name updates that party instead of creating a duplicate." },
  { label: "Party Type", example: "Courier / International Shipping", required: false },
  { label: "Payment Type", example: "AGAINST BILL", required: false, help: "ADVANCE, AGAINST BILL, CASH, NO BILL, or SALARY." },
  { label: "Invoice Type", example: "Purchase", required: false, help: "DUTY TAX, Purchase, FREIGHT INVOICE, Printing, Washing, Disbursement FEE, Service, or JOB WORK." },
  { label: "Address", example: "", required: false },
  { label: "Contact No", example: "", required: false },
  { label: "Email", example: "", required: false },
  { label: "GST", example: "", required: false },
  { label: "Remark", example: "", required: false },
];
