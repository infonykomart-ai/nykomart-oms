"use server";

// Gap 1 (multi-package per order, 2026-08-20) — the manual entry screen
// for order_shipments (one row per real AWB) / order_packages (one row per
// physical box, FK'd to the shipment/AWB it travels under). See
// claude/gap1-multipackage-design-2026-08-20.md for the full design and
// db/2026-08-20-order-shipments-and-packages.sql for the schema. This is a
// green-field build — no prior single-order dispatch-entry UI existed to
// retrofit (confirmed by research before starting this gap).
//
// Reuses 'doc_entry' (Finance/MD/Admin) — the same capability every other
// Documents-module entry screen (Courier Bill, Duty & Tax Bill, Washing
// Data, etc.) is gated behind; this belongs alongside them.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import { revalidatePath } from "next/cache";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  return v ? Number(v) : null;
}

export type PackageRow = {
  id: string;
  package_no: number;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  remark: string | null;
};

export type ShipmentRow = {
  id: string;
  shipment_no: number;
  courier_name: string | null;
  awb_no: string | null;
  delivered_status: "Delivered" | "NOT Delivered" | null;
  delivered_date: string | null;
  remark: string | null;
  packages: PackageRow[];
};

export type OrderPackagesLookup = {
  error: string | null;
  order: { id: string; ref_no: string; company_id: string } | null;
  shipments: ShipmentRow[];
};

const EMPTY: OrderPackagesLookup = { error: null, order: null, shipments: [] };

async function fetchShipments(supabase: ServiceClient, orderId: string): Promise<ShipmentRow[]> {
  const { data: shipments } = await supabase
    .from("order_shipments")
    .select("id, shipment_no, courier_name, awb_no, delivered_status, delivered_date, remark")
    .eq("order_id", orderId)
    .order("shipment_no");
  if (!shipments || shipments.length === 0) return [];

  const { data: packages } = await supabase
    .from("order_packages")
    .select("id, order_shipment_id, package_no, weight_kg, length_cm, width_cm, height_cm, remark")
    .in(
      "order_shipment_id",
      shipments.map((s) => s.id)
    )
    .order("package_no");

  return shipments.map((s) => ({
    ...s,
    packages: (packages ?? [])
      .filter((p) => p.order_shipment_id === s.id)
      .map((p) => ({
        id: p.id,
        package_no: p.package_no,
        weight_kg: p.weight_kg != null ? Number(p.weight_kg) : null,
        length_cm: p.length_cm != null ? Number(p.length_cm) : null,
        width_cm: p.width_cm != null ? Number(p.width_cm) : null,
        height_cm: p.height_cm != null ? Number(p.height_cm) : null,
        remark: p.remark,
      })),
  }));
}

export async function lookupOrderForPackages(query: string): Promise<OrderPackagesLookup> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const trimmed = query.trim();
  if (!trimmed) return { ...EMPTY, error: "Enter a PO/RF/RG number." };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id")
    .ilike("ref_no", trimmed)
    .in("company_id", employee.companyIds)
    .maybeSingle();

  if (!order) return { ...EMPTY, error: `No order found for "${trimmed}".` };

  const shipments = await fetchShipments(supabase, order.id);
  return { error: null, order, shipments };
}

async function assertOrderAccess(supabase: ServiceClient, companyIds: string[], orderId: string): Promise<string | null> {
  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !companyIds.includes(order.company_id)) return "That order is not accessible.";
  return null;
}

export type SimpleResult = { error: string | null };

/**
 * Add or edit a shipment (AWB). shipment_no is caller-supplied (the "Add
 * shipment" button in the UI pre-fills the next free number) rather than
 * auto-incremented server-side, so an edit (same shipment_no, same
 * order_id) upserts in place instead of creating a duplicate.
 */
export async function saveOrderShipment(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  const shipmentNo = numOrNull(formData, "shipment_no");
  if (!orderId) return { error: "Missing order." };
  if (!shipmentNo || shipmentNo < 1) return { error: "Shipment No. must be a positive number." };

  const accessError = await assertOrderAccess(supabase, employee.companyIds, orderId);
  if (accessError) return { error: accessError };

  const { error } = await supabase.from("order_shipments").upsert(
    {
      order_id: orderId,
      shipment_no: shipmentNo,
      courier_name: strOrNull(formData, "courier_name"),
      awb_no: strOrNull(formData, "awb_no"),
      delivered_status: (strOrNull(formData, "delivered_status") as "Delivered" | "NOT Delivered" | null) ?? null,
      delivered_date: strOrNull(formData, "delivered_date"),
      remark: strOrNull(formData, "remark"),
      created_by_employee_id: employee.id,
    },
    { onConflict: "order_id,shipment_no" }
  );
  if (error) return { error: error.message };

  await resyncDispatchSummary(supabase, orderId);
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/orders");
  return { error: null };
}

export async function deleteOrderShipment(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: shipment } = await supabase.from("order_shipments").select("id, order_id").eq("id", id).maybeSingle();
  if (!shipment) return { error: "Shipment not found." };
  const accessError = await assertOrderAccess(supabase, employee.companyIds, shipment.order_id);
  if (accessError) return { error: accessError };

  // A shipment already billed (freight_bill_awb_assignments/duty_bill_awb_assignments
  // reference it via order_shipment_id) or already matched by a courier
  // webhook shouldn't silently vanish — block the delete instead of letting
  // the FK constraint throw an opaque error.
  const { data: freightAssignment } = await supabase.from("freight_bill_awb_assignments").select("id").eq("order_shipment_id", id).maybeSingle();
  if (freightAssignment) return { error: "This shipment/AWB is already billed on a Courier Bill — remove that assignment first." };
  const { data: dutyAssignment } = await supabase.from("duty_bill_awb_assignments").select("id").eq("order_shipment_id", id).maybeSingle();
  if (dutyAssignment) return { error: "This shipment/AWB is already billed on a Duty & Tax Bill — remove that assignment first." };

  const { error: pkgError } = await supabase.from("order_packages").delete().eq("order_shipment_id", id);
  if (pkgError) return { error: pkgError.message };
  const { error } = await supabase.from("order_shipments").delete().eq("id", id);
  if (error) return { error: error.message };

  await resyncDispatchSummary(supabase, shipment.order_id);
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/orders");
  return { error: null };
}

export async function saveOrderPackage(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const orderShipmentId = str(formData, "order_shipment_id");
  const packageNo = numOrNull(formData, "package_no");
  if (!orderShipmentId) return { error: "Missing shipment." };
  if (!packageNo || packageNo < 1) return { error: "Package No. must be a positive number." };

  const { data: shipment } = await supabase.from("order_shipments").select("id, order_id").eq("id", orderShipmentId).maybeSingle();
  if (!shipment) return { error: "Shipment not found." };
  const accessError = await assertOrderAccess(supabase, employee.companyIds, shipment.order_id);
  if (accessError) return { error: accessError };

  const { error } = await supabase.from("order_packages").upsert(
    {
      order_shipment_id: orderShipmentId,
      package_no: packageNo,
      weight_kg: numOrNull(formData, "weight_kg"),
      length_cm: numOrNull(formData, "length_cm"),
      width_cm: numOrNull(formData, "width_cm"),
      height_cm: numOrNull(formData, "height_cm"),
      remark: strOrNull(formData, "remark"),
    },
    { onConflict: "order_shipment_id,package_no" }
  );
  if (error) return { error: error.message };

  await resyncDispatchSummary(supabase, shipment.order_id);
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/orders");
  return { error: null };
}

export async function deleteOrderPackage(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: pkg } = await supabase.from("order_packages").select("id, order_shipment_id").eq("id", id).maybeSingle();
  if (!pkg) return { error: "Package not found." };
  const { data: shipment } = await supabase.from("order_shipments").select("id, order_id").eq("id", pkg.order_shipment_id).maybeSingle();
  if (!shipment) return { error: "Shipment not found." };
  const accessError = await assertOrderAccess(supabase, employee.companyIds, shipment.order_id);
  if (accessError) return { error: accessError };

  const { error } = await supabase.from("order_packages").delete().eq("id", id);
  if (error) return { error: error.message };

  await resyncDispatchSummary(supabase, shipment.order_id);
  revalidatePath("/dashboard/order-packages");
  revalidatePath("/dashboard/orders");
  return { error: null };
}
