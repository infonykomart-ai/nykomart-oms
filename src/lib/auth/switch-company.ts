"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAuthedEmployee, CURRENT_COMPANY_COOKIE } from "./require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";

export type SwitchCompanyState = { success: boolean; error: string | null };

export const initialSwitchCompanyState: SwitchCompanyState = { success: false, error: null };

/**
 * Sets "which company is this login currently acting as" — see the cookie's
 * doc comment in require-capability.ts. Re-validates the target company
 * against the employee's real access list server-side (never trusts the
 * submitted value alone, same reasoning as requireCapability()).
 *
 * Bug fix (2026-08-22, per owner's repeated "switcher still has problems"
 * reports): this used to `return` with no value at all when the requested
 * company wasn't actually in the employee's companyIds — completely silent
 * from the client's point of view, so the dropdown just visually reverted
 * with zero explanation. It now always returns an explicit {success,
 * error} state (useActionState on the client side) so company-switcher.tsx
 * can show the same "you don't have access" wording already used
 * everywhere else in this app (see e.g. src/app/dashboard/salary/actions.ts,
 * src/app/dashboard/attendance/admin/actions.ts) instead of failing quietly.
 */
export async function switchCompanyAction(
  _prevState: SwitchCompanyState,
  formData: FormData
): Promise<SwitchCompanyState> {
  const companyId = String(formData.get("company_id") || "");
  const employee = await getAuthedEmployee();

  if (!companyId) {
    return { success: false, error: "No company selected." };
  }

  if (!employee.companyIds.includes(companyId)) {
    return { success: false, error: await explainDeniedCompanySwitch(employee.id, companyId) };
  }

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_COMPANY_COOKIE, companyId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard", "layout");
  return { success: true, error: null };
}

/**
 * Stretch goal (2026-08-22): company access can come ONLY from a
 * leave-coverage assignment (leave_coverage_assignments, unioned into
 * companyIds by getAuthedEmployee() via each covered store's company_id),
 * which expires automatically at midnight on its to_date — no row is
 * deleted anywhere, it just stops counting. So a company switchable
 * yesterday can silently vanish from this same dropdown today with no
 * schema change involved. Rather than the flat generic message for that
 * case, look for the most recent now-expired coverage grant that reached
 * this company (via its stores) and name it specifically. Purely a
 * read-only query against the existing table — no schema change.
 */
async function explainDeniedCompanySwitch(employeeId: string, companyId: string): Promise<string> {
  const supabase = await createClient();
  const service = createServiceRoleClient();

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).single();
  const companyName = company?.name ?? "that company";

  const { data: companyStores } = await service.from("stores").select("id").eq("company_id", companyId);
  const storeIds = (companyStores ?? []).map((s) => s.id);

  if (storeIds.length > 0) {
    const { data: pastCoverage } = await service
      .from("leave_coverage_assignments")
      .select("to_date")
      .eq("covering_employee_id", employeeId)
      .in("store_id", storeIds)
      .order("to_date", { ascending: false })
      .limit(1);

    const lastToDate = pastCoverage?.[0]?.to_date;
    if (lastToDate && lastToDate < todayIST()) {
      return `Your temporary access to ${companyName} expired on ${lastToDate}.`;
    }
  }

  return "You don't have access to that company.";
}
