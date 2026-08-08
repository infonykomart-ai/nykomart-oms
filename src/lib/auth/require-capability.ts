// Direct port of the old system's requireCapability_() (Code.gs) — every
// privileged Server Function must call this FIRST, before touching any
// data. It is the server-side re-check; never trust a client-side
// capability check alone (the old system's own comment on this point still
// applies: a client can be tampered with, this cannot).
//
// Unlike the old ROLE_CAPABILITIES hardcoded object, capabilities are now a
// real roles/capabilities/role_capabilities join — see db/schema.sql — so
// granting a role a new capability is a data change, not a redeploy.
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(capability: string) {
    super(`Your role does not have the "${capability}" capability.`);
    this.name = "ForbiddenError";
  }
}

// 2026-08-05: user confirmed real staff work across all 3 companies from
// ONE login — this cookie holds "which company is this login currently
// acting as", switchable via the header's company dropdown (see
// src/lib/auth/switch-company.ts + src/components/company-switcher.tsx).
// It's read-only in most places (Server Components can't set cookies —
// see supabase/server.ts's same caveat) so a stale/tampered value simply
// falls back to the employee's home company below; it's never trusted for
// anything beyond "which company's data to show".
export const CURRENT_COMPANY_COOKIE = "oms_company_id";

export type AuthedEmployee = {
  id: string;
  homeCompanyId: string;
  currentCompanyId: string;
  companyIds: string[];
  storeIds: string[];
  name: string;
  roleId: string;
  roleName: string;
  capabilities: string[];
};

/**
 * Resolves the currently-signed-in employee (via Supabase Auth session),
 * their role's capabilities, and which company they're currently acting as.
 * Throws UnauthorizedError if no session / no matching active employee row.
 */
export async function getAuthedEmployee(): Promise<AuthedEmployee> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError();

  // Plain queries rather than embedded-resource joins (`roles(name)`) — the
  // hand-rolled Database type (scripts/gen-types.mjs, used because this
  // sandbox has no working Docker for the official `supabase gen types`
  // CLI) doesn't emit full `Relationships` metadata for every join shape,
  // so those come back typed as `never`. Plain queries need no such
  // metadata and are just as correct.
  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, company_id, name, role_id, active")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !employee || employee.active === false) {
    throw new UnauthorizedError("No active employee record for this account.");
  }

  const [{ data: role }, { data: caps }, { data: access }, { data: storeAccess }] = await Promise.all([
    supabase.from("roles").select("name").eq("id", employee.role_id).single(),
    supabase.from("role_capabilities").select("capability_code").eq("role_id", employee.role_id),
    supabase.from("employee_company_access").select("company_id").eq("employee_id", employee.id),
    // 2026-08-08: which store(s) this login is actually assigned to work on
    // — used to scope the Ad Spend module for anyone without the separate
    // ad_spend_report_all capability. See employee_store_access in
    // db/schema.sql. Empty on purpose for most logins (Finance/MD/Admin/
    // Higher Authority bypass this via ad_spend_report_all instead).
    supabase.from("employee_store_access").select("store_id").eq("employee_id", employee.id),
  ]);

  const companyIds = Array.from(
    new Set([employee.company_id, ...(access ?? []).map((a) => a.company_id)])
  );
  const storeIds = (storeAccess ?? []).map((a) => a.store_id);

  const cookieStore = await cookies();
  const requested = cookieStore.get(CURRENT_COMPANY_COOKIE)?.value;
  const currentCompanyId = requested && companyIds.includes(requested) ? requested : employee.company_id;

  return {
    id: employee.id,
    homeCompanyId: employee.company_id,
    currentCompanyId,
    companyIds,
    storeIds,
    name: employee.name,
    roleId: employee.role_id,
    roleName: role?.name ?? "",
    capabilities: (caps ?? []).map((c) => c.capability_code),
  };
}

/**
 * The one-line guard every capability-gated Server Function should start
 * with — mirrors requireCapability_(p, capability) exactly:
 *
 *   export async function saveCreditNote(input: CreditNoteInput) {
 *     'use server'
 *     const employee = await requireCapability('doc_entry')
 *     ...
 *   }
 */
export async function requireCapability(capability: string): Promise<AuthedEmployee> {
  const employee = await getAuthedEmployee();
  if (!employee.capabilities.includes(capability)) {
    throw new ForbiddenError(capability);
  }
  return employee;
}
