// 2026-10-31 — "jis company me bill chadhaya hai usme hi poora dikhe".
//
// THE PROBLEM: a Purchase/Printing bill is stored as ONE bill_pass_register row
// per item/PO (see src/lib/bill-grouping.ts), and each row's company_id used to
// be whatever the item's ORDER belonged to. So a single vendor invoice entered
// on 4 Nyko orders + 2 Rugara orders landed as 4 rows in Nyko's ledger and 2 in
// Rugara's — neither showing the real bill, and no payment ever tying out.
// The user: "bill me 4 order nyko ke hai to 4 ka total nyko me dikha raha, baki
// rugara me or bill register hua nyko me. total jud ke aana chahiye nyko ke
// ledger me."
//
// THE RULE (one place, used by every page that lists bills): an invoice is ONE
// document and belongs to ONE company — the company it is registered in.
//   • purchase_bills.company_id is that answer: the Finance hand-off stamps
//     every item row of the invoice with the company it was posted to (see
//     sendPurchaseBillInvoiceToFinance in documents/actions.ts).
//   • Courier / Duty / office-expense rows are one row per document already, so
//     each is simply its own group — their own company is the answer.
//   • Legacy rows (the document has no company, or its item rows carry
//     disagreeing ones, from per-order entry before that hand-off): the company
//     holding the larger share of the invoice is where it was booked; ties go to
//     whichever row posted first.
//
// Callers fetch a party's / company's rows of every accessible company (a
// split invoice is only visible that way), then filter on the returned owner.
// The companion migration db/2026-10-31e-purchase-invoice-company-attribution.sql
// repairs the existing split rows in the database itself, so pages that only
// aggregate (ageing, party summary, dashboards) get the same answer without
// reading this module.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** The columns this module needs — every caller's select already has them. */
export type BillCompanyRow = {
  id: string;
  company_id: string;
  party_id?: string | null;
  vendor_invoice_no?: string | null;
  invoice_date?: string | null;
  invoice_recv_date?: string | null;
  source?: string | null;
  source_id?: string | null;
  total_amt?: number | string | null;
  created_at?: string | null;
};

/** PostgREST URL length safety — purchase_bills.company_id lookups in batches. */
const ID_CHUNK = 200;

/**
 * The invoice identity a bill row belongs to: vendor invoice number + invoice
 * date for a Purchase/Printing bill (the date matters — a vendor can reuse a
 * number in another financial year, see lib/bill-grouping.ts), otherwise the
 * row itself (Courier / Duty / expense / a manually typed bill are one row per
 * document, and two of them are never "the same invoice").
 */
export function billInvoiceKey(e: BillCompanyRow): string {
  const inv = (e.vendor_invoice_no ?? "").trim().toLowerCase();
  return e.source === "purchase_bill" && inv
    ? `pb|${inv}|${(e.invoice_date ?? e.invoice_recv_date ?? "").slice(0, 10)}`
    : `row|${e.id}`;
}

/**
 * Which company books each row's DOCUMENT. Returns bill id → company id for
 * every row passed in (never partial: a row with no usable signal keeps its
 * own company_id).
 */
export async function resolveBillCompanyOwners<T extends BillCompanyRow>(
  supabase: Client,
  rows: T[]
): Promise<Map<string, string>> {
  const rowsByInvoice = new Map<string, T[]>();
  for (const e of rows) {
    const key = billInvoiceKey(e);
    const list = rowsByInvoice.get(key);
    if (list) list.push(e);
    else rowsByInvoice.set(key, [e]);
  }

  // Only Purchase/Printing rows need the document lookup. Chunked so a party
  // with thousands of items can never build an over-long PostgREST URL.
  const pbSourceIds = Array.from(
    new Set(
      rows
        .filter((e) => e.source === "purchase_bill" && e.source_id)
        .map((e) => e.source_id as string)
    )
  );
  const registeredCompanyByPbId = new Map<string, string>();
  for (let i = 0; i < pbSourceIds.length; i += ID_CHUNK) {
    const { data } = await supabase
      .from("purchase_bills")
      .select("id, company_id")
      .in("id", pbSourceIds.slice(i, i + ID_CHUNK));
    for (const r of data ?? []) if (r.company_id) registeredCompanyByPbId.set(r.id, r.company_id);
  }

  const ownerByBillId = new Map<string, string>();
  for (const list of rowsByInvoice.values()) {
    const docCompanies = Array.from(
      new Set(
        list
          .map((e) => (e.source === "purchase_bill" && e.source_id ? registeredCompanyByPbId.get(e.source_id) : undefined))
          .filter((v): v is string => !!v)
      )
    );
    let owner: string | undefined;
    if (docCompanies.length === 1) {
      owner = docCompanies[0];
    } else {
      const byCompany = new Map<string, { amount: number; first: string }>();
      for (const e of list) {
        const cur = byCompany.get(e.company_id) ?? { amount: 0, first: e.created_at ?? "" };
        cur.amount += Math.abs(Number(e.total_amt ?? 0));
        const created = e.created_at ?? "";
        if (!cur.first || (created && created < cur.first)) cur.first = created;
        byCompany.set(e.company_id, cur);
      }
      owner = [...byCompany.entries()].sort((a, b) => b[1].amount - a[1].amount || a[1].first.localeCompare(b[1].first))[0]?.[0];
    }
    const finalOwner = owner ?? list[0].company_id;
    for (const e of list) ownerByBillId.set(e.id, finalOwner);
  }

  return ownerByBillId;
}

/**
 * The list-page entry point: "give me the bills this company books", where a
 * Purchase/Printing invoice that is (or was) split across companies still comes
 * back whole.
 *
 * The caller supplies its own query as `fetch`, so every page keeps ITS filters
 * (status, FY, party, limit) and this module never guesses them:
 *   • `fetch(viewCompanyIds)` — exactly the query the page already had;
 *   • `fetch(otherCompanyIds, vendorInvoiceNos)` — the SAME filters, narrowed to
 *     the invoices seen in the first result, read from the other companies.
 *
 * That second read is why this is not just "fetch every company": the page's
 * result set stays as small as before (no risk of hitting PostgREST's row cap
 * because other companies' unrelated bills came along), while the members of a
 * split invoice are always all present, so the attribution is exact.
 */
export async function fetchBillsInCompanyView<T extends BillCompanyRow>(opts: {
  supabase: Client;
  /** Companies whose ledger is on screen (usually one). */
  viewCompanyIds: string[];
  /** Every company this login can reach — the sibling read is limited to these. */
  allCompanyIds: string[];
  fetch: (companyIds: string[], vendorInvoiceNos?: string[]) => Promise<T[]>;
}): Promise<T[]> {
  const scoped = await opts.fetch(opts.viewCompanyIds);
  if (scoped.length === 0) return scoped;

  const invoices = Array.from(
    new Set(
      scoped
        .filter((r) => r.source === "purchase_bill" && (r.vendor_invoice_no ?? "").trim())
        .map((r) => (r.vendor_invoice_no as string).trim())
    )
  );
  const otherCompanyIds = opts.allCompanyIds.filter((c) => !opts.viewCompanyIds.includes(c));
  if (invoices.length === 0 || otherCompanyIds.length === 0) return scoped;

  const siblings: T[] = [];
  for (let i = 0; i < invoices.length; i += ID_CHUNK) {
    siblings.push(...(await opts.fetch(otherCompanyIds, invoices.slice(i, i + ID_CHUNK))));
  }

  const byId = new Map<string, T>();
  for (const r of scoped) byId.set(r.id, r);
  for (const r of siblings) if (!byId.has(r.id)) byId.set(r.id, r);

  const attributed = await withBillCompanyOwners(opts.supabase, [...byId.values()]);
  return attributed.filter((r) => opts.viewCompanyIds.includes(r.company_id));
}

/**
 * Convenience wrapper for list pages: the SAME rows with `company_id` set to the
 * company that books each document. Filter on company_id afterwards and a split
 * invoice can only ever appear once — in the company that registered it, with
 * its whole amount.
 */
export async function withBillCompanyOwners<T extends BillCompanyRow>(supabase: Client, rows: T[]): Promise<T[]> {
  const ownerByBillId = await resolveBillCompanyOwners(supabase, rows);
  return rows.map((r) => {
    const owner = ownerByBillId.get(r.id);
    return owner && owner !== r.company_id ? { ...r, company_id: owner } : r;
  });
}
