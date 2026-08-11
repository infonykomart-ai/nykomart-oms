import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { formatDuration, liveElapsedSeconds } from "@/lib/attendance/timer";

// 2026-08-11 (round 2): "TASK... REPORT PURI RD LOHRA KO OR ADMIN KO
// DIKHE" / "SABHI LOGO KI REPORT MD KE PASS DIKHE" — the full company-wide
// Task view, gated behind task_admin (Finance/MD/Admin — same 3 roles as
// attendance_admin, see db/schema.sql). Two parts: a "Live Now" panel
// (who's actively working on what, right now — matches the legacy tool's
// own Live Now panel) and the full task list for the selected company.
export default async function TaskAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("task_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name").in("id", employee.companyIds);
  const selectedCompanyId = (typeof sp.company === "string" && employee.companyIds.includes(sp.company)) ? sp.company : employee.currentCompanyId;

  const [{ data: teamEmployees }, { data: tasks }, { data: liveNow }] = await Promise.all([
    supabase.from("employees").select("id, name").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase
      .from("tasks")
      .select("id, website, category, priority, deadline, status, description, created_at, timer_started_at, time_spent_seconds, assigned_by_employee_id, assigned_to_employee_id")
      .eq("company_id", selectedCompanyId)
      .order("created_at", { ascending: false })
      .limit(200),
    // Live Now — across every company this login can see, not just the
    // selected one, so a company switch never hides someone who's mid-task.
    supabase
      .from("tasks")
      .select("id, description, timer_started_at, time_spent_seconds, assigned_to_employee_id, company_id")
      .in("company_id", employee.companyIds)
      .not("timer_started_at", "is", null),
  ]);

  const employeeName = new Map((teamEmployees ?? []).map((e) => [e.id, e.name]));
  // assignTask() allows cross-company assignment (the assigner just needs
  // access to the ASSIGNEE's company, not membership in it) — so an
  // "Assigned By" name, or a Live Now name, can reference an employee
  // outside the selected company entirely. teamEmployees alone (scoped to
  // selectedCompanyId) would show "—" for exactly that case, so fetch
  // every referenced id that isn't already covered.
  const missingIds = Array.from(
    new Set([
      ...(tasks ?? []).map((t) => t.assigned_by_employee_id),
      ...(tasks ?? []).map((t) => t.assigned_to_employee_id),
      ...(liveNow ?? []).map((l) => l.assigned_to_employee_id),
    ])
  ).filter((id) => !employeeName.has(id));
  if (missingIds.length) {
    const { data: extraEmployees } = await supabase.from("employees").select("id, name").in("id", missingIds);
    for (const e of extraEmployees ?? []) employeeName.set(e.id, e.name);
  }

  const nowMs = new Date().getTime();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📊 Task Reports</h1>
        <p className="mt-1 text-sm text-slate-500">Every employee&apos;s tasks and live timers, company-wide.</p>
      </div>

      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="mb-3 text-sm font-semibold text-amber-800">🟢 Live Now</h2>
        {(liveNow ?? []).length === 0 && <p className="text-xs text-amber-700/70">No one is actively timing a task right now.</p>}
        <div className="space-y-1.5">
          {(liveNow ?? []).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-amber-100 bg-white px-2.5 py-1.5 text-xs">
              <span className="font-medium text-slate-800">{employeeName.get(t.assigned_to_employee_id) ?? "—"}</span>
              <span className="flex-1 truncate text-slate-600">{t.description}</span>
              <span className="font-semibold text-amber-800">
                {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, nowMs))}
              </span>
            </div>
          ))}
        </div>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">All Tasks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-3">Assigned To</th>
                <th className="px-2">Assigned By</th>
                <th className="px-2">Description</th>
                <th className="px-2">Priority</th>
                <th className="px-2">Status</th>
                <th className="px-2">Deadline</th>
                <th className="px-2">Time Spent</th>
              </tr>
            </thead>
            <tbody>
              {(tasks ?? []).map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{employeeName.get(t.assigned_to_employee_id) ?? "—"}</td>
                  <td className="px-2 text-slate-500">{employeeName.get(t.assigned_by_employee_id) ?? "—"}</td>
                  <td className="max-w-xs truncate px-2 text-slate-600">{t.description}</td>
                  <td className="px-2">{t.priority}</td>
                  <td className="px-2">{t.status}</td>
                  <td className="px-2 text-slate-500">{t.deadline ?? "—"}</td>
                  <td className="px-2 text-amber-700">
                    {formatDuration(liveElapsedSeconds({ timeSpentSeconds: t.time_spent_seconds, timerStartedAt: t.timer_started_at }, nowMs))}
                    {t.timer_started_at && <span className="ml-1 text-green-600">●</span>}
                  </td>
                </tr>
              ))}
              {(tasks ?? []).length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-slate-400">No tasks for this company yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
