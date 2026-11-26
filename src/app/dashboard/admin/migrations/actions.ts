"use server";

// 2026-11-26 — "Record verified files" for the migration ledger (P0 audit fix #2).
//
// The ledger only ever records what the PROBES have just confirmed present in
// this database, never a human's memory of "I think I ran that". Clicking the
// button runs a fresh probe pass (force: true — the page's 5-minute cache would
// otherwise record yesterday's answer) and inserts one row per file that is
// applied but not yet recorded, with the committed file's SHA-256 from the
// manifest. Files whose probe cannot verify anything (indexes, RLS policies,
// data repairs) are deliberately NOT recorded: a hash says nothing about them,
// and guessing "applied" is exactly the invisible drift this page exists to
// expose.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { probeMigrationsCached } from "@/lib/migrations/probes";
import { readMigrationLedger, summarizeMigrationLedger } from "@/lib/migrations/ledger";
import { migrationHash } from "@/lib/migrations/manifest";
import type { Database } from "@/types/database";

type LedgerInsert = Database["public"]["Tables"]["schema_migrations"]["Insert"];

export async function recordVerifiedMigrationsAction(): Promise<void> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const ledger = await readMigrationLedger(supabase);
  if (!ledger.available) redirect("/dashboard/admin/migrations?ledger=missing");

  const { probes } = await probeMigrationsCached(supabase, employee.currentCompanyId, { force: true });
  const { recordable } = summarizeMigrationLedger(probes, ledger);

  const now = new Date().toISOString();
  const payload: LedgerInsert[] = recordable
    .map((file) => ({
      file,
      sha256: migrationHash(file) ?? "",
      applied_at: now,
      applied_by: employee.name,
      note: "Recorded from the migration status page — the probe confirmed this file's object is present.",
    }))
    .filter((row) => row.sha256.length > 0);

  if (payload.length === 0) redirect("/dashboard/admin/migrations?recorded=0");

  const { error } = await supabase.from("schema_migrations").insert(payload);
  if (error) redirect("/dashboard/admin/migrations?ledger=error");

  await logAudit(supabase, {
    companyId: employee.currentCompanyId,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "migrations.recorded",
    entityType: "schema_migrations",
    entityId: "schema_migrations",
    changes: { files: payload.map((row) => row.file) },
  });

  revalidatePath("/dashboard/admin/migrations");
  redirect(`/dashboard/admin/migrations?recorded=${payload.length}`);
}
