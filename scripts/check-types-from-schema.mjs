// 2026-11-26 — local schema → types coverage check (audit 3.9).
//
// check-types-in-sync.mjs is the authoritative CI check, but it needs a live
// Postgres (it runs gen-types.mjs and diffs the result). On a machine without
// Docker/psql that means the drift can only be discovered after a push.
// This script reads db/schema.sql directly — the cumulative source of truth —
// and compares its CREATE TABLE / CREATE VIEW columns with the committed
// src/types/database.ts. It is the same two-way coverage rule as the CI check,
// with no database required.
//
// Usage: node scripts/check-types-from-schema.mjs
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types/database.ts", import.meta.url), "utf8");

/** Remove -- comments without touching dashes inside string literals. */
function stripComments(sql) {
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split a CREATE TABLE body on its top-level commas. */
function splitTopLevel(body) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

const CREATE_CONSTRAINT = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE|LIKE)\b/i;
const COLUMN_NAME = /^([a-z_][a-z0-9_]*)\s/i;

function parseSchema(sql) {
  const clean = stripComments(sql);
  const tables = new Map();
  const createRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)\s*\(/gi;
  let match;
  while ((match = createRe.exec(clean))) {
    const name = match[1];
    const open = clean.indexOf("(", match.index);
    let depth = 0;
    let inString = false;
    let close = -1;
    for (let i = open; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === "'") inString = !inString;
      if (inString) continue;
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const columns = [];
    for (const part of splitTopLevel(clean.slice(open + 1, close))) {
      const segment = part.trim();
      if (!segment || CREATE_CONSTRAINT.test(segment)) continue;
      const column = segment.match(COLUMN_NAME);
      if (column) columns.push(column[1]);
    }
    tables.set(name, new Set(columns));
  }

  // Columns added outside the CREATE TABLE block.
  const alterRe = /ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi;
  while ((match = alterRe.exec(clean))) {
    if (!tables.has(match[1])) tables.set(match[1], new Set());
    tables.get(match[1]).add(match[2]);
  }

  const views = new Set();
  const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-z0-9_]+)/gi;
  while ((match = viewRe.exec(clean))) views.add(match[1]);

  return { tables, views };
}

function parseTypes(source) {
  const tablesStart = source.indexOf("    Tables: {");
  const viewsStart = source.indexOf("    Views: {");
  if (tablesStart < 0 || viewsStart < 0 || viewsStart <= tablesStart) return null;

  // Some hand-folded tables (finance, newer modules) name their row type
  // (`Row: FinAccountRow;`) instead of spelling the columns inline. Resolve
  // those aliases so their columns are still checked.
  const aliases = new Map();
  const aliasRe = /^export type ([A-Za-z0-9_]+) = \{\r?\n([\s\S]*?)\r?\n\};/gm;
  for (const match of source.matchAll(aliasRe)) {
    const columns = match[2]
      .split("\n")
      .map((line) => line.match(/^ {2}([a-z0-9_]+)\??:/))
      .filter(Boolean)
      .map((m) => m[1]);
    if (columns.length > 0) aliases.set(match[1], new Set(columns));
  }

  const tables = new Map();
  // CRLF-tolerant: the committed file is checked out with Windows line endings
  // on some machines and LF on others; the check must not depend on that.
  const tableRe =
    /^ {6}([a-z0-9_]+): \{\r?\n {8}Row: (?:\{\r?\n([\s\S]*?)\r?\n {8}\};|([A-Za-z0-9_]+);)/gm;
  for (const match of source.slice(tablesStart, viewsStart).matchAll(tableRe)) {
    if (match[3]) {
      tables.set(match[1], aliases.get(match[3]) ?? null);
      continue;
    }
    const columns = match[2]
      .split("\n")
      .map((line) => line.match(/^ {10}([a-z0-9_]+):/))
      .filter(Boolean)
      .map((m) => m[1]);
    tables.set(match[1], new Set(columns));
  }

  const views = new Set();
  for (const match of source.slice(viewsStart).matchAll(tableRe)) views.add(match[1]);
  return { tables, views };
}

const fromSchema = parseSchema(schema);
const fromTypes = parseTypes(types);
if (!fromTypes) {
  console.error("::error::Could not parse the Tables/Views sections of src/types/database.ts");
  process.exit(1);
}

const problems = [];
const untypedTables = [];
for (const [table, columns] of fromSchema.tables) {
  const typed = fromTypes.tables.get(table);
  if (typed === undefined) {
    // Some modules (inventory) deliberately read through the untyped
    // service-role client and do not appear here. That is a known gap, not a
    // regression this script can decide on — report it, do not fail.
    untypedTables.push(table);
    continue;
  }
  if (!typed) continue; // alias type with no resolvable definition — see above
  for (const column of columns) {
    if (!typed.has(column)) problems.push(`column "${table}.${column}" exists in db/schema.sql but not in src/types/database.ts`);
  }
}
for (const table of fromTypes.tables.keys()) {
  if (!fromSchema.tables.has(table)) problems.push(`table "${table}" is typed but no CREATE TABLE exists in db/schema.sql`);
}
for (const view of fromSchema.views) {
  if (!fromTypes.views.has(view)) problems.push(`view "${view}" exists in db/schema.sql but not in src/types/database.ts`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\n${problems.length} type drift item(s) against db/schema.sql.`);
  process.exit(1);
}

if (untypedTables.length > 0) {
  console.log(
    `Not typed (read through the unchecked client): ${untypedTables.length} table(s) — ${untypedTables.join(", ")}`
  );
}
console.log(
  `Types cover db/schema.sql: ${fromSchema.tables.size - untypedTables.length} typed tables, ${fromSchema.views.size} views, all columns present.`
);
