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

// 2026-10-17b — optional unit/size: when the line is priced by area (per
// sq ft / per sq mtr + a size spec) the SELLING value is area × rate, not
// qty × rate, so computeCosting routes every line through lineAmount().
// unitCost stays per-PIECE (product master cost), unchanged.
export type CostingLine = { qty: number; unitCost: number; unitPrice: number; unit?: string | null; size?: string | null };

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
  const sellingValue = round2(
    input.lines.reduce((s, l) => s + lineAmount({ qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, size: l.size }), 0)
  );
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

// ── Export-document money (2026-10-13) ──────────────────────────────────────
// The CA-style review of a real PI: "Total amount ka format galat hai —
// $28,00,000.00 likha hai. International format: USD 2,800,000.00". Export
// documents never use Indian lakh/crore grouping and never a bare symbol —
// ISO code + international (en-US) grouping, and every total also printed
// in words. Shared by the print page and the client preview so both agree.

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "United States Dollars",
  INR: "Indian Rupees",
  EUR: "Euros",
  GBP: "Pounds Sterling",
  AED: "UAE Dirhams",
  CAD: "Canadian Dollars",
  AUD: "Australian Dollars",
};

/** International document format: `USD 2,800,000.00` (en-US grouping, ISO code prefix — never ₹28,00,000). */
export function fmtDocMoney(n: number, currency = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  try {
    const body = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n || 0);
    return `${code} ${body}`;
  } catch {
    return `${code} ${(n || 0).toFixed(2)}`;
  }
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}

/**
 * International-scale amount in words (Thousand / Million / Billion — export
 * documents use international grouping, not lakh/crore):
 *   2800000 USD → "Two Million Eight Hundred Thousand United States Dollars Only."
 * Paisa/cents print as "and Fifty Cents" when non-zero.
 */
export function amountInWords(amount: number, currency = "USD"): string {
  const code = (currency || "USD").toUpperCase();
  const name = CURRENCY_NAMES[code] ?? code;
  const abs = Math.abs(amount || 0);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);

  if (whole === 0 && cents === 0) return `Zero ${name} Only.`;

  const scales: { value: number; label: string }[] = [
    { value: 1_000_000_000, label: "Billion" },
    { value: 1_000_000, label: "Million" },
    { value: 1_000, label: "Thousand" },
  ];
  let rest = whole;
  const parts: string[] = [];
  for (const s of scales) {
    const count = Math.floor(rest / s.value);
    if (count > 0) {
      parts.push(`${underThousand(count)} ${s.label}`);
      rest -= count * s.value;
    }
  }
  if (rest > 0) parts.push(underThousand(rest));

  const negative = amount < 0 ? "Minus " : "";
  const words = parts.length > 0 ? parts.join(" ") : "Zero";
  const frac = cents > 0 ? ` and ${underThousand(cents)} Cents` : "";
  return `${negative}${words}${frac} ${name} Only.`;
}

// ── Flexible units + size-quantity formulas (2026-10-13 round 2) ────────────
// "INQUARY KESE BHI AASKATI AHI — PCS, SQ FT, SQ MTR, QTY" + "SIZE QUINTIY
// PCS SQ FT CBS FORMULA, SABHI KI CALCULATION SAHI JAGAH MATCH HONI
// CHAHIYE": items can be measured in pieces OR area/volume units, and a
// Size spec (L × W, e.g. "2 × 6 feet") × qty computes sq ft / sq mtr / CBM
// live so every place that prints them (quote form, PI/CI, packing data)
// agrees — all pure, all client-safe, all stub-testable.

/**
 * Common export line-item units — the select options on every item editor
 * (inquiry create/edit + quote form — see UnitSelect in b2b-client.tsx).
 *
 * 2026-10-16 — "QUOTATION VALE SECTION ME INQUIRY AGAR AAYEGI TO KESE
 * HANDLE HOYEGI — BS PCS SE CALCULATION HORI, BAKI CM, MTR, FEET, INCH,
 * SQ FT, SQ MTR, PER SQ FT, PER INCH VALE SECTION NAHI HAI": added the
 * length units (feet / inch / cm — mtr, yard, sq ft, sq mtr were already
 * here) and the "per …" RATE units (per pcs / per mtr / per feet / per
 * inch / per sq ft / per sq mtr) a carpet/rug inquiry actually prices
 * by. Units are labels only — subtotal is Σ qty × rate server-side (see
 * actions.ts), so every unit computes identically; nothing converts to a
 * base unit here (unlike Purchase Bills' toFeet), because a quote must
 * show the buyer exactly the unit they asked in.
 */
export const ITEM_UNITS = [
  "pcs",
  "nos",
  "sets",
  "pair",
  "kg",
  "mtr",
  "feet",
  "inch",
  "cm",
  "yard",
  "sq ft",
  "sq mtr",
  "per pcs",
  "per mtr",
  "per feet",
  "per inch",
  "per sq ft",
  "per sq mtr",
  "box",
  "carton",
  "roll",
  "bag",
  "bundle",
  "litre",
] as const;

export const SIZE_UNITS = ["ft", "m", "cm", "inch"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

const SIZE_UNIT_ALIASES: Record<string, SizeUnit> = {
  ft: "ft", feet: "ft", foot: "ft", "'": "ft",
  m: "m", mtr: "m", meter: "m", metre: "m", meters: "m", metres: "m",
  cm: "cm", centimeter: "cm", centimetre: "cm", centimeters: "cm", centimetres: "cm",
  inch: "inch", inches: "inch", in: "inch", '"': "inch",
};

export type ParsedSize = { length: number; width: number; thickness: number | null; unit: SizeUnit };

/**
 * Parses a free-typed size spec into length × width (× optional thickness)
 * + the unit. Accepts the shapes people actually type:
 *   "2 × 6 feet" / "2x6" / "2 * 6" / "60 x 90 cm" / "2×6×0.05 ft" / "4 x 6"
 *   "3 ft * 400 mtr" — each part may carry its OWN unit (converted to a
 *   common one below; the old single-unit parser read this as 3 m × 400 m).
 * Separator: ×, x, X, * (not the letter x inside words). A part with no
 * unit takes the FIRST unit written anywhere in the spec ("2.6 x 6 ft" →
 * both in ft); with no unit at all it defaults to ft — this business's
 * rug/dhurrie sizes are feet-first. Returns null for anything unparseable
 * so the UI can simply show no preview rather than a wrong number.
 */
export function parseSizeSpec(text: string): ParsedSize | null {
  const raw = (text || "").trim().toLowerCase();
  if (!raw) return null;

  const parts = raw.split(/\s*[×x*]\s*/).filter((p) => p.trim());
  const parsedParts: { value: number; unit: SizeUnit | null }[] = [];
  for (const part of parts) {
    const m = part.match(/(\d+(?:\.\d+)?)\s*([a-z"'°]+)?/);
    if (!m) continue;
    const value = Number(m[1]);
    if (!(value > 0)) continue;
    const token = m[2] ? m[2].trim() : "";
    parsedParts.push({ value, unit: token ? (SIZE_UNIT_ALIASES[token] ?? null) : null });
  }
  if (parsedParts.length < 2) return null;

  // Default unit for the parts that didn't write one: the first unit the
  // spec does mention (or ft — feet-first business default).
  const explicit = parsedParts.find((p) => p.unit);
  const fallback: SizeUnit = explicit?.unit ?? "ft";
  const [l, w, t] = parsedParts.map((p) => ({ value: p.value, unit: p.unit ?? fallback }));
  if (l.value <= 0 || w.value <= 0) return null;

  // Mixed units ("3 ft * 400 mtr") → normalise everything to metres so the
  // single-unit computeItemDims() maths stays exact.
  const units = [l.unit, w.unit, ...(t ? [t.unit] : [])];
  const sameUnit = units.every((u) => u === units[0]);
  if (sameUnit) {
    return { length: l.value, width: w.value, thickness: t ? t.value : null, unit: units[0] };
  }
  // Full precision (not round2) — these feed the area maths; rounding
  // here would compound into a visibly wrong sq ft on large quantities.
  return {
    length: l.value * METERS_PER[l.unit],
    width: w.value * METERS_PER[w.unit],
    thickness: t ? t.value * METERS_PER[t.unit] : null,
    unit: "m",
  };
}

const METERS_PER: Record<SizeUnit, number> = { ft: 0.3048, m: 1, cm: 0.01, inch: 0.0254 };

export function lengthToMeters(value: number, unit: SizeUnit): number {
  return (value || 0) * (METERS_PER[unit] ?? 0.3048);
}

export type ItemDims = {
  /** per-line total area in sq ft (qty × L × W) */
  sqFt: number;
  /** per-line total area in sq mtr (sq ft × 0.09290304) */
  sqMtr: number;
  /** per-line total volume in CBM — only when thickness given, else 0 */
  cbm: number;
};

export const SQFT_TO_SQM = 0.09290304;

/**
 * The "SIZE × QTY" formula: line totals in sq ft / sq mtr / CBM.
 *   sqFt  = qty × L × W (converted to feet when the size unit is m/cm/inch)
 *   sqMtr = sqFt × 0.09290304
 *   cbm   = qty × L(m) × W(m) × T(m) — 0 unless a thickness was parsed
 * Rounded to 2 decimals at the boundary (same rule as every money figure).
 */
export function computeItemDims(input: { qty: number; length: number; width: number; thickness?: number | null; unit: SizeUnit }): ItemDims {
  const qty = Math.max(0, input.qty || 0);
  const lM = lengthToMeters(input.length, input.unit);
  const wM = lengthToMeters(input.width, input.unit);
  const tM = input.thickness ? lengthToMeters(input.thickness, input.unit) : 0;
  // 2026-10-17 — both figures derive from the SAME unrounded product
  // (sqFt from exact square metres ÷ 0.09290304). The old
  // `sqFt = round2(round2(sqMtr) / SQFT_TO_SQM)` double-rounded and showed
  // e.g. 130,000.05 sq ft on 5,000 pcs of 2.6 × 10 ft — wrong on a priced
  // line, where the amount is area × rate.
  const areaM2 = qty * lM * wM;
  const sqMtr = round2(areaM2);
  const sqFt = round2(areaM2 / SQFT_TO_SQM);
  const cbm = tM > 0 ? round2(areaM2 * tM) : 0;
  return { sqFt, sqMtr, cbm };
}

/** Convenience: parse a size spec + qty straight to dims (null spec → null). */
export function dimsFromSizeSpec(qty: number, sizeSpec: string | null | undefined): ItemDims | null {
  const parsed = parseSizeSpec(sizeSpec ?? "");
  if (!parsed) return null;
  return computeItemDims({ qty, length: parsed.length, width: parsed.width, thickness: parsed.thickness, unit: parsed.unit });
}

/** Human line for the form preview / PI sub-line: "24,000,000.00 sq ft · 2,229,672.96 sq mtr" (+ CBM when known). */
export function formatDims(d: ItemDims): string {
  const parts = [`${d.sqFt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft`];
  if (d.sqFt > 0) parts.push(`${d.sqMtr.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq mtr`);
  if (d.cbm > 0) parts.push(`${d.cbm.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} CBM`);
  return parts.join(" · ");
}

// ── Area-based line pricing (2026-10-17) ─────────────────────────────────────
// "RATE PER SQ FT ME HAI KI 5 SQ FT TO CALCULATION BHI USI HISAB SE HO" —
// when an item is priced by area (sq ft / sq mtr, with or without the
// "per" prefix), qty × rate is WRONG for a sized piece: 5,000 pcs of
// 2.6 × 10 ft at 5/sq ft is 65,000 sq ft × 5 = 325,000 — not 25,000.
// Every money surface (inquiry lines, quotation subtotal + line_total,
// engine, sales orders, PI/CI print, reports, control centre, payments
// against them) goes through ONE lineAmount() so they can never disagree.
//
// Rules (deliberately small — units the app actually sells by):
//   • area unit + a size spec → measure = qty × L × W in that unit
//   • area unit + no size    → qty IS the area (e.g. "5000 sq ft")
//   • anything else          → qty × rate, exactly as before
// Length "per …" units (per mtr / per feet / per inch) stay qty × rate: a
// single linear dimension for a sized piece is ambiguous (length vs width
// of a rug) and guessing would silently price documents wrong.

export const AREA_RATE_UNITS = ["sq ft", "sq mtr", "per sq ft", "per sq mtr"] as const;

export function isAreaUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim().toLowerCase();
  return (AREA_RATE_UNITS as readonly string[]).includes(u);
}

export type LineArea = { sqFt: number; sqMtr: number };

/**
 * The area a line covers, in both units — null for non-area units (they
 * have no area meaning, callers must fall back to qty).
 */
export function lineArea(input: { qty: number; unit?: string | null; size?: string | null }): LineArea | null {
  const unit = (input.unit ?? "").trim().toLowerCase();
  if (!(AREA_RATE_UNITS as readonly string[]).includes(unit)) return null;
  const dims = dimsFromSizeSpec(input.qty, input.size);
  if (dims) return { sqFt: dims.sqFt, sqMtr: dims.sqMtr };
  const qty = Math.max(0, input.qty || 0);
  return unit.includes("sq mtr")
    ? { sqFt: round2(qty / SQFT_TO_SQM), sqMtr: round2(qty) }
    : { sqFt: round2(qty), sqMtr: round2(qty * SQFT_TO_SQM) };
}

/** The ONE line-amount formula: area × rate for area units, qty × rate otherwise. */
export function lineAmount(input: { qty: number; unit?: string | null; unitPrice?: number | null; size?: string | null }): number {
  const rate = Math.max(0, input.unitPrice || 0);
  const area = lineArea(input);
  if (!area) return round2(Math.max(0, input.qty || 0) * rate);
  const measure = (input.unit ?? "").trim().toLowerCase().includes("sq mtr") ? area.sqMtr : area.sqFt;
  return round2(measure * rate);
}

/** Σ lineAmount over a set of lines — the subtotal formula for every doc. */
export function linesSubtotal<T extends { qty: number; unit?: string | null; unitPrice?: number | null; size?: string | null }>(lines: T[]): number {
  return round2(lines.reduce((s, l) => s + lineAmount(l), 0));
}

// ── Professional send template (2026-10-13 round 2) ─────────────────────────
// "QUATATION BHI AGR SEND KARTE HAI TO EK BADHIYA SE FORMATE ME JAYE USKE
// PASS": one formatted message (WhatsApp / email body) built from the SAME
// stored quote + the SAME formatters the print page uses — so what the
// buyer receives on WhatsApp exactly matches the A4 PDF. Pure function →
// stub-testable, shared by both share buttons.

export type QuotationMessageLine = {
  description: string;
  hsnCode?: string | null;
  qty: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
  sizeSpec?: string | null;
};

export type QuotationMessageInput = {
  docNo: string; // e.g. PI/Q-26-27-0001/01 — or quote_no when no doc issued yet
  docDate: string; // display date, e.g. "13 Oct 2026"
  validUntil: string | null;
  companyName: string;
  buyerName: string;
  buyerCompany?: string | null;
  currency: string;
  subtotal: number;
  taxLabel: string; // "Tax (0%)" or the tax_note text
  taxAmount: number;
  taxIsNote: boolean; // true → print the note text instead of the amount
  shippingLabel: string; // "Shipping & Freight" or the shipping_note text
  shippingAmount: number;
  shippingIsNote: boolean;
  total: number;
  paymentCondition?: string | null;
  paymentMethod?: string | null;
  deliveryPeriod?: string | null;
  incoterm?: string | null;
  terms?: string | null;
  lines: QuotationMessageLine[];
};

/**
 * Builds the buyer-facing quotation message — bold headings, per-line
 * details with size spec, totals block with amount-in-words, payment and
 * delivery lines, validity and a sign-off. Plain text (wa.me + email both
 * render it faithfully); the ₹/$ grouping is always the international
 * fmtDocMoney so the buyer never sees lakh-style figures.
 */
export function buildQuotationMessage(input: QuotationMessageInput): string {
  const cur = (input.currency || "USD").toUpperCase();
  const bar = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const rows = input.lines
    .map((l, i) => {
      const head = `${i + 1}. ${l.description}${l.sizeSpec ? ` (${l.sizeSpec})` : ""}`;
      const meta = `   Qty: ${l.qty.toLocaleString("en-US")} ${l.unit ?? "pcs"} × ${fmtDocMoney(l.unitPrice, cur)}`;
      const total = `   = ${fmtDocMoney(l.lineTotal, cur)}`;
      const hsn = l.hsnCode ? `   HSN: ${l.hsnCode}` : null;
      return [head, meta, hsn, total].filter(Boolean).join("\n");
    })
    .join("\n");

  const totals = [
    `Subtotal: ${fmtDocMoney(input.subtotal, cur)}`,
    `${input.taxIsNote ? `Tax: ${input.taxLabel}` : `${input.taxLabel}: ${fmtDocMoney(input.taxAmount, cur)}`}`,
    `${input.shippingIsNote ? `Freight: ${input.shippingLabel}` : `${input.shippingLabel}: ${fmtDocMoney(input.shippingAmount, cur)}`}`,
    `*TOTAL: ${fmtDocMoney(input.total, cur)}*`,
    `Amount in words: ${amountInWords(input.total, cur)}`,
  ].join("\n");

  const terms = [
    input.paymentCondition && `Payment: ${input.paymentCondition}`,
    input.paymentMethod && `Method: ${input.paymentMethod}`,
    input.deliveryPeriod && `Delivery: ${input.deliveryPeriod}`,
    input.incoterm && `Incoterm: ${input.incoterm}`,
    input.validUntil && `Valid until: ${input.validUntil}`,
    input.terms && `Terms: ${input.terms}`,
  ].filter(Boolean).join("\n");

  return [
    `*${input.companyName.toUpperCase()}*`,
    `*PROFORMA QUOTATION* — ${input.docNo}`,
    `Date: ${input.docDate}`,
    bar,
    `Buyer: ${input.buyerName}${input.buyerCompany ? ` (${input.buyerCompany})` : ""}`,
    bar,
    rows,
    bar,
    totals,
    ...(terms ? [bar, terms] : []),
    bar,
    `This is a quotation/proforma — not a final commercial invoice.`,
    `For orders & confirmation:`,
    `${input.companyName}`,
  ].join("\n");
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
