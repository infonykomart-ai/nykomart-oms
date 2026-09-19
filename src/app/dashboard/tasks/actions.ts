"use server";

// 2026-08-11 (round 2): Task Assignment — direct rebuild of the legacy
// "NYKO MART — Work & Performance System" Apps Script tool's Tasks sheet,
// matching the screenshots given this round. "TASK KOI BHI KISI KO ASSIGN
// KAR DE" — any employee with task_management (every role — see
// db/schema.sql's role_capabilities seed) can assign a task to any other
// active employee. Only the ASSIGNEE controls their own task's
// Start/Pause timer and status — matches the legacy tool's own
// per-person timer ownership (you can't run someone else's stopwatch for
// them).
//
// 2026-08-11 (round 4): "ORDER ENTRY VALA ADMIN KO BHI ASSIGN KAR SAKTA
// HAI MD KO BHI FINANCE KO BHI, MATLAB KOI BHI KISI KO ASSIGN KAR SAKTA
// HAI PHIR COMPANY CHAHE KOI BHI HO" — removed the earlier
// company-access restriction entirely (both the assign form's employee
// dropdown and this server-side re-check). Any employee, in any of the 3
// companies, can now assign a task to any other active employee,
// regardless of which company either of them belongs to.
//
// 2026-08-11 (round 3): "task vala option isi page par show hona chahiye
// usko alag se kyu banaya hai" — this UI now renders on
// /dashboard/attendance (My Tasks/Assign/Tasks I Assigned) and
// /dashboard/attendance/admin (Live Now/All Tasks) instead of its own
// standalone route, so every revalidatePath below points there. This file
// itself (server actions) is unchanged — components importing it just
// moved.
import { revalidatePath } from "next/cache";
import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, splitIntervalByISTDay } from "@/lib/attendance/ist-date";
import { notifyCompanion } from "@/lib/companion/notify";
// 2026-09-19 (audit fix, item C5) — recordDailySegmentsAndGetToday and
// markTaskDone's daily_work_logs insert both silently swallowed a failure
// (console.error only) and still reported success to the caller. Neither
// becomes blocking because of this fix — see recordDailySegmentsAndGetToday's
// own comment on why a logging failure must never undo the timer/task
// action that already committed — it just also lands somewhere visible.
import { logEntryError } from "@/lib/error-log/log-entry-error";

/**
 * 2026-09-09 — commits a stopped timer interval into task_daily_time_log,
 * split across IST calendar-day boundaries (see splitIntervalByISTDay).
 * Called from pauseTaskTimer/markTaskDone right after they've already
 * updated tasks.time_spent_seconds — this is purely an additive breakdown
 * of that same total, never a second source of truth for it. Best-effort:
 * a failure here must never undo or block the timer action that already
 * committed (same principle as markTaskDone's daily_work_logs insert
 * below) — logged and swallowed, not thrown.
 *
 * Returns today's committed total afterward (queried fresh rather than
 * computed locally, since a multi-day-spanning interval may or may not
 * have touched today at all) so callers can hand the client an accurate
 * "today so far" figure without a full page refetch.
 */
async function recordDailySegmentsAndGetToday(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employee: AuthedEmployee,
  taskId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  try {
    const segments = splitIntervalByISTDay(startIso, endIso);
    for (const seg of segments) {
      const { error } = await supabase.rpc("add_task_daily_time", {
        p_task_id: taskId,
        p_log_date: seg.logDate,
        p_seconds: seg.seconds,
      });
      if (error) {
        console.error("recordDailySegmentsAndGetToday: add_task_daily_time failed", seg, error);
        // 2026-09-19 (audit fix, item C5) — previously console.error only,
        // invisible outside server logs. Still non-blocking (return below
        // still runs regardless), just also visible on /dashboard/error-log.
        await logEntryError(supabase, {
          companyId: employee.currentCompanyId,
          source: "system",
          reason: `Task daily-time sync failed for ${seg.logDate} (${seg.seconds}s): ${error.message}`,
          referenceType: "task",
          referenceId: taskId,
          raisedByEmployeeId: employee.id,
          raisedByName: employee.name,
        });
      }
    }
  } catch (e) {
    console.error("recordDailySegmentsAndGetToday: failed to split/record interval", e);
    await logEntryError(supabase, {
      companyId: employee.currentCompanyId,
      source: "system",
      reason: `Task daily-time interval split/record failed: ${e instanceof Error ? e.message : String(e)}`,
      referenceType: "task",
      referenceId: taskId,
      raisedByEmployeeId: employee.id,
      raisedByName: employee.name,
    });
  }
  const { data } = await supabase
    .from("task_daily_time_log")
    .select("seconds_spent")
    .eq("task_id", taskId)
    .eq("log_date", todayIST())
    .maybeSingle();
  return data?.seconds_spent ?? 0;
}

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

  // 2026-08-11 (round 4): "KOI BHI KISI KO ASSIGN KAR SAKTA HAI PHIR
  // COMPANY CHAHE KOI BHI HO" — task assignment is explicitly NOT scoped
  // to the assigner's own company access. Order Entry can assign to
  // Admin, MD, Finance — anyone, in any of the 3 companies. The only
  // real check left is that the target is a real, active employee — never
  // trust a client-supplied employee id blindly, but don't gate it on
  // company access anymore (that was the old, too-narrow behavior).
  const { data: target } = await supabase
    .from("employees")
    .select("id, company_id")
    .eq("id", assignedToEmployeeId)
    .eq("active", true)
    .maybeSingle();
  if (!target) return { error: "That employee wasn't found or isn't active.", success: false };

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

  // 2026-09-05 — AI Companion: "kisi ne task assin kiya to bole ki you
  // have recvie task" — notifies the ASSIGNEE (target), not the person who
  // assigned it.
  await notifyCompanion(supabase, {
    employeeId: target.id,
    eventType: "task_assigned",
    message: `You have received a task: ${description}`,
  });

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
  // 2026-09-09 — committed seconds for TODAY (IST) specifically, from
  // task_daily_time_log — see recordDailySegmentsAndGetToday above. Distinct
  // from timeSpentSeconds, which is the task's whole-lifetime total.
  todaySeconds: number;
};

const EMPTY_TIMER_RESULT = { timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, status: null, todaySeconds: 0 };

export async function startTaskTimer(id: string): Promise<TimerActionResult> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("first_started_at, time_spent_seconds, timer_started_at, status")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id) // only the assignee can run their own timer
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", ...EMPTY_TIMER_RESULT };
  if (existing.timer_started_at) {
    const { data: todayRow } = await supabase.from("task_daily_time_log").select("seconds_spent").eq("task_id", id).eq("log_date", todayIST()).maybeSingle();
    return { error: null, timerStartedAt: existing.timer_started_at, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null, status: existing.status, todaySeconds: todayRow?.seconds_spent ?? 0 };
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
  if (error || !data) return { error: error?.message ?? "Could not start timer.", ...EMPTY_TIMER_RESULT };
  const { data: todayRow } = await supabase.from("task_daily_time_log").select("seconds_spent").eq("task_id", id).eq("log_date", todayIST()).maybeSingle();
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status, todaySeconds: todayRow?.seconds_spent ?? 0 };
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
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", ...EMPTY_TIMER_RESULT };
  if (!existing.timer_started_at) {
    const { data: todayRow } = await supabase.from("task_daily_time_log").select("seconds_spent").eq("task_id", id).eq("log_date", todayIST()).maybeSingle();
    return { error: null, timerStartedAt: null, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null, status: existing.status, todaySeconds: todayRow?.seconds_spent ?? 0 };
  }
  const now = new Date();
  const startedAtIso = existing.timer_started_at;
  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 1000));
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .update({ timer_started_at: null, time_spent_seconds: existing.time_spent_seconds + elapsed, last_paused_at: nowIso })
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at, status")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not pause timer.", ...EMPTY_TIMER_RESULT };
  // 2026-09-09 — commit this stopped interval into task_daily_time_log,
  // split across any IST midnight it crossed, so it's counted even though
  // the task itself is still incomplete (only Done previously synced
  // anything visible day-by-day — see this file's header comment on the
  // new table for the full "why").
  const todaySeconds = await recordDailySegmentsAndGetToday(supabase, employee, id, startedAtIso, nowIso);
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status, todaySeconds };
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
  if (!existing) return { error: "Task not found.", success: false, ...EMPTY_TIMER_RESULT };

  const now = new Date();
  const nowIso = now.toISOString();
  const wasRunningSince = existing.timer_started_at;
  const timerPatch = wasRunningSince
    ? {
        timer_started_at: null,
        time_spent_seconds: existing.time_spent_seconds + Math.max(0, Math.floor((now.getTime() - new Date(wasRunningSince).getTime()) / 1000)),
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
  if (error || !data) return { error: error?.message ?? "Could not complete task.", success: false, ...EMPTY_TIMER_RESULT };

  // 2026-09-09 — same day-breakdown commit as pauseTaskTimer, only when the
  // timer was actually running at the moment of Done (mirrors the
  // conditional timerPatch above).
  const todaySeconds = wasRunningSince
    ? await recordDailySegmentsAndGetToday(supabase, employee, id, wasRunningSince, nowIso)
    : (await supabase.from("task_daily_time_log").select("seconds_spent").eq("task_id", id).eq("log_date", todayIST()).maybeSingle()).data?.seconds_spent ?? 0;

  // Best-effort: a failure here shouldn't undo the task being marked
  // Done (the task update above already committed) — log server-side and
  // move on, same "never let a secondary effect block the real action"
  // principle as punchOutOnLogout elsewhere in this codebase.
  try {
    const { error: dwlError } = await supabase.from("daily_work_logs").insert({
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
    if (dwlError) throw dwlError;
  } catch (e) {
    console.error("markTaskDone: failed to auto-create daily_work_logs row", e);
    // 2026-09-19 (audit fix, item C5) — previously console.error only: the
    // task showed "Done" while this row silently never got created, a
    // payroll/attendance data gap invisible to the employee. Still
    // non-blocking (markTaskDone still returns success below), just also
    // now visible on /dashboard/error-log so it can actually get fixed.
    await logEntryError(supabase, {
      companyId: existing.company_id,
      source: "system",
      reason: `Task marked Done but its Daily Work Log row failed to auto-create: ${e instanceof Error ? e.message : String(e)}`,
      referenceType: "task",
      referenceId: id,
      referenceLabel: existing.description,
      raisedByEmployeeId: employee.id,
      raisedByName: employee.name,
    });
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, success: true, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, status: data.status, todaySeconds };
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
