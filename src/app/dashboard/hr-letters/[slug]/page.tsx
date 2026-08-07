import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { findTemplate } from "@/lib/hr-letters/templates";
import { LetterForm } from "./letter-form";
import { notFound } from "next/navigation";

export default async function LetterPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireCapability("hr_letters");
  const { slug } = await params;
  const template = findTemplate(slug);
  if (!template) notFound();

  const supabase = await createClient();
  const [{ data: employees }, { data: companies }] = await Promise.all([
    supabase.from("employees").select("id, name, company_id, designation, employee_code, date_of_joining").eq("active", true).order("name"),
    supabase.from("companies").select("id, name, logo_url, active").eq("active", true).order("name"),
  ]);

  const companyProfiles = await supabase
    .from("company_profiles")
    .select("company_id, address, phone, email");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          {template.icon} {template.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Select an employee — the company letterhead will be filled in automatically. You can edit the text below
          before printing.
        </p>
      </div>

      <LetterForm
        template={template}
        employees={employees ?? []}
        companies={companies ?? []}
        companyProfiles={companyProfiles.data ?? []}
      />
    </div>
  );
}
