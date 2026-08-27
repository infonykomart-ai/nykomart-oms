"use server";

// Approvals L1/L2 (round 11) — see db/2026-08-12-round11-unbuilt-dashboard-
// sections.sql's header comment: this workflow never existed anywhere
// before (old system nor current schema until this migration), so it's a
// genuine new design, not a port. Kept to the simplest 2-level chain that
// matches the 2 capability names + the existing role_capabilities seed
// (Higher Authority has approve_level1, MD has approve_level2 — i.e. L1 is
// a first pass, L2 is the final sign-off, which is exactly what's built
// here): Pending -> (L1 approves) -> Approved L1 -> (L2 approves) ->
// Approved L2. Either level can Reject instead of approving.
//
// 2026-08-27 — "approval me bhi ek bill ki 4 entry ja rahi item ke
// according jo galat hai na": a multi-item/multi-order Purchase Bill
// mirrors N bill_pass_register rows (one per item/order) for what's really
// ONE vendor invoice. approve/reject now take a comma-joined `bill_ids`
// list (see src/lib/bill-grouping.ts) instead of a single `bill_id`, and
// apply the status change to every row in the group ATOMICALLY — all rows
// are validated first (same company access, same current status) before
// any row is updated, so a grouped invoice can never end up half-approved.
// A single ungrouped bill still works exactly the same way: `bill_ids` is
// just a length-1 list.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ApprovalActionState = { error: string | null; success: boolean };

function parseBillIds(formData: FormData): string[] {
  const raw = String(formData.get("bill_ids") ?? formData.get("bill_id") ?? "");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function approveLevel1(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const employee = await requireCapability("approve_level1");
  const supabase = createServiceRoleClient();
  const billIds = parseBillIds(formData);
  if (billIds.length === 0) return { error: "Bill not specified.", success: false };

  const { data: bills } = await supabase.from("bill_pass_register").select("id, company_id, approval_status").in("id", billIds);
  if (!bills || bills.length !== billIds.length) return { error: "One or more entries in this group were not found — refresh and try again.", success: false };
  for (const bill of bills) {
    if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };
    if (bill.approval_status !== "Pending") {
      return { error: `This entry (or part of it) is already "${bill.approval_status}" — refresh and try again.`, success: false };
    }
  }

  const { data: updated, error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Approved L1", approved_l1_by: employee.id, approved_l1_at: new Date().toISOString() })
    .in("id", billIds)
    .eq("approval_status", "Pending") // second guard against a race with another L1 approver
    .select("id");
  if (error) return { error: error.message, success: false };
  if ((updated ?? []).length !== billIds.length) {
    return { error: "Part of this group changed status just now (another approver?) — refresh and check before retrying.", success: false };
  }

  revalidatePath("/dashboard/approvals/l1");
  return { error: null, success: true };
}

export async function approveLevel2(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const employee = await requireCapability("approve_level2");
  const supabase = createServiceRoleClient();
  const billIds = parseBillIds(formData);
  if (billIds.length === 0) return { error: "Bill not specified.", success: false };

  const { data: bills } = await supabase.from("bill_pass_register").select("id, company_id, approval_status").in("id", billIds);
  if (!bills || bills.length !== billIds.length) return { error: "One or more entries in this group were not found — refresh and try again.", success: false };
  for (const bill of bills) {
    if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };
    if (bill.approval_status !== "Approved L1") {
      return { error: `This entry (or part of it) is "${bill.approval_status}" — it needs L1 approval first.`, success: false };
    }
  }

  const { data: updated, error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Approved L2", approved_l2_by: employee.id, approved_l2_at: new Date().toISOString() })
    .in("id", billIds)
    .eq("approval_status", "Approved L1")
    .select("id");
  if (error) return { error: error.message, success: false };
  if ((updated ?? []).length !== billIds.length) {
    return { error: "Part of this group changed status just now (another approver?) — refresh and check before retrying.", success: false };
  }

  revalidatePath("/dashboard/approvals/l2");
  return { error: null, success: true };
}

export async function rejectBill(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const level = String(formData.get("level") ?? "");
  const capability = level === "2" ? "approve_level2" : "approve_level1";
  const employee = await requireCapability(capability);
  const supabase = createServiceRoleClient();
  const billIds = parseBillIds(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  if (billIds.length === 0) return { error: "Bill not specified.", success: false };
  if (!reason) return { error: "A rejection reason is required.", success: false };

  const { data: bills } = await supabase.from("bill_pass_register").select("id, company_id").in("id", billIds);
  if (!bills || bills.length !== billIds.length) return { error: "One or more entries in this group were not found — refresh and try again.", success: false };
  for (const bill of bills) {
    if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };
  }

  const { error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Rejected", rejected_by: employee.id, rejected_at: new Date().toISOString(), rejection_reason: reason })
    .in("id", billIds);
  if (error) return { error: error.message, success: false };

  revalidatePath(level === "2" ? "/dashboard/approvals/l2" : "/dashboard/approvals/l1");
  return { error: null, success: true };
}
