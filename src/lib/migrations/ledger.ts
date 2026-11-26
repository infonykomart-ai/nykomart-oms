// 2026-11-26 — migration LEDGER read/compare layer (P0 audit fix #2).
//
// `schema_migrations` (db/2026-11-26-schema-migrations-ledger.sql) holds one row
// per applied db/*.sql file plus the file's SHA-256 at that moment. This module
// only READS and COMPARES — it never writes. The write path is the admin action,
// and it records only files whose probe just confirmed the object is present, so
// a ledger row always means "verified present in this database".
//
// Why compare at all: probes answer "does the object exist?", which cannot tell
// a file that was run from one that was EDITED after it was run. Comparing the
// recorded hash with the committed one (src/lib/migrations/manifest.ts,
// regenerated from db/ by `npm run migrations:manifest`) answers that.
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MIGRATION_FILES } from "./manifest";
import { migrationApplied, migrationIsManual, type MigrationProbe } from "./probes";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type MigrationLedgerRow = {
  file: string;
  sha256: string;
  applied_at: string;
  applied_by: string | null;
  note: string | null;
};

export type MigrationLedger =
  | { available: false; error: string; rows: Map<string, MigrationLedgerRow> }
  | { available: true; rows: Map<string, MigrationLedgerRow> };

/**
 * Reads the ledger. A database that has not run
 * db/2026-11-26-schema-migrations-ledger.sql is reported as `available: false`
 * (the page shows the file to run) — never as "nothing is applied", which would
 * be a false alarm on a perfectly fine database.
 */
export async function readMigrationLedger(client: ServiceClient): Promise<MigrationLedger> {
  const { data, error } = await client
    .from("schema_migrations")
    .select("file, sha256, applied_at, applied_by, note");
  if (error) return { available: false, error: error.message, rows: new Map() };

  const rows = new Map<string, MigrationLedgerRow>();
  for (const row of (data ?? []) as MigrationLedgerRow[]) rows.set(row.file, row);
  return { available: true, rows };
}

export type LedgerSummary = {
  /** Files in the committed manifest (the one-time patches in db/). */
  total: number;
  recorded: number;
  /** Applied by probe but with no ledger row — the action can record these now. */
  recordable: string[];
  /** Recorded hash differs from the committed file: the file was edited after it ran. */
  drifted: { file: string; recordedSha: string; currentSha: string }[];
  /** Ledger says applied, but this database does not have the object. */
  conflicts: string[];
  /** Recorded rows whose file is no longer in db/ (renamed or removed). */
  orphaned: string[];
  /** Neither verifiable by the API nor recorded — a human must confirm these. */
  manual: string[];
};

/**
 * Compares the committed manifest with the ledger and the probe run.
 * Pure: no I/O, so it is testable and the page stays a straight render.
 */
export function summarizeMigrationLedger(probes: MigrationProbe[], ledger: MigrationLedger): LedgerSummary {
  const probeByFile = new Map(probes.map((probe) => [probe.file, probe]));
  const currentSha = new Map(MIGRATION_FILES.map((entry) => [entry.file, entry.sha256]));

  const recordable: string[] = [];
  const manual: string[] = [];
  let recorded = 0;

  for (const entry of MIGRATION_FILES) {
    const probe = probeByFile.get(entry.file);
    if (ledger.rows.has(entry.file)) {
      recorded += 1;
      continue;
    }
    // No probe row at all (a manifest file the panel does not list) is treated
    // like a manual one: there is nothing to verify, so it must not be offered
    // as "recordable".
    if (!probe || migrationIsManual(probe)) {
      manual.push(entry.file);
      continue;
    }
    if (migrationApplied(probe)) recordable.push(entry.file);
  }

  const drifted: LedgerSummary["drifted"] = [];
  const conflicts: string[] = [];
  const orphaned: string[] = [];

  for (const row of ledger.rows.values()) {
    const sha = currentSha.get(row.file);
    if (!sha) {
      orphaned.push(row.file);
      continue;
    }
    if (sha !== row.sha256) drifted.push({ file: row.file, recordedSha: row.sha256, currentSha: sha });
    const probe = probeByFile.get(row.file);
    if (probe && probe.checks.some((check) => check.state === "missing")) conflicts.push(row.file);
  }

  return { total: MIGRATION_FILES.length, recorded, recordable, drifted, conflicts, orphaned, manual };
}
