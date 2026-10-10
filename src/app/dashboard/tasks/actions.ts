"use server";

// 2026-10-07: Consolidate the task server actions so both the
// Attendance page and the new /dashboard/tasks route use the same
// functions. Keep this as THE source of truth for task_assignment /
// per-task timers / Daily Work Report auto-fill (task_daily_time_log with
// per-day breakdown, created_at ordering), matching the logic the
// Attendance page already relies on.
//
// Imports live here so the other components (assign-task-form,
// task-list, assigned-by-me-list) don't create circular deps back to this
// file.
import { revalidatePath } from "next/cache";
import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, splitIntervalByISTDay } from "@/lib/attendance/ist-date";
import { notifyCompanion } from "@/lib/companion/notify";
import { logEntryError } from "@/lib/error-log/log-entry-error";

export type SimpleActionState = { error: string | null; success: boolean };

export type AssignTaskInput = {
  assignedToEmployeeId: string;
  website: string;
  category: string;
  priority: string;
  deadline: string; // "" = none
  description: string;
};

export async function assignTask(
  _prev: SimpleActionState,
  formData: FormData
): Promise<SimpleActionState> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();

  const assignedToEmployeeId = String(formData.get("assigned_to_employee_id") || "");
  const description = String(formData.get("description") || "").trim();
  if (!assignedToEmployeeId) return { error: "Choose who this task is for.", success: false };
  if (!description) return { error: "Description is required.", success: false };

  // 2026-08-11 (round 4): any employee in any company can assign to any
  // other active employee. Only the target must exist and be active.
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
  // task_daily_time_log.
  todaySeconds: number;
};

const EMPTY_TIMER_RESULT = {
  timerStartedAt: null,
  timeSpentSeconds: 0,
  firstStartedAt: null,
  lastPausedAt: null,
  status: null,
  todaySeconds: 0,
};

async function recordDailySegmentsAndGetToday(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employee: AuthedEmployee,
  taskId: string,
  startIso: string,
  endIso: string
): Promise<{ todaySeconds: number; logDates: string[] }> {
  const logDates = new Set<string>([todayIST()]);
  try {
    const segments = splitIntervalByISTDay(startIso, endIso);
    for (const seg of segments) {
      logDates.add(seg.logDate);
      const { error } = await supabase.rpc("add_task_daily_time", {
        p_task_id: taskId,
        p_log_date: seg.logDate,
        p_seconds: seg.seconds,
      });
      if (error) {
        console.error("recordDailySegmentsAndGetToday: add_task_daily_time failed", seg, error);
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
  return { todaySeconds: data?.seconds_spent ?? 0, logDates: Array.from(logDates) };
}

type TaskWorkLogSource = {
  id: string;
  companyId: string;
  category: string | null;
  website: string | null;
  description: string;
  priority: string;
  firstStartedAt: string | null;
};

/**
 * 2026-10-09 — "agar aaj 2 ghante lagaye to wo AJ KI report me count ho
 * chahe task incomplete ho, aur pehle ke din ka time dobara count na ho".
 * Mirrors a task's PER-DAY committed time (task_daily_time_log — the
 * additive per-IST-day breakdown) into the employee's Daily Work Report
 * (daily_work_logs), one row per day, each SET to only that day's total.
 *
 * This is the fix for two separate bugs in the old markTaskDone INSERT:
 *   1. It wrote the task's LIFETIME time_spent_seconds into today's row, so
 *      a 3-day task dumped all 3 days of hours into its completion day's
 *      report (double-counting days that already had their own rows).
 *   2. It only ever ran on Done — an INCOMPLETE task's hours never reached
 *      the Daily Work Report at all. Now pause mirrors them too
 *      (finalize=false → draft the employee can still edit/submit).
 *
 * Row identity: employee + log_date + the same "[Task] ..." description
 * convention markTaskDone already used (daily_work_logs has no task_id FK).
 * finalize=true (task Done) additionally submits every still-open row for
 * the task — the old "Done auto-submits a report row" behavior, now applied
 * to every day the task touched. Already-submitted rows stay locked, like
 * everywhere else on this table. All failures are logged, never thrown: a
 * report-mirror bug must not eat the employee's timer action.
 */
async function syncTaskDailyWorkLogRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employee: AuthedEmployee,
  task: TaskWorkLogSource,
  logDates: string[],
  opts: { finalize: boolean }
): Promise<void> {
  const description = `[Task] ${task.description}${task.website ? ` (${task.website})` : ""}`;
  const today = todayIST();
  const nowIso = new Date().toISOString();

  for (const logDate of Array.from(new Set(logDates)).sort()) {
    try {
      const { data: dayRow } = await supabase
        .from("task_daily_time_log")
        .select("seconds_spent")
        .eq("task_id", task.id)
        .eq("log_date", logDate)
        .maybeSingle();
      const seconds = Math.max(0, dayRow?.seconds_spent ?? 0);
      const isToday = logDate === today;

      const { data: existingRows } = await supabase
        .from("daily_work_logs")
        .select("id, submitted_at")
        .eq("employee_id", employee.id)
        .eq("log_date", logDate)
        .eq("description", description)
        .order("created_at", { ascending: true })
        .limit(1);
      const existing = existingRows?.[0] ?? null;
      if (existing?.submitted_at) continue; // already finalized — locked, same as upsertDailyLog's guard
      // Nothing to report for this day (e.g. a 0-second segment day) unless
      // it's the completion day, which still gets its "task done today" row.
      if (!existing && seconds <= 0 && !(isToday && opts.finalize)) continue;

      const row = {
        work_status: opts.finalize ? "Completed" : "In Progress",
        time_spent_seconds: seconds,
        updated_at: nowIso,
        ...(opts.finalize ? { submitted_at: nowIso } : {}),
      };
      if (existing) {
        const { error } = await supabase
          .from("daily_work_logs")
          .update(row)
          .eq("id", existing.id)
          .is("submitted_at", null); // race guard — same shape as upsertDailyLog
        if (error) throw error;
      } else {
        const { error } = await supabase.from("daily_work_logs").insert({
          employee_id: employee.id,
          company_id: task.companyId,
          log_date: logDate,
          category: task.category ?? "Task",
          description,
          work_status: row.work_status,
          time_spent_seconds: seconds,
          priority: task.priority,
          first_started_at: task.firstStartedAt,
          last_paused_at: nowIso,
          ...(opts.finalize ? { submitted_at: nowIso } : {}),
        });
        if (error) throw error;
      }
    } catch (e) {
      console.error("syncTaskDailyWorkLogRows failed", { taskId: task.id, logDate, finalize: opts.finalize }, e);
      await logEntryError(supabase, {
        companyId: employee.currentCompanyId,
        source: "system",
        reason: `Task daily-report mirror failed for ${logDate}: ${e instanceof Error ? e.message : String(e)}`,
        referenceType: "task",
        referenceId: task.id,
        raisedByEmployeeId: employee.id,
        raisedByName: employee.name,
      });
    }
  }

  if (opts.finalize) {
    // Task is Done → every still-open report row for it becomes final,
    // including days paused earlier and never submitted. Rows the employee
    // already submitted are left locked by the .is("submitted_at", null)
    // guard.
    try {
      await supabase
        .from("daily_work_logs")
        .update({ submitted_at: nowIso, work_status: "Completed", updated_at: nowIso })
        .eq("employee_id", employee.id)
        .eq("description", description)
        .is("submitted_at", null);
    } catch (e) {
      console.error("syncTaskDailyWorkLogRows finalize sweep failed", { taskId: task.id }, e);
      await logEntryError(supabase, {
        companyId: employee.currentCompanyId,
        source: "system",
        reason: `Task daily-report finalize sweep failed: ${e instanceof Error ? e.message : String(e)}`,
        referenceType: "task",
        referenceId: task.id,
        raisedByEmployeeId: employee.id,
        raisedByName: employee.name,
      });
    }
  }
}

export async function startTaskTimer(id: string): Promise<TimerActionResult> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("first_started_at, time_spent_seconds, timer_started_at, status")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", ...EMPTY_TIMER_RESULT };
  if (existing.timer_started_at) {
    const { data: todayRow } = await supabase
      .from("task_daily_time_log")
      .select("seconds_spent")
      .eq("task_id", id)
      .eq("log_date", todayIST())
      .maybeSingle();
    return {
      error: null,
      timerStartedAt: existing.timer_started_at,
      timeSpentSeconds: existing.time_spent_seconds,
      firstStartedAt: existing.first_started_at,
      lastPausedAt: null,
      status: existing.status,
      todaySeconds: todayRow?.seconds_spent ?? 0,
    };
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
  const { data: todayRow } = await supabase
    .from("task_daily_time_log")
    .select("seconds_spent")
    .eq("task_id", id)
    .eq("log_date", todayIST())
    .maybeSingle();
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return {
    error: null,
    timerStartedAt: data.timer_started_at,
    timeSpentSeconds: data.time_spent_seconds,
    firstStartedAt: data.first_started_at,
    lastPausedAt: data.last_paused_at,
    status: data.status,
    todaySeconds: todayRow?.seconds_spent ?? 0,
  };
}

export async function pauseTaskTimer(id: string): Promise<TimerActionResult> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tasks")
    .select("timer_started_at, time_spent_seconds, first_started_at, status, company_id, category, website, description, priority")
    .eq("id", id)
    .eq("assigned_to_employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Task not found.", ...EMPTY_TIMER_RESULT };
  if (!existing.timer_started_at) {
    const { data: todayRow } = await supabase
      .from("task_daily_time_log")
      .select("seconds_spent")
      .eq("task_id", id)
      .eq("log_date", todayIST())
      .maybeSingle();
    return {
      error: null,
      timerStartedAt: null,
      timeSpentSeconds: existing.time_spent_seconds,
      firstStartedAt: existing.first_started_at,
      lastPausedAt: null,
      status: existing.status,
      todaySeconds: todayRow?.seconds_spent ?? 0,
    };
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
  const { todaySeconds, logDates } = await recordDailySegmentsAndGetToday(supabase, employee, id, startedAtIso, nowIso);
  // 2026-10-09 — an INCOMPLETE task's hours still belong in the day they
  // were worked (finalize=false → draft row the employee can edit/submit).
  // Mirrors task_daily_time_log into daily_work_logs per IST day — see
  // syncTaskDailyWorkLogRows.
  await syncTaskDailyWorkLogRows(
    supabase,
    employee,
    {
      id,
      companyId: existing.company_id,
      category: existing.category,
      website: existing.website,
      description: existing.description,
      priority: existing.priority,
      firstStartedAt: existing.first_started_at,
    },
    logDates,
    { finalize: false }
  );
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/tasks");
  return {
    error: null,
    timerStartedAt: data.timer_started_at,
    timeSpentSeconds: data.time_spent_seconds,
    firstStartedAt: data.first_started_at,
    lastPausedAt: data.last_paused_at,
    status: data.status,
    todaySeconds,
  };
}

/** ✔ Done — pauses timer if running, marks task complete, auto-creates a submitted Daily Work Report row. */
export async function markTaskDone(id: string): Promise<TimerActionResult & { success: boolean }> {
  const employee = await requireCapability("task_management");
  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("tasks")
    .select("timer_started_at, time_spent_seconds, first_started_at, company_id, category, website, description, priority")
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

  const { todaySeconds, logDates } = wasRunningSince
    ? await recordDailySegmentsAndGetToday(supabase, employee, id, wasRunningSince, nowIso)
    : {
        todaySeconds: (await supabase.from("task_daily_time_log").select("seconds_spent").eq("task_id", id).eq("log_date", todayIST()).maybeSingle()).data?.seconds_spent ?? 0,
        logDates: [todayIST()],
      };

  // 2026-10-09 — REPLACES the old single INSERT that wrote the task's
  // LIFETIME time_spent_seconds into today's report row (double-counting
  // prior days' hours) and only ever fired on Done (incomplete-task hours
  // never reached the report). syncTaskDailyWorkLogRows writes one row per
  // IST day with only that day's hours and finalizes every still-open row.
  await syncTaskDailyWorkLogRows(
    supabase,
    employee,
    {
      id,
      companyId: existing.company_id,
      category: existing.category,
      website: existing.website,
      description: existing.description,
      priority: existing.priority,
      firstStartedAt: existing.first_started_at,
    },
    logDates,
    { finalize: true }
  );

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/tasks");
  return {
    error: null,
    success: true,
    timerStartedAt: data.timer_started_at,
    timeSpentSeconds: data.time_spent_seconds,
    firstStartedAt: data.first_started_at,
    lastPausedAt: data.last_paused_at,
    status: data.status,
    todaySeconds,
  };
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
