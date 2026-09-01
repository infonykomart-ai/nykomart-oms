import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// 2026-08-11 (round 2): "AGAR KOI KAAM NEXT DAY KE LIYE MARK KIYA HAI TO VO
// AGALE DIN AUTOMATIC PENDING ME DIKH JAYE" — any daily_work_logs row still
// marked "Next Day Carry On" from a PREVIOUS day gets copied forward into
// today as a fresh row with work_status = "Pending", the moment the
// employee's Attendance page is opened on the new day. carried_forward on
// the original row stops it from being copied again on a later visit; if
// it's ALSO marked "Next Day Carry On" again on the new day, that new row
// carries forward again the day after — same as literally re-marking it,
// which is exactly what a repeatedly-postponed item should do.
//
// 2026-08-24 — "jis work ko net day par likhe to submit to ho jaye lekin
// next day pending work me aajaye autometic, pending & in progress bhi ese
// hi aaye" (an item logged one day should automatically show up in the
// NEXT day's pending work too — Pending and In Progress should carry
// forward the same way "Next Day Carry On" already does). Previously this
// only matched the one special "Next Day Carry On" status, so a plain
// "Pending" or "In Progress" row — the normal case, since Submit itself is
// only available once a row is marked Completed (see submitDailyLog /
// saveAndSubmitDailyLog) — just sat there and silently vanished from every
// screen once its day passed (My Recent Reports / Report History both only
// show submitted_at IS NOT NULL rows, and this was the only place ANY
// unfinished row was ever re-surfaced). Broadened to any not-yet-finished
// status so the employee doesn't have to remember to pick a special 4th
// status just to keep unfinished work visible.
//
// Deliberately a plain function (not a "use server" action) called
// directly from the Attendance page (a Server Component) before its own
// queries run, using the service-role client — same "server re-check,
// never trust the client" posture as everywhere else in this module.
const CARRY_FORWARD_STATUSES = ["Pending", "In Progress", "Next Day Carry On"];

export async function carryOverPendingDailyLogs(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  todayStr: string
): Promise<void> {
  const { data: pending } = await supabase
    .from("daily_work_logs")
    // 2026-09-01: priority didn't exist on this table when this automatic
    // mechanism was first written — included now so a silently-rolled-over
    // row doesn't lose its priority back to the column default, matching
    // what the new explicit Carry Forward action (actions.ts,
    // carryForwardDailyLog) already does.
    .select("id, company_id, category, description, target_qty, remark_sku, priority")
    .eq("employee_id", employeeId)
    .in("work_status", CARRY_FORWARD_STATUSES)
    .eq("carried_forward", false)
    // Defense in depth: none of these 3 statuses can actually be submitted
    // today (Submit/saveAndSubmitDailyLog requires Completed), so this is
    // always true in practice — but explicit here so a future change to
    // that rule can't accidentally start re-copying an already-finalized
    // report forward.
    .is("submitted_at", null)
    .lt("log_date", todayStr);

  if (!pending || pending.length === 0) return;

  for (const row of pending) {
    // db/schema.sql has a UNIQUE index on carried_from_log_id (where not
    // null) specifically so a concurrent duplicate insert (two tabs open,
    // or a retried request racing this same select) fails here instead of
    // creating a second "Pending" row — treat that failure as "someone
    // else already carried this one forward" and just mark it done.
    const { error: insertError } = await supabase.from("daily_work_logs").insert({
      employee_id: employeeId,
      company_id: row.company_id,
      log_date: todayStr,
      category: row.category,
      description: row.description,
      target_qty: row.target_qty,
      work_status: "Pending",
      remark_sku: row.remark_sku,
      priority: row.priority,
      carried_from_log_id: row.id,
    });
    if (insertError && insertError.code !== "23505") continue; // unexpected error — leave carried_forward alone, retry next load
    await supabase.from("daily_work_logs").update({ carried_forward: true }).eq("id", row.id);
  }
}
