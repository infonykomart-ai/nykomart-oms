import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { todayIST } from "@/lib/attendance/ist-date";
import { ImportPunchForm } from "./import-punch-form";

// 2026-10-01 — "TEAM OFFICE SE PUNCH KI HO YA KISI OR PARKAR KI REPORT
// SUBMIT KARNE KA OPTION BHI HO JISSE SABKI SALARY BANA SAKU": the
// missing import screen the Attendance Admin tile's own description has
// promised since day one ("Import the TeamOffice attendance report,
// review mismatches"). Rows land in the attendance table (source
// 'TeamOffice Import' + device_punch_* + match_flag), which is exactly
// what the Daily/Monthly/Periodic/Yearly reports and the salary
// pipeline already read — so an externally-punched day counts toward
// salary like any web punch.
export default async function ImportPunchReportPage() {
  await requireCapability("attendance_admin");
  const today = todayIST();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Import Punch Report</h1>
          <p className="text-sm text-slate-500">
            TeamOffice (or any biometric/Excel) daily IN/OUT export ko yahan se submit karein — wo din reports aur salary
            calculation me web punch jaisa count hoga.
          </p>
        </div>
        <Link
          href="/dashboard/attendance/admin"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Attendance Admin
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <ImportPunchForm today={today} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Accepted formats</h2>
        <ul className="mb-2 list-disc space-y-1 pl-5">
          <li>
            <strong>With header:</strong> columns named like Empcode / Employee Code, Name, Date, INTime / Punch In, OUTTime /
            Punch Out — names don&apos;t have to match exactly, the importer recognises the common variants.
          </li>
          <li>
            <strong>Without header:</strong> columns are assumed to be <code className="rounded bg-slate-100 px-1">code, date, in, out</code>{" "}
            (or <code className="rounded bg-slate-100 px-1">code, name, date, in, out</code>).
          </li>
          <li>
            Dates: <strong>dd/mm/yyyy</strong> (TeamOffice style) or yyyy-mm-dd. Times: 24h <code className="rounded bg-slate-100 px-1">09:29</code> or{" "}
            <code className="rounded bg-slate-100 px-1">9:29 AM</code>.
          </li>
          <li>
            TeamOffice&apos;s Daily IN/OUT report has the date only in its title — leave the fallback date filled and it is applied to
            every row.
          </li>
        </ul>
        <p className="text-slate-500">
          Existing rows are never clobbered: a recorded web punch / approved leave stays as-is — the imported device punch is stored
          alongside it and any difference shows as a <strong>⚠️ Mismatch</strong> flag for review.
        </p>
      </div>
    </div>
  );
}
