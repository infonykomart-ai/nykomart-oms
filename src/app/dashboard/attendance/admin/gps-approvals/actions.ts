"use server";

// 2026-10-02c — GPS Approve/Pending/Rejected decision endpoint. One form
// per punch row on the GPS Approvals screen; the clicked button carries
// the decision (Approved/Rejected). Gated attendance_admin and scoped to
// the punch's own company against this admin's accessible companies —
// the id in the form is never trusted on its own. Errors bounce back to
// the approvals screen with ?error=... so a plain (non-useActionState)
// form action still surfaces what went wrong.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

const APPROVALS_PATH = "/dashboard/attendance/admin/gps-approvals";

function fail(message: string): never {
  redirect(`${APPROVALS_PATH}?error=${encodeURIComponent(message)}`);
}

export async function decideGpsApproval(formData: FormData): Promise<void> {
  const authed = await requireCapability("attendance_admin");

  const id = typeof formData.get("id") === "string" ? (formData.get("id") as string) : "";
  const decision = typeof formData.get("decision") === "string" ? (formData.get("decision") as string) : "";
  const remark = typeof formData.get("remark") === "string" ? (formData.get("remark") as string).trim() : "";
  const returnTo = typeof formData.get("return_to") === "string" ? (formData.get("return_to") as string) : "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail("Invalid punch.");
  if (decision !== "Approved" && decision !== "Rejected") fail("Choose Approved or Rejected.");

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("attendance")
    .select("id, company_id, punch_in_lat, punch_out_lat")
    .eq("id", id)
    .maybeSingle();
  if (!row || !authed.companyIds.includes(row.company_id)) fail("Punch not found in your companies.");
  if (row.punch_in_lat == null && row.punch_out_lat == null) fail("This punch has no GPS coordinates to review.");

  const { error } = await supabase
    .from("attendance")
    .update({
      gps_status: decision,
      gps_decided_by_employee_id: authed.id,
      gps_decided_at: new Date().toISOString(),
      gps_decision_remark: remark || null,
    })
    .eq("id", id);
  if (error) fail(error.message);

  revalidatePath(APPROVALS_PATH);
  revalidatePath("/dashboard/attendance/admin/gps-report");
  // Preserve the admin's filters when bouncing back (only our own path —
  // never an arbitrary URL from the form).
  if (returnTo.startsWith(`${APPROVALS_PATH}?`)) redirect(returnTo);
}
