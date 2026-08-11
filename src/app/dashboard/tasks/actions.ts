"use server";

// 2026-08-11 (round 2): Task Assignment — direct rebuild of the legacy
// "NYKO MART — Work & Performance System" Apps Script tool's Tasks sheet,
// matching the screenshots given this round. "TASK KOI BHI KISI KO ASSIGN
// KAR DE" — any employee with task_management (every role — see
// db/schema.sql's role_capabilities seed) can assign a task to any other
// employee they share company access with. Only the ASSIGNEE controls
// their own task's Start/Pause timer and status — matches the legacy
// tool's own per-person timer ownership (you can't run someone else's
// stopwatch for them).
//
// 2026-08-11 (round 3): "task vala option isi page par show hona chahiye
// usko alag se kyu banaya hai" — this UI now renders on
// /dashboard/attendance (My Tasks/Assign/Tasks I Assigned) and
// /dashboard/attendance/admin (Live Now/All Tasks) instead of its own
// standalone route, so every revalidatePath below points there. This file
// itself (server actions) is unchanged — components importing it just
// moved.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";

export type SimpleActionState = { error: string | null; success: boolean };

export type AssignTaskInput = {
  assignedToEmployeeId: string;
  website: string;
  category: string;
  priority: string;
  deadline: string; // "" = none
  description: string;
};

export async function assignTask(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();

  const assignedToEmployeeId = String(formData.get("assigned_to_employee_id") || "");
  const description = String(formData.get("description") || "").trim();
  if (!assignedToEmployeeId) return { error: "Choose who this task is for.", success: false };
  if (!description) return { error: "Description is required.", success: false };

  // Server re-check: the target employee must actually be someone this
  // login can see (same company-access scope as the assign form's own
  // dropdown) — never trust a client-supplied employee id blindly.
  const { data: target } = await supabase
    .from("employees")
    .select("id, company_id")
    .eq("id", assignedToEmployeeId)
    .in("company_id", employee.companyIds)
    .eq("active", true)
    .maybeSingle();
  if (!target) return { error: "That employee isn't in a company you have access to.", success: false };

  const deadline = String(formData.get("deadline") || "");
  const { error } = await supabase.from("tasks").insert({
    company_id: target.company_id,
    assigned_by_employee_id: employee.id,
    assigned_to_employee_id: target.id,
    website: String(formData.get("website") || "") || null,
    category: String(formData.get("category") || "") || null,
    priority: String(formData.get("priority") || "Medium"),
    deadline: deadline || null,
    description,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, success: true };
}

type TimerActionResult = {
  error: string | null;
  timerStartedAt: string | null;
  timeSpentSeconds: number;
  firstStartedAt: string | null;
  lastPausedAt: string | null;
  status: string | null;
};

export async function startTaskTimer(id: string): Promise<TimerActionResult> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("first_started_at, time_spent_seconds, timer_started_at, status")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id) // only the assignee can run their own timer
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };
  if (existing.timer_started_at) {
    return { error: null, timerStartedAt: existing.timer_started_at, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null, status: existing.status };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      timer_started_at: now,
      first_started_at: existing.first_started_at ?? now,
      status: existing.status === "Pending" ? "In Progress" : existing.status,
    })
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at, status")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not start timer.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status };
}

export async function pauseTaskTimer(id: string): Promise<TimerActionResult> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("timer_started_at, time_spent_seconds, first_started_at, status")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };
  if (!existing.timer_started_at) {
    return { error: null, timerStartedAt: null, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null, status: existing.status };
  }
  const now = new Date();
  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(existing.timer_started_at).getTime()) / 1000));
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .update({ timer_started_at: null, time_spent_seconds: existing.time_spent_seconds + elapsed, last_paused_at: nowIso })
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at, status")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not pause timer.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status };
}

/**
 * ✔ Done button — pauses the timer if it's still running, marks the task
 * complete, AND (2026-08-11, round 4: "task compleate hote hi submit
 * report me automaticly add ho jaye ki is task par itna time kaam kiya")
 * auto-creates an already-submitted Daily Work Report row for the
 * assignee, so the time spent on this task shows up in their own "My
 * Recent Reports" and on the Admin/MD Team Daily Work Log without any
 * extra typing. That report row is finalized immediately (submitted_at
 * set) — it's a record of completed task time, not a draft to edit.
 */
export async function markTaskDone(id: string): Promise<TimerActionResult & { success: boolean }> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("tasks")
    .select("timer_started_at, time_spent_seconds, first_started_at, company_id, category, website, description")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .single();
  if (!existing) return { error: "Task not found.", success: false, timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };

  const now = new Date();
  const nowIso = now.toISOString();
  const timerPatch = existing.timer_started_at
    ? {
        timer_started_at: null,
        time_spent_seconds: existing.time_spent_seconds + Math.max(0, Math.floor((now.getTime() - new Date(existing.timer_started_at).getTime()) / 1000)),
        last_paused_at: nowIso,
      }
    : {};
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "Done", completed_at: nowIso, ...timerPatch })
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at, status")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not complete task.", success: false, timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null };

  // Best-effort: a failure here shouldn't undo the task being marked
  // Done (the task update above already committed) — log server-side and
  // move on, same "never let a secondary effect block the real action"
  // principle as punchOutOnLogout elsewhere in this codebase.
  try {
    await supabase.from("daily_work_logs").insert({
      employee_id: employee.id,
      company_id: existing.company_id,
      log_date: todayIST(),
      category: existing.category ?? "Task",
      description: `[Task] ${existing.description}${existing.website ? ` (${existing.website})` : ""}`,
      work_status: "Completed",
      first_started_at: existing.first_started_at,
      time_spent_seconds: data.time_spent_seconds,
      last_paused_at: nowIso,
      submitted_at: nowIso,
    });
  } catch (e) {
    console.error("markTaskDone: failed to auto-create daily_work_logs row", e);
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, success: true, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status };
}

/** Assigner can cancel a task they created, as long as it isn't already Done. */
export async function cancelTask(id: string): Promise<SimpleActionState> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("assigned_by_employee_id", employee.id)
    .neq("status", "Done");
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, success: true };
}
