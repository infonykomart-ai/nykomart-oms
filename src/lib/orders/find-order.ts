// 2026-10-22 — "order hote hue bhi order show nahi hota ... jab filter laga
// kar dekhte hai to pata chalta hai ki order hai lekin vaha dikha nahi raha".
//
// Every picker that resolves ONE order from a typed PO/RF/RG (Purchase Bill's
// PO picker, Courier Bill's "Assign / View AWBs", Stock Out / Material OUT)
// matched the column EXACTLY — `.ilike("ref_no", q)` with no wildcards — and
// read it with `.maybeSingle()`. Two consequences:
//   - a partial number, an extra space or a different case matched nothing,
//     so an order that plainly exists answered "No order found";
//   - when a ref existed more than once (the same PO number in two
//     companies), maybeSingle() returned an ERROR with `data: null`, which
//     every caller rendered as that same "not found".
//
// This resolves a reference the way the user means it: exact first (a fully
// typed number always wins), then a unique partial match on ref_no or the
// marketplace order number, and an honest "several orders match" message when
// it is genuinely ambiguous instead of pretending the order does not exist.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type OrderRefLookup =
  | { ok: true; id: string; ref_no: string }
  | { ok: false; error: string };

/**
 * Strips the characters that would break a PostgREST `or=(…)` filter string,
 * so a ref typed with a comma/parenthesis/percent can't turn the search into
 * a malformed request (which PostgREST answers with an error, i.e. an empty
 * result the UI reads as "not found").
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function resolveOrderByReference(
  supabase: Client,
  rawQuery: string,
  companyIds: string[]
): Promise<OrderRefLookup> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { ok: false, error: "Enter a PO/RF/RG number." };

  // 1) Exact ref (case-insensitive). limit(2) rather than maybeSingle() so a
  //    duplicated ref is reported as ambiguous instead of vanishing.
  const exact = await supabase
    .from("orders")
    .select("id, ref_no")
    .in("company_id", companyIds)
    .ilike("ref_no", trimmed)
    .limit(2);
  if (exact.error) return { ok: false, error: exact.error.message };
  const exactRows = exact.data ?? [];
  if (exactRows.length === 1) return { ok: true, id: exactRows[0].id, ref_no: exactRows[0].ref_no };
  if (exactRows.length > 1) {
    return {
      ok: false,
      error: `"${trimmed}" exists in more than one company — type the full PO/RF/RG number, or search by AWB where this screen offers it.`,
    };
  }

  // 2) Partial match on ref_no OR marketplace order number — "0012", "PO-12",
  //    a buyer-facing order id like "123-4567-8901".
  const safe = sanitizeSearchTerm(trimmed);
  if (safe.length < 2) return { ok: false, error: `No order found for "${trimmed}".` };
  const partial = await supabase
    .from("orders")
    .select("id, ref_no")
    .in("company_id", companyIds)
    .or(`ref_no.ilike.%${safe}%,marketplace_order_no.ilike.%${safe}%`)
    .order("ref_no")
    .limit(6);
  if (partial.error) return { ok: false, error: partial.error.message };
  const rows = partial.data ?? [];
  if (rows.length === 1) return { ok: true, id: rows[0].id, ref_no: rows[0].ref_no };
  if (rows.length === 0) return { ok: false, error: `No order found for "${trimmed}".` };
  return {
    ok: false,
    error: `${rows.length} orders match "${trimmed}" (${rows.map((r) => r.ref_no).join(", ")}) — type the full PO/RF/RG number.`,
  };
}
