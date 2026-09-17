import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "./csv-upload-form";

// CSV Upload hub (round 11) — see actions.ts / lib/statement-import/tables.ts
// header comments. Covers every statement-family table that's genuinely
// CSV-shaped (the 2 PDF-only ones live on Statement Entry instead).
export default async function CsvUploadPage() {
  const employee = await requireCapability("csv_upload");
  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📤 CSV Upload</h1>
      </div>

      <CsvUploadForm companies={companies ?? []} />
    </div>
  );
}
