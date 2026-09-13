export type VendorAssignColumn = {
  label: string;
  example: string;
  required: boolean;
  help?: string;
};

// Columns for Bulk Vendor Assignment (2026-09-13 — "Vendor Assignment
// (assign to party) me ek sath agar 100-200 po par ek sath party assign
// karna ho to kese karenge. abhi to ek ek po rf rg ke against me hota hai
// isko modify karo"). Same shape as bulk-tracking-update's columns so the
// shared DownloadTemplateButton works unchanged.
export const VENDOR_ASSIGN_COLUMNS: VendorAssignColumn[] = [
  { label: "Ref No", example: "PO-0001", required: true, help: "The exact PO/RF/RG number (with any -1/2 suffix if applicable)." },
  { label: "Party Name", example: "Shree Textiles", required: false, help: "Exact party name as saved in Party Master. Leave blank to just record the assigned date/remark (rare)." },
  { label: "Assigned Date", example: "2026-09-13", required: true, help: "YYYY-MM-DD." },
  { label: "Remark", example: "", required: false, help: "Optional — stored on the assignment cycle." },
];
