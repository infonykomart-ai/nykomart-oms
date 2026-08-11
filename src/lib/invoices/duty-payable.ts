// Duty & Taxes Payable By — auto-derived from the shipment's Incoterm.
// 2026-08-11: "agar ddp karenge to to check box automaticly mark ho jayega
// exporter vala, agar ddu karenge to consignee vala checkbox mark ho
// jayega" — DDP (Delivered Duty Paid) means the exporter/seller pays duty
// & taxes; DDU/DAP (Delivered Duty Unpaid / Delivered At Place) means the
// consignee/buyer pays. This is only ever a sensible DEFAULT computed once
// at invoice-generation time from shipment_term (see actions.ts) — it
// stays freely editable afterward, same as every other invoice field, and
// is never auto-resynced if shipment_term is edited later.
export type DutyPayableBy = "Exporter" | "Consignee" | "Other";

export function dutyPayableByForShipmentTerm(shipmentTerm: string): DutyPayableBy | null {
  const t = (shipmentTerm || "").toUpperCase();
  if (t.includes("DDP")) return "Exporter";
  if (t.includes("DDU") || t.includes("DAP")) return "Consignee";
  return null; // unrecognized/other term — left blank, preparer picks manually
}
