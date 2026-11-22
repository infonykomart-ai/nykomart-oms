// 2026-11-22c — Phase 3: pure Purchase Order rules.
//
// Kept out of the "use server" action file so they can be unit-tested without
// Next.js, Supabase or a database — the same split the address engine uses.

export const PO_STATUSES = ["Draft", "Sent", "Received", "Cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export function isPoStatus(value: unknown): value is PoStatus {
  return typeof value === "string" && (PO_STATUSES as readonly string[]).includes(value);
}

export type ParsedPoLine = {
  sku_label: string | null;
  qty: number;
  unit_cost: number;
  sort_order: number;
};

/**
 * Parses the three parallel form fields into lines.
 *
 * Rules, matching what the form shows:
 *   • a completely blank row is ignored (the form always renders one);
 *   • any other row must have qty > 0 and unit_cost >= 0;
 *   • money is rounded to 2 decimals, qty to a whole number;
 *   • at least one line is required.
 */
export function parsePoLines(
  skus: string[],
  qtys: string[],
  costs: string[]
): { lines: ParsedPoLine[]; error: string | null } {
  const lines: ParsedPoLine[] = [];
  const rowCount = Math.max(skus.length, qtys.length, costs.length);

  for (let i = 0; i < rowCount; i++) {
    const sku = (skus[i] ?? "").trim();
    const qtyRaw = (qtys[i] ?? "").trim();
    const costRaw = (costs[i] ?? "").trim();
    if (!sku && !qtyRaw && !costRaw) continue;

    const qty = Number(qtyRaw);
    const unitCost = Number(costRaw);
    const lineNo = lines.length + 1;

    if (!Number.isFinite(qty) || qty <= 0) {
      return { lines: [], error: `Line ${lineNo}: quantity must be greater than 0.` };
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return { lines: [], error: `Line ${lineNo}: unit cost must be 0 or more.` };
    }

    lines.push({
      sku_label: sku || null,
      qty: Math.round(qty),
      unit_cost: Math.round(unitCost * 100) / 100,
      sort_order: lines.length,
    });
  }

  if (!lines.length) return { lines: [], error: "Add at least one line item." };
  return { lines, error: null };
}

/** The stored PO total: sum of qty × unit cost, to 2 decimals. */
export function poTotal(lines: Pick<ParsedPoLine, "qty" | "unit_cost">[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.qty * line.unit_cost, 0) * 100) / 100;
}

/**
 * `NPO-<FY>-####`, e.g. NPO-26-27-0001.
 *
 * The NPO- prefix is deliberate: an order's own reference is already
 * `PO-0001` (format_order_ref_no), so a PO document that also read `PO-…`
 * would be indistinguishable from the order it links to.
 */
export function buildPoNumber(fyLabel: string, sequence: number): string {
  const fy = (fyLabel || "").trim() || "NA";
  const seq = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 0;
  return `NPO-${fy}-${String(seq).padStart(4, "0")}`;
}
