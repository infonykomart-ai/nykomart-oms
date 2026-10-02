// 2026-10-02c — GPS Approve/Pending/Rejected workflow (TeamOffice parity):
// every Web-Punch GPS fix lands here as "Pending" and waits for an admin
// decision. One row per punch with the coordinates + a Google Maps link,
// an optional remark field, and ✅ Approve / ❌ Reject buttons (the clicked
// button carries the decision — plain server action, no client fetch).
// Rows already decided show the badge + remark instead of the buttons.
//
// The queue reads attendance.gps_status (set by punch.ts when a fix is
// captured); "All" shows every reviewed punch, and the GPS Report carries
// the same status as a column so reports and the queue can never disagree.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, addDaysToDateStr } from "@/lib/attendance/ist-date";
import { istTimeLabel } from "@/lib/attendance/monthly-report";
import { validDate } from "../range-report-data";
import { decideGpsApproval } from "./actions";

const APPROVALS_PATH = "/dashboard/attendance/admin/gps-approvals";
const STATUS_OPTIONS = ["Pending", "Approved", "Rejected", "All"] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

const STATUS_BADGE: Record<string, string> = {
  Pending: "border-amber-200 bg-amber-50 text-amber-700",
  Approved: "border-green-200 bg-green-50 text-green-700",
  Rejected: "border-red-200 bg-red-50 text-red-600",
};

function coords(lat: number | null, lng: number | null): string | null {
  return lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null;
}

export default async function GpsApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("attendance_admin");
  const supabase = await createClient();
  const sp = await searchParams;
  const today = todayIST();

  const status: StatusOption =
    typeof sp.status === "string" && (STATUS_OPTIONS as readonly string[]).includes(sp.status)
      ? (sp.status as StatusOption)
      : "Pending";
  let from = validDate(sp.from, addDaysToDateStr(today, -30));
  let to = validDate(sp.to, today);
  if (from > to) [from, to] = [to, from];
  const companyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;
  const qs = new URLSearchParams({ status, from, to, company: companyId });
  const returnTo = `${APPROVALS_PATH}?${qs.toString()}`;
  const error = typeof sp.error === "string" ? sp.error : null;

  // gps_status !== 'None' rows are exactly the punches that HAVE coordinates
  // (punch.ts only flips to Pending when a fix was captured), so the queue
  // never shows a row with nothing to review.
  const punchBase = supabase
    .from("attendance")
    .select(
      "id, attendance_date, employee_id, status, punch_in, punch_out, punch_in_lat, punch_in_lng, punch_out_lat, punch_out_lng, gps_status, gps_decision_remark, gps_decided_at"
    )
    .eq("company_id", companyId)
    .gte("attendance_date", from)
    .lte("attendance_date", to);
  const punchQuery = status === "All" ? punchBase.neq("gps_status", "None") : punchBase.eq("gps_status", status);

  const [{ data: companies }, { data: departments }, { data: employees }, { data: punches }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", authed.companyIds).order("name"),
    supabase.from("departments").select("id, name").eq("company_id", companyId),
    supabase.from("employees").select("id, name, employee_code, department_id").eq("company_id", companyId),
    punchQuery.order("attendance_date", { ascending: false }).limit(200),
  ]);

  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">🛰️ GPS Approvals</h1>
          <p className="text-sm text-slate-500">
            Web-Punch GPS fixes ki review queue — coordinates + map link dekh kar ✅ Approve ya ❌ Reject karo (remark optional).
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/attendance/admin/gps-report"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            📡 GPS Report
          </Link>
          <Link
            href="/dashboard/attendance/admin"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Attendance Admin
          </Link>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={companyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Review Status</label>
          <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All reviewed" : s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
          <input type="date" name="to" defaultValue={to} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          Show
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Date</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Employee</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Punch IN</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Punch OUT</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">GPS Review</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(punches ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  {status === "Pending" ? "No pending GPS reviews — sab clear! 🎉" : "No punches match this filter."}
                </td>
              </tr>
            )}
            {(punches ?? []).map((p) => {
              const emp = employeeById.get(p.employee_id);
              const inGps = coords(p.punch_in_lat, p.punch_in_lng);
              const outGps = coords(p.punch_out_lat, p.punch_out_lng);
              const link = inGps ?? outGps;
              const decided = p.gps_status === "Approved" || p.gps_status === "Rejected";
              return (
                <tr key={p.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2">{p.attendance_date}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{emp?.name ?? "—"}</div>
                    <div className="text-[11px] text-slate-400">
                      {emp?.employee_code ? `Code ${emp.employee_code}` : "—"}
                      {emp?.department_id && departmentName.get(emp.department_id)
                        ? ` · ${departmentName.get(emp.department_id)}`
                        : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{p.status ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div>{istTimeLabel(p.punch_in)}</div>
                    <div className="text-[11px] text-slate-400">{inGps ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{istTimeLabel(p.punch_out)}</div>
                    <div className="text-[11px] text-slate-400">{outGps ?? "—"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[p.gps_status] ?? ""}`}>
                      {p.gps_status}
                    </span>
                    {link && (
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(link)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-[11px] font-medium text-blue-600 hover:underline"
                      >
                        🗺️ Map
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {decided ? (
                      <div className="text-[11px] text-slate-500">
                        <div>
                          {p.gps_status} · {p.gps_decided_at ? p.gps_decided_at.slice(0, 10) : "—"}
                        </div>
                        {p.gps_decision_remark && <div className="text-slate-400">“{p.gps_decision_remark}”</div>}
                      </div>
                    ) : (
                      <form action={decideGpsApproval} className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="return_to" value={returnTo} />
                        <input
                          name="remark"
                          placeholder="Remark"
                          className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
                        />
                        <button
                          type="submit"
                          name="decision"
                          value="Approved"
                          className="rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100"
                        >
                          ✅ Approve
                        </button>
                        <button
                          type="submit"
                          name="decision"
                          value="Rejected"
                          className="rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                        >
                          ❌ Reject
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Server-side punches (login/logout) aur TeamOffice imports ke paas GPS hota hi nahi — wo queue me kabhi nahi aate. Sirf
        Web-Punch se capture hue fixes Pending hote hain. Max 200 rows per view.
      </p>
    </div>
  );
}
