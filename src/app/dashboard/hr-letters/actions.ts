"use server";

// 2026-08-27 — "jis employe ko ye latter issue ho uska record teyar hota
// jaye ... usko ek no diya jaye ... dispatch no": HR Letters had ZERO
// persistence before this (letter-form.tsx just rendered into a print
// area, nothing was ever saved) — this is the first write path into
// `hr_letters`. The table + its `ref_no` auto-numbering trigger
// (hr_letters_before_insert / trg_hr_letters_ref_no(), db/schema.sql) were
// already live in production, unused, confirmed via a direct SQL check
// 2026-08-27 (0 rows). See db/2026-08-27-hr-letters-record-and-dispatch-
// no.sql for the small schema addition this needed (content-snapshot
// columns + 1 new letter_type enum value for Termination Letter).
//
// Uses the service-role client, same as every other newer table in this
// codebase (see require-capability.ts's own comment on this) — hr_letters
// has RLS enabled+forced with no policies defined, so the capability check
// below (requireCapability("hr_letters"), same gate the HR Letters pages
// already use) is what actually protects this, not RLS.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { TEMPLATE_TO_LETTER_TYPE } from "@/lib/hr-letters/letter-type-map";

export type IssueLetterInput = {
  templateSlug: string;
  companyId: string;
  employeeId: string | null;
  employeeName: string;
  employeeCode: string | null;
  employeeAddress: string;
  /** Free-typed display date from the form (e.g. "27 August 2026") — the
   * PRINTED letter always shows this exact string; it's parsed to a real
   * date only for the record's own `letter_date` column (sorting/filtering
   * the record log), falling back to today if it doesn't parse. */
  letterDate: string;
  signatoryName: string;
  signatoryDesignation: string;
  subjectLine: string;
  fieldValues: Record<string, string>;
  bodyText: string;
};

export type IssueLetterResult = { ok: true; id: string; refNo: string } | { ok: false; error: string };

export async function issueHrLetter(input: IssueLetterInput): Promise<IssueLetterResult> {
  const employee = await requireCapability("hr_letters");

  const letterType = TEMPLATE_TO_LETTER_TYPE[input.templateSlug];
  if (!letterType) {
    return { ok: false, error: "Unknown letter template — cannot assign a dispatch number." };
  }
  if (!input.companyId) return { ok: false, error: "Select a company first." };
  if (!employee.companyIds.includes(input.companyId)) {
    return { ok: false, error: "You do not have access to this company." };
  }
  if (!input.employeeName.trim()) return { ok: false, error: "Employee name is required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Generate the letter text before issuing." };

  const parsedDate = new Date(input.letterDate);
  const letterDate = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsedDate.toISOString().slice(0, 10);

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("hr_letters")
    .insert({
      for_company_id: input.companyId,
      for_employee_id: input.employeeId,
      for_employee_name_snapshot: input.employeeName,
      for_employee_code_snapshot: input.employeeCode,
      letter_type: letterType,
      letter_date: letterDate,
      generated_by_employee_id: employee.id,
      template_slug: input.templateSlug,
      employee_address: input.employeeAddress || null,
      signatory_name: input.signatoryName || null,
      signatory_designation: input.signatoryDesignation || null,
      subject_line: input.subjectLine || null,
      field_values: input.fieldValues,
      body_text: input.bodyText,
    })
    .select("id, ref_no")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not save the letter record." };
  }

  revalidatePath("/dashboard/hr-letters/records");
  return { ok: true, id: data.id, refNo: data.ref_no ?? "" };
}
