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

// 2026-11-27 (audit 3.12) — EXPLICIT ORDER. Sorting the file names was wrong for
// the compact legacy names: "20260805fixrlsblockinglogin.sql" sorts AFTER every
// "2026-08-05-…" file because "-" sorts before a digit, so the admin page's
// "run these in the order shown" list put the oldest files last. Order by the
// PARSED date instead, then the optional a/b/c letter (so 2026-08-13- sorts
// before 2026-08-13b-), then the rest of the name. The position is emitted as
// `seq` and recorded in schema_migrations.sequence_no, so the order is stored
// data rather than a re-derived guess.
function orderKey(name) {
  const match = name.match(/^(\d{4})-?(\d{2})-?(\d{2})([a-z]*)-?(.*)$/);
  if (!match) return [`99999999`, name, name];
  return [`${match[1]}${match[2]}${match[3]}`, match[4], match[5]];
}

function compareMigrationNames(a, b) {
  const ka = orderKey(a);
  const kb = orderKey(b);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
  return 0;
}

const files = readdirSync(DB_DIR)
  .filter((name) => name.endsWith(".sql") && DATED_MIGRATION.test(name))
  .sort(compareMigrationNames);

const entries = files.map((name, index) => {
  const buffer = readFileSync(join(DB_DIR, name));
  return {
    file: `db/${name}`,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    seq: index + 1,
  };
});

const body = entries
  .map((entry) => `  { file: "${entry.file}", sha256: "${entry.sha256}", seq: ${entry.seq} },`)
  .join("\n");

writeFileSync(
  OUT,
  `// AUTO-GENERATED — do not edit by hand. Run \`npm run migrations:manifest\`
// after adding or changing any db/*.sql file (see scripts/migration-manifest.mjs).
//
// One entry per one-time patch in db/: the file, its SHA-256 and its 1-based
// \`seq\` (explicit run order — parsed date, then a/b/c letter, then name). The
// ledger (schema_migrations) stores the hash recorded when a file was applied,
// so a committed change to an already-run file is visible as DRIFT on
// /dashboard/admin/migrations instead of silently passing as "applied".
export type MigrationManifestEntry = { file: string; sha256: string; seq: number };

export const MIGRATION_FILES: MigrationManifestEntry[] = [
${body}
];

/** Lookup for the ledger comparison; null when the file is not in the manifest. */
export function migrationHash(file: string): string | null {
  return MIGRATION_FILES.find((entry) => entry.file === file)?.sha256 ?? null;
}

/**
 * The file's explicit run order (1-based), or null when it is not a tracked
 * one-time patch. Recorded as schema_migrations.sequence_no and used to order
 * the Admin → Database / Migration Status list.
 */
export function migrationSequence(file: string): number | null {
  return MIGRATION_FILES.find((entry) => entry.file === file)?.seq ?? null;
}
`,
  "utf8"
);

console.log(`Wrote ${entries.length} entries to src/lib/migrations/manifest.ts`);
