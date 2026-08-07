import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { PolicyHandbookViewer } from "./policy-handbook-viewer";

export default async function PolicyHandbookPage() {
  await requireCapability("hr_letters");
  const supabase = await createClient();
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, logo_url")
    .eq("active", true)
    .order("name");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📘 Company Policy Handbook</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each company may have its own version — select a company, edit the text below, then print or download.
        </p>
      </div>
      <PolicyHandbookViewer companies={companies ?? []} />
    </div>
  );
}
