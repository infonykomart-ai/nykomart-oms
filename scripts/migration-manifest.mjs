// 2026-11-26 — regenerates src/lib/migrations/manifest.ts.
//
// WHY A GENERATED MANIFEST: the migration ledger stores the SHA-256 of each
// db/*.sql file at the moment it was recorded as applied, so a file edited
// after it was run can be detected. The server cannot read db/ at runtime (that
// folder is not bundled into the deployment), so the list and the hashes are
// committed as a TypeScript module instead — this script is the only writer.
//
// RUN IT AFTER ADDING OR EDITING ANY db/*.sql FILE:
//   npm run migrations:manifest
// `src/lib/migrations/coverage.test.ts` fails when this file is stale, so a
// forgotten run is caught by `npm test` rather than by a wrong ledger entry.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const OUT = join(ROOT, "src/lib/migrations/manifest.ts");

// Same rule the admin page and the coverage test use: the dated patches, plus
// the older 20260805…-shaped names. schema.sql is the cumulative definition (not
// a one-time patch) and check-*.sql is an ad-hoc diagnostic query, so both stay
// out.
export const DATED_MIGRATION = /^(\d{4}-\d{2}-\d{2}[a-z]?-|\d{8})/;

const files = readdirSync(DB_DIR)
  .filter((name) => name.endsWith(".sql") && DATED_MIGRATION.test(name))
  .sort();

const entries = files.map((name) => {
  const buffer = readFileSync(join(DB_DIR, name));
  return { file: `db/${name}`, sha256: createHash("sha256").update(buffer).digest("hex") };
});

const body = entries
  .map((entry) => `  { file: "${entry.file}", sha256: "${entry.sha256}" },`)
  .join("\n");

writeFileSync(
  OUT,
  `// AUTO-GENERATED — do not edit by hand. Run \`npm run migrations:manifest\`
// after adding or changing any db/*.sql file (see scripts/migration-manifest.mjs).
//
// One entry per one-time patch in db/: the file and its SHA-256. The ledger
// (schema_migrations) stores the hash recorded when a file was applied, so a
// committed change to an already-run file is visible as DRIFT on
// /dashboard/admin/migrations instead of silently passing as "applied".
export type MigrationManifestEntry = { file: string; sha256: string };

export const MIGRATION_FILES: MigrationManifestEntry[] = [
${body}
];

/** Lookup for the ledger comparison; null when the file is not in the manifest. */
export function migrationHash(file: string): string | null {
  return MIGRATION_FILES.find((entry) => entry.file === file)?.sha256 ?? null;
}
`,
  "utf8"
);

console.log(`Wrote ${entries.length} entries to src/lib/migrations/manifest.ts`);
