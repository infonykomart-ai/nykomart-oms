import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { findTemplate } from "@/lib/hr-letters/templates";
import { notFound } from "next/navigation";
import { IssuedLetterView } from "./issued-letter-view";

// 2026-08-27 — the "baad me bhi kabhi agar dubara download kare to mil
// jaye" half of the request: reopens exactly what was issued (from the
// content-snapshot columns added in db/2026-08-27-hr-letters-record-and-
// dispatch-no.sql — for_employee_name_snapshot, body_text, field_values,
// etc.), NOT a live re-render off the employee's current data or the
// template's current wording, so a letter printed a year from now still
// matches the one actually handed to the employee.
export default async function IssuedLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const authed = await requireCapability("hr_letters");
  const { id } = await params;

  const db = createServiceRoleClient();
  const { data: letter } = await db.from("hr_letters").select("*").eq("id", id).single();

  if (!letter || !authed.companyIds.includes(letter.for_company_id)) notFound();

  const [{ data: company }, { data: profile }] = await Promise.all([
    db.from("companies").select("id, name, logo_url").eq("id", letter.for_company_id).single(),
    db.from("company_profiles").select("address, phone, email").eq("company_id", letter.for_company_id).maybeSingle(),
  ]);

  const template = letter.template_slug ? findTemplate(letter.template_slug) : undefined;

  return (
    <div>
      <IssuedLetterView
        letter={{
          refNo: letter.ref_no,
          letterDate: letter.letter_date,
          employeeName: letter.for_employee_name_snapshot,
          employeeAddress: letter.employee_address,
          subjectLine: letter.subject_line,
          bodyText: letter.body_text,
          signatoryName: letter.signatory_name,
          signatoryDesignation: letter.signatory_designation,
          toWhomsoever: template?.toWhomsoever ?? false,
          templateTitle: template?.title ?? letter.letter_type,
          templateIcon: template?.icon ?? "✉️",
        }}
        company={{
          name: company?.name ?? "",
          logoUrl: company?.logo_url ?? null,
          address: profile?.address ?? null,
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
        }}
      />
    </div>
  );
}
