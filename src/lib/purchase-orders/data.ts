// 2026-11-22c — Phase 3: read side of the Purchase Order module.
//
// The tables come from db/2026-11-22c-purchase-orders.sql and are not in
// src/types/database.ts (that file is regenerated), so every query here uses
// the unchecked service-role client — the same precedent the Inventory module
// set (see createServiceRoleClientUnchecked in src/lib/supabase/server.ts).
// Callers MUST have verified the employee first; every function also takes
// the caller's companyIds and scopes to them.
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { closeUpUrlsForOrder, getOrderCloseupPhotos, type CloseupPhoto } from "@/lib/orders/closeup-photos";
import { isPoStatus, PO_STATUSES, type PoStatus } from "@/lib/purchase-orders/lines";

// Re-exported so the list / detail / actions keep one import source.
export { PO_STATUSES, isPoStatus };
export type { PoStatus };

export type PurchaseOrder = {
  id: string;
  company_id: string;
  order_id: string | null;
  po_no: string;
  supplier_party_id: string | null;
  status: PoStatus;
  po_date: string;
  expected_date: string | null;
  currency: string | null;
  total_amount: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  sku_label: string | null;
  qty: number;
  unit_cost: number;
  sort_order: number;
};

export type PoListItem = PurchaseOrder & {
  orderRef: string | null;
  buyerName: string | null;
  supplierName: string | null;
  lineCount: number;
  qtyTotal: number;
  closeupCount: number;
};

export type PoLinkedOrder = {
  id: string;
  ref_no: string;
  order_date: string;
  buyer_name_address: string | null;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  order_currency: string | null;
  status: string;
  closeupCount: number;
};

type PoRow = Omit<PurchaseOrder, "total_amount"> & { total_amount: number | string };

function toPo(row: PoRow): PurchaseOrder {
  return { ...row, total_amount: Number(row.total_amount ?? 0) };
}

function toItem(row: PurchaseOrderItem & { unit_cost: number | string }): PurchaseOrderItem {
  return { ...row, unit_cost: Number(row.unit_cost ?? 0) };
}

/** Sanitise a search term for PostgREST's `or()` / `ilike` mini-language. */
function searchTerm(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/[,()%*]/g, " ").replace(/\s+/g, " ").slice(0, 60);
}

export type PoListFilters = {
  companyIds: string[];
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listPurchaseOrders(filters: PoListFilters): Promise<{
  rows: PoListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  if (!filters.companyIds.length) return { rows: [], total: 0, page, pageSize };

  const supabase = createServiceRoleClientUnchecked();
  const q = searchTerm(filters.q);

  // A PO is searchable by its own number OR by the linked order's reference.
  let orderIdsForSearch: string[] = [];
  if (q) {
    const { data: matchedOrders } = await supabase
      .from("orders")
      .select("id")
      .in("company_id", filters.companyIds)
      .or(`ref_no.ilike.%${q}%,marketplace_order_no.ilike.%${q}%`)
      .limit(200);
    orderIdsForSearch = ((matchedOrders ?? []) as { id: string }[]).map((o) => o.id);
  }

  let query = supabase
    .from("purchase_orders")
    .select("*", { count: "exact" })
    .in("company_id", filters.companyIds);

  if (isPoStatus(filters.status)) query = query.eq("status", filters.status);
  if (q) {
    const orParts = [`po_no.ilike.%${q}%`];
    if (orderIdsForSearch.length) orParts.push(`order_id.in.(${orderIdsForSearch.join(",")})`);
    query = query.or(orParts.join(","));
  }

  const { data, count, error } = await query
    .order("po_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as PoRow[]).map(toPo);
  const poIds = rows.map((r) => r.id);
  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((v): v is string => !!v)));
  const supplierIds = Array.from(
    new Set(rows.map((r) => r.supplier_party_id).filter((v): v is string => !!v))
  );

  const [itemsRes, ordersRes, suppliersRes] = await Promise.all([
    poIds.length
      ? supabase.from("purchase_order_items").select("purchase_order_id, qty").in("purchase_order_id", poIds)
      : Promise.resolve({ data: [] as { purchase_order_id: string; qty: number }[] }),
    orderIds.length
      ? supabase.from("orders").select("id, ref_no, buyer_name_address, photo_url, photo_urls").in("id", orderIds)
      : Promise.resolve({ data: [] as { id: string; ref_no: string; buyer_name_address: string | null; photo_url: string | null; photo_urls: string[] | null }[] }),
    supplierIds.length
      ? supabase.from("parties").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const itemTotals = new Map<string, { count: number; qty: number }>();
  for (const row of (itemsRes.data ?? []) as { purchase_order_id: string; qty: number }[]) {
    const current = itemTotals.get(row.purchase_order_id) ?? { count: 0, qty: 0 };
    current.count += 1;
    current.qty += Number(row.qty ?? 0);
    itemTotals.set(row.purchase_order_id, current);
  }

  const orderById = new Map(
    ((ordersRes.data ?? []) as {
      id: string;
      ref_no: string;
      buyer_name_address: string | null;
      photo_url: string | null;
      photo_urls: string[] | null;
    }[]).map((o) => [o.id, o])
  );
  const supplierById = new Map(((suppliersRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p]));

  return {
    total: count ?? rows.length,
    page,
    pageSize,
    rows: rows.map((po) => {
      const order = po.order_id ? orderById.get(po.order_id) : null;
      const totals = itemTotals.get(po.id) ?? { count: 0, qty: 0 };
      return {
        ...po,
        orderRef: order?.ref_no ?? null,
        buyerName: order?.buyer_name_address ?? null,
        supplierName: po.supplier_party_id ? supplierById.get(po.supplier_party_id)?.name ?? null : null,
        lineCount: totals.count,
        qtyTotal: totals.qty,
        closeupCount: order ? closeUpUrlsForOrder(order).length : 0,
      };
    }),
  };
}

export type PurchaseOrderDetail = {
  po: PurchaseOrder;
  items: PurchaseOrderItem[];
  order: {
    id: string;
    ref_no: string;
    order_date: string;
    status: string;
    buyer_name_address: string | null;
    contact_no: string | null;
    destination_country: string | null;
    sku_label: string | null;
    size_label: string | null;
    qty: number;
    colour: string | null;
  } | null;
  supplierName: string | null;
  companyName: string;
  companyLogoUrl: string | null;
  photos: CloseupPhoto[];
};

export async function getPurchaseOrder(
  id: string,
  companyIds: string[]
): Promise<PurchaseOrderDetail | null> {
  if (!companyIds.length) return null;
  const supabase = createServiceRoleClientUnchecked();

  const { data: poRow, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .in("company_id", companyIds)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!poRow) return null;

  const po = toPo(poRow as PoRow);

  const [itemsRes, companyRes, supplierRes, orderRes] = await Promise.all([
    supabase
      .from("purchase_order_items")
      .select("id, purchase_order_id, sku_label, qty, unit_cost, sort_order")
      .eq("purchase_order_id", po.id)
      .order("sort_order", { ascending: true }),
    supabase.from("companies").select("name, logo_url").eq("id", po.company_id).maybeSingle(),
    po.supplier_party_id
      ? supabase.from("parties").select("name").eq("id", po.supplier_party_id).maybeSingle()
      : Promise.resolve({ data: null }),
    po.order_id
      ? supabase
          .from("orders")
          .select(
            "id, ref_no, order_date, status, buyer_name_address, contact_no, destination_country, sku_label, size_label, qty, colour, photo_url, photo_urls"
          )
          .eq("id", po.order_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const order = (orderRes.data ?? null) as (PurchaseOrderDetail["order"] & {
    photo_url: string | null;
    photo_urls: string[] | null;
  }) | null;

  // The ONLY photo read path (src/lib/orders/closeup-photos.ts): typed
  // attachment rows merged with the order's own saved list.
  const photos = order ? await getOrderCloseupPhotos(order.id) : [];

  return {
    po,
    items: ((itemsRes.data ?? []) as (PurchaseOrderItem & { unit_cost: number | string })[]).map(toItem),
    order: order
      ? {
          id: order.id,
          ref_no: order.ref_no,
          order_date: order.order_date,
          status: order.status,
          buyer_name_address: order.buyer_name_address,
          contact_no: order.contact_no,
          destination_country: order.destination_country,
          sku_label: order.sku_label,
          size_label: order.size_label,
          qty: order.qty,
          colour: order.colour,
        }
      : null,
    supplierName: ((supplierRes.data ?? null) as { name: string } | null)?.name ?? null,
    companyName: ((companyRes.data ?? null) as { name: string } | null)?.name ?? "",
    companyLogoUrl: ((companyRes.data ?? null) as { logo_url: string | null } | null)?.logo_url ?? null,
    photos,
  };
}

/** Recent orders for the "linked order" picker, with their close-up count. */
export async function listOrdersForPoPicker(
  companyIds: string[],
  q?: string
): Promise<PoLinkedOrder[]> {
  if (!companyIds.length) return [];
  const supabase = createServiceRoleClientUnchecked();
  const term = searchTerm(q);

  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, order_date, buyer_name_address, sku_label, size_label, qty, order_currency, status, photo_url, photo_urls"
    )
    .in("company_id", companyIds);

  if (term) {
    query = query.or(
      `ref_no.ilike.%${term}%,marketplace_order_no.ilike.%${term}%,buyer_name_address.ilike.%${term}%`
    );
  }

  const { data, error } = await query.order("entry_timestamp", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);

  return ((data ?? []) as {
    id: string;
    ref_no: string;
    order_date: string;
    buyer_name_address: string | null;
    sku_label: string | null;
    size_label: string | null;
    qty: number;
    order_currency: string | null;
    status: string;
    photo_url: string | null;
    photo_urls: string[] | null;
  }[]).map((order) => ({
    id: order.id,
    ref_no: order.ref_no,
    order_date: order.order_date,
    buyer_name_address: order.buyer_name_address,
    sku_label: order.sku_label,
    size_label: order.size_label,
    qty: Number(order.qty ?? 0),
    order_currency: order.order_currency,
    status: order.status,
    closeupCount: closeUpUrlsForOrder(order).length,
  }));
}

export async function listSupplierOptions(companyIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!companyIds.length) return [];
  const supabase = createServiceRoleClientUnchecked();
  const { data } = await supabase.from("parties").select("id, name").order("name").limit(500);
  // parties is a shared master (no company_id) — same read the order form uses.
  void companyIds;
  return (data ?? []) as { id: string; name: string }[];
}
