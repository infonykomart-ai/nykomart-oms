import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { AssignTaskForm } from "./assign-task-form";
import { TaskList, type TaskRow } from "./task-list";
import { AssignedByMeList, type AssignedTaskRow } from "./assigned-by-me-list";

// 2026-08-11 (round 2): "TASK KOI BHI KISI KO ASSIGN KAR DE" — Task
// Assignment, direct rebuild of the legacy "NYKO MART — Work & Performance
// System" Apps Script tool's Tasks sheet, matching the screenshots given
// this round. Every employee (task_management — granted to every role,
// see db/schema.sql) can assign a task to anyone in a company they have
// access to, and works their OWN assigned tasks here with a live
// Start/Pause watch. Full company-wide visibility (the RD Lohra / Admin /
// MD "everyone's report" view) lives at /dashboard/tasks/admin, gated
// behind the separate task_admin capability.
export default async function TasksPage() {
  const employee = await requireCapability("task_management");
  const supabase = await createClient();

  const [{ data: employees }, { data: stores }, { data: myTasks }, { data: assignedByMe }] = await Promise.all([
    supabase.from("employees").select("id, name, company_id").in("company_id", employee.companyIds).eq("active", true).order("name"),
    supabase.from("stores").select("name").in("company_id", employee.companyIds).eq("active", true).order("name"),
    supabase
      .from("tasks")
      .select("id, website, category, priority, deadline, status, description, created_at, timer_started_at, time_spent_seconds, first_started_at, last_paused_at, assigned_by_employee_id")
      .eq("assigned_to_employee_id", employee.id)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, category, priority, status, description, deadline, time_spent_seconds, timer_started_at, assigned_to_employee_id")
      .eq("assigned_by_employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.name]));
  const otherEmployees = (employees ?? []).filter((e) => e.id !== employee.id);
  const websites = Array.from(new Set((stores ?? []).map((s) => s.name)));

  // assignTask() allows cross-company assignment (the assigner just needs
  // access to the ASSIGNEE's company, not membership in it) — so an
  // assigner or assignee on one of MY tasks can be someone outside my own
  // companyIds entirely. `employees` above (scoped to employee.companyIds)
  // would show "—" for exactly that case, so fetch whatever's missing.
  const missingIds = Array.from(
    new Set([
      ...(myTasks ?? []).map((t) => t.assigned_by_employee_id),
      ...(assignedByMe ?? []).map((t) => t.assigned_to_employee_id),
    ])
  ).filter((id) => !employeeName.has(id));
  if (missingIds.length) {
    const { data: extraEmployees } = await supabase.from("employees").select("id, name").in("id", missingIds);
    for (const e of extraEmployees ?? []) employeeName.set(e.id, e.name);
  }

  const myTaskRows: TaskRow[] = (myTasks ?? []).map((t) => ({
    id: t.id,
    website: t.website,
    category: t.category,
    priority: t.priority,
    deadline: t.deadline,
    status: t.status,
    description: t.description,
    created_at: t.created_at,
    assignedByName: employeeName.get(t.assigned_by_employee_id) ?? "—",
    timerStartedAt: t.timer_started_at,
    timeSpentSeconds: t.time_spent_seconds,
    firstStartedAt: t.first_started_at,
    lastPausedAt: t.last_paused_at,
  }));

  const assignedByMeRows: AssignedTaskRow[] = (assignedByMe ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    priority: t.priority,
    status: t.status,
    description: t.description,
    deadline: t.deadline,
    assignedToName: employeeName.get(t.assigned_to_employee_id) ?? "—",
    timeSpentSeconds: t.time_spent_seconds,
    timerStartedAt: t.timer_started_at,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📋 Tasks</h1>
        <p className="mt-1 text-sm text-slate-500">Assign work to anyone, and track your own tasks with a live timer.</p>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Assign a Task</h2>
        <AssignTaskForm employees={otherEmployees} websites={websites} />
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">My Tasks</h2>
        <TaskList tasks={myTaskRows} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Tasks I Assigned</h2>
        <AssignedByMeList tasks={assignedByMeRows} />
      </div>
    </div>
  );
}
