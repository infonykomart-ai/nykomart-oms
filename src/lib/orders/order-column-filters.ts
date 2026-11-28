// 2026-11-28 — "ye filter kaam nahi karte puri trh se": the Orders page's
// per-column "Filter…" boxes used to run ONLY in the browser, over the newest
// 300 rows the page had already loaded. An older order (or any order outside
// that window) therefore matched nothing even though it plainly exists — the
// user could only find it by page-level search.
//
// This module turns those column filters into a PostgREST logic expression so
// the MATCH happens in the database. The page still applies the same filters
// locally for instant feedback, and both use the same "contains, ignore case"
// rule.
//
// Two deliberate limits, both visible in the table itself:
//   - dates / qty are compared as text locally only — filtering a `date` or
//     `int` column with `ilike` needs a cast that PostgREST may reject, and a
//     rejected filter would blank the whole list;
//   - columns that are computed from other tables (Purchase Bill, Delivered,
//     Tracking, Freight, Marketplace Fee, Late Order) have no single `orders`
//     column behind them and stay local to the loaded rows.
import { sanitizeSearchTerm } from "@/lib/orders/find-order";

export type NamedRow = { id: string; name: string };
export type ColumnFilter = { key: string; value: string };

export type OrderFilterContext = {
  stores: NamedRow[];
  itemCategories: NamedRow[];
  parties: NamedRow[];
};

/** Parse the repeatable `?f=<column>=<value>` params of the Orders page. */
export function parseColumnFilters(raw: string | string[] | undefined): ColumnFilter[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: ColumnFilter[] = [];
  for (const entry of list) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const value = entry.slice(eq + 1).trim();
    if (value) out.push({ key: entry.slice(0, eq), value });
  }
  return out;
}

// Exactly the fields the page-level search box covers (kept in step with
// orders/page.tsx, which used to hold this list inline).
const SEARCH_COLUMNS = [
  "ref_no",
  "buyer_name_address",
  "contact_no",
  "marketplace_order_no",
  "sku_label",
  "email_id",
  "remark",
  "vat_number",
  "eori_number",
  "ioss_number",
  "destination_country",
  "buyer_city",
  "advance_tracking",
  "final_tracking",
];

// Column-filter key -> the one `orders` column that backs it.
const TEXT_COLUMNS: Record<string, string> = {
  remark: "remark",
  poNo: "ref_no",
  orderNo: "marketplace_order_no",
  sku: "sku_label",
  sizes: "size_label",
  buyer: "buyer_name_address",
  contact: "contact_no",
  email: "email_id",
  addressType: "address_type",
};

function idsByName(rows: NamedRow[], value: string): string[] {
  const needle = value.toLowerCase();
  return rows.filter((r) => (r.name ?? "").toLowerCase().includes(needle)).map((r) => r.id);
}

/**
 * Builds the single `or=`/`and=` expression the Orders query passes to
 * `.or()`. Returns `matchesNothing` when a filter names a store/item/vendor
 * that does not exist — that must yield no rows, and PostgREST cannot express
 * an empty `in.()`.
 */
export function buildOrderFilterExpression(
  q: string,
  filters: ColumnFilter[],
  ctx: OrderFilterContext
): { expression: string | null; matchesNothing: boolean } {
  const pieces: string[] = [];
  let matchesNothing = false;

  const safeQ = sanitizeSearchTerm(q);
  if (safeQ) {
    pieces.push(`or(${SEARCH_COLUMNS.map((c) => `${c}.ilike.%${safeQ}%`).join(",")})`);
  }

  for (const { key, value } of filters) {
    const safe = sanitizeSearchTerm(value);
    if (!safe) continue;

    const textColumn = TEXT_COLUMNS[key];
    if (textColumn) {
      pieces.push(`${textColumn}.ilike.%${safe}%`);
      continue;
    }

    if (key === "store" || key === "item" || key === "vendor") {
      const rows = key === "store" ? ctx.stores : key === "item" ? ctx.itemCategories : ctx.parties;
      const column = key === "store" ? "store_id" : key === "item" ? "item_category_id" : "vendor_party_id";
      const ids = idsByName(rows, safe);
      if (!ids.length) {
        matchesNothing = true;
        continue;
      }
      pieces.push(`${column}.in.(${ids.join(",")})`);
      continue;
    }

    if (key === "vatTax") {
      pieces.push(
        `or(${["tax_id", "vat_number", "ioss_number", "eori_number"].map((c) => `${c}.ilike.%${safe}%`).join(",")})`
      );
    }
  }

  if (!pieces.length) return { expression: null, matchesNothing };
  return {
    expression: pieces.length === 1 ? pieces[0] : `and(${pieces.join(",")})`,
    matchesNothing,
  };
}
