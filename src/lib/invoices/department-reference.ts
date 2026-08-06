// Department Reference No. — FedEx-only, per claude/invoice-origin-
// declarations-and-numbering.md section 2 (DECODED, fully confirmed
// against all 3 real sample invoices):
//
//   <SCHEME>/N/<SHIPMENT_TERM>/B/E/-/<DDMMYY>
//
// SCHEME = CS5 for CSB-V, CS4 for CSB-IV. N, B, E are fixed literal
// constants (confirmed identical across every real sample regardless of
// company/scheme/term/date). SHIPMENT_TERM mirrors whatever was picked on
// the invoice (samples show both DDP and FOB, not limited to those two).
// Date is the invoice's own date, DDMMYY zero-padded.
export function computeDepartmentReferenceNo(
  csbType: "CSB-V" | "CSB-IV",
  shipmentTerm: string,
  invoiceDate: string // "YYYY-MM-DD"
): string {
  const scheme = csbType === "CSB-V" ? "CS5" : "CS4";
  const [y, m, d] = invoiceDate.split("-");
  const ddmmyy = `${d}${m}${y.slice(2)}`;
  return `${scheme}/N/${shipmentTerm}/B/E/-/${ddmmyy}`;
}

export function isFedEx(courierCompany: string): boolean {
  return courierCompany.trim().toLowerCase().includes("fedex");
}
