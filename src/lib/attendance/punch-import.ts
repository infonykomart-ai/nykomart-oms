// 2026-10-01 — "TEAM OFFICE SE PUNCH KI HO YA KISI OR PARKAR KI REPORT
// SUBMIT KARNE KA OPTION BHI HO JISSE SABKI SALARY BANA SAku": pure
// parsing layer for importing punches recorded OUTSIDE this app (a
// TeamOffice biometric daily IN/OUT export, or any sheet with the same
// shape) into the attendance table, so reports and the salary pipeline
// see those days like any other punch.
//
// Pure functions only — no Supabase, no server-only APIs — so the
// server action stays a thin wrapper around "rows in → normalized rows +
// human-readable issues out". Column matching is deliberately forgiving
// (TeamOffice's own headers are "Empcode / INTime / OUTTime", other
// tools say "Employee Code / Punch In / Time In", and hand-typed pastes
// may have no header at all), but every row's DATE and TIME still have
// to parse unambiguously or the row is reported as an issue instead of
// being guessed at.
//
// Date convention: DAY-FIRST (dd/mm/yyyy) — Indian/TeamOffice default.
// A cell like 13/01/2026 can only be dd/mm, and when the first part is
// >12 we still take it as the day; only a clearly month-first cell
// (second part >12) is swapped, so "01/13/2026" also works.

export type PunchImportRow = {
  line: number; // 1-indexed line in the source file/paste (as the user sees it)
  code: string; // employee_code as typed ("" when matched by name only)
  name: string; // employee name as typed ("" when code matched)
  date: string; // "YYYY-MM-DD"
  inTime: string | null; // "HH:MM" IST
  outTime: string | null; // "HH:MM" IST
};

export type PunchParseResult = {
  rows: PunchImportRow[];
  issues: string[];
};

const MAX_ISSUES = 40;

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CODE_HEADERS = ["empcode", "employeecode", "code", "empid", "employeeid", "empno", "employeeno"];
const NAME_HEADERS = ["name", "employeename", "empname"];
const DATE_HEADERS = ["date", "punchdate", "attendancedate", "day"];
const IN_HEADERS = ["intime", "in", "punchin", "timein"];
const OUT_HEADERS = ["outtime", "out", "punchout", "timeout"];

type ColumnMap = { code: number; name: number; date: number; in: number; out: number };

function mapColumns(headerRow: (string | null)[]): ColumnMap | null {
  const map: ColumnMap = { code: -1, name: -1, date: -1, in: -1, out: -1 };
  let hits = 0;
  headerRow.forEach((cell, i) => {
    const h = normalizeHeader(String(cell ?? ""));
    if (!h) return;
    if (map.code === -1 && CODE_HEADERS.includes(h)) { map.code = i; hits++; return; }
    if (map.name === -1 && NAME_HEADERS.includes(h)) { map.name = i; hits++; return; }
    if (map.date === -1 && DATE_HEADERS.includes(h)) { map.date = i; hits++; return; }
    if (map.in === -1 && IN_HEADERS.includes(h)) { map.in = i; hits++; return; }
    if (map.out === -1 && OUT_HEADERS.includes(h)) { map.out = i; hits++; return; }
  });
  // A real header row must identify at least the punch columns plus who/when.
  if (hits >= 2 && map.code !== -1 && (map.in !== -1 || map.out !== -1)) return map;
  if (hits >= 2 && map.name !== -1 && map.date !== -1 && (map.in !== -1 || map.out !== -1)) return map;
  return null;
}

/** "01/10/2026" | "01-10-2026" | "2026-10-01" | "1 Oct 2026" → "YYYY-MM-DD" (day-first). */
export function parseDateCell(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Excel serial date (1900 date system): days since 1899-12-30.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12 && day <= 12) {
      // Clearly month-first (01/13/2026) — swap.
      const t = day;
      day = month;
      month = t;
    }
    if (day > 31 || month > 12) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** "09:29" | "9:29 AM" | "14:39:00" | "  -- " → "HH:MM" | null. */
export function parseTimeCell(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  if (!s || /^[-—–]+$/.test(s) || /^(na|n\/a|null|nil|-)$/i.test(s)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3]?.toLowerCase();
  if (min > 59) return null;
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function isBlankRow(row: (string | null | undefined)[]): boolean {
  return row.every((c) => String(c ?? "").trim() === "");
}

/**
 * aoa → normalized rows. `fallbackDate` (YYYY-MM-DD) is used when the
 * file has no date column (TeamOffice's Daily IN/OUT report carries its
 * date in the title, not per row). Unparseable rows are never guessed —
 * they come back as issues with their source line number.
 */
export function parsePunchRows(aoa: unknown[][], fallbackDate: string | null): PunchParseResult {
  const issues: string[] = [];
  const rows: PunchImportRow[] = [];
  const pushIssue = (msg: string) => {
    if (issues.length < MAX_ISSUES) issues.push(msg);
  };

  const dataRows = (aoa ?? []).filter((r) => !isBlankRow(r as (string | null | undefined)[]));
  if (!dataRows.length) return { rows, issues: ["The file/paste has no non-empty rows."] };

  let map = mapColumns(dataRows[0] as (string | null)[]);
  let bodyStart = 1;
  if (!map) {
    // No header — assume a positional layout. The positions are guessed
    // from the first data row and VERIFIED against it, otherwise a leading
    // column (e.g. a row number or a stray Status column) silently shifts
    // every column and drops most rows as "no IN/OUT time" / "no employee".
    const first = dataRows[0];
    const candidates: ColumnMap[] = [];
    if (first.length >= 5) {
      // code,name,date,in,out
      candidates.push({ code: 0, name: 1, date: 2, in: 3, out: 4 });
    }
    if (first.length >= 4) {
      // code,date,in,out
      candidates.push({ code: 0, name: -1, date: 1, in: 2, out: 3 });
    }
    const valid = candidates.filter((c) => {
      const row = dataRows[0] as (string | null)[];
      const dateOK = parseDateCell(row[c.date]) !== null;
      const inOK = parseTimeCell(row[c.in]) !== null;
      const outOK = parseTimeCell(row[c.out]) !== null;
      return dateOK && inOK && outOK;
    });
    if (valid.length > 0) {
      // Prefer the 5-column layout (TeamOffice exports include the
      // employee name); otherwise the 4-column compact layout.
      map = valid[0];
      bodyStart = 0;
    } else {
      // Neither candidate validates — do not silently shift columns and
      // report the mismatch to the user with the exact fix.
      pushIssue(
        `No header row found and the first data row does not match a positional layout (code,date,in,out or code,name,date,in,out). A leading column or shifted cells mean the columns need to be re-ordered, or paste a header row (Empcode, Name, Date, IN, OUT).`
      );
      map = { code: 0, name: -1, date: 1, in: 2, out: 3 };
      bodyStart = 0;
    }
  }

  let usedFallback = false;
  for (let i = bodyStart; i < dataRows.length; i++) {
    const raw = dataRows[i] as unknown[];
    const line = i + 1;
    const code = map.code >= 0 ? String(raw[map.code] ?? "").trim() : "";
    const name = map.name >= 0 ? String(raw[map.name] ?? "").trim() : "";
    if (!code && !name) {
      pushIssue(`Row ${line}: no employee code/name — skipped.`);
      continue;
    }

    let date: string | null = map.date >= 0 ? parseDateCell(raw[map.date]) : null;
    if (!date && fallbackDate) {
      date = fallbackDate;
      usedFallback = true;
    }
    if (!date) {
      pushIssue(`Row ${line}: could not read the date${map.date === -1 ? " (no Date column — set the fallback date above)" : ""} — skipped.`);
      continue;
    }

    const inTime = map.in >= 0 ? parseTimeCell(raw[map.in]) : null;
    const outTime = map.out >= 0 ? parseTimeCell(raw[map.out]) : null;
    if (!inTime && !outTime) {
      pushIssue(`Row ${line} (${code || name}, ${date}): no IN/OUT time — skipped.`);
      continue;
    }

    rows.push({ line, code, name, date, inTime, outTime });
  }

  if (usedFallback && rows.length) {
    issues.unshift(`No Date column found — fallback date ${fallbackDate} applied to ${rows.length} row(s).`);
  }
  if (issues.length >= MAX_ISSUES) issues.push(`…issues truncated at ${MAX_ISSUES}.`);
  return { rows, issues };
}

/** Minimal RFC4180-ish CSV/TSV splitter (quoted fields, commas/semicolons/tabs). */
export function splitDelimitedText(text: string): unknown[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const first = lines[0];
  const delimiter = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}
