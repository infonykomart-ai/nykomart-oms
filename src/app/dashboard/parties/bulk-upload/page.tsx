import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { BulkPartyUploadForm } from "./bulk-party-upload-form";

export default async function PartiesBulkUploadPage() {
  await requireCapability("party_admin");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📤 Bulk Party Master Upload (CSV/Excel)</h1>
        </div>
        <Link
          href="/dashboard/parties"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Party Master
        </Link>
      </div>

      <BulkPartyUploadForm />
    </div>
  );
}
