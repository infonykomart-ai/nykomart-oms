import { requireCapability } from "@/lib/auth/require-capability";
import Link from "next/link";
import { LETTER_TEMPLATES } from "@/lib/hr-letters/templates";

/**
 * HR Letters hub — item 7/8/9. Certificates (item 9) and all 7 letter
 * templates (item 8, from HR_Letters_Certificates_Company_Policy.docx) are
 * live here. Company Policy Handbook (docx section 8) is a static
 * per-company reference doc, not a per-employee generated letter — it gets
 * its own simple page next rather than the generic letter-form flow.
 */
export default async function HrLettersHubPage() {
  await requireCapability("hr_letters");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">HR Letters</h1>
        <p className="mt-1 text-sm text-slate-500">
          You always get a chance to edit any letter or certificate before printing or sending it — nothing goes
          straight to &ldquo;ready to print&rdquo;.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard/hr-letters/certificates"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-xl">🏆</div>
          <h3 className="font-semibold text-slate-900 group-hover:text-amber-600">Certificates</h3>
          <p className="mt-1 text-sm text-slate-500">
            Best Performance, Employee of the Month, Work Anniversary, Training Completion.
          </p>
        </Link>

        {LETTER_TEMPLATES.map((t) => (
          <Link
            key={t.slug}
            href={`/dashboard/hr-letters/${t.slug}`}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-xl">{t.icon}</div>
            <h3 className="font-semibold text-slate-900 group-hover:text-amber-600">{t.title}</h3>
          </Link>
        ))}

        <Link
          href="/dashboard/hr-letters/policy-handbook"
          className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-xl">📘</div>
          <h3 className="font-semibold text-slate-900 group-hover:text-amber-600">Company Policy Handbook</h3>
          <p className="mt-1 text-sm text-slate-500">A separate reference document for each company.</p>
        </Link>
      </div>
    </div>
  );
}
