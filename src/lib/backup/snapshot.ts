// Full data snapshot for the weekly cloud backup (2026-10-23).
//
// WHAT "FULL" MEANS HERE: every table PostgREST exposes for this project —
// discovered from Supabase's own OpenAPI description at request time, not a
// hand-maintained list. A new table therefore lands in the very next backup
// without anyone remembering to add it here, which is the whole point of a
// backup: it has to cover what nobody remembered. Derived `*_view` objects are
// skipped (they are computed from the tables we already dump) and recorded in
// the manifest as skipped, so the omission is visible rather than silent.
//
// Rows are read with the service-role key directly over PostgREST instead of
// the typed Supabase client: the table name is dynamic here, and paging with
// `limit`/`offset` over HTTP keeps this module free of the Database type's
// per-table generic gymnastics while behaving identically.
//
// The workbook is the complete dataset (one sheet per table). The PDF report
// (report-pdf.tsx) is the human-readable archive: summary, totals, table index
// and full listings of the core financial/operational tables.
import * as XLSX from "xlsx";

export type SnapshotTableName = string;

export type SnapshotTable = {
  name: string;
  rows: Array<Record<string, unknown>>;
  /** True when the safety row cap stopped a table before its real end. */
  truncated: boolean;
};

export type SkippedTable = { name: string; reason: string };

export type SnapshotData = {
  generatedAt: string;
  tables: SnapshotTable[];
  skipped: SkippedTable[];
  totalRows: number;
};

/** Rows fetched per request (PostgREST's own default max is 1000). */
const PAGE_SIZE = 1000;
/**
 * Safety caps. A backup that runs out of memory dies with nothing written,
 * which is worse than one that says "orders was capped at 50,000 rows" in the
 * manifest — and no realistic week for this business comes close to these.
 */
const PER_TABLE_LIMIT = 50_000;
const TOTAL_ROW_LIMIT = 150_000;
const FETCH_CONCURRENCY = 4;

function supabaseRestBase(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — cannot build a snapshot.");
  }
  return { url, key };
}

async function restFetch(url: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Every queryable table name, straight from PostgREST's OpenAPI document.
 * Throws when discovery itself fails — a backup that silently covers zero or
 * half the tables is the one failure mode a backup must never have.
 */
export async function discoverSnapshotTables(): Promise<{ tables: string[]; skipped: SkippedTable[] }> {
  const { url, key } = supabaseRestBase();
  const res = await restFetch(`${url}/rest/v1/`, key, { headers: { Accept: "application/openapi+json" } });
  if (!res.ok) {
    throw new Error(`Could not list database tables (PostgREST ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const spec = (await res.json()) as { paths?: Record<string, unknown> };
  const paths = Object.keys(spec.paths ?? {});
  if (paths.length === 0) {
    throw new Error("Supabase returned an empty API description — refusing to write an empty backup.");
  }

  const tables: string[] = [];
  const skipped: SkippedTable[] = [];
  for (const path of paths) {
    if (!path.startsWith("/") || path === "/" || path.includes("/", 1)) continue;
    const name = path.slice(1);
    if (!name) continue;
    if (name.endsWith("_view")) {
      skipped.push({ name, reason: "Derived view — computed from the base tables in this backup." });
      continue;
    }
    tables.push(name);
  }
  tables.sort((a, b) => a.localeCompare(b));
  return { tables, skipped };
}

function errorMessageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; details?: string };
    return [parsed.message, parsed.details].filter(Boolean).join(" — ") || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** True when PostgREST rejects `order=<column>` because that column doesn't exist. */
function isMissingOrderColumn(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  const text = body.toLowerCase();
  return text.includes("order") && (text.includes("column") || text.includes("does not exist"));
}

/**
 * Reads one table, newest-safe paging via limit/offset. Tables with an `id`
 * column are ordered by it so pages can't overlap; a table without one is
 * read unordered rather than failing the whole backup over a sort column.
 */
export async function fetchTableRows(
  table: string,
  budget: number
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const { url, key } = supabaseRestBase();
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  let ordered = true;

  for (;;) {
    if (rows.length >= budget) return { rows, truncated: true };
    const remaining = Math.min(PAGE_SIZE, budget - rows.length);
    const params = new URLSearchParams({ select: "*", limit: String(remaining), offset: String(offset) });
    if (ordered) params.set("order", "id.asc");
    const res = await restFetch(`${url}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`, key);
    if (!res.ok) {
      const body = await res.text();
      if (ordered && isMissingOrderColumn(res.status, body)) {
        // No id column (or no ordering on it) — restart this table unordered.
        ordered = false;
        offset = 0;
        rows.length = 0;
        continue;
      }
      throw new Error(`${table}: ${errorMessageFrom(body)}`);
    }
    const page = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(page)) throw new Error(`${table}: unexpected response shape from Supabase.`);
    rows.push(...page);
    if (page.length < remaining) return { rows, truncated: false };
    offset += page.length;
  }
}

/** Collects the complete snapshot, in bounded parallel batches. */
export async function collectSnapshot(): Promise<SnapshotData> {
  const { tables, skipped } = await discoverSnapshotTables();
  const collected: SnapshotTable[] = [];
  let totalRows = 0;

  for (let i = 0; i < tables.length; i += FETCH_CONCURRENCY) {
    const batch = tables.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (name) => {
        const budget = Math.max(0, Math.min(PER_TABLE_LIMIT, TOTAL_ROW_LIMIT - totalRows));
        if (budget === 0) return { name, rows: [], truncated: true } satisfies SnapshotTable;
        try {
          const { rows, truncated } = await fetchTableRows(name, budget);
          return { name, rows, truncated } satisfies SnapshotTable;
        } catch (err) {
          // A single unreadable table must not lose the other 130: record the
          // reason in the manifest (visible in the admin page and the PDF) and
          // keep going.
          return {
            name,
            rows: [],
            truncated: false,
            error: err instanceof Error ? err.message : String(err),
          } as SnapshotTable & { error: string };
        }
      })
    );
    for (const result of results) {
      const maybeError = (result as SnapshotTable & { error?: string }).error;
      if (maybeError) {
        skipped.push({ name: result.name, reason: maybeError });
        continue;
      }
      totalRows += result.rows.length;
      collected.push(result);
    }
  }

  // Any table skipped after the row budget ran out is still reported.
  for (const table of tables) {
    if (!collected.some((t) => t.name === table) && !skipped.some((s) => s.name === table)) {
      skipped.push({ name: table, reason: "Not read — the 150,000-row safety limit was reached." });
    }
  }

  return { generatedAt: new Date().toISOString(), tables: collected, skipped, totalRows };
}

// ---------------------------------------------------------------------------
// Excel workbook
// ---------------------------------------------------------------------------

const EXCEL_CELL_LIMIT = 32_000;
const EXCEL_SHEET_NAME_LIMIT = 31;

function cellValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.length > EXCEL_CELL_LIMIT ? `${value.slice(0, EXCEL_CELL_LIMIT)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  const json = JSON.stringify(value) ?? "";
  return json.length > EXCEL_CELL_LIMIT ? `${json.slice(0, EXCEL_CELL_LIMIT)}…` : json;
}

/** Column order: first-seen across the rows, so id/date columns stay left. */
export function tableColumns(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

/** Excel's own sheet-name rules: max 31, no []:*?/\ and no leading/trailing quote. */
export function sanitizeSheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, EXCEL_SHEET_NAME_LIMIT);
  if (!base) base = "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${n++}`;
    name = `${base.slice(0, EXCEL_SHEET_NAME_LIMIT - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

export type WorkbookMeta = {
  generatedAt: string;
  files: { xlsx: string; pdf: string };
};

export function buildSnapshotWorkbook(snapshot: SnapshotData, meta: WorkbookMeta): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const summary: Array<Array<string | number | boolean>> = [
    ["Nyko Mart — Data Snapshot"],
    ["Generated (UTC)", snapshot.generatedAt],
    ["Tables", snapshot.tables.length],
    ["Rows", snapshot.totalRows],
    ["Files", `${meta.files.xlsx} + ${meta.files.pdf}`],
    [],
    ["Table", "Rows", "Status"],
  ];
  for (const table of snapshot.tables) {
    summary.push([table.name, table.rows.length, table.truncated ? "Capped at the row-safety limit" : "Complete"]);
  }
  for (const skip of snapshot.skipped) {
    summary.push([skip.name, 0, `Skipped: ${skip.reason}`]);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  summarySheet["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, sanitizeSheetName("Summary", used));

  for (const table of snapshot.tables) {
    const columns = tableColumns(table.rows);
    let sheet: XLSX.WorkSheet;
    if (columns.length === 0) {
      sheet = XLSX.utils.aoa_to_sheet([["(no rows)"]]);
    } else {
      const aoa: Array<Array<string | number | boolean>> = [columns];
      for (const row of table.rows) aoa.push(columns.map((c) => cellValue(row[c])));
      sheet = XLSX.utils.aoa_to_sheet(aoa);
      sheet["!cols"] = columns.map((c) => ({ wch: Math.min(60, Math.max(c.length + 2, 12)) }));
    }
    XLSX.utils.book_append_sheet(wb, sheet, sanitizeSheetName(table.name, used));
  }

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out;
}
