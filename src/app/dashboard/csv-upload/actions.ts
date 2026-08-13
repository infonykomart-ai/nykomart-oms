"use server";

// Generic statement-family CSV importer (round 11) — drives off
// src/lib/statement-import/tables.ts's config instead of one bespoke
// action per table (8 tables, several 20-60 columns wide — a config-driven
// mapper is both faster to get right and easier to keep right than 8
// hand-written near-duplicates). Same readBulkFile/cellStr/cellNum XLSX
// pattern as every other bulk-upload feature in this app (Stock, Orders,
// Parties, Invoices) — see src/app/dashboard/stock/actions.ts.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { importTableByKey, type ImportColumn, type ImportTableConfig } from "@/lib/statement-import/tables";

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}

function cellRaw(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function convertCell(row: Record<string, unknown>, byHeader: Map<string, string>, col: ImportColumn): unknown {
  const raw = cellRaw(row, byHeader, col.header);
  if (!raw) return null;
  switch (col.type) {
    // 2026-08-13: fixed against real Etsy Ledger CSV exports — amount-type
    // columns there come as "₹18,348", "-₹18", or "--" (Etsy's own blank
    // marker), not plain numbers. Number("₹18,348") / Number("--") are
    // both NaN, so every currency-formatted amount was silently importing
    // as NULL. Stripping everything except digits/minus/decimal-point
    // handles ₹, $, commas, and "--" (which collapses to "-" -> NaN ->
    // null, still correctly null) without changing behavior for plain
    // numeric input from other statement sources.
    case "number": {
      const cleaned = raw.replace(/[^0-9.-]/g, "");
      const n = Number(cleaned);
      return cleaned && Number.isFinite(n) ? n : null;
    }
    case "integer": {
      const cleaned = raw.replace(/[^0-9.-]/g, "");
      const n = Number(cleaned);
      return cleaned && Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "boolean":
      return /^(true|yes|y|1)$/i.test(raw);
    // 2026-08-13: fixed against real Amazon Transactions exports — the
    // SAME "Date" header is DD/MM/YYYY on the UK/GBP export and M/D/YYYY
    // on the US/USD export (verified against each real file's own stated
    // date range). Postgres' default DateStyle would misparse (or reject)
    // whichever one doesn't match its expected order if passed through as
    // plain text, so these convert explicitly to ISO before insert rather
    // than leaving it to Postgres to guess.
    case "date_dmy":
    case "date_mdy": {
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return raw; // unrecognized shape — pass through, let Postgres try (and fail loudly if genuinely bad)
      const [, a, b, year] = m;
      const [month, day] = col.type === "date_dmy" ? [b, a] : [a, b];
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    case "date":
    case "text":
    default:
      return raw;
  }
}

const MAX_BULK_ROWS = 2000;

export type BulkImportResult = { row: number; error: string | null };
export type BulkImportState = { error: string | null; tableKey: string | null; imported: number | null; results: BulkImportResult[] | null };

const FOOTER_ROW_RE = /^(total|totals|grand total|subtotal|sub total)$/i;

// 2026-08-13: fixed against a real eBay "Tax invoice detail" export, which
// carries a 5-line metadata preamble (Invoice date / seller ID / report
// name / marketplace entity / time period) before the real header row —
// the old code always treated row 1 as the header, so this file (and per
// claude/statement-import-notes.md, also Bank Statement 2023's 16-line
// preamble and eBay Transaction Report's ~10-line preamble) would have
// failed to match any configured column. Ported from the same
// findHeaderLine_ approach already verified in the original 2026-08-01
// Apps Script build: score each of the first 40 rows by how many cells
// match one of this table's own configured headers, and pick the
// best-scoring row as the real header. A clean file with the header
// already on row 1 still resolves correctly, since row 1 always scores at
// least as well as any preamble row for its own table's columns. Also
// drops a trailing "Total"/"Subtotal" summary row, same as the original
// build's footer-filtering rule (seen in the eBay Freight Invoice export).
async function readBulkFile(
  file: FormDataEntryValue | null,
  config: ImportTableConfig
): Promise<{ rows: Record<string, unknown>[]; headerKeys: string[]; headerLineNo: number } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file first." };
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    // 2026-08-13: fixed against real Amazon Transactions exports — WITHOUT
    // `raw: true` here, xlsx's CSV parser auto-sniffs date-looking cells
    // (e.g. "10/08/2026") and silently converts them to an Excel serial
    // number using its OWN locale guess (verified: it assumed M/D, so a
    // real 10 Aug 2026 — DD/MM, from the UK/Australia exports — silently
    // became 8 Oct 2026, no error, no warning) before this code ever sees
    // a "raw" string to parse with date_dmy/date_mdy. `raw: true` at the
    // workbook-read level keeps CSV cells as their literal source text —
    // confirmed this doesn't affect genuine .xlsx uploads with real
    // Date-typed cells (those stay real Excel serials regardless, since
    // that's inherent to the binary format, not this CSV-sniffing
    // heuristic). This also protects every other statement CSV from the
    // same class of silent corruption on any column that merely looks
    // like a date or number to xlsx's heuristics.
    const wb = XLSX.read(buf, { type: "array", raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    if (!aoa.length) return { error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure." };

    const targetHeaders = new Set(config.columns.map((c) => normalizeHeader(c.header)));
    let headerIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < Math.min(40, aoa.length); i++) {
      const row = aoa[i] ?? [];
      const score = row.filter((cell) => targetHeaders.has(normalizeHeader(String(cell ?? "")))).length;
      if (score > bestScore) {
        bestScore = score;
        headerIdx = i;
      }
    }

    const headerKeys = (aoa[headerIdx] ?? []).map((h) => String(h ?? ""));
    const rows: Record<string, unknown>[] = [];
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const raw = aoa[i] ?? [];
      if (raw.every((c) => String(c ?? "").trim() === "")) continue; // blank row
      const firstNonBlank = raw.find((c) => String(c ?? "").trim() !== "");
      if (firstNonBlank !== undefined && FOOTER_ROW_RE.test(String(firstNonBlank).trim())) continue; // summary/footer row
      const obj: Record<string, unknown> = {};
      headerKeys.forEach((k, idx) => {
        obj[k] = raw[idx] ?? "";
      });
      rows.push(obj);
    }
    // 1-indexed file line number of the header row, so callers can report
    // "row N" against the real file (not always "row 2") once a preamble
    // pushes the header off line 1.
    return { rows, headerKeys, headerLineNo: headerIdx + 1 };
  } catch {
    return { error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure." };
  }
}

export async function bulkImportStatement(_prev: BulkImportState, formData: FormData): Promise<BulkImportState> {
  const employee = await requireCapability("csv_upload");
  const supabase = createServiceRoleClient();

  const tableKey = String(formData.get("table_key") ?? "");
  const config = importTableByKey(tableKey);
  if (!config) return { error: "Unknown import target.", tableKey: null, imported: null, results: null };

  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) return { error: "Select a company first.", tableKey, imported: null, results: null };
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", tableKey, imported: null, results: null };
  }

  const parsed = await readBulkFile(formData.get("file"), config);
  if ("error" in parsed) return { error: parsed.error, tableKey, imported: null, results: null };
  const { rows, headerKeys, headerLineNo } = parsed;
  if (!rows.length) return { error: "No data rows found in the file.", tableKey, imported: null, results: null };
  if (rows.length > MAX_BULK_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_ROWS} or fewer at a time.`, tableKey, imported: null, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  const dbRows: Record<string, unknown>[] = [];
  const results: BulkImportResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = headerLineNo + 1 + i;
    const missingRequired = config.columns.find((c) => c.required && !cellRaw(raw, byHeader, c.header));
    if (missingRequired) {
      results.push({ row: rowNum, error: `Missing required "${missingRequired.header}".` });
      continue;
    }
    const dbRow: Record<string, unknown> = { company_id: companyId, ...config.fixedValues };
    for (const col of config.columns) {
      dbRow[col.dbColumn] = convertCell(raw, byHeader, col);
    }
    dbRows.push(dbRow);
    results.push({ row: rowNum, error: null });
  }

  if (dbRows.length > 0) {
    const { error } = await supabase.from(config.dbTable as never).insert(dbRows as never);
    if (error) return { error: error.message, tableKey, imported: null, results: null };
  }

  return { error: null, tableKey, imported: dbRows.length, results };
}
