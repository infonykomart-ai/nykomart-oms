// 2026-10-02d — pure domain logic for the B2B Export ERP. No server or
// framework imports, so the SAME functions run in server pages (KPI
// aggregation, order P&L) and client components (the costing engine's live
// preview, the packing calculator) — one source of truth for every formula
// the spec's "AUTO CALCULATION MASTER LIST" demands.
//
// Rule carried over from the spec: freight / incoterm costs are always
// ENTERED (or come from a connected rate source) — nothing here guesses a
// rate. All money math rounds to 2 decimals at the boundary (matches the
// DB's numeric(14,2) columns and the GENERATED line_total columns).

// ── Products ────────────────────────────────────────────────────────────────

export const PRODUCT_TYPES = ["Cotton Dhurrie", "Carpet", "Jute Rug", "Cotton Kurti", "Table Cover"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** SKU prefix per product type — CD-1001 / CR-1001 / JR-1001 / CK-1001 / TC-1001. */
export const SKU_PREFIX: Record<ProductType, string> = {
  "Cotton Dhurrie": "CD",
  Carpet: "CR",
  "Jute Rug": "JR",
  "Cotton Kurti": "CK",
  "Table Cover": "TC",
};

/** Numbering: 1000 + counter so the first SKU of a prefix is <PREFIX>-1001 (the spec's example). */
export function formatSku(prefix: string, counter: number): string {
  return `${prefix}-${1000 + counter}`;
}

export type SpecField = {
  key: string;
  label: string;
  unit?: string;
  options?: string[];
  type?: "text" | "number";
};

// Type-specific spec fields (stored in b2b_products.specs jsonb). The trade
// fields shared by all 5 types (material, design, color, size, GSM, weight,
// MOQ, prices, packing…) are REAL columns on b2b_products — these are only
// the rest.
export const PRODUCT_SPECS: Record<ProductType, SpecField[]> = {
  "Cotton Dhurrie": [
    { key: "weaving_type", label: "Weaving type", options: ["Handloom", "Power Loom", "Dobby", "Jacquard"] },
    { key: "pattern", label: "Pattern", options: ["Stripes", "Checks", "Solid", "Geometric", "Floral"] },
    { key: "fringe", label: "Fringe", options: ["Yes", "No"] },
    { key: "backing", label: "Backing", options: ["Cotton", "Anti-slip", "None"] },
  ],
  Carpet: [
    { key: "construction", label: "Construction", options: ["Tufted", "Woven", "Hand-Knotted", "Flat Weave"] },
    { key: "pile_height_mm", label: "Pile height", unit: "mm", type: "number" },
    { key: "shape", label: "Shape", options: ["Rectangular", "Round", "Oval"] },
    { key: "backing", label: "Backing", options: ["Jute", "Cotton", "Latex", "None"] },
  ],
  "Jute Rug": [
    { key: "jute_type", label: "Jute type", options: ["Raw", "Bleached", "Blended", "Dyed"] },
    { key: "weave", label: "Weave", options: ["Plain", "Twill", "Herringbone", "Basket"] },
    { key: "shape", label: "Shape", options: ["Rectangular", "Round", "Oval"] },
    { key: "thickness_mm", label: "Thickness", unit: "mm", type: "number" },
    { key: "border", label: "Border", options: ["Self", "Contrast", "Fringed", "None"] },
  ],
  "Cotton Kurti": [
    { key: "fabric", label: "Fabric", options: ["Cotton", "Mulmul", "Linen", "Cotton Blend", "Chanderi"] },
    { key: "print", label: "Print", options: ["Block", "Screen", "Digital", "Plain", "Embroidered"] },
    { key: "sleeve", label: "Sleeve", options: ["Full", "Half", "Three-Quarter", "Cap", "Sleeveless"] },
    { key: "neck", label: "Neck", options: ["Round", "V", "Collar", "Boat", "Other"] },
  ],
  "Table Cover": [
    { key: "fabric", label: "Fabric", options: ["Cotton", "Polyester", "Cotton Blend", "Linen"] },
    { key: "shape", label: "Shape", options: ["Rectangular", "Round", "Oval", "Square"] },
    { key: "print", label: "Print / Embroidery", options: ["Printed", "Embroidered", "Plain", "Both"] },
    { key: "border", label: "Border", options: ["Self", "Contrast", "Lace", "None"] },
  ],
};

// ── Costing engine (spec §5 / §6) ───────────────────────────────────────────

export type CostingLine = { qty: number; unitCost: number; unitPrice: number };

export type CostingResult = {
  productCost: number; // Σ qty × unit cost
  sellingValue: number; // Σ qty × unit price
  packingCost: number; // entered
  freightCost: number; // entered — never guessed
  otherCosts: number; // documentation + handling + bank + misc — entered
  discount: number; // entered
  totalCost: number; // product + packing + freight + other
  netSelling: number; // selling − discount
  grossProfit: number; // netSelling − totalCost
  marginPct: number; // grossProfit ÷ netSelling × 100 (0 when netSelling = 0)
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeCosting(input: {
  lines: CostingLine[];
  packingCost?: number;
  freight?: number;
  otherCosts?: number;
  discount?: number;
}): CostingResult {
  const productCost = round2(input.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitCost || 0), 0));
  const sellingValue = round2(input.lines.reduce((s, l) => s + (l.qty || 0) * (l.unitPrice || 0), 0));
  const packingCost = round2(input.packingCost ?? 0);
  const freightCost = round2(input.freight ?? 0);
  const otherCosts = round2(input.otherCosts ?? 0);
  const discount = round2(input.discount ?? 0);
  const totalCost = round2(productCost + packingCost + freightCost + otherCosts);
  const netSelling = round2(Math.max(0, sellingValue - discount));
  const grossProfit = round2(netSelling - totalCost);
  const marginPct = netSelling > 0 ? round2((grossProfit / netSelling) * 100) : 0;
  return { productCost, sellingValue, packingCost, freightCost, otherCosts, discount, totalCost, netSelling, grossProfit, marginPct };
}

/** Spec §4 — enquiry estimate: what would this deal COST and earn? */
export type EnquiryEstimateInput = {
  qty: number;
  unitCost: number; // product cost per pc (from the master)
  packingPerPc?: number;
  freight?: number;
  documentationCost?: number;
  bankChargePct?: number; // % of selling value
  targetMarginPct?: number; // desired margin for the suggested price
};

export type EnquiryEstimate = CostingResult & {
  suggestedUnitPrice: number;
  expectedProfit: number;
  expectedMarginPct: number;
};

export function estimateEnquiry(input: EnquiryEstimateInput): EnquiryEstimate {
  const targetMargin = input.targetMarginPct ?? 20;
  const base = computeCosting({
    lines: [{ qty: input.qty, unitCost: input.unitCost, unitPrice: 0 }],
    packingCost: (input.packingPerPc ?? 0) * input.qty,
    freight: input.freight ?? 0,
    otherCosts: input.documentationCost ?? 0,
  });
  // Suggested price: cover total cost + bank charges + target margin.
  // bankCharges = pct of the selling value, so solve for it in the price.
  const bankPct = (input.bankChargePct ?? 0) / 100;
  const margin = targetMargin / 100;
  const denom = input.qty > 0 ? input.qty * (1 - bankPct - margin) : 0;
  const suggestedUnitPrice = denom > 0 ? round2(base.totalCost / denom) : 0;
  const suggestedSelling = round2(suggestedUnitPrice * input.qty);
  const bankCharges = round2(suggestedSelling * bankPct);
  const expectedProfit = round2(suggestedSelling - bankCharges - base.totalCost);
  const expectedMarginPct = suggestedSelling > 0 ? round2((expectedProfit / suggestedSelling) * 100) : 0;
  return {
    ...base,
    sellingValue: suggestedSelling,
    suggestedUnitPrice,
    expectedProfit,
    expectedMarginPct,
  };
}

// ── BOM engine (spec §7 / §10) ──────────────────────────────────────────────

export type BomLine = { material: string; consumption: number; unit: string; wastagePercent: number };

export type BomRequirement = {
  material: string;
  unit: string;
  baseRequired: number; // qty × consumption
  wastage: number; // extra units from wastage %
  required: number; // base + wastage (the "Actual Requirement")
};

export function computeBomRequirement(lines: BomLine[], orderQty: number): BomRequirement[] {
  return lines.map((l) => {
    const base = orderQty * l.consumption;
    const withWastage = base * (1 + (l.wastagePercent || 0) / 100);
    return {
      material: l.material,
      unit: l.unit,
      baseRequired: round2(base),
      wastage: round2(withWastage - base),
      required: round2(withWastage),
    };
  });
}

// ── Packing calculator (spec §15 / §20) ─────────────────────────────────────

export type PackingInput = {
  qty: number;
  pcsPerCarton: number;
  cartonLengthCm?: number;
  cartonWidthCm?: number;
  cartonHeightCm?: number;
  netWeightEachKg?: number;
  cartonTareKg?: number;
};

export type PackingResult = {
  cartons: number;
  cbm: number; // L × W × H (m) × cartons — 0 unless all 3 dims known
  netWeightKg: number;
  grossWeightKg: number;
};

export function computePacking(input: PackingInput): PackingResult {
  const qty = Math.max(0, input.qty || 0);
  const per = Math.max(0, input.pcsPerCarton || 0);
  const cartons = per > 0 ? Math.ceil(qty / per) : 0;
  const { cartonLengthCm: l, cartonWidthCm: w, cartonHeightCm: h } = input;
  const cbm = l && w && h ? Math.round((l / 100) * (w / 100) * (h / 100) * cartons * 10000) / 10000 : 0;
  const netWeightKg = round2(qty * (input.netWeightEachKg ?? 0));
  const grossWeightKg = round2(netWeightKg + cartons * (input.cartonTareKg ?? 0));
  return { cartons, cbm, netWeightKg, grossWeightKg };
}

// ── Order profitability (spec §18 / §19 / §26 + the "why is profit low?" ────
//    drill-down the spec asks for: every cost bucket as a % of sales)

export type OrderCostBuckets = {
  salesValue: number;
  productCost: number;
  labourCost: number;
  packingCost: number;
  freightCost: number;
  documentationCost: number;
  bankCharges: number;
  otherCosts: number;
};

export type PnlBreakdownRow = { label: string; value: number; pctOfSales: number };

export type OrderPnl = {
  totalCost: number;
  grossProfit: number;
  marginPct: number;
  breakdown: PnlBreakdownRow[]; // cost buckets + profit, pct of sales — the drill-down rows
};

export function computeOrderPnl(b: OrderCostBuckets): OrderPnl {
  const rows: { label: string; value: number }[] = [
    { label: "Product cost", value: b.productCost },
    { label: "Labour", value: b.labourCost },
    { label: "Packing", value: b.packingCost },
    { label: "Freight", value: b.freightCost },
    { label: "Documentation", value: b.documentationCost },
    { label: "Bank charges", value: b.bankCharges },
    { label: "Other expenses", value: b.otherCosts },
  ];
  const totalCost = round2(rows.reduce((s, r) => s + r.value, 0));
  const grossProfit = round2(b.salesValue - totalCost);
  const marginPct = b.salesValue > 0 ? round2((grossProfit / b.salesValue) * 100) : 0;
  const pct = (v: number) => (b.salesValue > 0 ? round2((v / b.salesValue) * 100) : 0);
  const breakdown: PnlBreakdownRow[] = [
    ...rows.map((r) => ({ label: r.label, value: round2(r.value), pctOfSales: pct(r.value) })),
    { label: "Gross profit", value: grossProfit, pctOfSales: marginPct },
  ];
  return { totalCost, grossProfit, marginPct, breakdown };
}

// ── Payment schedule engine (spec §13 / §20) ────────────────────────────────

export type ScheduleRow = { label: string; dueDate: string; amount: number };

/**
 * Builds the automatic payment schedule from free-typed terms.
 * Recognised shapes (case-insensitive):
 *   "50/50", "30/70", "100/0"  → instalments by % — first due on the order
 *                                date, last on the delivery date, middles split
 *   "100% advance" / "advance" → full amount on the order date
 *   "Net 30" / "Net 60" / "Net 90" → full amount N days after the order date
 * Anything else falls back to a single instalment due on the delivery date
 * (or the order date when no delivery date exists). Never guesses splits.
 */
export function buildPaymentSchedule(
  terms: string,
  total: number,
  orderDate: string,
  deliveryDate: string | null
): ScheduleRow[] {
  const amt = round2(total);
  if (amt <= 0) return [];
  const t = (terms || "").trim().toLowerCase();
  const lastDue = deliveryDate || orderDate;

  const slash = t.match(/^(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/);
  if (slash) {
    const pcts = [Number(slash[1]), Number(slash[2]), slash[3] ? Number(slash[3]) : null].filter((p): p is number => p !== null);
    if (pcts.reduce((s, p) => s + p, 0) > 0 && pcts.every((p) => p >= 0 && p <= 100)) {
      const sum = pcts.reduce((s, p) => s + p, 0);
      let allocated = 0;
      return pcts.map((p, i) => {
        const isLast = i === pcts.length - 1;
        const amount = isLast ? round2(amt - allocated) : round2((amt * p) / sum);
        allocated = round2(allocated + amount);
        const dueDate = i === 0 ? orderDate : isLast ? lastDue : orderDate;
        return { label: pcts.length === 2 ? (i === 0 ? "Advance" : "Balance") : `Instalment ${i + 1}`, dueDate, amount };
      }).filter((r) => r.amount > 0);
    }
  }

  const net = t.match(/^net\s*(\d{1,3})$/);
  if (net) {
    const days = Number(net[1]);
    const due = addDays(orderDate, days);
    return [{ label: `Net ${days}`, dueDate: due, amount: amt }];
  }

  if (/advance/.test(t)) {
    return [{ label: "Advance", dueDate: orderDate, amount: amt }];
  }

  return [{ label: "Balance", dueDate: lastDue, amount: amt }];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── QC math (spec §19) ──────────────────────────────────────────────────────

export type QcInput = { inspected: number; passed: number; rejected: number; rework: number };

export type QcResult = { passPct: number; rejectPct: number; reworkPct: number; defectPct: number };

export function computeQc(q: QcInput): QcResult {
  const base = q.inspected > 0 ? q.inspected : 0;
  const pct = (n: number) => (base > 0 ? round2((n / base) * 100) : 0);
  return {
    passPct: pct(q.passed),
    rejectPct: pct(q.rejected),
    reworkPct: pct(q.rework),
    defectPct: pct(q.rejected), // Defect % = Rejected ÷ Inspected × 100 (the spec's formula)
  };
}

// ── Production completion (spec §8 / §17) ───────────────────────────────────

export function productionPct(planned: number, produced: number): number {
  if (planned <= 0) return 0;
  return Math.min(100, round2((produced / planned) * 100));
}

// ── Status vocabularies (shared by pages + actions; NOT exported from any
//    "use server" file — server actions re-declare their own guards) ────────

export const ORDER_STATUSES = [
  "Confirmed",
  "In Production",
  "QC",
  "Packing",
  "Ready to Dispatch",
  "Booked",
  "In Transit",
  "Delivered",
  "Closed",
  "Cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PRODUCTION_STATUSES = ["Planned", "In Progress", "Completed", "Delayed"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const SHIPMENT_STATUSES = ["Booking", "Ready", "Stuffed", "Departed", "In Transit", "Arrived", "Delivered"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const DEFAULT_STAGES = [
  "Material Issue",
  "Cutting",
  "Weaving",
  "Stitching",
  "Finishing",
  "Washing",
  "Ironing",
  "Labeling",
  "Packing",
  "QC",
] as const;

export const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "FCA", "DAP", "DDP"] as const;

export const QUOTE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD"] as const;

export const BUYER_TYPES = ["Retailer", "Wholesaler", "Importer", "Distributor"] as const;

export const PAYMENT_MODES = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card", "Advance", "LC"] as const;

// ── Formatting helpers (client-safe) ────────────────────────────────────────

export function fmtMoney(n: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toFixed(2)}`;
  }
}

export function fmtPct(n: number): string {
  return `${(n || 0).toFixed(2)}%`;
}

/** Status chip colour classes — one place so every page agrees. */
export function statusTone(status: string): string {
  switch (status) {
    case "Delivered":
    case "Completed":
    case "Closed":
      return "bg-emerald-100 text-emerald-700";
    case "Ready to Dispatch":
    case "Ready":
    case "Arrived":
      return "bg-sky-100 text-sky-700";
    case "In Transit":
    case "Booked":
    case "Departed":
    case "Stuffed":
      return "bg-indigo-100 text-indigo-700";
    case "In Production":
    case "In Progress":
    case "Packing":
    case "QC":
      return "bg-amber-100 text-amber-700";
    case "Delayed":
    case "Cancelled":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
