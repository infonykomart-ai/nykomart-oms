// 2026-11-03 — the one dated SQL file the agreement module needs. Kept out of
// the "use server" actions file because a Server Actions module may only
// export async functions (a const export there fails the Next build).
export const AGREEMENT_MIGRATION_FILE = "db/2026-11-03-vendor-agreements.sql";

export const AGREEMENT_MIGRATION_HINT = `Run ${AGREEMENT_MIGRATION_FILE} in the Supabase SQL editor first — the agreement tables are not created yet.`;

/** Postgres 42P01 / PostgREST PGRST205 and friends = the file hasn't been run. */
export function isMissingAgreementSchema(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("schema cache") || (message.includes("relation") && message.includes("does not exist"));
}
