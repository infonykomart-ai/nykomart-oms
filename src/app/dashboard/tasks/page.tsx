import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
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

  const [{ data: employees }, { data: tasks }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, company_id")
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
      .eq("log_date", new Date().toISOString().slice(0, 10)),
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
    />
  );
}
