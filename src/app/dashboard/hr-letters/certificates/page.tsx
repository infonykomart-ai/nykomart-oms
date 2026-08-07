import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CertificateForm } from "./certificate-form";

export default async function CertificatesPage() {
  await requireCapability("hr_letters");
  const supabase = await createClient();

  const [{ data: employees }, { data: companies }] = await Promise.all([
    supabase.from("employees").select("id, name, company_id, designation").eq("active", true).order("name"),
    supabase.from("companies").select("id, name, logo_url").eq("active", true).order("name"),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Certificates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Select an employee and occasion — that employee&apos;s company logo will be applied automatically. You can
          edit any field before printing.
        </p>
      </div>

      <CertificateForm employees={employees ?? []} companies={companies ?? []} />
    </div>
  );
}
