import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// 2026-11-27 (audit #2) — db/2026-11-27-company-scoped-rls.sql is a live RLS
// change, so it cannot be exercised without a database. What CAN be pinned is
// its completeness and its direction:
//
//   * the policy function mirrors the app's companyIds union AND expands it
//     to the linked-company group (Nyko Mart / Rugara / CASA ARRA share data;
//     a company outside the group must not),
//   * every table in schema.sql with a NOT NULL company_id is covered by the
//     loop (so a newly added company table is scoped automatically),
//   * the only company tables left un-scoped are nullable ones, and that list
//     is written down in the file — a new nullable table fails this test until
//     someone decides what its NULL means,
//   * no company table keeps `USING (true)`.
const MIGRATION = "db/2026-11-27-company-scoped-rls.sql";
const sql = readFileSync(MIGRATION, "utf8");
// The rollback recipe in the trailing comments deliberately shows the old
// blanket policy; structural assertions must look at executable SQL only.
const code = sql.replace(/--[^\r\n]*/g, "");
const schema = readFileSync("db/schema.sql", "utf8");

function companyTables(): Map<string, { nullable: boolean }> {
  const out = new Map<string, { nullable: boolean }>();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+) \(([\s\S]*?)\r?\n\);/g;
  for (const match of schema.matchAll(re)) {
    const [, name, body] = match;
    if (!/\bcompany_id\s+uuid/.test(body)) continue;
    out.set(name, { nullable: !/\bcompany_id\s+uuid\s+NOT NULL/.test(body) });
  }
  return out;
}

const tables = companyTables();
const notNull = [...tables].filter(([, info]) => !info.nullable).map(([name]) => name).sort();
const nullable = [...tables].filter(([, info]) => info.nullable).map(([name]) => name).sort();

const notScopedBlock =
  sql.match(/DELIBERATELY NOT SCOPED HERE[\s\S]*?(?=\n-- Idempotent)/)?.[0] ?? "";
const notScoped = [...notScopedBlock.matchAll(/\b([a-z][a-z_0-9]+)\b/g)]
  .map((match) => match[1])
  .filter((name) => tables.has(name))
  .sort();

test("the helper mirrors the app's companyIds (home + access + live coverage)", () => {
  assert.match(code, /CREATE OR REPLACE FUNCTION public\.auth_company_ids\(\)/i);
  assert.match(code, /SECURITY DEFINER/i);
  assert.match(code, /SET search_path = public, pg_temp/i);
  for (const source of [
    "FROM public.employees e",
    "FROM public.employee_company_access a",
    "FROM public.leave_coverage_assignments c",
    "JOIN public.stores s",
  ]) {
    assert.ok(code.includes(source), `auth_company_ids() no longer reads ${source}`);
  }
  assert.match(code, /Asia\/Kolkata/, "coverage dates must use the app's IST day, not the DB timezone");
});

test("linked companies resolve to one group, so they keep seeing each other", () => {
  assert.match(
    code,
    /ALTER TABLE public\.companies\s+ADD COLUMN IF NOT EXISTS group_company_id uuid REFERENCES public\.companies\(id\)/i,
    "the link must be an explicit column on companies"
  );
  assert.match(code, /coalesce\(c\.group_company_id, c\.id\)/i, "a company's group is its root, or itself");
  assert.match(code, /FROM public\.companies c/, "the helper must expand a login's companies through companies");
  assert.match(
    code,
    /WHERE name IN \('Nyko Mart', 'Rugara', 'CASA ARRA'\)/,
    "the seed must name today's three linked companies explicitly"
  );
  assert.match(code, /AND group_company_id IS NULL/, "the seed must not re-parent an already-linked company");
  assert.ok(
    !/group_company_id IS NULL\s+AND\s+c\.id <>/i.test(code),
    "the seed must not group every company by default — a company created later starts on its own"
  );
});

test("the migration refuses to install policies that would recurse", () => {
  assert.match(code, /rolbypassrls/);
  assert.match(code, /RAISE EXCEPTION/);
});

test("every NOT NULL company_id table is scoped by the loop", () => {
  assert.ok(notNull.length >= 90, `expected the company-owned schema, found ${notNull.length} tables`);
  assert.match(code, /a\.attnotnull/, "the loop must select NOT NULL company_id tables");
  assert.match(code, /DROP POLICY IF EXISTS allow_authenticated_all ON public\.%I/i);
  assert.match(code, /CREATE POLICY company_scope_all ON public\.%I FOR ALL TO authenticated/i);
  assert.match(
    code,
    /company_id = any \(public\.auth_company_ids\(\)\)/,
    "policies must scope by the caller's company ids"
  );
  for (const name of notNull) {
    assert.ok(
      !notScoped.includes(name),
      `${name} has a NOT NULL company_id and must not be in the not-scoped list`
    );
  }
  assert.ok(!/USING \(true\)/i.test(code), "no blanket USING (true) policy may be created");
});

test("nullable company_id tables are an explicit, reviewed list", () => {
  // The one nullable table this fix scopes on purpose.
  assert.match(code, /CREATE POLICY company_scope_all ON public\.order_whatsapp_messages/i);
  assert.ok(!notScoped.includes("order_whatsapp_messages"));

  assert.deepEqual(
    notScoped,
    nullable.filter((name) => name !== "order_whatsapp_messages").sort(),
    "a nullable company_id table changed without a decision — scope it or list it under DELIBERATELY NOT SCOPED"
  );
});

test("the WhatsApp log policy does not open NULL-company rows to everyone", () => {
  const block = code.match(
    /CREATE POLICY company_scope_all ON public\.order_whatsapp_messages[\s\S]*?;/
  )?.[0] ?? "";
  assert.ok(block.length > 0);
  assert.ok(!/company_id IS NULL/i.test(block), "NULL-company rows must stay invisible, not shared");
});
