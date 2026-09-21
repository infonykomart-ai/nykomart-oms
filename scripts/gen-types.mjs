// One-off local type generator — introspects a Postgres database's public
// schema (tables, views, enums) and emits a Supabase-style Database type to
// src/types/database.ts. Used in place of `supabase gen types` because this
// sandbox has no working Docker daemon (that subcommand shells out to a
// container). Re-run this any time db/schema.sql changes and you have a
// local Postgres loaded with it (see README.md "Local schema checks").
import pg from "pg";
import { writeFileSync } from "node:fs";

const DB_URL =
  process.env.GEN_TYPES_DB_URL ||
  "postgresql://postgres:postgres@localhost:5432/oms_test";

const PG_TO_TS = {
  uuid: "string",
  text: "string",
  citext: "string",
  varchar: "string",
  bpchar: "string",
  date: "string",
  timestamptz: "string",
  timestamp: "string",
  time: "string",
  boolean: "boolean",
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  numeric: "number",
  float4: "number",
  float8: "number",
  json: "Json",
  jsonb: "Json",
};

function tsTypeFromUdt(udtName, enums) {
  if (enums.has(udtName)) return enums.get(udtName);
  return PG_TO_TS[udtName] || (udtName?.startsWith("_") ? "unknown[]" : "unknown");
}

function tsType(col, enums, checkUnions, tableName) {
  // 1) Text columns constrained by a single-column CHECK (col IN ('a','b',...))
  //    become string-literal unions — mirrors what the old hand-maintained
  //    types file expressed, now derived from the live schema.
  const key = `${tableName}.${col.column_name}`;
  const union = checkUnions instanceof Map && checkUnions.get(key);
  if (union && col.udt_name === "text") return union;
  // 2) Array columns type as element-type[] using the same inference rules
  //    (Postgres stores these as udt_name starting with "_").
  if (col.udt_name?.startsWith("_")) {
    const elem = PG_TO_TS[col.udt_name.slice(1)];
    return `${elem ?? "unknown"}[]`;
  }
  return tsTypeFromUdt(col.udt_name, enums);
}

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  const enumRows = (
    await client.query(`
    select t.typname as enum_name, e.enumlabel as value
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
  `)
  ).rows;
  const enums = new Map();
  for (const row of enumRows) {
    const key = `"${row.value}"`;
    if (!enums.has(row.enum_name)) enums.set(row.enum_name, []);
    enums.get(row.enum_name).push(key);
  }
  const enumTsMap = new Map();
  for (const [name, values] of enums) enumTsMap.set(name, values.join(" | "));  const tableRows = (
    await client.query(`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable,
           c.column_default,
           (t.table_type = 'VIEW') as is_view
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position
  `)
).rows;

  // String-literal unions for text columns guarded by a single-column
  // CHECK (col = ANY (ARRAY['a'::text, ...])) — the canonical form Postgres
  // stores for CHECK (col IN ('a', ...)) written against a text column.
  // This restores the richer per-column types (courier/status/kind/etc.) the
  // old hand-maintained types file carried, without keeping that file
  // hand-maintained. CHECKs on enum-typed columns are skipped (the enum's
  // own union is already resolved through enums map above).
  const checkRows = (
    await client.query(`
    select conrelid::regclass::text as table_name, pg_get_constraintdef(oid, true) as def
    from pg_constraint
    where contype = 'c' and connamespace = 'public'::regnamespace
  `)
).rows;
  const checkUnions = new Map();
  for (const row of checkRows) {
    const def = row.def;
    const m =
      def.match(/\(?([\w]+)\)? = ANY \(ARRAY\[((?:'[^']*'::text(?:, )?)+)\]\)/i) ||
      def.match(/\(?([\w]+)\)? IN \(([^)]+)\)/i);
    if (!m) continue;
    const quoted = m[2].includes("::text") ? m[2].matchAll(/'([^']*)'::text/g) : m[2].matchAll(/'([^']*)'/g);
    const vals = [...quoted].map((x) => x[1]);
    if (vals.length) {
      const key = `${row.table_name}.${m[1]}`;
      if (!checkUnions.has(key)) checkUnions.set(key, vals.map((v) => JSON.stringify(v)).join(" | "));
    }
  }

  // Real FK relationships — needed both for documentation and so the
  // Supabase JS client's `GenericTable.Relationships` field is populated
  // with real data (an empty array works to unblock plain queries, but a
  // real one is what makes embedded-resource joins like `.select("roles(name)")`
  // type-check instead of silently degrading to `never`).
  const fkRows = (
    await client.query(`
    select
      tc.table_name as foreign_key_table,
      kcu.column_name as column_name,
      ccu.table_name as referenced_table,
      ccu.column_name as referenced_column,
      tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  `)
  ).rows;
  const fksByTable = new Map();
  for (const row of fkRows) {
    if (!fksByTable.has(row.foreign_key_table)) fksByTable.set(row.foreign_key_table, []);
    fksByTable.get(row.foreign_key_table).push(row);
  }

  const tables = new Map();
  for (const row of tableRows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, { isView: row.is_view, columns: [] });
    tables.get(row.table_name).columns.push(row);
  }

  // Callable functions (business-rule RPCs like reserve_next_number(),
  // get_official_rate_as_of() — see db/schema.sql section 3/4) — needed so
  // `supabase.rpc(name, args)` type-checks with real Args/Returns instead of
  // the `Record<string, never>` stub, which makes every .rpc() call fail to
  // compile. Trigger functions (RETURNS trigger, e.g. trg_assign_document_no)
  // are excluded — PostgREST can't call those via RPC anyway.
  // Extension-owned function OIDs (pgcrypto/citext ship dozens of overloaded
  // functions into the public schema — e.g. armor/digest/citext casts — with
  // unnamed params that collide when keyed by routine_name; these were never
  // meant to be called as app-level RPCs, so exclude anything pg_depend says
  // belongs to an extension and keep only what db/schema.sql itself defines.
  const extensionOwnedOids = new Set(
    (
      await client.query(`
      select d.objid
      from pg_depend d
      where d.deptype = 'e'
        and d.classid = 'pg_proc'::regclass
    `)
    ).rows.map((r) => Number(r.objid))
  );

  const routineRows = (
    await client.query(`
    select r.specific_name, r.routine_name, r.type_udt_name
    from information_schema.routines r
    where r.specific_schema = 'public' and r.routine_type = 'FUNCTION' and r.data_type <> 'trigger'
    order by r.routine_name
  `)
  ).rows.filter((r) => {
    // information_schema.routines.specific_name is "<function_name>_<oid>"
    // (Postgres appends the OID to disambiguate overloads) — extract it to
    // cross-reference against extension-owned OIDs above.
    const oid = Number(r.specific_name.slice(r.specific_name.lastIndexOf("_") + 1));
    return !extensionOwnedOids.has(oid);
  });
  const retsetRows = (
    await client.query(`
    select p.proname, p.proretset
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  `)
  ).rows;
  const retsetByName = new Map(retsetRows.map((r) => [r.proname, r.proretset]));

  const paramRows = (
    await client.query(`
    select specific_name, parameter_name, parameter_mode, udt_name, ordinal_position
    from information_schema.parameters
    where specific_schema = 'public'
    order by specific_name, ordinal_position
  `)
  ).rows;
  const paramsBySpecific = new Map();
  for (const row of paramRows) {
    if (!paramsBySpecific.has(row.specific_name)) paramsBySpecific.set(row.specific_name, []);
    paramsBySpecific.get(row.specific_name).push(row);
  }

  const functions = [];
  for (const routine of routineRows) {
    const params = paramsBySpecific.get(routine.specific_name) || [];
    const inParams = params.filter((p) => p.parameter_mode === "IN");
    const outParams = params.filter((p) => p.parameter_mode === "OUT" || p.parameter_mode === "INOUT");
    const isSet = retsetByName.get(routine.routine_name) === true;
    // Args with DEFAULT values are optional for the caller. Postgres stores
    // the count in pronargdefaults; those are the LAST pronargdefaults
    // input args. Mark them optional (`?:`) so callers can omit them —
    // matches how the RPCs are actually called (filters omitted = no
    // filter) and mirrors the hand-maintained types' `p_store_id?:`.
    let defaultsCount = 0;
    try {
      const dres = await client.query(`
        select pronargdefaults from pg_proc
        where oid = $1::regproc::oid and pronamespace = 'public'::regnamespace
      `, [routine.routine_name]);
      defaultsCount = Number(dres.rows[0]?.pronargdefaults ?? 0);
    } catch {
      defaultsCount = 0;
    }
    const inCount = inParams.length;
    const firstOptionalIdx = inCount - defaultsCount; // index into inParams where optional args start
    functions.push({
      name: routine.routine_name,
      inParams,
      outParams,
      isSet,
      scalarUdtName: routine.type_udt_name,
      firstOptionalIdx,
    });
  }

  let out = `// AUTO-GENERATED by scripts/gen-types.mjs — do not hand-edit.
// Regenerate after any db/schema.sql change (see README.md).
/* eslint-disable @typescript-eslint/no-empty-object-type -- Args: {} on no-arg RPCs is Supabase's own generated-types convention; removing it breaks rpc() typing */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
`;

  for (const [tableName, { isView, columns }] of tables) {
    if (isView) continue;
    out += `      ${tableName}: {\n        Row: {\n`;
    for (const col of columns) {
      const nullable = col.is_nullable === "YES";
      out += `          ${col.column_name}: ${tsType(col, enumTsMap, checkUnions, tableName)}${nullable ? " | null" : ""};\n`;
    }
    out += `        };\n        Insert: {\n`;
    for (const col of columns) {
      const nullable = col.is_nullable === "YES";
      const hasDefault = col.column_default !== null;
      const optional = nullable || hasDefault;
      out += `          ${col.column_name}${optional ? "?" : ""}: ${tsType(col, enumTsMap, checkUnions, tableName)}${nullable ? " | null" : ""};\n`;
    }
    out += `        };\n        Update: {\n`;
    for (const col of columns) {
      out += `          ${col.column_name}?: ${tsType(col, enumTsMap, checkUnions, tableName)}${col.is_nullable === "YES" ? " | null" : ""};\n`;
    }
    out += `        };\n        Relationships: [\n`;
    for (const fk of fksByTable.get(tableName) || []) {
      out += `          {\n            foreignKeyName: "${fk.constraint_name}";\n            columns: ["${fk.column_name}"];\n            isOneToOne: false;\n            referencedRelation: "${fk.referenced_table}";\n            referencedColumns: ["${fk.referenced_column}"];\n          },\n`;
    }
    out += `        ];\n      };\n`;
  }

  out += `    };\n    Views: {\n`;
  for (const [tableName, { isView, columns }] of tables) {
    if (!isView) continue;
    out += `      ${tableName}: {\n        Row: {\n`;
    for (const col of columns) {
      out += `          ${col.column_name}: ${tsType(col, enumTsMap, checkUnions, tableName)} | null;\n`;
    }
    out += `        };\n        Relationships: [];\n      };\n`;
  }
  out += `    };\n    Functions: {\n`;
  for (const fn of functions) {
    out += `      ${fn.name}: {\n        Args: {\n`;
    fn.inParams.forEach((p, idx) => {
      const optional = idx >= fn.firstOptionalIdx;
      out += `          ${p.parameter_name}${optional ? "?" : ""}: ${tsTypeFromUdt(p.udt_name, enumTsMap)}${optional ? " | null" : ""};\n`;
    });
    out += `        };\n        Returns: `;
    if (fn.outParams.length > 0) {
      out += `{\n`;
      for (const p of fn.outParams) {
        out += `          ${p.parameter_name}: ${tsTypeFromUdt(p.udt_name, enumTsMap)} | null;\n`;
      }
      out += fn.isSet ? `        }[];\n` : `        };\n`;
    } else {
      const scalar = tsTypeFromUdt(fn.scalarUdtName, enumTsMap);
      out += fn.isSet ? `${scalar}[];\n` : `${scalar};\n`;
    }
    out += `      };\n`;
  }
  out += `    };\n    Enums: {\n`;
  for (const [name, values] of enums) {
    out += `      ${name}: ${values.join(" | ")};\n`;
  }
  out += `    };\n  };\n};\n`;

  writeFileSync(new URL("../src/types/database.ts", import.meta.url), out);
  console.log(`Wrote database.ts — ${tables.size} tables/views, ${enums.size} enums`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
