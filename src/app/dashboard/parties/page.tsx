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
//
// 2026-08-22 — filter UI added (GET-form + searchParams, same pattern as
// Orders). Before this, party-list.tsx did its own CLIENT-SIDE search
// (useState + useMemo `.filter()`, no URL/server involvement at all) —
// replaced here with server-side filtering so it matches every other list
// page's filter convention. `party_type` is free text on this table (no
// enum — see db/schema.sql's comment on parties.party_type, "old TYPE
// column"), so the dropdown's options are built from the DISTINCT values
// actually present in the table today, not a hardcoded list.
export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCapability("party_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const partyType = typeof sp.party_type === "string" ? sp.party_type : "";

  const [{ data: allPartyTypes }, queryResult] = await Promise.all([
    supabase.from("parties").select("party_type").not("party_type", "is", null).order("party_type"),
    (async () => {
      let query = supabase
        .from("parties")
        .select(
          "id, name, party_type, payment_type, invoice_type, address, contact_no, email, gst, remark, bank_name, account_no, ifsc_code, account_holder_name"
        )
        .order("name");
      if (q) query = query.ilike("name", `%${q}%`);
      if (partyType) query = query.eq("party_type", partyType);
      return query;
    })(),
  ]);
  const { data: parties } = queryResult;

  const partyTypeOptions = Array.from(new Set((allPartyTypes ?? []).map((p) => p.party_type).filter((t): t is string => !!t))).sort();

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
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">Search (Name)</label>
              <input id="q" name="q" defaultValue={q} placeholder="Party name..." className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="party_type">Party Type</label>
              <select id="party_type" name="party_type" defaultValue={partyType} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
                <option value="">All</option>
                {partyTypeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
              Filter
            </button>
            <a href="/dashboard/parties" className="text-xs text-slate-400 underline">Clear</a>
          </form>

          <PartyList parties={parties ?? []} />
        </div>
      </div>
    </div>
  );
}
