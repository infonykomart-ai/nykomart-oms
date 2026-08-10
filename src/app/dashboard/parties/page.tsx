import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { PartyForm } from "./party-form";
import { PartyList } from "./party-list";

// Party Master (2026-08-10) — see actions.ts header comment for the full
// "why this was still missing" story. This is the FIRST screen for this
// module (the party_admin capability + dashboard tile already existed,
// pointing here, since the original capability seed — this is what fills
// in the 404).
export default async function PartiesPage() {
  await requireCapability("party_admin");
  const supabase = await createClient();

  const { data: parties } = await supabase
    .from("parties")
    .select("id, name, party_type, payment_type, invoice_type, address, contact_no, email, gst, remark")
    .order("name");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🤝 Party Master</h1>
          <p className="mt-1 text-sm text-slate-500">
            Vendors/parties used across Purchase Bill, Debit Note, Washing Entry, and Stock — add one here and it
            shows up in every lookup dropdown across the app.
          </p>
        </div>
        <Link
          href="/dashboard/parties/bulk-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📤 Bulk Upload (CSV)
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <PartyForm />
        </div>

        <div className="lg:col-span-2">
          <PartyList parties={parties ?? []} />
        </div>
      </div>
    </div>
  );
}
