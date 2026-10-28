// 2026-10-24 — one place that answers "which A4 document sheet does this
// bill_pass_register row open?" so Bill Payment, the Party Ledger and anything
// else that lists a bill number all agree.
//
// Before this, Bill Payment had its own copy of the mapping inside page.tsx
// while the Party Ledger's invoice cell always opened the generic bill
// statement — so the SAME invoice number showed a different document
// depending on which page you clicked it from. The user asked for the sheet
// to be reachable from the ledger too ("yahi sheet ledger page par bhi link
// rahe vaha se bhi nikal jaye").
//
// Source mapping (bill_pass_register.source):
//   freight_bill  -> Courier Bill report (per-AWB charges)
//   duty_tax_bill -> Duty & Tax Bill report
//   purchase_bill -> Purchase Bill sheet (every PO/item on the invoice)
//   NULL          -> a row typed straight into the ledger. Many of those are
//                    courier bills whose freight_bills record exists under the
//                    same invoice number, so a batched invoice-number lookup
//                    rescues those. Anything else has no document.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type BillDocSourceRow = {
  id: string;
  invoice_no: string | null;
  source: string | null;
  source_id: string | null;
};

/** The document path a bill row points at, or null when it has no document. */
export function docHrefFromSource(source: string | null, sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (source === "freight_bill") return `/dashboard/documents/freight-bills/${sourceId}/report`;
  if (source === "duty_tax_bill") return `/dashboard/documents/duty-bills/${sourceId}/report`;
  if (source === "purchase_bill") return `/dashboard/documents/purchase-bills/${sourceId}/report`;
  // 2026-10-28b — an office expense bill entered with a party posts to the
  // ledger (source 'office_expense', source_id = the bill's entry_group_id),
  // so its invoice number opens the bill's own A4 sheet here too.
  if (source === "office_expense") return `/dashboard/expenses/${sourceId}/report`;
  return null;
}

/** Dialog title for a resolved document path. */
export function docSheetTitle(href: string): string {
  if (href.includes("/freight-bills/")) return "Courier Bill Sheet";
  if (href.includes("/duty-bills/")) return "Duty & Tax Bill Sheet";
  if (href.includes("/dashboard/expenses/")) return "Office Expense Bill Sheet";
  return "Purchase Bill Sheet";
}

/**
 * Resolves every row's document path in ONE extra batched query at most.
 * Rows with a real source resolve locally; only the source-less rows need the
 * freight_bills invoice-number fallback. A bill without any document simply
 * gets no map entry (callers then fall back to the bill statement).
 */
export async function resolveBillDocHrefs(
  supabase: Client,
  rows: BillDocSourceRow[]
): Promise<Map<string, string>> {
  const hrefByBillId = new Map<string, string>();
  const manualInvoiceNos: string[] = [];

  for (const row of rows) {
    const href = docHrefFromSource(row.source, row.source_id);
    if (href) hrefByBillId.set(row.id, href);
    else if (!row.source && row.invoice_no) manualInvoiceNos.push(row.invoice_no);
  }

  const invoices = Array.from(new Set(manualInvoiceNos));
  if (invoices.length > 0) {
    // freight_bills.invoice_no is UNIQUE, so this is one small indexed lookup
    // for the whole page — never a query per row.
    const { data: courierBills } = await supabase
      .from("freight_bills")
      .select("id, invoice_no")
      .in("invoice_no", invoices);
    const courierIdByInvoice = new Map((courierBills ?? []).map((f) => [f.invoice_no, f.id] as const));
    for (const row of rows) {
      if (hrefByBillId.has(row.id) || row.source || !row.invoice_no) continue;
      const courierId = courierIdByInvoice.get(row.invoice_no);
      if (courierId) hrefByBillId.set(row.id, `/dashboard/documents/freight-bills/${courierId}/report`);
    }
  }

  return hrefByBillId;
}
