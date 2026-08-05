"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getAuthedEmployee, CURRENT_COMPANY_COOKIE } from "./require-capability";

/**
 * Sets "which company is this login currently acting as" — see the cookie's
 * doc comment in require-capability.ts. Re-validates the target company
 * against the employee's real access list server-side (never trusts the
 * submitted value alone, same reasoning as requireCapability()).
 */
export async function switchCompanyAction(formData: FormData): Promise<void> {
  const companyId = String(formData.get("company_id") || "");
  const employee = await getAuthedEmployee();

  if (!companyId || !employee.companyIds.includes(companyId)) return;

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_COMPANY_COOKIE, companyId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard", "layout");
}
