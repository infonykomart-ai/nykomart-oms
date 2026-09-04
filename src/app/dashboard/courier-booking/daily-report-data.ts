// Data-fetch for the Daily Shipment Report tab (EGS-integration round,
// 2026-09-04 — mirrors EGS's own Daily Shipment Report page). Server-only.
//
// HONEST SCOPE: EGS's own Daily Shipment Report has a very large column
// set (per-surcharge customs/duty breakdown, MEIS, GSTIN/IEC/PAN, terms of
// trade, etc.) that this app's schema simply doesn't capture at booking
// time (see shipment-detail-data.ts's own note on the same gap). This
// report uses ONLY columns this schema actually has — order_shipments +
// courier_shipments (the in-app booking flow) plus dispatch_invoices where
// a legacy dispatch entry exists for the same order (optional, left blank
// otherwise) — rather than padding the table with empty EGS-named columns
// this app can't populate.
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CourierKey } from "@/lib/couriers/credentials";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type DailyReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  courier?: CourierKey | "";
  status?: "pending" | "created" | "failed" | "cancelled" | "";
  destinationCountry?: string;
};

export type DailyReportRow = {
  awbNo: string | null;
  courier: CourierKey | null;
  courierBookingStatus: string;
  refNo: string;
  orderDate: string;
  bookingDate: string | null;
  marketplaceOrderNo: string | null;
  buyerNameAddress: string | null;
  contactNo: string | null;
  destinationCountry: string | null;
  skuLabel: string | null;
  qty: number;
  orderValueOriginal: number | null;
  orderCurrency: string | null;
  orderValueInr: number | null;
  bookedFreightAmt: number | null;
  bookedCurrency: string | null;
  bookedAmountSource: string | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  serviceCode: string | null;
  ddpDdu: string | null;
  deliveredStatus: string | null;
  deliveredDate: string | null;
  shipmentStatus: string;
  lastUpdateDate: string | null;
  legacyInvoiceNo: string | null;
  legacyGst18pctAmt: number | null;
};

const ROW_CAP_ONSCREEN = 500;
const ROW_CAP_EXPORT = 5000;

export async function getDailyShipmentReport(
  supabase: ServiceClient,
  companyId: string,
  filters: DailyReportFilters,
  forExport: boolean
): Promise<DailyReportRow[]> {
  let shipmentQuery = supabase
    .from("courier_shipments")
    .select("id, courier, order_id, order_shipment_id, service_code, ddp_ddu, status, awb_no, booked_amt, booked_currency, booked_amount_source, created_at")
    .order("created_at", { ascending: false })
    .limit(forExport ? ROW_CAP_EXPORT : ROW_CAP_ONSCREEN);
  if (filters.courier) shipmentQuery = shipmentQuery.eq("courier", filters.courier);
  if (filters.status) shipmentQuery = shipmentQuery.eq("status", filters.status);

  const { data: shipments } = await shipmentQuery;
  if (!shipments || shipments.length === 0) return [];

  const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));
  let orderQuery = supabase
    .from("orders")
    .select("id, ref_no, order_date, marketplace_order_no, buyer_name_address, contact_no, destination_country, sku_label, qty, order_value_original, order_currency, order_value_inr, shipment_status")
    .in("id", orderIds)
    .eq("company_id", companyId);
  if (filters.dateFrom) orderQuery = orderQuery.gte("order_date", filters.dateFrom);
  if (filters.dateTo) orderQuery = orderQuery.lte("order_date", filters.dateTo);
  if (filters.destinationCountry) orderQuery = orderQuery.eq("destination_country", filters.destinationCountry);
  const { data: orders } = await orderQuery;
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  const shipmentIds = shipments.map((s) => s.order_shipment_id).filter((id): id is string => !!id);
  const [{ data: orderShipments }, { data: packages }, { data: dispatchInvoices }] = await Promise.all([
    shipmentIds.length > 0
      ? supabase.from("order_shipments").select("id, delivered_status, delivered_date, last_update_date").in("id", shipmentIds)
      : Promise.resolve({ data: [] as { id: string; delivered_status: string | null; delivered_date: string | null; last_update_date: string | null }[] }),
    shipmentIds.length > 0
      ? supabase.from("order_packages").select("order_shipment_id, weight_kg, length_cm, width_cm, height_cm").in("order_shipment_id", shipmentIds).eq("package_no", 1)
      : Promise.resolve({ data: [] as { order_shipment_id: string; weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null }[] }),
    supabase.from("dispatch_invoices").select("order_id, invoice_no, gst_18pct_amt").in("order_id", orderIds),
  ]);
  const orderShipmentById = new Map((orderShipments ?? []).map((os) => [os.id, os]));
  const packageByShipment = new Map((packages ?? []).map((p) => [p.order_shipment_id, p]));
  const dispatchByOrder = new Map((dispatchInvoices ?? []).map((d) => [d.order_id, d]));

  const rows: DailyReportRow[] = [];
  for (const s of shipments) {
    const order = orderById.get(s.order_id);
    if (!order) continue; // filtered out by date/country, or not in this company
    const os = s.order_shipment_id ? orderShipmentById.get(s.order_shipment_id) : null;
    const pkg = s.order_shipment_id ? packageByShipment.get(s.order_shipment_id) : null;
    const dispatch = dispatchByOrder.get(s.order_id);
    rows.push({
      awbNo: s.awb_no,
      courier: s.courier as CourierKey,
      courierBookingStatus: s.status,
      refNo: order.ref_no,
      orderDate: order.order_date,
      bookingDate: s.created_at ? s.created_at.slice(0, 10) : null,
      marketplaceOrderNo: order.marketplace_order_no,
      buyerNameAddress: order.buyer_name_address,
      contactNo: order.contact_no,
      destinationCountry: order.destination_country,
      skuLabel: order.sku_label,
      qty: order.qty,
      orderValueOriginal: order.order_value_original,
      orderCurrency: order.order_currency,
      orderValueInr: order.order_value_inr,
      bookedFreightAmt: s.booked_amt,
      bookedCurrency: s.booked_currency,
      bookedAmountSource: s.booked_amount_source,
      weightKg: pkg?.weight_kg ?? null,
      lengthCm: pkg?.length_cm ?? null,
      widthCm: pkg?.width_cm ?? null,
      heightCm: pkg?.height_cm ?? null,
      serviceCode: s.service_code,
      ddpDdu: s.ddp_ddu,
      deliveredStatus: os?.delivered_status ?? null,
      deliveredDate: os?.delivered_date ?? null,
      shipmentStatus: order.shipment_status,
      lastUpdateDate: os?.last_update_date ?? null,
      legacyInvoiceNo: dispatch?.invoice_no ?? null,
      legacyGst18pctAmt: dispatch?.gst_18pct_amt ?? null,
    });
  }
  return rows;
}

const CSV_COLUMNS: { key: keyof DailyReportRow; header: string }[] = [
  { key: "awbNo", header: "AWB No." },
  { key: "courier", header: "Courier" },
  { key: "courierBookingStatus", header: "Booking Status" },
  { key: "refNo", header: "Ref No." },
  { key: "orderDate", header: "Order Date" },
  { key: "bookingDate", header: "Booking Date" },
  { key: "marketplaceOrderNo", header: "Marketplace Order No." },
  { key: "buyerNameAddress", header: "Buyer Name & Address" },
  { key: "contactNo", header: "Contact No." },
  { key: "destinationCountry", header: "Destination Country" },
  { key: "skuLabel", header: "SKU" },
  { key: "qty", header: "Qty" },
  { key: "orderValueOriginal", header: "Order Value (Original)" },
  { key: "orderCurrency", header: "Order Currency" },
  { key: "orderValueInr", header: "Order Value (INR)" },
  { key: "bookedFreightAmt", header: "Booked Freight Amt" },
  { key: "bookedCurrency", header: "Booked Currency" },
  { key: "bookedAmountSource", header: "Booked Amount Source" },
  { key: "weightKg", header: "Weight (kg)" },
  { key: "lengthCm", header: "Length (cm)" },
  { key: "widthCm", header: "Width (cm)" },
  { key: "heightCm", header: "Height (cm)" },
  { key: "serviceCode", header: "Service" },
  { key: "ddpDdu", header: "DDP/DDU" },
  { key: "deliveredStatus", header: "Delivered Status" },
  { key: "deliveredDate", header: "Delivered Date" },
  { key: "shipmentStatus", header: "Shipment Status" },
  { key: "lastUpdateDate", header: "Last Update Date" },
  { key: "legacyInvoiceNo", header: "Legacy Dispatch Invoice No." },
  { key: "legacyGst18pctAmt", header: "Legacy GST 18% Amt" },
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: DailyReportRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((row) => CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}
