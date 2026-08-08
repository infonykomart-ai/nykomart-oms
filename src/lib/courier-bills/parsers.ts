import type { ParsedBill, ParsedShipment, CourierBillParseResult } from "./types";

// Parses the 5 courier-bill PDF templates seen in practice (2026-08-08
// round — see claude/order-lifecycle-inventory-tracking-adspend-requests-
// 2026-08-08.md), from the layout-reconstructed text produced by
// pdf-layout.ts. Verified against real UPS and FedEx sample bills:
//   - UPS "BILL OF SUPPLY"                  -> duty, non-taxable duty pass-through
//   - UPS "Tax Invoice" (Worldwide Waybills) -> freight, GST-taxable
//   - UPS "Tax Invoice" (DISBURSEMENT FEE)   -> duty, GST-taxable service fee
//   - FedEx "Freight/Tax Invoice"            -> freight, GST-taxable
//   - FedEx "Duty & Tax Invoice"             -> duty, mixed taxable/non-taxable
//
// Mapping to the DB (see freight_bills / duty_tax_bills in db/schema.sql):
//   - freight_bills.freight_amt/fuel_amt/other_charges must sum to the
//     bill's pre-GST taxable subtotal — its gross_total_amt column is a
//     GENERATED *1.18 column, which held true on every sample bill (both
//     couriers bill freight at a flat 18% GST slab under HSN 996812).
//   - duty_tax_bills.duty_tax_amt_inr + gst_18pct_amt are both plain STORED
//     columns (not generated), so these are set from the bill's own actual
//     SGST+CGST+IGST breakdown rather than assumed — duty bills often have
//     a non-taxable duty-passthrough portion mixed with a taxable service
//     fee portion (see FedEx Duty & Tax) that a flat-rate assumption would
//     get wrong.
// Per-shipment fields feed the *_awb_assignments "review" rows (order
// match + weight + amounts) shown to the user before anything is written —
// see courier-bill-pdf-actions.ts. Nothing here writes to the database.

function parseAmt(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const UPS_MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

function upsDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const mm = UPS_MONTHS[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

// FedEx India bills use DD/MM/YYYY (verified: Invoice Date 01/01/2026, Due
// Date 16/01/2026 — 15 days later; shipment dates like 15/12/2025 confirm
// day-first).
function fedexDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function detectTemplate(text: string): ParsedBill["templateId"] | null {
  const isUps = /United Parcel Service|UPS EXPRESS/i.test(text);
  const isFedex = /FedEx Express/i.test(text);

  if (isUps) {
    if (/BILL OF SUPPLY/i.test(text)) return "ups-bill-of-supply";
    if (/DISBURSEMENT FEE/i.test(text)) return "ups-tax-invoice-disbursement";
    if (/Tax Invoice/i.test(text)) return "ups-tax-invoice-freight";
  }
  if (isFedex) {
    if (/Duty\s*&\s*Tax Invoice/i.test(text)) return "fedex-duty";
    if (/Freight\s*\/\s*Tax Invoice/i.test(text)) return "fedex-freight";
  }
  return null;
}

function parseUpsHeader(text: string) {
  const invoiceNo = text.match(/Invoice No\.:\s*(\d+)/)?.[1] ?? "";
  const invoiceDateRaw = text.match(/Invoice Date\s+(\d{1,2}\s+\w+\s+\d{4})/)?.[1] ?? null;
  const totalAmountDue = parseAmt(text.match(/Total Amount Due\s+RS\s*([\d,]+\.\d{2})/)?.[1]);
  return { invoiceNo, invoiceDate: upsDateToIso(invoiceDateRaw), totalAmountDue };
}

// UPS shipment blocks all key off unique "1Z..." tracking numbers (18
// chars) appearing as the row anchor — split the text into one block per
// unique tracking number, from its first occurrence to the next one's.
function parseUpsShipmentBlocks(text: string, mode: "duty-a1" | "duty-a3" | "freight-a2"): ParsedShipment[] {
  const trackingRe = /\b(1Z[A-Z0-9]{16})\b/g;
  const firstIndex = new Map<string, number>();
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = trackingRe.exec(text))) {
    if (!firstIndex.has(m[1])) {
      firstIndex.set(m[1], m.index);
      order.push(m[1]);
    }
  }

  const shipments: ParsedShipment[] = [];
  for (let i = 0; i < order.length; i++) {
    const trackingNo = order[i];
    const start = firstIndex.get(trackingNo)!;
    const end = i + 1 < order.length ? firstIndex.get(order[i + 1])! : text.length;
    const block = text.slice(start, end);

    const auditedWeight = parseAmt(block.match(/Audited Weight:\s*([\d.]+)\s*kgs?/i)?.[1]);
    const ratioMatch = block.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)[A-Z]?\s*[\s\S]{0,60}?PKG/);
    const ratioWeight = ratioMatch ? parseAmt(ratioMatch[2]) : null;
    const weightKg = auditedWeight ?? ratioWeight ?? null;

    const dims = block.match(/Audited Dimensions\s*=\s*([\d.]+\s*X\s*[\d.]+\s*X\s*[\d.]+\s*cm)/i)?.[1] ?? null;
    const consignee = block.match(/Consignee:\s+(.+)/)?.[1]?.trim().replace(/\s{2,}/g, "  ") ?? null;
    const courierRefNo = block.match(/\b([A-Z]{1,4}-\d+-\d{2}-\d{2})\//)?.[1] ?? null;

    let dutyAmt: number | null = null;
    let otherAmt: number | null = null;
    if (mode === "duty-a1") {
      dutyAmt = parseAmt(block.match(/Duty Amount\s+([\d,]+\.\d{2})/)?.[1]);
    } else if (mode === "duty-a3") {
      otherAmt = parseAmt(block.match(/DISBURSEMENT FEE\s+([\d,]+\.\d{2})/)?.[1]);
    }

    const totalChargesAmt = parseAmt(block.match(/Total Charges(?: for Shipment)?\s+\S+\s+RS\s+([\d,]+\.\d{2})/)?.[1]);
    const amount = totalChargesAmt ?? dutyAmt ?? otherAmt ?? null;

    shipments.push({ trackingNo, courierRefNo, shipDate: null, weightKg, dims, consignee, amount, dutyAmt, otherAmt });
  }
  return shipments;
}

function parseUpsBillOfSupply(text: string): ParsedBill {
  const header = parseUpsHeader(text);
  const dutyTaxAmtInr = parseAmt(text.match(/Total Non[\s-]*Taxable Charges\s+([\d,]+\.\d{2})/i)?.[1]) ?? header.totalAmountDue;
  return {
    templateId: "ups-bill-of-supply",
    courier: "UPS",
    billCategory: "duty",
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    totalAmountDue: header.totalAmountDue,
    freightAmt: null,
    fuelAmt: null,
    otherCharges: null,
    dutyTaxAmtInr,
    gstAmt: 0,
    shipments: parseUpsShipmentBlocks(text, "duty-a1"),
  };
}

function parseUpsGst(text: string) {
  const sgst = parseAmt(text.match(/SGST\s+\d+%\s+([\d,]+\.\d{2})/)?.[1]) ?? 0;
  const cgst = parseAmt(text.match(/CGST\s+\d+%\s+([\d,]+\.\d{2})/)?.[1]) ?? 0;
  const igst = parseAmt(text.match(/IGST\s+\d+%\s+([\d,]+\.\d{2})/)?.[1]) ?? 0;
  return sgst + cgst + igst;
}

function parseUpsTaxInvoiceFreight(text: string): ParsedBill {
  const header = parseUpsHeader(text);
  const taxableSubtotal = parseAmt(text.match(/Total Taxable Charges\s+([\d,]+\.\d{2})/)?.[1]);
  return {
    templateId: "ups-tax-invoice-freight",
    courier: "UPS",
    billCategory: "freight",
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    totalAmountDue: header.totalAmountDue,
    freightAmt: taxableSubtotal,
    fuelAmt: 0,
    otherCharges: 0,
    dutyTaxAmtInr: null,
    gstAmt: parseUpsGst(text),
    shipments: parseUpsShipmentBlocks(text, "freight-a2"),
  };
}

function parseUpsTaxInvoiceDisbursement(text: string): ParsedBill {
  const header = parseUpsHeader(text);
  const taxableSubtotal = parseAmt(text.match(/Total Taxable Charges\s+([\d,]+\.\d{2})/)?.[1]);
  return {
    templateId: "ups-tax-invoice-disbursement",
    courier: "UPS",
    billCategory: "duty",
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    totalAmountDue: header.totalAmountDue,
    freightAmt: null,
    fuelAmt: null,
    otherCharges: null,
    dutyTaxAmtInr: taxableSubtotal,
    gstAmt: parseUpsGst(text),
    shipments: parseUpsShipmentBlocks(text, "duty-a3"),
  };
}

function parseFedexHeader(text: string) {
  const invoiceNo = text.match(/Invoice Number:\s*(\d+)/)?.[1] ?? "";
  const invoiceDateRaw = text.match(/Invoice Date:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? null;
  let totalAmountDue = parseAmt(text.match(/Total Amount Due\s+INR\s+([\d,]+\.\d{2})/i)?.[1]);
  if (totalAmountDue == null) totalAmountDue = parseAmt(text.match(/Amount Due\s+([\d,]+\.\d{2})\s+INR/i)?.[1]);
  return { invoiceNo, invoiceDate: fedexDateToIso(invoiceDateRaw), totalAmountDue };
}

function parseFedexFreight(text: string): ParsedBill {
  const header = parseFedexHeader(text);
  const billRow = text.match(/Shipper\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  const freightAmt = parseAmt(billRow?.[2] ?? null);
  const otherCharges = parseAmt(billRow?.[3] ?? null);

  const shipments: ParsedShipment[] = [];
  const re = /^\s*(\d{10,14})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d+)\s+([\d.]+)\s*kg\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const trackingNo = m[1];
    const shipDate = fedexDateToIso(m[2]);
    const other = parseAmt(m[7]);
    const total = parseAmt(m[8]);
    const tail = text.slice(m.index, m.index + 400);
    const dims = tail.match(/Dims:\s*([\d.]+x[\d.]+x[\d.]+)\s*Cm/i)?.[1] ?? null;
    const billedWeight = parseAmt(tail.match(/Billed Weight:\s*([\d.]+)\s*kg/i)?.[1]) ?? parseAmt(m[5]);
    shipments.push({
      trackingNo,
      courierRefNo: null,
      shipDate,
      weightKg: billedWeight,
      dims,
      consignee: null,
      amount: total,
      dutyAmt: null,
      otherAmt: other,
    });
  }

  return {
    templateId: "fedex-freight",
    courier: "FedEx",
    billCategory: "freight",
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    totalAmountDue: header.totalAmountDue,
    freightAmt,
    fuelAmt: 0,
    otherCharges,
    dutyTaxAmtInr: null,
    gstAmt: null,
    shipments,
  };
}

function parseFedexDuty(text: string): ParsedBill {
  const header = parseFedexHeader(text);
  const taxableLine = text.match(/HSN\s+996719\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  const taxableBase = parseAmt(taxableLine?.[1] ?? null);
  const gstAmt = taxableLine
    ? (parseAmt(taxableLine[2]) ?? 0) + (parseAmt(taxableLine[3]) ?? 0) + (parseAmt(taxableLine[4]) ?? 0)
    : null;
  const nonTaxable = parseAmt(text.match(/Non Taxable Charges\s+([\d,]+\.\d{2})/)?.[1]);
  const dutyTaxAmtInr = taxableBase != null || nonTaxable != null ? (taxableBase ?? 0) + (nonTaxable ?? 0) : null;

  const shipments: ParsedShipment[] = [];
  const re = /^\s*(\d{10,14})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const trackingNo = m[1];
    const shipDate = fedexDateToIso(m[2]);
    const importDuty = parseAmt(m[4]) ?? 0;
    const importTax = parseAmt(m[5]) ?? 0;
    const otherTaxable = parseAmt(m[6]) ?? 0;
    const otherNonTaxable = parseAmt(m[7]) ?? 0;
    const total = parseAmt(m[8]);
    const tail = text.slice(m.index, m.index + 300);
    const billedWeight = parseAmt(tail.match(/Billed Weight:\s*([\d.]+)\s*kg/i)?.[1]);
    const dims = tail.match(/Dims:\s*([\d.]+x[\d.]+x[\d.]+)\s*Cm/i)?.[1] ?? null;
    shipments.push({
      trackingNo,
      courierRefNo: null,
      shipDate,
      weightKg: billedWeight,
      dims,
      consignee: null,
      amount: total,
      dutyAmt: importDuty + importTax,
      otherAmt: otherTaxable + otherNonTaxable,
    });
  }

  return {
    templateId: "fedex-duty",
    courier: "FedEx",
    billCategory: "duty",
    invoiceNo: header.invoiceNo,
    invoiceDate: header.invoiceDate,
    totalAmountDue: header.totalAmountDue,
    freightAmt: null,
    fuelAmt: null,
    otherCharges: null,
    dutyTaxAmtInr,
    gstAmt,
    shipments,
  };
}

export function parseCourierBill(text: string): CourierBillParseResult {
  const templateId = detectTemplate(text);
  if (!templateId) {
    return {
      error:
        "Could not recognize this bill's format. Supported: UPS Bill of Supply, UPS Tax Invoice (Freight), UPS Tax Invoice (Disbursement Fee), FedEx Freight/Tax Invoice, FedEx Duty & Tax Invoice. You can still enter it manually via the Courier Bill / Duty & Tax Bill tab.",
    };
  }

  let bill: ParsedBill;
  switch (templateId) {
    case "ups-bill-of-supply":
      bill = parseUpsBillOfSupply(text);
      break;
    case "ups-tax-invoice-freight":
      bill = parseUpsTaxInvoiceFreight(text);
      break;
    case "ups-tax-invoice-disbursement":
      bill = parseUpsTaxInvoiceDisbursement(text);
      break;
    case "fedex-freight":
      bill = parseFedexFreight(text);
      break;
    case "fedex-duty":
      bill = parseFedexDuty(text);
      break;
  }

  if (!bill.invoiceNo) {
    return { error: "Recognized the bill format but could not find an Invoice Number — please enter it manually via the Courier Bill / Duty & Tax Bill tab." };
  }
  if (bill.shipments.length === 0) {
    return { error: "Recognized the bill format but could not find any shipment/tracking rows — please enter it manually via the Courier Bill / Duty & Tax Bill tab." };
  }
  return { bill };
}
