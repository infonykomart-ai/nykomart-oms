// 2026-10-13 — "MERE HISAB SE 8 ORDER HAI 1/2 2/2 4/4 JESE ORDER EK HI
// MANA JAYE OR QUANTITY ME HO": pure math behind the Daily Order Sheet,
// extracted into its own module so it can be stub-tested without a
// database. page.tsx only fetches and scopes the rows (store/company
// access), this module decides the numbers, and daily-order-sheet.tsx
// only renders what it is handed — so screen, exports and the PO-file
// link can never disagree.

import type { DailyOrderSheetData } from "./daily-order-sheet";

export type DailySheetOrderRow = {
  id: string;
  ref_no: string | null;
  store_id: string;
  order_date: string | null;
  po_date: string | null;
  qty: number | null;
  order_value_usd: number | null;
  sku_label: string | null;
  size_label: string | null;
  buyer_country: string | null;
  destination_country: string | null;
};

/**
 * Multi-part POs count as ONE order: PO-A926-1/2 and PO-A926-2/2 both
 * reduce to base "PO-A926" (same for -2/2, -4/4 …), so 9 rows in the day
 * = 8 orders the way the business counts them — while every part's qty
 * and amount still add up separately. A blank/missing PO no. can never
 * collide with another row, so it falls back to the row id (always
 * unique — never merges).
 */
export function basePoKey(refNo: string | null | undefined, rowId: string): string {
  const base = (refNo ?? "").trim().replace(/-\d+\/\d+$/, "");
  return base || rowId;
}

// 2026-10-13 (part 3) — "UNITED STATES & USA DONO ALAG ALAG DIKHA RAHE
// JABKI EK HI TO HAI": marketplace feeds spell the same country several
// ways, so the Country-wise table showed United States and USA as two
// rows. Conservative alias table (lower-case key → canonical display) —
// only unambiguous spellings, so nothing can be wrongly merged.
const COUNTRY_ALIASES: Record<string, string> = {
  us: "United States",
  usa: "United States",
  "u.s.": "United States",
  "u.s.a": "United States",
  "u.s.a.": "United States",
  "united states": "United States",
  "united states of america": "United States",
  america: "United States",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  "united kingdom": "United Kingdom",
  uae: "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  netherlands: "Netherlands",
  in: "India",
  de: "Germany",
  deutschland: "Germany",
  fr: "France",
  ca: "Canada",
  au: "Australia",
  it: "Italy",
  es: "Spain",
  jp: "Japan",
  nl: "Netherlands",
  sg: "Singapore",
};

/** One country's canonical display label: alias table first, else the
 *  trimmed original (case-variant merging happens via the lower-case
 *  bucket key in buildDailySheet). Blank/missing → "—". */
export function canonicalCountry(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "—";
  return COUNTRY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

type Bucket = { orders: number; qty: number; usd: number; poKeys: Set<string> };

const newBucket = (): Bucket => ({ orders: 0, qty: 0, usd: 0, poKeys: new Set<string>() });

/** One row into one bucket: qty/amount always add; the ORDER count only
 *  ticks once per distinct base PO (each bucket tracks its own set, so a
 *  PO's parts landing in different SKU/size buckets still count once in
 *  EACH of those buckets — every dimension stays internally correct). */
function bump(b: Bucket, poKey: string, qty: number, usd: number): void {
  if (!b.poKeys.has(poKey)) {
    b.poKeys.add(poKey);
    b.orders += 1;
  }
  b.qty += qty;
  b.usd += usd;
}

const plain = (b: Bucket) => ({ orders: b.orders, qty: b.qty, usd: b.usd });

// Natural order for the PO file: PO-A922, PO-A923, … PO-A926, PO-A926-1/2,
// PO-A926-2/2 (plain string sort would mis-order numeric PO fragments).
const refCollator = new Intl.Collator("en", { numeric: true });

/**
 * Same effective-date rule as the Monthly Roll-up / the rest of this
 * module: an order belongs to the day its PO DATE falls on (blank PO
 * date falls back to the entry/order date) — rows fetched by the OR
 * filter but PO'd on another day are dropped here, never double counted.
 */
export function buildDailySheet({
  orders,
  date,
  storeName,
  companyName,
  storeCompanyId,
}: {
  orders: DailySheetOrderRow[];
  date: string;
  storeName: Map<string, string>;
  companyName: Map<string, string>;
  storeCompanyId: Map<string, string>;
}): DailyOrderSheetData {
  const totals = newBucket();
  const storeMap = new Map<string, Bucket>();
  const countryMap = new Map<string, Bucket>();
  const skuMap = new Map<string, Bucket>();
  const sizeMap = new Map<string, Bucket>();
  // Country buckets are keyed lower-case so "USA" / "United States" /
  // "u.s.a." land in ONE row; this keeps the label to display (first
  // spelling seen wins, aliases always resolve to the canonical name).
  const countryDisplay = new Map<string, string>();

  const bucketFor = (m: Map<string, Bucket>, key: string): Bucket => {
    let b = m.get(key);
    if (!b) {
      b = newBucket();
      m.set(key, b);
    }
    return b;
  };

  const kept: DailySheetOrderRow[] = [];
  for (const o of orders) {
    const effDate = o.po_date ?? o.order_date;
    if (effDate !== date) continue;
    kept.push(o);

    const poKey = basePoKey(o.ref_no, o.id);
    const qty = Number(o.qty ?? 0);
    const usd = Number(o.order_value_usd ?? 0);

    const countryLabel = canonicalCountry(o.buyer_country || o.destination_country);
    const countryKey = countryLabel.toLowerCase();
    if (!countryDisplay.has(countryKey)) countryDisplay.set(countryKey, countryLabel);

    bump(totals, poKey, qty, usd);
    bump(bucketFor(storeMap, o.store_id), poKey, qty, usd);
    bump(bucketFor(countryMap, countryKey), poKey, qty, usd);
    bump(bucketFor(skuMap, o.sku_label || "—"), poKey, qty, usd);
    bump(bucketFor(sizeMap, o.size_label || "—"), poKey, qty, usd);
  }

  const byUsdDesc = <T extends { usd: number }>(a: T, b: T) => b.usd - a.usd;

  return {
    date,
    totals: plain(totals),
    // Full day's order ids in PO order for /dashboard/orders/print — the
    // exact order file the Orders page generates (stacked A4 PO sheets).
    orderIds: kept
      .slice()
      .sort((a, b) => refCollator.compare(a.ref_no ?? "", b.ref_no ?? "") || a.id.localeCompare(b.id))
      .map((o) => o.id),
    storeRows: [...storeMap.entries()]
      .map(([storeId, b]) => ({
        storeId,
        storeName: storeName.get(storeId) ?? "—",
        companyName: companyName.get(storeCompanyId.get(storeId) ?? "") ?? "—",
        ...plain(b),
      }))
      .sort(byUsdDesc),
    countryRows: [...countryMap.entries()]
      .map(([key, b]) => ({ label: countryDisplay.get(key) ?? key, ...plain(b) }))
      .sort(byUsdDesc),
    skuRows: [...skuMap.entries()].map(([label, b]) => ({ label, ...plain(b) })).sort(byUsdDesc),
    sizeRows: [...sizeMap.entries()].map(([label, b]) => ({ label, ...plain(b) })).sort(byUsdDesc),
  };
}
