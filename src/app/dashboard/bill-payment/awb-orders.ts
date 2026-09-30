// Shared AWB → order resolver helpers (2026-09-30) — "courier party ka
// credit note direct couriour se aata hai ... lekin usme kon konse order
// PO/RG/RF ke against me AWB hai".
//
// Deliberately a PLAIN module, not part of credit-note-actions.ts: that
// file is a "use server" module, and Next.js/Turbopack requires every
// runtime export of such a file to be an async function (the build fails
// with "Server Actions must be async functions" otherwise). These helpers
// are imported by the actions file internally; client code reaches them
// only through the async resolveAwbOrders action.
import { createServiceRoleClient } from "@/lib/supabase/server";

/** Free-typed AWB list ("A, B\nC") → deduped, trimmed tokens (min 5 chars, max 50). */
export function normalizeAwbList(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[\s,;]+/)
        .map((a) => a.trim())
        .filter((a) => a.length >= 5)
    )
  ).slice(0, 50);
}

/**
 * AWB → "PO-26-27-0123 (Nyko Mart)" map, resolved through order_shipments →
 * orders (ref_no IS the PO/RF/RG number) → companies. An AWB shared by more
 * than one order joins its lines with " / ". Server-side only (needs a
 * service-role client) — pass the caller's own client in.
 */
export async function fetchAwbOrderMap(
  supabase: ReturnType<typeof createServiceRoleClient>,
  awbs: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (awbs.length === 0) return map;
  const { data: ships } = await supabase
    .from("order_shipments")
    .select("awb_no, order_id")
    .in("awb_no", awbs);
  const orderIds = Array.from(new Set((ships ?? []).map((s) => s.order_id)));
  const { data: ords } = orderIds.length
    ? await supabase.from("orders").select("id, ref_no, company_id").in("id", orderIds)
    : { data: [] };
  const companyIds = Array.from(new Set((ords ?? []).map((o) => o.company_id)));
  const { data: comps } = companyIds.length
    ? await supabase.from("companies").select("id, name").in("id", companyIds)
    : { data: [] };
  const ordById = new Map((ords ?? []).map((o) => [o.id, o] as const));
  const compName = new Map((comps ?? []).map((c) => [c.id, c.name] as const));
  for (const s of ships ?? []) {
    if (!s.awb_no) continue; // nullable column — rows without an AWB can't be matched
    const o = ordById.get(s.order_id);
    if (!o) continue;
    const line = `${o.ref_no ?? "?"}${o.company_id ? ` (${compName.get(o.company_id) ?? "?"})` : ""}`;
    const prev = map.get(s.awb_no);
    map.set(s.awb_no, prev ? `${prev} / ${line}` : line);
  }
  return map;
}
