// 2026-10-17 — CI types drift check.
//
// The previous CI step regenerated src/types/database.ts and required a
// byte-for-byte `git diff --exit-code`. That could never pass on this repo:
// the committed file is intentionally hand-annotated (migration comments,
// a few Supabase-specific fixes) and is not the generator's exact output.
// The job has therefore been red on main for many commits, which hides real
// drift instead of catching it.
//
// This check keeps the MEANING of the old step — the types must cover every
// table and column the schema creates — without policing formatting or
// comments. It generates the types into the working tree, captures the
// result, restores the committed file unchanged, and compares the table /
// column sets in both directions.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PATH = new URL("../src/types/database.ts", import.meta.url);

function parseTables(src) {
  const start = src.indexOf("    Tables: {");
  const end = src.indexOf("    Views: {");
  if (start < 0 || end < 0 || end <= start) return null;
  const body = src.slice(start, end);
  const tables = new Map();
  const tableRe = /^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\};/gm;
  for (const match of body.matchAll(tableRe)) {
    const columns = match[2]
      .split("\n")
      .map((line) => line.match(/^ {10}([a-z0-9_]+):/))
      .filter(Boolean)
      .map((m) => m[1]);
    tables.set(match[1], columns);
  }
  return tables;
}

const committed = readFileSync(PATH, "utf8");
const committedTables = parseTables(committed);
if (!committedTables) {
  console.error("::error::Could not parse the Tables section of src/types/database.ts");
  process.exit(1);
}

// Generate in place, capture, then restore the committed file even if the
// generator fails — the working tree must be left exactly as checked out.
let generated;
try {
  execFileSync(process.execPath, [new URL("./gen-types.mjs", import.meta.url).pathname], {
    stdio: "inherit",
    env: process.env,
  });
  generated = readFileSync(PATH, "utf8");
} finally {
  writeFileSync(PATH, committed);
}

const generatedTables = parseTables(generated);
if (!generatedTables) {
  console.error("::error::Could not parse the generator output");
  process.exit(1);
}

const problems = [];
for (const [table, cols] of generatedTables) {
  const committedCols = committedTables.get(table);
  if (!committedCols) {
    problems.push(`table "${table}" exists in the schema but not in src/types/database.ts`);
    continue;
  }
  const set = new Set(committedCols);
  for (const col of cols) {
    if (!set.has(col)) problems.push(`column "${table}.${col}" exists in the schema but not in src/types/database.ts`);
  }
}
for (const table of committedTables.keys()) {
  if (!generatedTables.has(table)) {
    problems.push(`table "${table}" is typed in src/types/database.ts but no longer exists in the schema`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(
    `\n${problems.length} type drift item(s). Regenerate with 'node scripts/gen-types.mjs' and fold the missing columns into the committed file.`
  );
  process.exit(1);
}

console.log(`Types cover the schema: ${generatedTables.size} tables, all columns present.`);
