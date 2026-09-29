"use server";

// 2026-09-29 — "agar sabhi employe ka data download karna ho to vo bhi
// option rakhna": bulk export of the ENTIRE roster, gated to
// `employee_admin` exactly like the page it sits on. Two outputs share one
// row-fetcher so they can never disagree with each other:
//
//   • getAllEmployeesExportRows() — every column including statutory/bank
//     (PAN/UAN/PF/ESI + bank account) — the HR-grade workbook, same trust
//     level as the Edit Details dialog that already shows these fields,
//     returned to the client and written to XLSX by downloadXLSX (the
//     same client-side SheetJS helper the Backup Export button uses).
//
//   • getTeamDirectoryPdf() — the PRINTABLE contact-book PDF (name,
//     designation, role, email, WhatsApp, joining date — NO bank/PAN
//     columns, deliberately, since the same file could just as easily be
//     pinned on a notice board). Rendered server-side with
//     renderPdfToBuffer and returned as base64 so it arrives through the
//     existing authenticated action channel; no new public URL surface.
//
// Both are hard capability-gated server actions — the client sends no ids
// and the server selects every row itself.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { renderTeamDirectoryPdf, type TeamDirectoryPdfInput } from "./team-directory-pdf";
import type { EmployeeExportRow } from "./employees-header";

// The employees table is hundreds of rows at most (one per staff member,
// not per order) — a flat select with no paging is correct here; the
// paged fetchAllPages pattern exists for the orders-scale Backup Export.
export async function getAllEmployeesExportRows(): Promise<EmployeeExportRow[]> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const [employeesRaw, roles, companies] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "name, email, active, designation, employee_code, company_id, role_id, date_of_joining, whatsapp_no, gender, marital_status, dob, anniversary_date, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number, pan_number, uan_number, pf_number, esi_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name"
      )
      .order("active", { ascending: false })
      .order("name", { ascending: true }),
    supabase.from("roles").select("id, name"),
    supabase.from("companies").select("id, name"),
  ]);
  if (employeesRaw.error) throw new Error(employeesRaw.error.message);

  const roleName = new Map((roles.data ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const dash = "—";

  return (employeesRaw.data ?? []).map((e) => ({
    name: e.name,
    email: e.email,
    employeeCode: e.employee_code,
    designation: e.designation,
    roleName: roleName.get(e.role_id) ?? dash,
    companyName: companyName.get(e.company_id) ?? dash,
    active: e.active,
    dateOfJoining: e.date_of_joining,
    whatsappNo: e.whatsapp_no,
    gender: e.gender,
    maritalStatus: e.marital_status,
    dob: e.dob,
    anniversaryDate: e.anniversary_date,
    family1: [e.family_contact_1_name, e.family_contact_1_relation, e.family_contact_1_number].filter(Boolean).join(" · "),
    family2: [e.family_contact_2_name, e.family_contact_2_relation, e.family_contact_2_number].filter(Boolean).join(" · "),
    panNumber: e.pan_number,
    uanNumber: e.uan_number,
    pfNumber: e.pf_number,
    esiNumber: e.esi_number,
    bankAccountHolderName: e.bank_account_holder_name,
    bankAccountNo: e.bank_account_no,
    bankIfsc: e.bank_ifsc,
    bankName: e.bank_name,
  }));
}

const PDF_CONTACT_COLUMNS = 3;

export async function getTeamDirectoryPdf(): Promise<{ ok: boolean; base64?: string; filename?: string; error?: string }> {
  await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const [employeesRaw, roles, companies] = await Promise.all([
    supabase
      .from("employees")
      .select("name, email, active, designation, employee_code, date_of_joining, whatsapp_no, company_id, role_id")
      .eq("active", true)
      .order("name"),
    supabase.from("roles").select("id, name"),
    supabase.from("companies").select("id, name"),
  ]);
  if (employeesRaw.error) return { ok: false, error: employeesRaw.error.message };

  const roleName = new Map((roles.data ?? []).map((r) => [r.id, r.name]));
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const dash = "—";
  const fmtDate = (v: string | null): string => {
    if (!v) return dash;
    const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const people: TeamDirectoryPdfInput["people"] = (employeesRaw.data ?? []).map((e) => ({
    name: e.name,
    employeeCode: e.employee_code,
    designation: e.designation,
    role: roleName.get(e.role_id) ?? dash,
    company: companyName.get(e.company_id) ?? dash,
    email: e.email,
    whatsapp: e.whatsapp_no,
    joined: fmtDate(e.date_of_joining),
  }));

  const buffer = await renderTeamDirectoryPdf({
    generatedAtLabel: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    people,
    columns: PDF_CONTACT_COLUMNS,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    base64: buffer.toString("base64"),
    filename: `team-directory-${stamp}.pdf`,
  };
}
