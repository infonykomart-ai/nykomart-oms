// Direct port of the old system's requireCapability_() (Code.gs) — every
// privileged Server Function must call this FIRST, before touching any
// data. It is the server-side re-check; never trust a client-side
// capability check alone (the old system's own comment on this point still
// applies: a client can be tampered with, this cannot).
//
// Unlike the old ROLE_CAPABILITIES hardcoded object, capabilities are now a
// real roles/capabilities/role_capabilities join — see db/schema.sql — so
// granting a role a new capability is a data change, not a redeploy.
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

export type AuthedEmployee = {
  id: string;
  companyId: string;
  name: string;
  roleId: string;
  roleName: string;
  capabilities: string[];
};

/**
 * Resolves the currently-signed-in employee (via Supabase Auth session) and
 * their role's capabilities. Throws UnauthorizedError if no session.
 */
export async function getAuthedEmployee(): Promise<AuthedEmployee> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError();

  // Two plain queries rather than an embedded-resource join (`roles(name)`)
  // — the hand-rolled Database type (scripts/gen-types.mjs, used because
  // this sandbox has no working Docker for the official `supabase gen
  // types` CLI) doesn't emit the `Relationships` metadata the JS client
  // needs to type embedded joins, so those come back typed as `never`.
  // Plain queries need no such metadata and are just as correct.
  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, company_id, name, role_id, active")
    .eq("auth_user_id", user.id)
    .single();

  if (error || !employee || employee.active === false) {
    throw new UnauthorizedError("No active employee record for this account.");
  }

  const [{ data: role }, { data: caps }] = await Promise.all([
    supabase.from("roles").select("name").eq("id", employee.role_id).single(),
    supabase.from("role_capabilities").select("capability_code").eq("role_id", employee.role_id),
  ]);

  return {
    id: employee.id,
    companyId: employee.company_id,
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
