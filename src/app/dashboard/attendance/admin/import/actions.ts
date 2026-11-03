"use server";

// 2026-10-01 — "TEAM OFFICE SE PUNCH KI HO YA KISI OR PARKAR KI REPORT
// SUBMIT KARNE KA OPTION BHI HO JISSE SABKI SALARY BANA SAKU": server
// side of the punch-report import. File (CSV/TSV/XLSX) or pasted text →
// parsePunchRows (pure, src/lib/attendance/punch-import.ts) → match each
// row to an employee by employee_code (name fallback) → write attendance
// rows that the existing reports AND the salary pipeline already read.
//
// Write policy (deliberate — an import must never silently clobber
// something a human or the web punch already recorded):
//  - No row for that employee+date        → INSERT with the device punch
//    as the real punch_in/punch_out (source 'TeamOffice Import') so
//    reports/salary see the day.
//  - Row already has punches (Web Punch)  → punch/status UNTOUCHED;
//    device_punch_in/out + match_flag record what the device said
//    ('✅ Match' / '⚠️ Mismatch: IN 09:29 vs 09:40').
//  - Row is Leave / Holiday / Week Off    → punch/status UNTOUCHED
//    (an approved leave is never silently overridden); device columns +
//    mismatch flag still record the punch.
//  - Row is Absent / Half Day / no status → device punches applied;
//    status upgraded from Absent to Present/Late, Half Day kept.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parsePunchRows, splitDelimitedText, type PunchImportRow } from "@/lib/attendance/punch-import";

export type ImportState = {
  error: string | null;
  summary: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    /** Rows that already had a punch and disagreed with the device's (⚠️). */
    mismatched: number;
    /** Rows that already had a punch and agreed exactly (✅). */
    matched: number;
  } | null;
  issues: string[];
  /**
   * 2026-10-19 — "attendance sheet sahi se compare ho rahi hai kya": the
   * device-vs-web comparison was written into the attendance row's
   * match_flag but shown to nobody, so there was no way to answer that
   * question. Every row the import touched now reports its own comparison
   * here, and the form renders it as a table.
   */
  comparison: ComparisonRow[];
};

export type ComparisonRow = {
  line: number;
  employee: string;
  date: string;
  webIn: string | null;
  webOut: string | null;
  deviceIn: string | null;
  deviceOut: string | null;
  verdict: string;
};

const EMPTY: ImportState = { error: null, summary: null, issues: [], comparison: [] };
/** Cap on the returned comparison table (a month's import is ~31 × headcount). */
const MAX_COMPARISON_ROWS = 400;
const MAX_ROWS = 1000;
const MAX_FILE_BYTES = 900_000;
// Same "after 9:45 AM" cut-off the web punch uses (src/lib/attendance/punch.ts).
const LATE_CUTOFF_MIN = 9 * 60 + 45;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function deriveStatus(inTime: string | null): "Present" | "Late" {
  if (!inTime) return "Present";
  const [h, m] = inTime.split(":").map(Number);
  return h * 60 + m > LATE_CUTOFF_MIN ? "Late" : "Present";
}

/** timestamptz ISO → IST "HH:MM" for the device-vs-web comparison. */
function isoToIstHM(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "HH:MM" on an IST calendar date → the timestamptz instant to store. */
function istInstant(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00+05:30`;
}

function buildMatchFlag(
  existingIn: string | null,
  existingOut: string | null,
  devIn: string | null,
  devOut: string | null
): string {
  const eIn = isoToIstHM(existingIn);
  const eOut = isoToIstHM(existingOut);
  if (eIn === devIn && eOut === devOut) return "✅ Match";
  const parts: string[] = [];
  if (eIn !== devIn) parts.push(`IN ${eIn ?? "—"} vs ${devIn ?? "—"}`);
  if (eOut !== devOut) parts.push(`OUT ${eOut ?? "—"} vs ${devOut ?? "—"}`);
  return `⚠️ Mismatch: ${parts.join(" / ")}`;
}

async function readAoa(file: FormDataEntryValue | null, pastedText: string): Promise<{ aoa: unknown[][] } | { error: string }> {
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "File too large (~1MB server-action limit) — split it into smaller date ranges." };
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
      const text = new TextDecoder().decode(buf);
      return { aoa: splitDelimitedText(text) };
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array", raw: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) return { error: "That workbook has no readable sheet." };
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
      return { aoa };
    } catch {
      return { error: "Could not read that Excel file — re-save it as .xlsx or .csv and try again." };
    }
  }
  if (pastedText.trim()) return { aoa: splitDelimitedText(pastedText) };
  return { error: "Choose a file or paste the report rows first." };
}

export async function importPunchReport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const admin = await requireCapability("attendance_admin");

  const parsedFile = await readAoa(formData.get("file"), str(formData, "pasted"));
  if ("error" in parsedFile) return { ...EMPTY, error: parsedFile.error };

  const fallbackRaw = str(formData, "fallback_date");
  const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(fallbackRaw) ? fallbackRaw : null;
  if (fallbackRaw && !fallbackDate) return { ...EMPTY, error: "Fallback date must be YYYY-MM-DD." };

  const parsed = parsePunchRows(parsedFile.aoa, fallbackDate);
  if (!parsed.rows.length) return { ...EMPTY, error: "No usable rows found.", issues: parsed.issues };
  if (parsed.rows.length > MAX_ROWS) {
    return { ...EMPTY, error: `Too many rows (${parsed.rows.length}) — import in batches of up to ${MAX_ROWS}.`, issues: parsed.issues };
  }

  const supabase = createServiceRoleClient();
  const { data: empRows, error: empError } = await supabase
    .from("employees")
    .select("id, name, employee_code, company_id")
    .in("company_id", admin.companyIds);
  if (empError) return { ...EMPTY, error: `Could not load employees: ${empError.message}` };
  const employees = empRows ?? [];

  // code/name → employee. null = ambiguous (same code/name on two rows) —
  // never guess which one, report it instead.
  const byCode = new Map<string, (typeof employees)[number] | null>();
  const byName = new Map<string, (typeof employees)[number] | null>();
  // 2026-10-19 — Excel (and TeamOffice's own matrix export) happily hands
  // back "2" where the employee_code is stored as "0002". Keep a second,
  // leading-zero-insensitive index so a code typed either way still finds
  // its employee instead of reporting "no active employee matches code".
  // 2026-11-03 — widened to digits-only: the roster stores "EMP0002" /
  // "NY-002" for some staff while the device sheet prints "0002", and the
  // old numeric-only index missed exactly those ("Row 15: no active
  // employee matches code '0002'"). Prefixes, dashes and spaces are now
  // ignored on both sides; ambiguity is still never guessed.
  const byDigits = new Map<string, (typeof employees)[number] | null>();
  const normName = (n: string) =>
    n
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const digitKey = (c: string) => {
    const digits = c.replace(/\D/g, "");
    return digits ? digits.replace(/^0+/, "") || "0" : "";
  };
  for (const e of employees) {
    const code = (e.employee_code ?? "").trim().toLowerCase();
    if (code) {
      byCode.set(code, byCode.has(code) ? null : e);
      const digits = digitKey(code);
      if (digits) byDigits.set(digits, byDigits.has(digits) ? null : e);
    }
    const name = normName(e.name);
    if (name) byName.set(name, byName.has(name) ? null : e);
  }

  const issues = [...parsed.issues];
  const pushIssue = (msg: string) => {
    if (issues.length < 60) issues.push(msg);
  };

  // Unmatched rows are grouped by what they asked for (code + name) instead
  // of one identical line per date — a month's sheet previously produced a
  // wall of fifty "Row 15: no active employee matches code '0002'" lines and
  // hid the real problem.
  const unmatched = new Map<string, { line: number; count: number; code: string; name: string }>();
  const noteUnmatched = (code: string, name: string, line: number) => {
    const key = `${code.toLowerCase()}||${name.toLowerCase()}`;
    const existing = unmatched.get(key);
    if (existing) existing.count++;
    else unmatched.set(key, { line, count: 1, code, name });
  };

  type Plan = { row: PunchImportRow; emp: (typeof employees)[number]; existing: ExistingRow | null };
  type ExistingRow = {
    id: string;
    punch_in: string | null;
    punch_out: string | null;
    status: string | null;
    source: string;
  };
  const resolved: Plan[] = [];
  let skipped = 0;

  for (const row of parsed.rows) {
    const codeKey = row.code.trim().toLowerCase();
    const nameKey = normName(row.name);
    let emp: (typeof employees)[number] | null | undefined;
    if (codeKey) emp = byCode.get(codeKey);
    if (emp === undefined && codeKey) {
      const digits = digitKey(codeKey);
      if (digits) emp = byDigits.get(digits);
    }
    if (emp === undefined || emp === null) emp = nameKey ? byName.get(nameKey) : undefined;
    if (emp === null) {
      skipped++;
      pushIssue(`Duplicate employee "${row.code || row.name}" in your roster — fix employee_code first.`);
      continue;
    }
    if (!emp) {
      skipped++;
      noteUnmatched(row.code, row.name, row.line);
      continue;
    }
    resolved.push({ row, emp, existing: null });
  }

  // One line per unmatched employee, with the closest roster entries so the
  // fix (a wrong employee_code, or a staff member on another company) is
  // obvious without exporting the roster.
  if (unmatched.size > 0) {
    const rosterHint = (code: string, name: string) => {
      const q = (code || name).trim().toLowerCase();
      if (!q) return "";
      const near = employees
        .filter((e) => {
          const ec = (e.employee_code ?? "").toLowerCase();
          return (
            ec.includes(q) ||
            normName(e.name).includes(normName(name || code)) ||
            (digitKey(ec) !== "" && digitKey(ec) === digitKey(code))
          );
        })
        .slice(0, 3)
        .map((e) => `"${e.employee_code ?? "—"} ${e.name}"`);
      return near.length ? ` Closest in roster: ${near.join(", ")}.` : ` Roster me ${employees.length} employee hain — code/naam milta nahi.`;
    };
    for (const u of unmatched.values()) {
      pushIssue(
        `Row ${u.line}: employee code "${u.code || "(blank)"}"${u.name ? ` / name "${u.name}"` : ""} roster me nahi mila` +
          `${u.count > 1 ? ` (${u.count} punch rows)` : ""}.${rosterHint(u.code, u.name)}`
      );
    }
  }

  if (!resolved.length) return { ...EMPTY, error: "No rows matched an employee.", issues };

  // Existing attendance rows for the resolved employees across the import date span —
  // chunked so the IN-list stays well within PostgREST limits.
  const empIds = Array.from(new Set(resolved.map((r) => r.emp.id)));
  const dates = resolved.map((r) => r.row.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const existingBy = new Map<string, ExistingRow>();
  for (let i = 0; i < empIds.length; i += 150) {
    const chunk = empIds.slice(i, i + 150);
    const { data, error } = await supabase
      .from("attendance")
      .select("id, employee_id, attendance_date, punch_in, punch_out, status, source")
      .in("employee_id", chunk)
      .gte("attendance_date", minDate)
      .lte("attendance_date", maxDate);
    if (error) return { ...EMPTY, error: `Could not load existing attendance: ${error.message}`, issues };
    for (const r of data ?? []) {
      existingBy.set(`${r.employee_id}|${r.attendance_date}`, {
        id: r.id,
        punch_in: r.punch_in,
        punch_out: r.punch_out,
        status: r.status,
        source: r.source,
      });
    }
  }
  for (const plan of resolved) {
    plan.existing = existingBy.get(`${plan.emp.id}|${plan.row.date}`) ?? null;
  }

  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const comparison: ComparisonRow[] = [];
  let imported = 0;
  let updated = 0;
  let mismatched = 0;
  let matched = 0;
  const pushComparison = (row: ComparisonRow) => {
    if (comparison.length < MAX_COMPARISON_ROWS) comparison.push(row);
  };

  for (const { row, emp, existing } of resolved) {
    const devIn = row.inTime;
    const devOut = row.outTime;
    const deviceFields = {
      device_punch_in: devIn,
      device_punch_out: devOut,
      device_status: deriveStatus(devIn),
    };

    if (!existing) {
      imported++;
      inserts.push({
        employee_id: emp.id,
        company_id: emp.company_id,
        attendance_date: row.date,
        punch_in: devIn ? istInstant(row.date, devIn) : null,
        punch_out: devOut ? istInstant(row.date, devOut) : null,
        status: deriveStatus(devIn),
        source: "TeamOffice Import",
        match_flag: "— (single source)",
        entered_by_employee_id: admin.id,
        ...deviceFields,
      });
      pushComparison({
        line: row.line,
        employee: emp.name,
        date: row.date,
        webIn: null,
        webOut: null,
        deviceIn: devIn,
        deviceOut: devOut,
        verdict: "➕ Imported (no web punch that day)",
      });
      continue;
    }

    const patch: Record<string, unknown> = { ...deviceFields, entered_by_employee_id: admin.id };
    const webIn = isoToIstHM(existing.punch_in);
    const webOut = isoToIstHM(existing.punch_out);

    if (existing.punch_in) {
      // Web/manual punch already recorded — keep it authoritative, only
      // record what the device said alongside it.
      patch.match_flag = buildMatchFlag(existing.punch_in, existing.punch_out, devIn, devOut);
    } else if (existing.status === "Leave" || existing.status === "Holiday" || existing.status === "Week Off") {
      patch.match_flag = buildMatchFlag(null, null, devIn, devOut);
    } else {
      patch.punch_in = devIn ? istInstant(row.date, devIn) : null;
      patch.punch_out = devOut ? istInstant(row.date, devOut) : null;
      // Absent/null status gets upgraded to the device truth; Half Day is a
      // human decision and stays.
      if (existing.status !== "Half Day") patch.status = deriveStatus(devIn);
      patch.match_flag = buildMatchFlag(existing.punch_in, existing.punch_out, devIn, devOut);
    }

    const flag = String(patch.match_flag);
    if (flag.startsWith("⚠️")) mismatched++;
    else if (flag === "✅ Match") matched++;
    // A Leave/Holiday/Week Off row is deliberately NOT overwritten — say so
    // in the comparison instead of leaving the reader to guess why the times
    // on screen still don't match the sheet.
    const kept = existing.status === "Leave" || existing.status === "Holiday" || existing.status === "Week Off";
    pushComparison({
      line: row.line,
      employee: emp.name,
      date: row.date,
      webIn,
      webOut,
      deviceIn: devIn,
      deviceOut: devOut,
      verdict: `${flag}${kept ? ` · ${existing.status} kept as-is (imported punch stored separately)` : ""}`,
    });
    updates.push({ id: existing.id, patch });
    updated++;
  }

  for (let i = 0; i < inserts.length; i += 100) {
    const { error } = await supabase.from("attendance").insert(inserts.slice(i, i + 100) as never);
    if (error) return { ...EMPTY, error: `Insert failed: ${error.message}`, issues };
  }
  for (const u of updates) {
    const { error } = await supabase.from("attendance").update(u.patch as never).eq("id", u.id);
    if (error) return { ...EMPTY, error: `Update failed: ${error.message}`, issues };
  }

  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance/admin/import");
  revalidatePath("/dashboard/attendance/admin/monthly-report");
  revalidatePath("/dashboard/attendance");

  return {
    error: null,
    summary: { total: parsed.rows.length, imported, updated, skipped, matched, mismatched },
    issues,
    comparison,
  };
}
