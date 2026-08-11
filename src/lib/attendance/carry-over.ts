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
// Deliberately a plain function (not a "use server" action) called
// directly from the Attendance page (a Server Component) before its own
// queries run, using the service-role client — same "server re-check,
// never trust the client" posture as everywhere else in this module.
export async function carryOverPendingDailyLogs(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  todayStr: string
): Promise<void> {
  const { data: pending } = await supabase
    .from("daily_work_logs")
    .select("id, company_id, category, description, target_qty, remark_sku")
    .eq("employee_id", employeeId)
    .eq("work_status", "Next Day Carry On")
    .eq("carried_forward", false)
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
      carried_from_log_id: row.id,
    });
    if (insertError && insertError.code !== "23505") continue; // unexpected error — leave carried_forward alone, retry next load
    await supabase.from("daily_work_logs").update({ carried_forward: true }).eq("id", row.id);
  }
}
