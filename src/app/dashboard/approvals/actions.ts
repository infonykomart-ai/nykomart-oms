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
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ApprovalActionState = { error: string | null; success: boolean };

export async function approveLevel1(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const employee = await requireCapability("approve_level1");
  const supabase = createServiceRoleClient();
  const billId = String(formData.get("bill_id") ?? "");
  if (!billId) return { error: "Bill not specified.", success: false };

  const { data: bill } = await supabase.from("bill_pass_register").select("company_id, approval_status").eq("id", billId).single();
  if (!bill) return { error: "Bill not found.", success: false };
  if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };
  if (bill.approval_status !== "Pending") return { error: `This bill is already "${bill.approval_status}" — nothing to L1-approve.`, success: false };

  const { error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Approved L1", approved_l1_by: employee.id, approved_l1_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("approval_status", "Pending"); // second guard against a race with another L1 approver
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/approvals/l1");
  return { error: null, success: true };
}

export async function approveLevel2(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const employee = await requireCapability("approve_level2");
  const supabase = createServiceRoleClient();
  const billId = String(formData.get("bill_id") ?? "");
  if (!billId) return { error: "Bill not specified.", success: false };

  const { data: bill } = await supabase.from("bill_pass_register").select("company_id, approval_status").eq("id", billId).single();
  if (!bill) return { error: "Bill not found.", success: false };
  if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };
  if (bill.approval_status !== "Approved L1") return { error: `This bill is "${bill.approval_status}" — it needs L1 approval first.`, success: false };

  const { error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Approved L2", approved_l2_by: employee.id, approved_l2_at: new Date().toISOString() })
    .eq("id", billId)
    .eq("approval_status", "Approved L1");
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/approvals/l2");
  return { error: null, success: true };
}

export async function rejectBill(_prev: ApprovalActionState, formData: FormData): Promise<ApprovalActionState> {
  const level = String(formData.get("level") ?? "");
  const capability = level === "2" ? "approve_level2" : "approve_level1";
  const employee = await requireCapability(capability);
  const supabase = createServiceRoleClient();
  const billId = String(formData.get("bill_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!billId) return { error: "Bill not specified.", success: false };
  if (!reason) return { error: "A rejection reason is required.", success: false };

  const { data: bill } = await supabase.from("bill_pass_register").select("company_id").eq("id", billId).single();
  if (!bill) return { error: "Bill not found.", success: false };
  if (!employee.companyIds.includes(bill.company_id)) return { error: "You don't have access to this bill's company.", success: false };

  const { error } = await supabase
    .from("bill_pass_register")
    .update({ approval_status: "Rejected", rejected_by: employee.id, rejected_at: new Date().toISOString(), rejection_reason: reason })
    .eq("id", billId);
  if (error) return { error: error.message, success: false };

  revalidatePath(level === "2" ? "/dashboard/approvals/l2" : "/dashboard/approvals/l1");
  return { error: null, success: true };
}
