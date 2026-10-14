// 2026-10-13 — cell/header logic for the generic statement importer
// (src/app/dashboard/csv-upload/actions.ts), extracted into a pure module
// so it can be stub-tested without a database or a File (same pattern as
// ad-spend/daily-sheet-stats.ts). Also hosts the three auto-detection
// helpers added for the merged Amazon tab: headerPattern column matching,
// currency capture from the Total column header, and per-file date-order
// detection (date_auto).
//
// History: the number/date cleaning below was fixed against real Etsy and
// Amazon exports on 2026-08-13 (currency-formatted amounts, DD/MM vs M/D
// dates, xlsx date-sniffing) — keep those behaviors when touching this.
import type { ImportColumn, ImportTableConfig } from "./tables";

export function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}

/**
 * Map each configured column to the header the FILE actually uses:
 * exact (case/whitespace-insensitive) match first, else the column's own
 * headerPattern (e.g. Amazon's "Total (GBP)"/"Total (USD)"/"Total (AUD)"
 * against a configured "Total"). Columns the file doesn't carry are
 * simply absent — required-checks then report them as missing, optional
 * ones import as null.
 */
export function resolveColumnHeaders(headerKeys: string[], columns: ImportColumn[]): Map<string, string> {
  const byNorm = new Map<string, string>();
  for (const k of headerKeys) {
    const n = normalizeHeader(k);
    if (!byNorm.has(n)) byNorm.set(n, k);
  }
  const resolved = new Map<string, string>();
  for (const col of columns) {
    const exact = byNorm.get(normalizeHeader(col.header));
    if (exact) {
      resolved.set(col.header, exact);
      continue;
    }
    if (col.headerPattern) {
      const hit = headerKeys.find((k) => col.headerPattern!.test(k));
      if (hit) resolved.set(col.header, hit);
    }
  }
  return resolved;
}

/**
 * Values read OUT of a matching header, once per file (same for every
 * row) — Amazon's marketplace currency from "Total (GBP)" etc., group 1
 * of the pattern (keeps the header's own casing: "GBP"). A capture that
 * matches nothing is reported back as `missing` so the caller can fail
 * BEFORE inserting anything instead of storing a blank/wrong currency.
 */
export function captureHeaderValues(
  headerKeys: string[],
  captures: NonNullable<ImportTableConfig["headerCaptures"]>
): { values: Record<string, string>; missing: { dbColumn: string } | null } {
  const values: Record<string, string> = {};
  for (const cap of captures) {
    let value = "";
    for (const k of headerKeys) {
      const m = cap.pattern.exec(k);
      if (m && m[1]?.trim()) {
        value = m[1].trim();
        break;
      }
    }
    if (!value) return { values, missing: { dbColumn: cap.dbColumn } };
    values[cap.dbColumn] = value;
  }
  return { values, missing: null };
}

/**
 * date_auto: decide D/M vs M/D by SCANNING the file's own dates — any
 * first component > 12 proves DD/MM, any second component > 12 proves
 * M/D (majority wins on a inconsistently-written file). Fully ambiguous
 * files fall back to the column's dateDefault (declared per config —
 * Amazon's UK/Australia exports are DD/MM, the US one is M/D).
 */
export function detectDateOrder(values: string[], col: ImportColumn): "dmy" | "mdy" {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy += 1;
    else if (b > 12 && a <= 12) mdy += 1;
  }
  if (dmy === 0 && mdy === 0) return col.dateDefault ?? "dmy";
  return mdy > dmy ? "mdy" : "dmy";
}

/**
 * Convert one raw cell to its DB value. `dateOrder` only matters for
 * date_auto (the file-level decision from detectDateOrder).
 */
export function convertCell(raw: string, col: ImportColumn, dateOrder?: "dmy" | "mdy"): unknown {
  if (!raw) return null;
  switch (col.type) {
    // Amount columns come currency-formatted ("₹18,348", "-₹18", "$1,234.56",
    // Etsy's "--") — strip everything except digits/minus/decimal-point
    // (handles ₹, $, £, €, AUD$, commas); "--" collapses to "-" → NaN → null.
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
    // The SAME "Date" header is DD/MM/YYYY on the UK/Australia Amazon
    // exports and M/D/YYYY on the US one — convert explicitly to ISO
    // rather than leaving it to Postgres' DateStyle to guess (and
    // silently misread one of them). date_auto uses the file-level
    // decision; if that decision still produces an impossible month but
    // the other side is valid, swap (per-row self-heal), and pass
    // through unparseable/nonsense values so the DB fails loudly.
    case "date_dmy":
    case "date_mdy":
    case "date_auto": {
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return raw;
      const first = Number(m[1]);
      const second = Number(m[2]);
      const forcedDmy = first > 12 && second <= 12;
      const forcedMdy = second > 12 && first <= 12;
      const useMdy =
        col.type === "date_mdy" ? true : col.type === "date_dmy" ? false : forcedMdy || (!forcedDmy && dateOrder === "mdy");
      let month = useMdy ? first : second;
      let day = useMdy ? second : first;
      if (month > 12 && day <= 12) {
        const swap = month;
        month = day;
        day = swap;
      }
      if (month > 12 || day > 31) return raw;
      return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    case "date":
    case "text":
    default:
      return raw;
  }
}
