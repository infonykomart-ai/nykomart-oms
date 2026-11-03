import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { findAgreementTemplate } from "@/lib/agreements/templates";
import { AGREEMENT_MIGRATION_FILE, isMissingAgreementSchema } from "@/lib/agreements/migration";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_STYLES } from "@/lib/agreements/status";

/**
 * LEGAL & COMPLIANCE → AGREEMENT GENERATOR (hub).
 *
 * Create New Agreement + every issued agreement with its status, template,
 * version and reference number, plus the two admin screens (template registry
 * and letterhead settings) that control what can be issued and how it looks.
 */
export default async function AgreementsHubPage() {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const supabase = await createClient();

  const [{ data: documents, error }, { data: companies }] = await Promise.all([
    supabase
      .from("agreement_documents")
      .select(
        "id, ref_no, company_id, vendor_name_snapshot, template_slug, status, effective_date, document_version, created_at, last_shared_at"
      )
      .in("company_id", employee.companyIds)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("companies").select("id, name"),
  ]);

  const companyName = new Map((companies ?? []).map((company) => [company.id, company.name]));
  const migrationPending = Boolean(error) && isMissingAgreementSchema(error);

  const rows = documents ?? [];
  const counts = {
    draft: rows.filter((row) => ["draft", "generated"].includes(row.status)).length,
    inFlight: rows.filter((row) => ["shared", "signed_received", "countersigned"].includes(row.status)).length,
    active: rows.filter((row) => row.status === "active").length,
    closed: rows.filter((row) => ["terminated", "renewed"].includes(row.status)).length,
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legal &amp; Compliance</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">Agreement Generator</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Create vendor agreements on the official company letterhead, generate numbered PDF versions, share them on WhatsApp and
            record the signed copies through to activation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/agreements/new"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            + Create New Agreement
          </Link>
          <Link
            href="/dashboard/agreements/templates"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Templates &amp; Legal Review
          </Link>
          <Link
            href="/dashboard/agreements/letterhead"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Letterhead Settings
          </Link>
        </div>
      </div>

      {migrationPending ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Agreement tables are not set up yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1">{AGREEMENT_MIGRATION_FILE}</code> in the Supabase SQL editor — it creates the
            agreement tables, the numbering function and the private PDF bucket.
          </p>
        </div>
      ) : null}

      {error && !migrationPending ? (
        <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Agreements could not be loaded: {error.message}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Draft / Generated", value: counts.draft },
          { label: "Awaiting signature", value: counts.inFlight },
          { label: "Active", value: counts.active },
          { label: "Closed (renewed / terminated)", value: counts.closed },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-semibold text-slate-900">{card.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Reference</th>
              <th className="px-4 py-2.5">Vendor</th>
              <th className="px-4 py-2.5">Template</th>
              <th className="px-4 py-2.5">Effective</th>
              <th className="px-4 py-2.5">Version</th>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No agreements yet — start with “Create New Agreement”.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Link href={`/dashboard/agreements/${row.id}`} className="text-amber-700 hover:underline">
                      {row.ref_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{row.vendor_name_snapshot}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {findAgreementTemplate(row.template_slug)?.shortTitle ?? row.template_slug}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{row.effective_date}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.document_version > 0 ? `v${row.document_version}` : "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{companyName.get(row.company_id) ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        AGREEMENT_STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {AGREEMENT_STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
