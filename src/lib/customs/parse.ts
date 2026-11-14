// Parsers for official customs-rate inputs — pure, unit tested.
//
// Three input shapes:
//   1. CSV  — the administrator's export of the official notification table,
//              or a file downloaded from an authorized official source.
//   2. PDF  — the notification itself, read as layout text (the app already
//              ships a visual-order PDF text extractor for courier bills).
//   3. JSON — a machine-readable feed, if an authorized one is ever provided.
//
// None of these decide whether a rate is verified. They only turn text into
// ExtractedRate rows; validation and approval live in validate.ts / ingest.ts.
import { SUPPORTED_CURRENCIES, resolveCurrency } from "./currencies";
import type { ExtractedRate } from "./types";

export type ParseResult = { rows: ExtractedRate[]; errors: string[] };

const HEADER_ALIASES: Record<string, string> = {
  currency_code: "currencyCode",
  currencycode: "currencyCode",
  code: "currencyCode",
  currency: "currencyName",
  currency_name: "currencyName",
  currencname: "currencyName",
  currency_unit: "currencyUnit",
  unit: "currencyUnit",
  imp: "importRate",
  import: "importRate",
  import_rate: "importRate",
  importrate: "importRate",
  import_rate_inr: "importRate",
  export: "exportRate",
  exp: "exportRate",
  export_rate: "exportRate",
  exportrate: "exportRate",
  export_rate_inr: "exportRate",
  effective_start_date: "effectiveStartDate",
  effective_from: "effectiveStartDate",
  effective_date: "effectiveStartDate",
  date: "effectiveStartDate",
  start_date: "effectiveStartDate",
  effective_end_date: "effectiveEndDate",
  effective_to: "effectiveEndDate",
  end_date: "effectiveEndDate",
  notification_no: "notificationNo",
  notification_number: "notificationNo",
  notification: "notificationNo",
  notification_date: "notificationDate",
  notification_published_on: "notificationDate",
};

function normalizeHeader(header: string): string {
  return header
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-()]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Minimal RFC-4180 CSV/TSV reader — handles quoted fields with commas/newlines. */
export function splitDelimitedRows(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // handled by the \n branch
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function pickDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

/**
 * Parses a CSV/TSV of customs rates. Header names are matched loosely (the
 * official table and an admin's own sheet rarely agree on spelling). A file
 * without a recognisable rate column is rejected with a clear message rather
 * than silently producing zero rows.
 */
export function parseCsvRates(text: string, fallback: { effectiveStartDate?: string } = {}): ParseResult {
  const errors: string[] = [];
  const delimiter = pickDelimiter(text);
  const table = splitDelimitedRows(text, delimiter);
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const header = table[0].map(normalizeHeader);
  const mapping = new Map<number, string>();
  header.forEach((h, i) => {
    const field = HEADER_ALIASES[h];
    if (field) mapping.set(i, field);
  });

  const has = (field: string) => Array.from(mapping.values()).includes(field);
  if (!has("currencyName") && !has("currencyCode")) {
    return {
      rows: [],
      errors: ["No currency column found. Expected a header such as Currency or Currency Code."],
    };
  }
  if (!has("exportRate") && !has("importRate")) {
    return {
      rows: [],
      errors: ["No rate column found. Expected 'Import Rate' and/or 'Export Rate' columns."],
    };
  }

  const rows: ExtractedRate[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const get = (field: string): string | null => {
      for (const [index, mapped] of mapping) {
        if (mapped === field) {
          const value = (cells[index] ?? "").trim();
          return value === "" ? null : value;
        }
      }
      return null;
    };

    const currencyRaw = get("currencyCode") ?? get("currencyName");
    if (!currencyRaw) continue; // blank/footer line

    const resolved = resolveCurrency(currencyRaw) ?? resolveCurrency(get("currencyName") ?? "");
    if (!resolved) {
      errors.push(`Row ${r + 1}: currency "${currencyRaw}" is not supported.`);
      continue;
    }

    const startDate = get("effectiveStartDate") ?? fallback.effectiveStartDate ?? "";
    rows.push({
      currencyCode: resolved.currency.code,
      currencyName: resolved.currency.name,
      currencyUnit: get("currencyUnit") ? Number(get("currencyUnit")) : null,
      importRate: get("importRate"),
      exportRate: get("exportRate"),
      effectiveStartDate: startDate,
      effectiveEndDate: get("effectiveEndDate"),
      notificationNo: get("notificationNo"),
      notificationDate: get("notificationDate"),
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("No rate rows were found in the file.");
  }
  return { rows, errors };
}

/** Extracts "Notification No. 30/2026" style references from a document. */
export function findNotificationNo(text: string): string | null {
  const match = text.match(/notification\s*(?:no\.?|number)?\s*[:\-]?\s*([0-9]{1,3}\s*\/\s*[0-9]{4})/i);
  if (match) return match[1].replace(/\s+/g, "");

  const bare = text.match(/\b([0-9]{1,3}\/20[0-9]{2})\b/);
  return bare ? bare[1] : null;
}

/** Extracts an effective / w.e.f. / published date from a notification. */
export function findNotificationDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const dmy = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const long = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (long) {
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const month = months.indexOf(long[2].toLowerCase()) + 1;
    return `${long[3]}-${String(month).padStart(2, "0")}-${long[1].padStart(2, "0")}`;
  }
  return null;
}

const NUMBER_RE = /\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/g;
const DATE_TOKEN_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a customs notification's layout text into one row per currency.
 *
 * CBIC tables print the currency name (sometimes followed by "(100)"), then
 * the import rate, then the export rate. The parser therefore takes the LAST
 * two decimal figures on the line — never the serial number or a date — and
 * leaves the export/import distinction to the column order. It is
 * intentionally conservative: a line with fewer than two decimals is recorded
 * with the single figure as the export rate only, which validation then marks
 * as needing review.
 */
export function parseNotificationText(
  text: string,
  fallback: { effectiveStartDate?: string; notificationNo?: string | null; notificationDate?: string | null } = {}
): ParseResult {
  const errors: string[] = [];
  const rows: ExtractedRate[] = [];
  const seen = new Set<string>();

  const notificationNo = fallback.notificationNo ?? findNotificationNo(text);
  const notificationDate = fallback.notificationDate ?? findNotificationDate(text);
  const effectiveStartDate = fallback.effectiveStartDate ?? notificationDate ?? "";

  // Longest names first so "Hong Kong Dollar" wins over "Dollar".
  const names = SUPPORTED_CURRENCIES.map((c) => c.name)
    .concat(["US Dollar", "UAE Dirham", "Pound Sterling", "Korean Won", "Japanese Yen"])
    .sort((a, b) => b.length - a.length);

  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (raw.length < 6) continue;
    if (/^(sr|s\.?\s*no|sl\.?\s*no|currency\s+import|notification|page\s+\d)/i.test(raw)) continue;

    // Find the currency on this line.
    let matchedName: string | null = null;
    for (const name of names) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(raw)) {
        matchedName = name;
        break;
      }
    }
    const codeToken = raw.match(/\b(USD|EUR|GBP|AED|JPY|KRW|AUD|CAD|CHF|CNY|HKD|SGD|NZD|SAR|QAR|KWD|BHD|OMR|SEK|DKK|NOK|ZAR|TRY|THB|MYR|IDR|PHP|TWD|LKR|BDT|NPR|PKR|EGP|KES|NGN|RUB|BRL|MXN|ILS)\b/);
    if (!matchedName && !codeToken) continue;

    const resolved = resolveCurrency(codeToken ? codeToken[0] : matchedName ?? "");
    if (!resolved) continue;

    const tokens = raw.match(NUMBER_RE) ?? [];
    // Drop serial numbers and dates; a rate is a decimal figure.
    const decimals = tokens.filter((t) => !DATE_TOKEN_RE.test(t) && t.includes("."));
    if (decimals.length === 0) continue;

    const values = decimals.slice(-2);
    const importRate = values.length === 2 ? values[0].replace(/,/g, "") : null;
    const exportRate = values[values.length - 1].replace(/,/g, "");

    const unitMatch = raw.match(/\(\s*(10|100|1000)\s*\)/) ?? raw.match(/^\s*\S.*?\s(10|100|1000)\s+\d/i);
    const currencyUnit = unitMatch ? Number(unitMatch[1]) : null;

    const key = `${resolved.currency.code}|${effectiveStartDate}`;
    if (seen.has(key)) {
      errors.push(`Currency ${resolved.currency.code} appears more than once in the document.`);
      continue;
    }
    seen.add(key);

    rows.push({
      currencyCode: resolved.currency.code,
      currencyName: resolved.currency.name,
      currencyUnit,
      importRate,
      exportRate,
      effectiveStartDate,
      notificationNo,
      notificationDate,
    });
  }

  if (rows.length === 0) {
    errors.push(
      "No currency rows could be read from the document. Check that it is the notification's rate table (with import and export figures), not a covering letter."
    );
  }
  return { rows, errors };
}

/**
 * Parses a machine-readable feed. Field names are matched tolerantly because
 * an authorized official feed's exact schema is not published — this is used
 * only when an administrator configures a feed URL.
 */
export function parseFeedJson(text: string): ParseResult {
  const errors: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { rows: [], errors: ["The feed did not return valid JSON."] };
  }

  const rows: ExtractedRate[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const nameRaw = obj.currency ?? obj.currency_name ?? obj.currencyName ?? obj.name;
    const exportRaw = obj.export ?? obj.export_rate ?? obj.exportRate ?? obj.exrate;
    const importRaw = obj.import ?? obj.import_rate ?? obj.importRate;
    if (nameRaw != null && exportRaw != null) {
      const resolved = resolveCurrency(String(nameRaw));
      if (resolved) {
        rows.push({
          currencyCode: resolved.currency.code,
          currencyName: resolved.currency.name,
          currencyUnit: obj.currency_unit != null ? Number(obj.currency_unit) : null,
          importRate: importRaw == null ? null : String(importRaw),
          exportRate: String(exportRaw),
          effectiveStartDate: String(obj.effective_start_date ?? obj.effectiveDate ?? obj.date ?? ""),
          effectiveEndDate: obj.effective_end_date ? String(obj.effective_end_date) : null,
          notificationNo: obj.notification_no ? String(obj.notification_no) : null,
          notificationDate: obj.notification_date ? String(obj.notification_date) : null,
        });
      }
    }
    Object.values(obj).forEach(walk);
  };
  walk(json);

  if (rows.length === 0) errors.push("The feed contained no recognisable currency rate rows.");
  return { rows, errors };
}

/** Normalizes an effective date written as DD/MM/YYYY or DD-MM-YYYY. */
export function normalizeDateInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return trimmed;
}
