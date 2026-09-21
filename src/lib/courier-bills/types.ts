// Normalized shape every per-template parser produces, regardless of
// courier/template quirks — see parsers.ts's header comment for the 5
// templates this covers and how each maps into freight_bills/duty_tax_bills
// + their *_awb_assignments tables (db/schema.sql section 7/8).

export type ParsedShipment = {
  trackingNo: string;
  courierRefNo: string | null; // the courier's own "Reference No. 1" field — NOT the same format as orders.ref_no, kept for display/manual cross-check only
  shipDate: string | null; // ISO yyyy-mm-dd
  weightKg: number | null; // billed weight where the bill distinguishes actual vs. billed
  dims: string | null;
  consignee: string | null;
  amount: number | null; // freight bills: this shipment's "Total" column; duty bills: unused (see dutyAmt/otherAmt)
  dutyAmt: number | null; // duty bills only — Import Duty (+ Import Tax where broken out)
  otherAmt: number | null; // duty bills only — the courier's own service/disbursement fee portion
  // 2026-09-21: per-AWB charge BREAKUP where the bill prints it ("total
  // shipping amt = per awb charges jisme fuel+remote+other hote hai phir
  // GST alag aata hai phir gross shipping ammount"). base = line-haul,
  // fuel = fuel surcharge, remote = remote/delivery-area surcharge —
  // components of `amount` above, null when this template doesn't break
  // them out per AWB. gst = GST charged on this AWB (prorated from the
  // bill's header GST by pre-tax charge share when the bill doesn't
  // invoice GST per line).
  baseAmt: number | null;
  fuelAmt: number | null;
  remoteAmt: number | null;
  gstAmt: number | null;
};

export type ParsedBill = {
  templateId: "ups-bill-of-supply" | "ups-tax-invoice-freight" | "ups-tax-invoice-disbursement" | "fedex-freight" | "fedex-duty";
  courier: "UPS" | "FedEx";
  billCategory: "freight" | "duty";
  invoiceNo: string;
  invoiceDate: string | null; // ISO yyyy-mm-dd
  totalAmountDue: number | null; // as stated on the bill — used only as a sanity-check display, never written verbatim to a single column
  // freight bills (-> freight_bills.freight_amt/fuel_amt/other_charges; gross_total_amt is a DB-generated *1.18 column)
  freightAmt: number | null;
  fuelAmt: number | null;
  otherCharges: number | null;
  // duty bills (-> duty_tax_bills.duty_tax_amt_inr/gst_18pct_amt; gross_total_amt = their sum, both stored not generated)
  dutyTaxAmtInr: number | null;
  gstAmt: number | null;
  shipments: ParsedShipment[];
};

export type CourierBillParseResult = { error: string; bill?: undefined } | { error?: undefined; bill: ParsedBill };
