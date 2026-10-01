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
  summary: { total: number; imported: number; updated: number; skipped: number } | null;
  issues: string[];
};

const EMPTY: ImportState = { error: null, summary: null, issues: [] };
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
  for (const e of employees) {
    const code = (e.employee_code ?? "").trim().toLowerCase();
    if (code) byCode.set(code, byCode.has(code) ? null : e);
    const name = e.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (name) byName.set(name, byName.has(name) ? null : e);
  }

  const issues = [...parsed.issues];
  const pushIssue = (msg: string) => {
    if (issues.length < 60) issues.push(msg);
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
    const codeKey = row.code.toLowerCase();
    const nameKey = row.name.toLowerCase().replace(/\s+/g, " ");
    let emp: (typeof employees)[number] | null | undefined;
    if (codeKey) emp = byCode.get(codeKey);
    if (emp === undefined || emp === null) emp = nameKey ? byName.get(nameKey) : undefined;
    if (emp === null) {
      skipped++;
      pushIssue(`Row ${row.line}: duplicate employee ${row.code || row.name} in your roster — fix employee_code first.`);
      continue;
    }
    if (!emp) {
      skipped++;
      pushIssue(`Row ${row.line}: no active employee matches code "${row.code || row.name}".`);
      continue;
    }
    resolved.push({ row, emp, existing: null });
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
  let imported = 0;
  let updated = 0;

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
      continue;
    }

    const patch: Record<string, unknown> = { ...deviceFields, entered_by_employee_id: admin.id };

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
    summary: { total: parsed.rows.length, imported, updated, skipped },
    issues,
  };
}
