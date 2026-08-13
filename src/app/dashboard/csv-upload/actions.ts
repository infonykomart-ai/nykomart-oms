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
import { importTableByKey, type ImportColumn } from "@/lib/statement-import/tables";

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
    case "date":
    case "text":
    default:
      return raw;
  }
}

const MAX_BULK_ROWS = 2000;

export type BulkImportResult = { row: number; error: string | null };
export type BulkImportState = { error: string | null; tableKey: string | null; imported: number | null; results: BulkImportResult[] | null };

async function readBulkFile(
  file: FormDataEntryValue | null
): Promise<{ rows: Record<string, unknown>[]; headerKeys: string[] } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file first." };
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][])[0];
    const headerKeys = headerRow ?? (rows.length ? Object.keys(rows[0]) : []);
    return { rows, headerKeys };
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

  const parsed = await readBulkFile(formData.get("file"));
  if ("error" in parsed) return { error: parsed.error, tableKey, imported: null, results: null };
  const { rows, headerKeys } = parsed;
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
    const rowNum = i + 2;
    const missingRequired = config.columns.find((c) => c.required && !cellRaw(raw, byHeader, c.header));
    if (missingRequired) {
      results.push({ row: rowNum, error: `Missing required "${missingRequired.header}".` });
      continue;
    }
    const dbRow: Record<string, unknown> = { company_id: companyId };
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
