"use server";

// Vendor Assignment history (2026-09-08) — "order fill hone ke baad, ek
// alag section — kis party ko order diya aur kis date ko; jab order wapas
// aaye to received mark karne ka option; agar party se galat order ho jaye
// to usko dobara assign bhi kar sake". This is a NEW, separate section from
// the existing "Purchasing From (if known)" `vendor_party_id` select on the
// order-creation/edit forms (order-form.tsx / order-edit-form.tsx) — that
// select stays exactly as-is, an optional convenience at entry time. This
// file is the full multi-cycle assign -> receive -> (if wrong) reassign
// history, backed by order_vendor_assignments — see
// db/2026-09-08-order-address-fields-and-vendor-assignments.sql for the
// schema and the full rationale.
//
// orders.vendor_party_id / vendor_date / received_date are kept mirrored to
// the LATEST cycle by the two mutations below (createVendorAssignment,
// markVendorAssignmentReceived) — both as sequential awaited writes in the
// same server action, no client-side race — so every existing report/
// purchase-bill form/order-list filter that already reads
// orders.vendor_party_id (~20 files, confirmed by grep before writing this)
// keeps seeing "the order's current vendor" correctly, and vendor_date/
// received_date (previously dead columns — zero usages anywhere) finally
// get populated instead of sitting unused.
//
// Gated behind the existing "order_entry" capability — same one
// updateOrder/deleteOrder/holdOrder/etc. in ./actions.ts already require for
// editing an order. No new capability needed: assigning/receiving a vendor
// cycle is just another facet of managing an order, and every role that can
// already edit an order can already reach this action's data.
import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const CAPABILITY = "order_entry";

export type VendorAssignmentCycle = {
  id: string;
  cycle_no: number;
  party_id: string;
  party_name: string;
  assigned_date: string;
  received_date: string | null;
  remark: string | null;
};

export type VendorAssignmentResult = { error: string | null; success: boolean };

/**
 * Full assign/receive history for one order, newest cycle first. Returns []
 * (rather than throwing) when the order doesn't exist or isn't in one of
 * this employee's companies — same "quietly show nothing" behavior the rest
 * of this page already has for company-scoped data, since this is a read
 * used directly from a Server Component render.
 */
export async function listVendorAssignments(orderId: string): Promise<VendorAssignmentCycle[]> {
  const employee = await requireCapability(CAPABILITY);
  const supabase = createServiceRoleClient();

  if (!orderId) return [];

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) return [];

  const { data: rows } = await supabase
    .from("order_vendor_assignments")
    .select("id, cycle_no, party_id, assigned_date, received_date, remark")
    .eq("order_id", orderId)
    .order("cycle_no", { ascending: false });

  if (!rows || rows.length === 0) return [];

  // Plain follow-up query for party names rather than an embedded-resource
  // join (`parties(name)`) — same reasoning as getAuthedEmployee's own
  // comment on this: the hand-rolled Database type doesn't emit
  // Relationships metadata precise enough for every join shape, so plain
  // queries are used everywhere in this codebase instead.
  const partyIds = Array.from(new Set(rows.map((r) => r.party_id)));
  const { data: parties } = await supabase.from("parties").select("id, name").in("id", partyIds);
  const nameById = new Map((parties ?? []).map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    id: r.id,
    cycle_no: r.cycle_no,
    party_id: r.party_id,
    party_name: nameById.get(r.party_id) ?? "—",
    assigned_date: r.assigned_date,
    received_date: r.received_date,
    remark: r.remark,
  }));
}

/**
 * Records a new assign cycle (either the order's first vendor assignment,
 * or a reassignment after a previous vendor got the order wrong). cycle_no
 * is max-existing+1 (or 1 for the first cycle on this order) — same pattern
 * as order_shipments.shipment_no elsewhere in this codebase.
 *
 * Design choice: orders.received_date is cleared to NULL here. A fresh
 * cycle means the order is, right now, out with a vendor and NOT received
 * — carrying forward a previous cycle's received_date onto a brand new,
 * unreceived cycle would make every report reading orders.received_date
 * (the "is this order currently received" mirror) lie. If a vendor cycle
 * needs re-marking received after being reassigned by mistake, that's what
 * markVendorAssignmentReceived is for.
 */
export async function createVendorAssignment(
  orderId: string,
  partyId: string,
  assignedDate: string,
  remark?: string | null
): Promise<VendorAssignmentResult> {
  const employee = await requireCapability(CAPABILITY);
  const supabase = createServiceRoleClient();
  return assignOneVendorCore(employee, supabase, { orderId, partyId, assignedDate, remark });
}

export type BulkVendorAssignRowResult = { label: string; ok: boolean; error: string | null };

/**
 * 2026-09-13 — checkbox bulk assign. "order ko check box se select kar ke
 * vendor assign kar sake": the Orders hub's existing per-row checkboxes
 * (already there for Print Selected) now also drive a Party + Date bar —
 * one action assigns EVERY selected order, creating the same per-order
 * assignment cycle the single-order button creates, so history/remark/
 * receive-marking all behave identically afterwards. This is the same
 * operation the bulk CSV page performs, just selected on-screen instead
 * of uploaded — orders not in the caller's companies are reported per-row
 * rather than failing the whole batch.
 */
export async function bulkAssignVendorsToOrders(
  orderIds: string[],
  partyId: string,
  assignedDate: string,
  remark?: string | null
): Promise<{ error: string | null; results: BulkVendorAssignRowResult[] }> {
  const employee = await requireCapability(CAPABILITY);
  const supabase = createServiceRoleClient();

  if (!partyId) return { error: "Pick a party to assign.", results: [] };
  if (!assignedDate) return { error: "Assigned date is required.", results: [] };
  const ids = Array.from(new Set((orderIds ?? []).filter(Boolean)));
  if (ids.length === 0) return { error: "Select at least one order.", results: [] };

  // One query for every requested order instead of one per id — same
  // company-scope guard createVendorAssignment applies individually.
  const { data: orders } = await supabase.from("orders").select("id, ref_no, company_id").in("id", ids);
  const byId = new Map((orders ?? []).map((o) => [o.id, o]));

  const results: BulkVendorAssignRowResult[] = [];
  for (const id of ids) {
    const order = byId.get(id);
    if (!order || !employee.companyIds.includes(order.company_id)) {
      results.push({ label: order?.ref_no ?? id.slice(0, 8), ok: false, error: "not found / no access" });
      continue;
    }
    const res = await assignOneVendorCore(employee, supabase, { orderId: id, partyId, assignedDate, remark });
    results.push({ label: order.ref_no ?? id.slice(0, 8), ok: res.success, error: res.error });
  }

  revalidatePath("/dashboard/orders");
  return { error: null, results };
}

/**
 * Marks one assignment cycle received. The child row (order_vendor_
 * assignments.received_date) is always set regardless — that's the
 * authoritative history and correcting/backfilling an old cycle's received
 * date should still work. The mirror onto orders.received_date, though, is
 * guarded: it only fires when this cycle is the CURRENT one (highest
 * cycle_no for the order). Without that guard, marking an old, already-
 * superseded cycle received from a stale UI tab could clobber
 * orders.received_date with a stale date even though a newer reassignment
 * cycle is the one actually in flight now.
 */
export async function markVendorAssignmentReceived(
  assignmentId: string,
  orderId: string,
  receivedDate: string
): Promise<VendorAssignmentResult> {
  const employee = await requireCapability(CAPABILITY);
  const supabase = createServiceRoleClient();

  if (!assignmentId || !orderId || !receivedDate) {
    return { error: "Received date is required.", success: false };
  }

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }

  const { data: assignment } = await supabase
    .from("order_vendor_assignments")
    .select("id, order_id, cycle_no")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment || assignment.order_id !== orderId) {
    return { error: "This assignment cycle was not found on this order.", success: false };
  }

  const { error: updateError } = await supabase
    .from("order_vendor_assignments")
    .update({ received_date: receivedDate, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (updateError) return { error: updateError.message, success: false };

  const { data: latest } = await supabase
    .from("order_vendor_assignments")
    .select("cycle_no")
    .eq("order_id", orderId)
    .order("cycle_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const isCurrentCycle = latest?.cycle_no === assignment.cycle_no;

  if (isCurrentCycle) {
    const { error: mirrorError } = await supabase.from("orders").update({ received_date: receivedDate }).eq("id", orderId);
    if (mirrorError) return { error: mirrorError.message, success: false };
  }

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  return { error: null, success: true };
}

/**
 * The single write path every assign flow now shares — the single-order
 * button, the Orders-hub checkbox bulk action, and the bulk CSV page all
 * produce IDENTICAL rows: next cycle_no, assignment history row, then the
 * 3-column mirror onto orders (vendor_party_id/vendor_date/received_date
 * reset). Extracted 2026-09-13 so the checkbox bulk action
 * (bulkAssignVendorsToOrders) could reuse the exact semantics instead of
 * a second hand-copied insert drifting out of sync over time.
 */
async function assignOneVendorCore(
  employee: AuthedEmployee,
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: { orderId: string; partyId: string; assignedDate: string; remark?: string | null }
): Promise<VendorAssignmentResult> {
  const { orderId, partyId, assignedDate, remark } = args;
  if (!orderId || !partyId || !assignedDate) {
    return { error: 'Party and assigned date are required.', success: false };
  }

  const { data: order } = await supabase.from('orders').select('id, company_id').eq('id', orderId).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }

  const { data: existing } = await supabase
    .from('order_vendor_assignments')
    .select('cycle_no')
    .eq('order_id', orderId)
    .order('cycle_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextCycleNo = (existing?.cycle_no ?? 0) + 1;

  const { error: insertError } = await supabase.from('order_vendor_assignments').insert({
    order_id: orderId,
    cycle_no: nextCycleNo,
    party_id: partyId,
    assigned_date: assignedDate,
    remark: remark && remark.trim() ? remark.trim() : null,
    created_by_employee_id: employee.id,
  });
  if (insertError) return { error: insertError.message, success: false };

  // Mirror onto orders — sequential awaited write in this same server
  // action (no client-side race): this new cycle is now the latest one, so
  // it becomes "the order's current vendor" for every existing report/
  // purchase-bill form/list filter that reads these 3 columns.
  const { error: mirrorError } = await supabase
    .from('orders')
    .update({ vendor_party_id: partyId, vendor_date: assignedDate, received_date: null })
    .eq('id', orderId);
  if (mirrorError) return { error: mirrorError.message, success: false };

  revalidatePath(`/dashboard/orders/${orderId}`);
  return { error: null, success: true };
}
