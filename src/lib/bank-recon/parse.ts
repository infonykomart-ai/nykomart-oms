// Bank & Card Reconciliation (2026-09-17) — parsing layer.
//
// WHY A SEPARATE LIB: every real bank/card export has a DIFFERENT column
// set AND a different header name for the same thing (PNB "Txn Date" vs
// ICICI "Value Date" vs HDFC "Value Dt"; UTR lives in "Ref No"/"UTR
// Number"/"Chq No"...). Rather than one hand-written importer per bank,
// every statement upload is parsed by HEADER HEURISTICS + a per-account
// learned mapping (bank_recon_columns) — the user's own ask: "statement
// kesa bhi ho auto adjust kare, collom vagera sabhi, ese nahi ki ye
// collom to hai hi nahi". XLSX is read with raw:true (the 2026-08-13
// csv-upload lesson: xlsx's CSV date-sniffing silently rewrites
// DD/MM/YYYY as M/D/YYYY without it).
//
// Fingerprint: (account, date, ±amount, 8-char description stem) — the
// duplicate guard. Same file re-uploaded = all dupes; a REAL second
// payment on the same day with the same amount to the same party (the
// vendor-does-two-UTRs case) is NOT a dupe because its UTR lands in a
// different description stem — which is exactly the behaviour wanted:
// "har mahine statement dalae ya daily, duplicate entry nhi hoye".

export const RECON_FIELDS = [
  "txn_date",
  "description",
  "ref_no",
  "withdrawal",
  "deposit",
  "balance",
  "cheque_no",
] as const;

export type ReconField = (typeof RECON_FIELDS)[number];

export type ColumnMapping = Record<string, string>; // file header -> ReconField

// Per-field header heuristics, ordered most-specific first. All lowercase;
// the header is normalized before matching (lowercase, collapse separators).
const HEADER_PATTERNS: { field: ReconField; patterns: RegExp[] }[] = [
  {
    field: "txn_date",
    patterns: [
      /^(transaction|value|txn|posting|post|date of txn|entry).*(date|dt)$/,
      /^(txn|transaction|value|post|entry) date$/,
      /^(date|dt)$/,
      /date$|date\/?dt$/,
    ],
  },
  {
    field: "ref_no",
    patterns: [
      /^(utr|upi|rrn|reference|ref|txn|transaction|chq|cheque|instrument)[ ._/#-]*(no|number|n[o°]?)$/,
      /^(ref|utr|rrn|reference|remark ref)[ ._/#-]*(no|number|id)?$/,
      /utr|rrn|ref[ ._/]*no/,
    ],
  },
  {
    field: "cheque_no",
    patterns: [/^(chq|cheque|chk)[ ._/]*(no|number)?$/, /chq|cheque/],
  },
  {
    field: "withdrawal",
    patterns: [
      /^(withdrawal|withdrawl|withdraw|debit|dr)[ ._/]*(amount|amt|inr)?$/,
      /^amount[ ._/]*withdraw(n)?$/,
      /withdraw|debit amount|^dr[ ._/]*amt/,
    ],
  },
  {
    field: "deposit",
    patterns: [
      /^(deposit|credit|cr)[ ._/]*(amount|amt|inr)?$/,
      /^amount[ ._/]*deposit(ed)?$/,
      /deposit|credit amount|^cr[ ._/]*amt/,
    ],
  },
  { field: "balance", patterns: [/^(closing|running|avail(able)?|account)?[ ._/]*balance$/] },
  {
    field: "description",
    patterns: [
      /^(narration|particulars|transaction remarks|description|remarks|details|transaction details)$/,
      /^(narration|particulars|remark|remark details)$/,
      /narration|particular|description|remark|details|memo/,
    ],
  },
];

export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .replace(/[\u2019'`]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function headerMatches(normalized: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(normalized));
}

// Score a header row by how many recognized fields it would produce —
// used to find the real header among a preamble (Bank Statement 2023
// carried a 16-line preamble; same findHeaderLine idea as the generic
// CSV importer in csv-upload/actions.ts).
export function detectHeaderRow(rows: unknown[][]): { index: number; score: number } {
  let best = { index: 0, score: -1 };
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const cells = (rows[i] ?? []).map((c) => normalizeHeader(String(c ?? ""))).filter(Boolean);
    if (cells.length < 2) continue;
    let score = 0;
    for (const f of RECON_FIELDS) {
      if (cells.some((c) => headerMatches(c, HEADER_PATTERNS.find((h) => h.field === f)!.patterns))) score++;
    }
    if (score > best.score) best = { index: i, score };
  }
  return best;
}

// Learn the mapping for one account: user's saved bank_recon_columns rows
// (file header -> field) take priority; heuristics fill the rest. Returns
// the full mapping AND which fields are missing so the UI can prompt.
export function buildMapping(
  headerRow: string[],
  learned: { file_header: string; maps_to: string }[]
): { mapping: ColumnMapping; missing: ReconField[]; learnedCount: number } {
  const mapping: ColumnMapping = {};
  let learnedCount = 0;
  const byNorm = new Map<string, string>();
  for (const l of learned) {
    byNorm.set(normalizeHeader(l.file_header), l.maps_to);
  }
  const remaining = new Set<string>(RECON_FIELDS as readonly string[]);

  for (const h of headerRow) {
    const norm = normalizeHeader(h);
    if (!norm) continue;
    const saved = byNorm.get(norm);
    if (saved && (RECON_FIELDS as readonly string[]).includes(saved)) {
      mapping[h] = saved;
      learnedCount++;
      remaining.delete(saved);
      continue;
    }
    for (const { field, patterns } of HEADER_PATTERNS) {
      if (!remaining.has(field)) continue;
      if (headerMatches(norm, patterns)) {
        mapping[h] = field;
        remaining.delete(field);
        break;
      }
    }
  }
  return { mapping, missing: Array.from(remaining) as ReconField[], learnedCount };
}

// --- value parsing -------------------------------------------------------
// One money cell can arrive as "-₹1,234.56", "1234.56 Dr", "(1,234.56)",
// "1.234,56" (European thousands), or "1 234,56". Parse ALL of it; sign
// from a leading minus or trailing "Dr" never overrides the COLUMN's
// meaning (a negative deposit is still a deposit — banks do print "-").
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s || s === "--" || s === "-" || /^n\/?a$/i.test(s)) return null;
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, " ");
  // trailing "Dr"/"Cr" markers — strip (column decides direction)
  s = s.replace(/\b(dr|cr)\b\.?/gi, " ");
  const neg = /^-/.test(s.trim());
  s = s.replace(/[^0-9.,\s]/g, "").replace(/\s/g, "");
  // European style: last separator is a comma with a 2-digit tail
  const m = s.match(/^([\d.,]+)$/);
  if (!m) return null;
  let t = m[1] as string;
  if (/,\d{2}$/.test(t) && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg || negParen ? -Math.abs(n) : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// Accepts: 2026-09-01, 01-09-2026, 01/09/2026, 1-Sep-2026, "Sep 1, 2026",
// "September 01, 2026", native Date, and Excel serial numbers. Never
// fabricates a date for an unparseable cell (BRAIN.md §4 gotcha — the row
// is skipped and reported, not guessed).
export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return iso(raw);
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 20000 && raw < 60000) {
    // Excel serial (1900 system, ignoring the 1900 leap-year quirk's ±1day
    // edge — bank exports that embed true serials are .xlsx which xlsx
    // already converts; this branch is belt-over-braces for CSV "45000")
    const ms = Math.round((raw - 25569) * 86400000);
    return iso(new Date(ms));
  }
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const [, a, b] = m;
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    let day = Number(a);
    let month = Number(b);
    if (day > 12 && month <= 12) {
      // unambiguous DD/MM
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day]; // M/D
    }
    // both <= 12: assume DD/MM (Indian banks) — the codebase's established
    // convention (date_dmy on the UK/AU Amazon importers).
    return iso(new Date(Number(y), month - 1, day));
  }

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (month) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return iso(new Date(Number(y), month - 1, Number(m[1])));
    }
  }

  m = s.match(/^([A-Za-z]{3,9})[-\s.](\d{1,2}),?[-\s.](\d{2,4})/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (month) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return iso(new Date(Number(y), month - 1, Number(m[2])));
    }
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : iso(d);
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// --- dedupe fingerprint --------------------------------------------------
export function statementFingerprint(input: {
  recon_account_id: string;
  txn_date: string | null;
  cr_amount: number | null;
  dr_amount: number | null;
  description: string | null;
  ref_no: string | null;
}): string {
  // UTR/ref-no-first when present: two same-day same-amount payments to
  // the same party are two REAL rows and must both import (the UTR inside
  // the narration differs); a true re-upload has the same UTR.
  if (input.ref_no && input.ref_no.trim()) {
    return `${input.recon_account_id}|ref:${input.ref_no.trim().toLowerCase()}`;
  }
  const stem = descStem(input.description);
  const amt = input.cr_amount != null ? `cr${input.cr_amount.toFixed(2)}` : `dr${(input.dr_amount ?? 0).toFixed(2)}`;
  return `${input.recon_account_id}|${input.txn_date ?? "nodate"}|${amt}|${stem}`;
}

// First 8 alnum chars of the narration's "meaningful" content: strips the
// leading UTR/ref number banks prepend/append, and currency symbols.
export function descStem(description: string | null): string {
  const s = String(description ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const tokens = s.split(/\s+/).filter(Boolean);
  const core = tokens.filter((t) => !/^(upi|neft|imps|rtgs|nach|ecs|ach|by|to|from|in|of|no|ref|clg|chq|txn|trf|pymt|payment)$/.test(t));
  return (core.length ? core : tokens).slice(0, 4).join(" ").replace(/ /g, "").slice(0, 8) || "narr";
}

// --- workbook reading ----------------------------------------------------
// Shared with csv-upload's reader but with recon-specific header detection.
export async function readStatementWorkbook(
  buf: ArrayBuffer
): Promise<{ headerRow: string[]; rows: Record<string, unknown>[]; headerLineNo: number } | { error: string }> {
  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(buf, { type: "array", raw: true });
  } catch {
    return { error: "Could not read that file — upload the bank's original CSV/Excel export." };
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { error: "That file has no readable sheet." };
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  if (!aoa.length) return { error: "That file has no data rows." };

  const { index } = detectHeaderRow(aoa);
  const headerRow = (aoa[index] ?? []).map((c) => String(c ?? ""));
  const rows: Record<string, unknown>[] = [];
  for (let i = index + 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue;
    const first = raw.find((c) => String(c ?? "").trim() !== "");
    if (first !== undefined && /^(total|totals|grand total|subtotal|sub total)$/i.test(String(first).trim())) continue;
    const obj: Record<string, unknown> = {};
    headerRow.forEach((h, idx) => {
      obj[h] = raw[idx] ?? "";
    });
    rows.push(obj);
  }
  return { headerRow, rows, headerLineNo: index + 1 };
}

// Convert raw file rows -> statement DB rows using a mapping. Returns
// per-row outcomes; unmapped-row (no date AND no amount) is SKIPPED and
// reported, never silently dropped and never guessed (BRAIN.md §4).
export type ParsedStatementRow = {
  rowNumber: number;
  txn_date: string | null;
  description: string | null;
  ref_no: string | null;
  cheque_no: string | null;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
};

export function parseStatementRows(
  rows: Record<string, unknown>[],
  headerRow: string[],
  mapping: ColumnMapping,
  headerLineNo: number
): { parsed: ParsedStatementRow[]; skipped: { row: number; reason: string }[] } {
  const parsed: ParsedStatementRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = headerLineNo + 1 + i;
    const raw = rows[i];
    const out: ParsedStatementRow = {
      rowNumber,
      txn_date: null,
      description: null,
      ref_no: null,
      cheque_no: null,
      withdrawal: null,
      deposit: null,
      balance: null,
    };
    for (const [header, field] of Object.entries(mapping)) {
      if (!(header in raw)) continue;
      const v = raw[header];
      switch (field) {
        case "txn_date":
          out.txn_date = parseDate(v);
          break;
        case "description":
          out.description = v === null || v === undefined ? null : String(v).trim() || null;
          break;
        case "ref_no":
          out.ref_no = v === null || v === undefined ? null : String(v).trim() || null;
          break;
        case "cheque_no":
          out.cheque_no = v === null || v === undefined ? null : String(v).trim() || null;
          break;
        case "withdrawal":
          out.withdrawal = parseAmount(v);
          break;
        case "deposit":
          out.deposit = parseAmount(v);
          break;
        case "balance":
          out.balance = parseAmount(v);
          break;
      }
    }
    // single signed amount column support: if no withdrawal/deposit column
    // mapped but a "Amount"-like description exists, heuristic already
    // handled via withdrawal/deposit patterns; if neither landed and there
    // is no date either, it's not a data row.
    if (out.txn_date === null && out.withdrawal === null && out.deposit === null) {
      skipped.push({ row: rowNumber, reason: "No recognizable date or amount in this row (check column mapping)." });
      continue;
    }
    parsed.push(out);
  }
  return { parsed, skipped };
}
