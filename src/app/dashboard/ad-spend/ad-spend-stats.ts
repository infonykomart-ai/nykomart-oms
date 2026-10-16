// 2026-10-15 — the Report tab's own math, extracted the same way
// daily-sheet-stats.ts was on 2026-10-13: page.tsx fetches and scopes the
// rows (store/company access), this module decides every number, and
// ad-spend-report-table.tsx only renders what it is handed — so the screen,
// the Print/PDF area and the CSV/Excel exports can never disagree.
//
// Two things were added on top of the 2026-08-08 aggregation that used to
// live inline in page.tsx:
//
//  1. AMAZON COUNTRY SPLIT — "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT
//     & SPEND HOTA HAI TO USKA MERE HISAB SE COUNTRY SECTION OR BAN JAYE JO
//     SIRF AMAZON PAR WORK KARE". An Amazon store's Budget/Spend is entered
//     per marketplace country (store_ad_spend.country_code, see
//     db/2026-10-15-ad-spend-amazon-country.sql) and its SALES/QTY are split
//     by the ORDER's own buyer country → Amazon country code
//     (amazon-countries.ts), so a country's sales and its spend finally land
//     on the same row. Every non-Amazon store keeps exactly one row per day
//     with country_code '' — its numbers are byte-for-byte what they were
//     before this change.
//
//  2. STATEMENT VERIFICATION — "ETSY EBAY WEBSITE KA TO SAHI DATA HOTA HAI
//     BS YE STORE KI MONTHLY STATEMENT SE BHI VERFY NAHI HOTA HAI TO YE US
//     SE BHI VERFY HO JAYE TO SAHI HOYEGA OR LINK HO JAYE": an order only
//     counts as verified once a line for it has actually been imported from
//     that store's own marketplace statement (Etsy Ledger / eBay Tax Invoice
//     / Amazon Transactions — matched by marketplace order no. through the
//     SAME matchMarketplaceFees() the Orders hub and the Store Expense
//     Report use, so the three can never drift apart). Reported per row as
//     ✅ matched/total, ⚠️ partial, ⏳ nothing imported yet, with each row
//     linking to that store's statement detail for the month.

import type { MarketplaceFeeMatches } from "@/lib/orders/marketplace-fees";
import type { AdSpendAmazonCountryRow, AdSpendDailyRow, AdSpendMonthlyRow, AdSpendStatementVerify } from "./ad-spend-report-table";
import { amazonCodeForCountryLabel, amazonCountryLabel, isAmazonStore } from "./amazon-countries";
import { canonicalCountry } from "./daily-sheet-stats";

export type AdSpendOrderRow = {
  id: string;
  store_id: string;
  order_date: string | null;
  po_date: string | null;
  order_value_usd: number | null;
  buyer_country: string | null;
  destination_country: string | null;
};

export type AdSpendSpendRow = {
  id: string;
  store_id: string;
  spend_date: string;
  country_code: string | null;
  budget_usd: number | null;
  spend_usd: number | null;
};

export type AdSpendStoreRef = { id: string; name: string; company_id: string };

/** "Amazon" / "Etsy" / "eBay" / "Website & other" — display label only; the
 *  matching itself stays on the statement tables' order numbers. */
export function storeMarketplace(storeName: string | null | undefined): string {
  const name = storeName ?? "";
  if (/amazon/i.test(name)) return "Amazon";
  if (/ebay/i.test(name)) return "eBay";
  if (/etsy/i.test(name)) return "Etsy";
  if (/website|web site|www/i.test(name)) return "Website";
  return "Other";
}

/** Stable bucket key for the (store, country) grain — '' country for every
 *  non-Amazon store, so those keep one row per store exactly as before.
 *  "|" separator (never "__"): the daily key appends the date to this same
 *  string, and a store uuid is the only other part that could contain
 *  underscores. */
export const KEY_SEP = "|";
export function adSpendKey(storeId: string, countryCode: string): string {
  return storeId + KEY_SEP + countryCode;
}

/** Which country bucket an order belongs to on the sales side. */
function orderCountryCode(o: AdSpendOrderRow, isAmazon: boolean): string {
  if (!isAmazon) return "";
  return amazonCodeForCountryLabel(canonicalCountry(o.buyer_country || o.destination_country));
}

/** Buyer-country label shown next to the spend side's country_code: the
 *  Amazon marketplace label when the code is known, else whatever the
 *  order said (an Amazon store selling to a country it has no ad account
 *  in lands in the table's "Other" row instead of being hidden). */
function orderCountryLabel(o: AdSpendOrderRow, isAmazon: boolean): string {
  if (!isAmazon) return "";
  const label = canonicalCountry(o.buyer_country || o.destination_country);
  const code = amazonCodeForCountryLabel(label);
  return code ? amazonCountryLabel(code) : label;
}

type Cell = {
  qty: number;
  usd: number;
  budget: number;
  spend: number;
  label: string;
  orders: string[];
};

const emptyCell = (label: string): Cell => ({ qty: 0, usd: 0, budget: 0, spend: 0, label, orders: [] });

export type AdSpendReport = {
  dailyRows: AdSpendDailyRow[];
  monthlyRows: AdSpendMonthlyRow[];
  /** Amazon-only Country section — empty when no Amazon store is in scope. */
  amazonCountryRows: AdSpendAmazonCountryRow[];
  /** true when at least one Amazon store is in scope, so the section (and
   *  its explanatory note) can be shown even before any country entry. */
  hasAmazonStore: boolean;
  /** Month-scoped order ids per store — feeds the per-store statement link. */
  verifyByKey: Record<string, AdSpendStatementVerify>;
};

export function buildAdSpendReport({
  month,
  orders,
  spendRows,
  stores,
  companyName,
  matches,
}: {
  month: string;
  orders: AdSpendOrderRow[];
  spendRows: AdSpendSpendRow[];
  stores: AdSpendStoreRef[];
  companyName: Map<string, string>;
  matches: MarketplaceFeeMatches;
}): AdSpendReport {
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month

  const storeById = new Map(stores.map((s) => [s.id, s]));
  const isAmazon = (storeId: string) => isAmazonStore(storeById.get(storeId)?.name);

  const daily = new Map<string, Cell>(); // storeId|country|date
  const monthly = new Map<string, Cell>(); // storeId|country
  const verified = new Map<string, { matched: number; total: number }>();

  function bump(map: Map<string, Cell>, key: string, label: string, delta: Partial<Omit<Cell, "label" | "orders">>, orderId?: string) {
    const cur = map.get(key) ?? emptyCell(label);
    cur.qty += delta.qty ?? 0;
    cur.usd += delta.usd ?? 0;
    cur.budget += delta.budget ?? 0;
    cur.spend += delta.spend ?? 0;
    if (orderId) cur.orders.push(orderId);
    if (!cur.label && label) cur.label = label;
    map.set(key, cur);
  }

  for (const o of orders ?? []) {
    // Effective date = PO date when filled, else the order/entry date — same
    // rule as the roll-up and the Daily Order Sheet.
    const effDate = o.po_date ?? o.order_date;
    if (!effDate || effDate < monthStart || effDate > monthEnd) continue; // PO landed in a different month
    const amazon = isAmazon(o.store_id);
    const code = orderCountryCode(o, amazon);
    const label = orderCountryLabel(o, amazon);
    const key = adSpendKey(o.store_id, code);
    const usd = Number(o.order_value_usd ?? 0);
    bump(daily, key + KEY_SEP + effDate, label, { qty: 1, usd }, o.id);
    bump(monthly, key, label, { qty: 1, usd }, o.id);
  }

  for (const s of spendRows ?? []) {
    // A spend row's own country_code wins over anything order-derived: it
    // is what was actually typed on the entry form.
    const code = isAmazon(s.store_id) ? (s.country_code ?? "") : "";
    const label = amazonCountryLabel(code) || (code ? code : "");
    const key = adSpendKey(s.store_id, code);
    const delta = { budget: Number(s.budget_usd ?? 0), spend: Number(s.spend_usd ?? 0) };
    bump(daily, key + KEY_SEP + s.spend_date, label, delta);
    bump(monthly, key, label, delta);
  }

  // Statement verification per (store, country) — an order is "verified"
  // when its marketplace order no. has at least one imported statement line.
  for (const [key, cell] of monthly) {
    const matched = cell.orders.filter(
      (orderId) => matches.etsyFeesByOrder[orderId] || matches.ebayFeesByOrder[orderId] || matches.amazonFeesByOrder[orderId]
    ).length;
    verified.set(key, { matched, total: cell.orders.length });
  }

  // Every Amazon (store, country) bucket that has any number at all: the 12
  // marketplace countries plus an "Other" row (code '') for buyer countries
  // the store has no Amazon ad account for.
  const amazonCountryRows: AdSpendAmazonCountryRow[] = [];
  for (const store of stores.filter((s) => isAmazonStore(s.name))) {
    for (const [key, cell] of monthly) {
      const [storeId, code] = splitKey(key);
      if (storeId !== store.id) continue;
      if (cell.qty === 0 && cell.usd === 0 && cell.budget === 0 && cell.spend === 0) continue;
      amazonCountryRows.push({
        storeId,
        storeName: store.name,
        companyName: companyName.get(store.company_id) ?? "—",
        countryCode: code,
        countryLabel: amazonCountryLabel(code) || cell.label || "Other",
        qty: cell.qty,
        usd: cell.usd,
        avg: cell.qty > 0 ? cell.usd / cell.qty : 0,
        budget: cell.budget,
        spend: cell.spend,
        verify: verified.get(key) ?? { matched: 0, total: cell.qty },
      });
    }
  }
  amazonCountryRows.sort(
    (a, b) =>
      a.storeName.localeCompare(b.storeName) ||
      b.usd - a.usd ||
      a.countryLabel.localeCompare(b.countryLabel)
  );

  // Key layout is fixed and every part is separator-safe (store uuid,
  // country code, ISO date — none can contain "|"), so a plain split is
  // enough: 2 parts for a monthly key, 3 for a daily one.
  const rowsOf = (map: Map<string, Cell>): { storeId: string; code: string; date: string | null; cell: Cell }[] =>
    [...map.entries()].map(([key, cell]) => {
      const [storeId, code, date = null] = key.split(KEY_SEP);
      return { storeId, code, date, cell };
    });

  const dailyRows: AdSpendDailyRow[] = rowsOf(daily)
    .map(({ storeId, code, date, cell }) => {
      const store = storeById.get(storeId);
      return {
        storeId,
        storeName: store?.name ?? "—",
        companyName: companyName.get(store?.company_id ?? "") ?? "—",
        countryCode: code,
        countryLabel: amazonCountryLabel(code) || cell.label,
        date: date ?? "",
        qty: cell.qty,
        usd: cell.usd,
        budget: cell.budget,
        spend: cell.spend,
        verify: verified.get(adSpendKey(storeId, code)) ?? { matched: 0, total: cell.qty },
      };
    })
    .sort((a, b) => (a.date === b.date ? a.storeName.localeCompare(b.storeName) : a.date.localeCompare(b.date)));

  const monthlyRows: AdSpendMonthlyRow[] = rowsOf(monthly)
    .map(({ storeId, code, cell }) => {
      const store = storeById.get(storeId);
      const key = adSpendKey(storeId, code);
      return {
        storeId,
        storeName: store?.name ?? "—",
        companyName: companyName.get(store?.company_id ?? "") ?? "—",
        countryCode: code,
        countryLabel: amazonCountryLabel(code) || cell.label,
        qty: cell.qty,
        usd: cell.usd,
        avg: cell.qty > 0 ? cell.usd / cell.qty : 0,
        budget: cell.budget,
        spend: cell.spend,
        verify: verified.get(key) ?? { matched: 0, total: cell.qty },
      };
    })
    .filter((r) => r.qty > 0 || r.usd > 0 || r.budget > 0 || r.spend > 0)
    .sort((a, b) => b.usd - a.usd || a.storeName.localeCompare(b.storeName) || a.countryLabel.localeCompare(b.countryLabel));

  const verifyByKey: Record<string, AdSpendStatementVerify> = {};
  for (const [key, v] of verified) verifyByKey[key] = v;

  return {
    dailyRows,
    monthlyRows,
    amazonCountryRows,
    hasAmazonStore: stores.some((s) => isAmazonStore(s.name)),
    verifyByKey,
  };
}

function splitKey(key: string): [string, string] {
  const at = key.indexOf(KEY_SEP);
  return at === -1 ? [key, ""] : [key.slice(0, at), key.slice(at + 1)];
}

/** ✅ all of the row's orders were found in the statement, ⚠️ only some,
 *  ⏳ none (the store's statement has not been imported for this period) —
 *  a row with no orders at all reports ⏳ too, since there is nothing to
 *  verify. */
export function verifyStatus(v: AdSpendStatementVerify): "ok" | "partial" | "none" {
  if (v.total > 0 && v.matched >= v.total) return "ok";
  if (v.matched > 0) return "partial";
  return "none";
}

export function verifyText(v: AdSpendStatementVerify): string {
  if (v.total === 0 && v.matched === 0) return "No orders";
  if (verifyStatus(v) === "ok") return `✅ ${v.matched}/${v.total} verified`;
  if (verifyStatus(v) === "partial") return `⚠️ ${v.matched}/${v.total} in statement`;
  return `⏳ 0/${v.total} in statement`;
}
