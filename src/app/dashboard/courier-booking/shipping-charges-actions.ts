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

/** One cell of the grid dialog: a charge head's amount for one shipment. */
export type ChargeGridLine = { chargeHead: string; amount: number; gstPct: number };

export type ChargeGridRow = {
  orderId: string;
  orderShipmentId: string | null;
  awbNo: string | null;
  courier: string;
  direction: string;
  billNo: string | null;
  billDate: string | null;
  lines: ChargeGridLine[];
};

export type ChargeGridResult = { error: string | null; inserted: number; updated: number };

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

  const row = {
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
  };

  // 2026-10-24 (2) — "DOUBLE CHARGE NAHI AAYE": the same head recorded twice
  // on the same shipment (once from this form, once from the grid, or twice
  // by hand) used to sit there as two lines and its cost was counted twice.
  // A repeat now REPLACES the existing line for that shipment + direction +
  // head instead of adding a second one.
  const existingId = await findExistingChargeLine(supabase, {
    orderId,
    orderShipmentId: row.order_shipment_id,
    awbNo: row.awb_no,
    direction: row.direction,
    chargeHead: row.charge_head,
  });

  const { error } = existingId
    ? await supabase
        .from("shipment_charge_lines")
        .update({ ...row, entered_by_employee_id: employee.id, entered_by_name: employee.name })
        .eq("id", existingId)
    : await supabase.from("shipment_charge_lines").insert({
        ...row,
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

/** The one existing line for this shipment + direction + head, if any. */
async function findExistingChargeLine(
  supabase: ReturnType<typeof createServiceRoleClient>,
  p: {
    orderId: string;
    orderShipmentId: string | null;
    awbNo: string | null;
    direction: string;
    chargeHead: string;
  }
): Promise<string | null> {
  let q = supabase
    .from("shipment_charge_lines")
    .select("id")
    .eq("order_id", p.orderId)
    .eq("direction", p.direction)
    .eq("charge_head", p.chargeHead);
  q = p.orderShipmentId ? q.eq("order_shipment_id", p.orderShipmentId) : q.is("order_shipment_id", null);
  q = p.awbNo ? q.eq("awb_no", p.awbNo) : q.is("awb_no", null);
  const { data } = await q.maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * 2026-10-24 (2) — the grid dialog's save.
 *
 * Every cell is one (shipment, head) pair, so this writes the whole grid in
 * one round-trip: an existing line for that pair is UPDATED (never a second
 * row — see the duplicate note in addShipmentCharge), a cell left blank or at
 * zero is skipped rather than saved as a zero charge or used to delete an
 * existing line behind the user's back. Company scope is verified for every
 * distinct order before anything is written, so a tampered client can't post
 * charges onto another company's shipments.
 */
export async function saveShipmentChargeGrid(rows: ChargeGridRow[]): Promise<ChargeGridResult> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "Nothing to save — enter at least one charge.", inserted: 0, updated: 0 };
  }
  if (rows.length > 100) {
    return { error: "Too many shipments in one save — save in batches of 100 or fewer.", inserted: 0, updated: 0 };
  }

  const orderIds = Array.from(new Set(rows.map((r) => r.orderId).filter(Boolean)));
  if (orderIds.length === 0) return { error: "Pick a shipment for each row.", inserted: 0, updated: 0 };

  const { data: orders } = await supabase
    .from("orders")
    .select("id, company_id, ref_no")
    .in("id", orderIds)
    .in("company_id", employee.companyIds);
  const allowed = new Set((orders ?? []).map((o) => o.id));
  const missing = orderIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    return { error: "Some selected shipments are not in a company you have access to.", inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const direction = row.direction === "return_to_india" ? "return_to_india" : "export";
    for (const line of row.lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const gstPct = Number(line.gstPct);
      if (!Number.isFinite(gstPct) || gstPct < 0 || gstPct > 100) {
        return { error: `GST % for ${line.chargeHead} must be between 0 and 100.`, inserted, updated };
      }

      const payload = {
        order_id: row.orderId,
        order_shipment_id: row.orderShipmentId || null,
        awb_no: row.awbNo || null,
        courier_name: row.courier || "FedEx",
        direction,
        charge_head: line.chargeHead,
        amount,
        gst_pct: gstPct,
        bill_no: row.billNo || null,
        bill_date: row.billDate || null,
      };

      const existingId = await findExistingChargeLine(supabase, {
        orderId: row.orderId,
        orderShipmentId: payload.order_shipment_id,
        awbNo: payload.awb_no,
        direction,
        chargeHead: line.chargeHead,
      });

      const { error } = existingId
        ? await supabase
            .from("shipment_charge_lines")
            .update({ ...payload, entered_by_employee_id: employee.id, entered_by_name: employee.name })
            .eq("id", existingId)
        : await supabase.from("shipment_charge_lines").insert({
            ...payload,
            entered_by_employee_id: employee.id,
            entered_by_name: employee.name,
          });

      if (error) {
        if (error.message.toLowerCase().includes("does not exist") || error.message.toLowerCase().includes("schema cache")) {
          return {
            error: "The charge ledger table is missing — run db/2026-10-24-shipment-charge-lines.sql in Supabase.",
            inserted,
            updated,
          };
        }
        return { error: error.message, inserted, updated };
      }
      if (existingId) updated += 1;
      else inserted += 1;
    }
  }

  revalidatePath("/dashboard/courier-booking");
  return { error: null, inserted, updated };
}
