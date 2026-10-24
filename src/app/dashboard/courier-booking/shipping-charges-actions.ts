"use server";

// 2026-10-24 — actions behind the Courier Ops "Charges" tab.
//
// The user's ask was explicit about HOW the charge should be found before it
// is added: "AWB, PO NO RF NO RG NO ya jo bhi apna system hai ke anusar
// search ho or add ho". So search resolves a shipment from any of the numbers
// people actually have in hand — the PO/RF/RG ref, the marketplace order no.,
// the AWB, or the dispatch invoice no. — and returns the shipments that
// match, each carrying its own AWB so the charge is attached to the right
// parcel (an order can now have several shipments).
//
// Writes are capability-checked here (never trusted from the client) and
// company-scoped: the order must belong to a company this login can access.
import { revalidatePath } from "next/cache";
import { requireCapability, getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type ChargeTarget = {
  orderId: string;
  refNo: string;
  awbNo: string | null;
  orderShipmentId: string | null;
  courier: string | null;
  country: string | null;
  status: string | null;
};

export type ChargeActionResult = { error: string | null; success: boolean };

const MAX_TARGETS = 20;

export async function searchShipmentTargets(query: string): Promise<ChargeTarget[]> {
  const employee = await requireCapability("courier_booking_shipment");
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = createServiceRoleClient();
  const like = `%${q}%`;

  // Three independent lookups, because the number in hand can be any of them.
  const [{ data: byRef }, { data: byAwb }, { data: byInvoice }] = await Promise.all([
    supabase
      .from("orders")
      .select("id")
      .in("company_id", employee.companyIds)
      .or(`ref_no.ilike.${like},marketplace_order_no.ilike.${like}`)
      .limit(MAX_TARGETS),
    supabase.from("order_shipments").select("order_id").ilike("awb_no", like).limit(MAX_TARGETS),
    supabase.from("dispatch_invoices").select("order_id").ilike("invoice_no", like).limit(MAX_TARGETS),
  ]);

  const orderIds = Array.from(
    new Set([
      ...(byRef ?? []).map((o) => o.id),
      ...(byAwb ?? []).map((s) => s.order_id),
      ...(byInvoice ?? []).map((d) => d.order_id),
    ])
  ).slice(0, MAX_TARGETS);
  if (orderIds.length === 0) return [];

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, ref_no, status, company_id, buyer_country, destination_country, order_shipments(id, awb_no, courier_name, created_at)"
    )
    .in("id", orderIds)
    .in("company_id", employee.companyIds)
    .order("ref_no", { ascending: true });

  const targets: ChargeTarget[] = [];
  for (const o of orders ?? []) {
    const shipments = ((o.order_shipments ?? []) as { id: string; awb_no: string | null; courier_name: string | null }[])
      .slice()
      .sort((a, b) => (a.awb_no ?? "").localeCompare(b.awb_no ?? ""));
    const base = {
      orderId: o.id,
      refNo: o.ref_no,
      country: o.destination_country || o.buyer_country || null,
      status: o.status,
    };
    if (shipments.length === 0) {
      targets.push({ ...base, awbNo: null, orderShipmentId: null, courier: null });
    } else {
      for (const s of shipments) {
        targets.push({ ...base, awbNo: s.awb_no, orderShipmentId: s.id, courier: s.courier_name });
      }
    }
  }
  return targets;
}

export async function addShipmentCharge(_prev: ChargeActionResult, formData: FormData): Promise<ChargeActionResult> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = String(formData.get("order_id") ?? "").trim();
  const chargeHead = String(formData.get("charge_head") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountRaw);
  if (!orderId) return { error: "Pick a shipment first — search by PO / RF / RG / AWB above.", success: false };
  if (!chargeHead) return { error: "Choose a charge head.", success: false };
  if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
    return { error: "Enter a charge amount greater than zero.", success: false };
  }

  // Re-check company scope on the ORDER (a tampered form can't attach a
  // charge to another company's shipment).
  const { data: order } = await supabase
    .from("orders")
    .select("id, company_id, ref_no")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "That order is not in a company you have access to.", success: false };
  }

  const gstRaw = String(formData.get("gst_pct") ?? "18").trim();
  const gstPct = gstRaw === "" ? 18 : Number(gstRaw);
  if (Number.isNaN(gstPct) || gstPct < 0 || gstPct > 100) {
    return { error: "GST % must be between 0 and 100.", success: false };
  }

  const direction = String(formData.get("direction") ?? "export");
  const shipmentId = String(formData.get("order_shipment_id") ?? "").trim();
  const awbNo = String(formData.get("awb_no") ?? "").trim();
  const billDate = String(formData.get("bill_date") ?? "").trim();

  const { error } = await supabase.from("shipment_charge_lines").insert({
    order_id: orderId,
    order_shipment_id: shipmentId || null,
    awb_no: awbNo || null,
    courier_name: String(formData.get("courier_name") ?? "FedEx").trim() || "FedEx",
    direction: direction === "return_to_india" ? "return_to_india" : "export",
    charge_head: chargeHead,
    amount,
    gst_pct: gstPct,
    bill_no: String(formData.get("bill_no") ?? "").trim() || null,
    bill_date: billDate || null,
    remark: String(formData.get("remark") ?? "").trim() || null,
    entered_by_employee_id: employee.id,
    entered_by_name: employee.name,
  });

  if (error) {
    // Missing table = the migration hasn't been run. Say so plainly instead
    // of surfacing a raw PostgREST error nobody can act on.
    if (error.message.toLowerCase().includes("does not exist") || error.message.toLowerCase().includes("schema cache")) {
      return {
        error: "The charge ledger table is missing — run db/2026-10-24-shipment-charge-lines.sql in Supabase.",
        success: false,
      };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}

export async function deleteShipmentCharge(formData: FormData): Promise<void> {
  const employee = await getAuthedEmployee();
  if (!employee.capabilities.includes("courier_booking_shipment")) {
    throw new Error('Your role does not have the "courier_booking_shipment" capability.');
  }
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const supabase = createServiceRoleClient();

  // Only delete a line whose order is in scope for this login.
  const { data: line } = await supabase
    .from("shipment_charge_lines")
    .select("id, order_id, orders(company_id)")
    .eq("id", id)
    .maybeSingle();
  const companyId = (line?.orders as unknown as { company_id: string } | null)?.company_id;
  if (!line || !companyId || !employee.companyIds.includes(companyId)) return;

  await supabase.from("shipment_charge_lines").delete().eq("id", id);
  revalidatePath("/dashboard/courier-booking");
}
