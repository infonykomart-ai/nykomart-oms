"use server";

import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

// 2026-09-02: Global Search — "pure OMS ke liye ek global search button do
// jisme kuch bhi search kare to us se related jo bhi data ho dikh jaye".
//
// Scope for this round (clarified with the owner before building,
// AskUserQuestion): the 6 data types the owner's own recent problem
// actually involved — Orders, Purchase Bills, Courier (Freight) Bills,
// Duty & Tax Bills, Parties, and Sales Invoices. NOT all 40+ tables in the
// schema — that's a much bigger, riskier single change; more types can be
// added in later rounds the same way these 6 were, without touching this
// file's existing entries.
//
// Access control ("data dikh jaye lekin authority na ho to zyada access na
// ho" — clarified: unauthorized hits show identifying fields like invoice
// number/date, but NOT sensitive fields like the amount, and there is no
// link to open the actual record): every hit is checked against the SAME
// capability that already gates that data type's own page
// (orders -> order_entry, purchase/freight/duty bills -> doc_entry,
// parties -> party_admin, sales invoices -> invoicing — see
// requireCapability() calls in each type's own page.tsx). There is no
// central table->capability registry anywhere else in this codebase (this
// file — TYPE_CAPABILITY below — is now that map, at least for these 6
// types); if a 7th type is added later, its capability must be looked up
// from that type's own page.tsx, not guessed.
//
// This action itself requires NO capability — search is open to every
// signed-in employee (matches Messages/Theme/My Profile precedent, see
// capability-info.ts) — because an unauthorized RESULT is still useful
// (it tells someone "this exists, ask an admin") without granting any
// data. It's each individual hit that's authorized or not, never the
// action as a whole.
export type SearchHitType = "order" | "purchase_bill" | "freight_bill" | "duty_tax_bill" | "party" | "sales_invoice";

export type SearchHit = {
  type: SearchHitType;
  typeLabel: string;
  id: string;
  authorized: boolean;
  // Always populated (even when unauthorized) — the whole point of this
  // feature is "tell me this exists". Never includes an amount/sensitive
  // field when authorized === false.
  title: string;
  subtitle: string | null;
  amount: string | null;
  // Only set when authorized — an unauthorized hit has no link, so there
  // is nowhere to click through to the actual record.
  href: string | null;
};

const TYPE_LABELS: Record<SearchHitType, string> = {
  order: "Order",
  purchase_bill: "Purchase Bill",
  freight_bill: "Courier Bill",
  duty_tax_bill: "Duty & Tax Bill",
  party: "Party",
  sales_invoice: "Sales Invoice",
};

const MAX_PER_TYPE = 8;
const MIN_QUERY_LENGTH = 2;

function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  return `$${n.toFixed(0)}`;
}

// Escapes Postgres ILIKE wildcards in the raw user input before wrapping
// it in our own %...% — otherwise a search for e.g. "50%" would silently
// behave like a wildcard instead of a literal percent sign.
function likePattern(query: string): string {
  const escaped = query.replace(/[%_\\]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export async function globalSearch(rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return [];

  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const like = likePattern(query);
  const myCompanyIds = new Set(employee.companyIds);

  const canOrders = employee.capabilities.includes("order_entry");
  const canDocs = employee.capabilities.includes("doc_entry");
  const canParties = employee.capabilities.includes("party_admin");
  const canInvoicing = employee.capabilities.includes("invoicing");

  // Orders are matched on 3 separate columns. Deliberately 3 separate
  // queries merged in JS rather than one `.or("a.ilike.x,b.ilike.x")`
  // filter string — buyer_name_address routinely contains literal commas
  // ("123 Main St, Springfield"), and PostgREST's `.or()` DSL treats a
  // comma as a condition separator with no escape for it inside a value,
  // so a comma in the search term (or in a value being matched) would
  // silently corrupt or error the whole filter.
  const orderCols = ["ref_no", "buyer_name_address", "marketplace_order_no"] as const;
  const orderQueries = orderCols.map((col) =>
    supabase
      .from("orders")
      .select("id, ref_no, buyer_name_address, order_date, company_id, order_value_usd")
      .ilike(col, like)
      .order("order_date", { ascending: false })
      .limit(MAX_PER_TYPE)
  );

  const [orderMatches, purchaseBillsRes, freightBillsRes, dutyBillsRes, partiesRes, salesInvoicesRes] = await Promise.all([
    Promise.all(orderQueries),
    supabase
      .from("purchase_bills")
      .select("id, vendor_invoice_no, vendor_invoice_date, company_id, total_amount")
      .ilike("vendor_invoice_no", like)
      .order("vendor_invoice_date", { ascending: false })
      .limit(MAX_PER_TYPE),
    supabase
      .from("freight_bills")
      .select("id, invoice_no, invoice_date, gross_total_amt")
      .ilike("invoice_no", like)
      .order("invoice_date", { ascending: false })
      .limit(MAX_PER_TYPE),
    supabase
      .from("duty_tax_bills")
      .select("id, invoice_no, invoice_date, total_payable_amt, gross_total_amt")
      .ilike("invoice_no", like)
      .order("invoice_date", { ascending: false })
      .limit(MAX_PER_TYPE),
    supabase.from("parties").select("id, name, party_type, contact_no").ilike("name", like).order("name").limit(MAX_PER_TYPE),
    supabase
      .from("sales_invoices")
      .select("id, invoice_no, invoice_date, company_id, buyer_name_address, invoice_value_usd")
      .ilike("invoice_no", like)
      .order("invoice_date", { ascending: false })
      .limit(MAX_PER_TYPE),
  ]);

  const hits: SearchHit[] = [];

  // Merge + dedupe the 3 order column matches (an order could match more
  // than one column) and cap back to MAX_PER_TYPE overall.
  const orderById = new Map<string, NonNullable<(typeof orderMatches)[number]["data"]>[number]>();
  for (const res of orderMatches) {
    for (const o of res.data ?? []) {
      if (!orderById.has(o.id)) orderById.set(o.id, o);
    }
  }
  const dedupedOrders = Array.from(orderById.values())
    .sort((a, b) => (a.order_date < b.order_date ? 1 : -1))
    .slice(0, MAX_PER_TYPE);

  for (const o of dedupedOrders) {
    const authorized = canOrders && myCompanyIds.has(o.company_id);
    hits.push({
      type: "order",
      typeLabel: TYPE_LABELS.order,
      id: o.id,
      authorized,
      title: o.ref_no,
      subtitle: authorized ? `${o.buyer_name_address ?? "-"} · ${o.order_date}` : o.order_date,
      amount: authorized ? money(o.order_value_usd) : null,
      href: authorized ? `/dashboard/orders/${o.id}` : null,
    });
  }

  for (const b of purchaseBillsRes.data ?? []) {
    const authorized = canDocs && (b.company_id === null || myCompanyIds.has(b.company_id));
    hits.push({
      type: "purchase_bill",
      typeLabel: TYPE_LABELS.purchase_bill,
      id: b.id,
      authorized,
      title: b.vendor_invoice_no,
      subtitle: b.vendor_invoice_date,
      amount: authorized ? money(b.total_amount) : null,
      href: authorized ? "/dashboard/documents" : null,
    });
  }

  for (const b of freightBillsRes.data ?? []) {
    // freight_bills has no company_id of its own (see db/schema.sql) — one
    // invoice can span AWBs across all 3 companies — so it's gated on
    // doc_entry alone, same as its own page (documents/page.tsx has no
    // extra company filter on this table either).
    hits.push({
      type: "freight_bill",
      typeLabel: TYPE_LABELS.freight_bill,
      id: b.id,
      authorized: canDocs,
      title: b.invoice_no,
      subtitle: b.invoice_date,
      amount: canDocs ? money(b.gross_total_amt) : null,
      href: canDocs ? "/dashboard/documents" : null,
    });
  }

  for (const b of dutyBillsRes.data ?? []) {
    // Same "no company_id" shape as freight_bills above.
    hits.push({
      type: "duty_tax_bill",
      typeLabel: TYPE_LABELS.duty_tax_bill,
      id: b.id,
      authorized: canDocs,
      title: b.invoice_no,
      subtitle: b.invoice_date,
      amount: canDocs ? money(b.total_payable_amt ?? b.gross_total_amt) : null,
      href: canDocs ? "/dashboard/documents" : null,
    });
  }

  for (const p of partiesRes.data ?? []) {
    hits.push({
      type: "party",
      typeLabel: TYPE_LABELS.party,
      id: p.id,
      authorized: canParties,
      title: p.name,
      subtitle: canParties ? (p.party_type ?? p.contact_no) : null,
      amount: null,
      href: canParties ? `/dashboard/parties/${p.id}/ledger` : null,
    });
  }

  for (const s of salesInvoicesRes.data ?? []) {
    const authorized = canInvoicing && myCompanyIds.has(s.company_id);
    hits.push({
      type: "sales_invoice",
      typeLabel: TYPE_LABELS.sales_invoice,
      id: s.id,
      authorized,
      title: s.invoice_no,
      subtitle: authorized ? `${s.buyer_name_address ?? "-"} · ${s.invoice_date}` : s.invoice_date,
      amount: authorized ? money(s.invoice_value_usd) : null,
      href: authorized ? `/dashboard/invoices/${s.id}` : null,
    });
  }

  return hits;
}
