import { requireCapability } from "@/lib/auth/require-capability";
import Link from "next/link";

/**
 * HR Letters hub — item 7/8/9. Certificates (item 9) is built and live
 * here; the 7 letter templates from HR_Letters_Certificates_Company_Policy.docx
 * (item 8 — Offer/Appointment/Experience/Relieving/Salary/Warning/
 * Termination) land in this same hub next, as more cards below.
 */
export default async function HrLettersHubPage() {
  await requireCapability("hr_letters");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">HR Letters</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kisi bhi letter/certificate ko print/send karne se pehle edit karne ka mauka milta hai — kabhi bhi
          seedha &ldquo;ready to print&rdquo; nahi hota.
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

        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200 text-xl">✉️</div>
          <h3 className="font-semibold text-slate-500">Letters (jald aa raha hai)</h3>
          <p className="mt-1 text-sm text-slate-400">
            Offer, Appointment, Experience, Relieving, Salary Certificate, Warning, Termination.
          </p>
        </div>
      </div>
    </div>
  );
}
