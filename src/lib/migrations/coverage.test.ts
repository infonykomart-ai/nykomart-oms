import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_FILES } from "./manifest";

// 2026-11-26 — P0 audit fix #2: the migration panel's coverage was "whatever
// someone remembered to add". These tests make both halves mechanical:
//
//   1. every one-time patch in db/ is in the generated manifest, and
//   2. every one of them has a probe entry in probes.ts,
//
// so a file merged without a probe fails `npm test` instead of living on
// invisibly (which is precisely how a pending migration used to hide). The
// third test pins the manifest hashes to the files on disk; without it the
// ledger would compare a hash nobody regenerated and report drift that is not
// real (or miss drift that is).
//
// Same dated-name rule as scripts/migration-manifest.mjs and the admin page:
// 2026-11-26-slug.sql (with optional a/b/c suffix) plus the older
// 20260805name.sql shape. schema.sql is cumulative, check-*.sql is an ad-hoc
// diagnostic query, so neither is a one-time patch.
const DATED_MIGRATION = /^(\d{4}-\d{2}-\d{2}[a-z]?-|\d{8})/;

const files = readdirSync("db")
  .filter((name) => name.endsWith(".sql") && DATED_MIGRATION.test(name))
  .map((name) => `db/${name}`)
  .sort();

const probesSource = readFileSync(join("src", "lib", "migrations", "probes.ts"), "utf8");

test("the manifest lists exactly the one-time patches in db/", () => {
  // Sorted copies: the manifest is now in EXPLICIT RUN ORDER (audit 3.12), which
  // is not the same as a byte-sort of the names (the compact 20260805… legacy
  // names sort after every 2026-08-05-… file). Coverage is about the SET.
  assert.deepEqual(
    [...MIGRATION_FILES.map((entry) => entry.file)].sort(),
    files,
    "src/lib/migrations/manifest.ts is out of step with db/ — run `npm run migrations:manifest`"
  );
});

test("the manifest carries an explicit 1..N run order", () => {
  assert.deepEqual(
    MIGRATION_FILES.map((entry) => entry.seq),
    MIGRATION_FILES.map((_, index) => index + 1),
    "every manifest entry needs a unique seq (1-based, in the generated order) — run `npm run migrations:manifest`"
  );
});

// 2026-11-27 (audit 3.12) — the compact `20260805name.sql` shape is legacy only.
// It sorts after every `2026-08-05-…` file, which is exactly how run order got
// silently wrong. New files must use the dashed date prefix.
const LEGACY_COMPACT_NAMES = new Set([
  "db/20260805fixrlsblockinglogin.sql",
  "db/20260806itemcategoryhsncodes.sql",
  "db/20260806itemcategoryhsncodesbatch2.sql",
  "db/20260806seeditemcategories.sql",
  "db/20260806seedsizesandcategories.sql",
]);

test("new migration files use the YYYY-MM-DD- prefix", () => {
  const compact = readdirSync("db")
    .filter((name) => name.endsWith(".sql") && /^\d{8}/.test(name))
    .map((name) => `db/${name}`)
    .filter((file) => !LEGACY_COMPACT_NAMES.has(file));
  assert.deepEqual(
    compact,
    [],
    `compact 20260805-style names are legacy only — rename these to YYYY-MM-DD-<slug>.sql: ${compact.join(", ")}`
  );
});

test("every db/*.sql patch has a probe entry on the migration page", () => {
  const missing = files.filter((file) => !probesSource.includes(`"${file}"`));
  assert.deepEqual(
    missing,
    [],
    `no entry in src/lib/migrations/probes.ts for: ${missing.join(", ")} — add one (manualProbe() when nothing is API-visible) so a pending file cannot stay invisible`
  );
});

test("manifest hashes match the files on disk", () => {
  const stale = MIGRATION_FILES.filter((entry) => {
    const hash = createHash("sha256").update(readFileSync(entry.file)).digest("hex");
    return hash !== entry.sha256;
  }).map((entry) => entry.file);
  assert.deepEqual(
    stale,
    [],
    `stale hash in src/lib/migrations/manifest.ts for: ${stale.join(", ")} — run \`npm run migrations:manifest\``
  );
});
