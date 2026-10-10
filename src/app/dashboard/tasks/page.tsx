import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { TaskRouteClient } from "./TaskRouteClient";

// 2026-10-07: Dedicated /dashboard/tasks route carrying the pending work
// feature the user asked for. Employee sees tasks WITHOUT priority
// (priority is admin-only, guarded by task_admin), and tasks that were
// assigned earlier appear first (ORDER BY created_at asc), per the
// "tasks that arrived earlier must be done first" rule. Per-task Start /
// Pause / Done timer is wired to the same server actions the Attendance
// page already uses.
export default async function TasksPage() {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();

  const [{ data: employees }, { data: allCompanies }, { data: stores }, { data: tasks }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, company_id")
      .eq("active", true)
      .order("name"),
    // 2026-10-10: companies + stores feed the Assign Task form below (same
    // data the Attendance page's copy of the form gets) — the dead "Assign
    // Task" button in the empty state is now wired to this real form.
    supabase.from("companies").select("id, name"),
    supabase
      .from("stores")
      .select("name")
      .in("company_id", employee.companyIds)
      .eq("active", true)
      .order("name"),
    supabase
      .from("tasks")
      .select(
        "id, assigned_by_employee_id, assigned_to_employee_id, website, category, priority, deadline, status, description, created_at, timer_started_at, time_spent_seconds, first_started_at, last_paused_at"
      )
      .eq("assigned_to_employee_id", employee.id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  const assigners = new Map(
    (employees ?? []).map((e) => [e.id, e.name])
  );
  const companyName = new Map((allCompanies ?? []).map((c) => [c.id, c.name]));
  const assignTaskEmployees = (employees ?? [])
    .filter((e) => e.id !== employee.id)
    .map((e) => ({ id: e.id, name: e.name, companyName: companyName.get(e.company_id) ?? "—" }));
  const taskWebsites = Array.from(new Set((stores ?? []).map((s) => s.name)));

  type TaskRow = {
    id: string;
    assigned_by_employee_id: string;
    assigned_to_employee_id: string;
    website: string | null;
    category: string | null;
    priority: string;
    deadline: string | null;
    status: string;
    description: string;
    created_at: string;
    timerStartedAt: string | null;
    timeSpentSeconds: number;
    firstStartedAt: string | null;
    lastPausedAt: string | null;
  };

  const taskRows: TaskRow[] = (tasks ?? []).map((t) => ({
    id: t.id,
    assigned_by_employee_id: t.assigned_by_employee_id,
    assigned_to_employee_id: t.assigned_to_employee_id,
    website: t.website,
    category: t.category,
    priority: t.priority,
    deadline: t.deadline,
    status: t.status,
    description: t.description,
    created_at: t.created_at,
    timerStartedAt: t.timer_started_at,
    timeSpentSeconds: t.time_spent_seconds,
    firstStartedAt: t.first_started_at,
    lastPausedAt: t.last_paused_at,
  }));

  // A lightweight "today so far" surfacing: seconds committed to today's
  // task_daily_time_log per task, read side-by-side with the live timer so
  // the Daily Work Report block below auto-fills from it. No second
  // source of truth — it's the same column task_daily_time_log already
  // records for the Attendance page's own timer.
  const [{ data: timeLogs }] = await Promise.all([
    supabase
      .from("task_daily_time_log")
      .select("task_id, log_date, seconds_spent")
      // 2026-10-10: was `new Date().toISOString().slice(0, 10)` — UTC, which
      // is the PREVIOUS day for the first 5.5h of every IST day, so "today"
      // task time read as 0 (or showed yesterday's) after midnight IST.
      // Same IST helper every timer action already uses.
      .eq("log_date", todayIST()),
  ]);
  const todaySecondsByTaskId = new Map<string, number>();
  for (const l of timeLogs ?? []) {
    todaySecondsByTaskId.set(l.task_id, (todaySecondsByTaskId.get(l.task_id) ?? 0) + (l.seconds_spent ?? 0));
  }

  return (
    <TaskRouteClient
      tasks={taskRows}
      todaySecondsByTaskId={todaySecondsByTaskId}
      assigners={assigners}
      assignTaskEmployees={assignTaskEmployees}
      taskWebsites={taskWebsites}
    />
  );
}
