// Data-fetch for the "Pending Orders" tab (EGS-integration round,
// 2026-09-04 — mirrors EGS's own "Pending Orders" / /shipment page: a
// staging list of orders that still need a courier AWB). Same
// server-only, no "use server" pattern as tracking-data.ts (a read, not a
// bound Server Action).
//
// "Pending" here = order.status not Cancelled/Returned/Hold AND no
// courier_shipments row with status='created' yet for that order — i.e.
// genuinely not yet booked with any courier. Hold orders are deliberately
// excluded (an order on Hold isn't ready to stage for shipping) — this is
// an engineering judgment call, not a guessed business rule; flagged here
// and in the round writeup for the user to correct if wrong.
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/orders/find-order";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type PendingOrderRow = {
  id: string;
  refNo: string;
  refNoBase: string;
  orderDate: string;
  estimatedDispatchDate: string | null;
  marketplaceOrderNo: string | null;
  buyerNameAddress: string | null;
  contactNo: string | null;
  emailId: string | null;
  destinationCountry: string | null;
  skuLabel: string | null;
  qty: number;
  orderValueInr: number | null;
  status: string;
  dueBucket: "overdue" | "due_soon" | "later" | "unknown";
  // 2026-09-09 — pre-booking weight/dims estimate (orders.weight_kg/
  // length_cm/width_cm/height_cm — see db/2026-09-09-order-weight-dims-
  // bulk.sql). Surfaced here so the new Bulk Update Weight/Dims modal
  // (pending-orders.tsx) can prefill each selected row with whatever's
  // already on file instead of always starting blank.
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
};

export type PendingOrdersFilters = {
  dateFrom?: string;
  dateTo?: string;
  q?: string; // matches Ref No., Marketplace Order No., buyer name, or contact no.
  destinationCountry?: string;
  due?: "overdue" | "due_soon" | "later" | "";
};

const MAX_ROWS = 300;

/** Local-midnight ISO date (yyyy-mm-dd) — the same clock computeDueBucket
 *  compares with, so the SQL filter and the badge can never disagree. */
function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function computeDueBucket(estimatedDispatchDate: string | null): PendingOrderRow["dueBucket"] {
  if (!estimatedDispatchDate) return "unknown";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dispatchDate = new Date(estimatedDispatchDate);
  const diffDays = Math.round((dispatchDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 2) return "due_soon";
  return "later";
}

export async function getPendingOrders(
  supabase: ServiceClient,
  companyIds: string[],
  companyId: string,
  filters: PendingOrdersFilters
): Promise<PendingOrderRow[]> {
  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, ref_no_base, order_date, estimated_dispatch_date, marketplace_order_no, buyer_name_address, contact_no, email_id, destination_country, sku_label, qty, order_value_inr, status, weight_kg, length_cm, width_cm, height_cm"
    )
    .eq("company_id", companyId)
    .not("status", "in", "(Cancelled,Returned,Hold)")
    .order("order_date", { ascending: false })
    .limit(MAX_ROWS);

  if (filters.dateFrom) query = query.gte("order_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("order_date", filters.dateTo);
  if (filters.destinationCountry) query = query.eq("destination_country", filters.destinationCountry);

  // 2026-10-22 — "order hote hue bhi order show nahi hota ... jab filter laga
  // kar dekhte hai to pata chalta hai ki order hai": the search term and the
  // Due filter were applied in JS AFTER `.limit(MAX_ROWS)`, so they only ever
  // looked at the newest 300 orders of this company. An older order was
  // invisible to search, while a date/destination filter (which narrows in
  // the database) pulled it back into that window — exactly the reported
  // symptom. Both conditions now narrow the QUERY, so the search covers every
  // pending order rather than the newest page of them.
  const searchTerm = filters.q ? sanitizeSearchTerm(filters.q) : "";
  if (searchTerm) {
    query = query.or(
      `ref_no.ilike.%${searchTerm}%,marketplace_order_no.ilike.%${searchTerm}%,buyer_name_address.ilike.%${searchTerm}%,contact_no.ilike.%${searchTerm}%`
    );
  }
  if (filters.due) {
    // Same boundaries computeDueBucket uses below: overdue = before today,
    // due_soon = today..today+2, later = after today+2.
    const todayIso = isoDateLocal(new Date());
    const soonIso = isoDateLocal(addDays(new Date(), 2));
    if (filters.due === "overdue") query = query.not("estimated_dispatch_date", "is", null).lt("estimated_dispatch_date", todayIso);
    else if (filters.due === "due_soon") query = query.gte("estimated_dispatch_date", todayIso).lte("estimated_dispatch_date", soonIso);
    else if (filters.due === "later") query = query.gt("estimated_dispatch_date", soonIso);
  }

  const { data: orders } = await query;
  if (!orders || orders.length === 0) return [];

  // Exclude orders already booked ("created") with any courier — the
  // whole point of this list is "still needs an AWB".
  const orderIds = orders.map((o) => o.id);
  const { data: booked } = await supabase
    .from("courier_shipments")
    .select("order_id")
    .in("order_id", orderIds)
    .eq("status", "created");
  const bookedIds = new Set((booked ?? []).map((b) => b.order_id));

  const q = filters.q?.trim().toLowerCase();
  const rows: PendingOrderRow[] = [];
  for (const o of orders) {
    if (bookedIds.has(o.id)) continue;
    if (q) {
      const haystack = `${o.ref_no ?? ""} ${o.marketplace_order_no ?? ""} ${o.buyer_name_address ?? ""} ${o.contact_no ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    const dueBucket = computeDueBucket(o.estimated_dispatch_date);
    if (filters.due && filters.due !== dueBucket) continue;
    rows.push({
      id: o.id,
      refNo: o.ref_no,
      refNoBase: o.ref_no_base ?? o.ref_no,
      orderDate: o.order_date,
      estimatedDispatchDate: o.estimated_dispatch_date,
      marketplaceOrderNo: o.marketplace_order_no,
      buyerNameAddress: o.buyer_name_address,
      contactNo: o.contact_no,
      emailId: o.email_id,
      destinationCountry: o.destination_country,
      skuLabel: o.sku_label,
      qty: o.qty,
      orderValueInr: o.order_value_inr,
      status: o.status,
      dueBucket,
      weightKg: o.weight_kg != null ? Number(o.weight_kg) : null,
      lengthCm: o.length_cm != null ? Number(o.length_cm) : null,
      widthCm: o.width_cm != null ? Number(o.width_cm) : null,
      heightCm: o.height_cm != null ? Number(o.height_cm) : null,
    });
  }
  return rows;
}

// Buyer-batch grouping (Combine view) — same unit the Invoice Generation
// module already groups by (company_id, store_id, ref_no_base); here just
// (company scoped already) ref_no_base, since this list is single-company.
export type PendingOrderBatch = { refNoBase: string; orders: PendingOrderRow[] };

export function groupIntoBatches(rows: PendingOrderRow[]): PendingOrderBatch[] {
  const byBase = new Map<string, PendingOrderRow[]>();
  for (const row of rows) {
    const list = byBase.get(row.refNoBase) ?? [];
    list.push(row);
    byBase.set(row.refNoBase, list);
  }
  return Array.from(byBase.entries()).map(([refNoBase, batchOrders]) => ({ refNoBase, orders: batchOrders }));
}
