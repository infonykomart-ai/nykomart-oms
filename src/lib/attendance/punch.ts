// Shared Punch In / Punch Out logic — reused by the login hook ("LOGIN
// KARTE HI PERSENT LAG JAYE"), the logout hook ("LOGOUT KARTE HI PUNCH
// OUT"), and the manual Punch In/Out button on /dashboard/attendance (a
// backup for anyone who was already mid-session when this shipped, or logs
// in from a device where the auto-hook didn't fire for some reason — same
// "backup for a missed physical/automatic punch" role the old system's Web
// Punch button played). Always uses the service-role client — see
// db/schema.sql's attendance table comment: no RLS policies exist on this
// table, every write goes through a capability-checked (or login-implied)
// server action, same pattern as sales_invoices/orders.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { todayIST, nowISOInstant, nowISTTime } from "./ist-date";
import { notifyCompanion } from "@/lib/companion/notify";

// HH:MM (IST, 24h) — same config-constant convention as the old system's
// ATTENDANCE_LATE_CUTOFF_HOUR/MINUTE. No admin UI to change this yet
// (flagged as a scope simplification) — edit this constant if the cutoff
// needs to change again.
//
// 2026-09-02: "attendance 9:30 ke baad sabhi ko late dikhati hai punching
// time 9:20 se 9:45 am tak agar koi present karta hai to vo present
// dikhaye" — moved from 09:30 to 09:45. Anyone punching in AT or before
// 9:45 AM IST now shows Present; only strictly after 9:45 shows Late.
const LATE_CUTOFF_HHMM = "09:45";

export async function recordPunchIn(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  companyId: string,
  source: "Web Punch" | "Manual Entry" = "Web Punch"
): Promise<{ ok: true; alreadyPunchedIn: boolean; status?: string } | { ok: false; error: string }> {
  const date = todayIST();
  const { data: existing, error: selectError } = await supabase
    .from("attendance")
    .select("id, punch_in")
    .eq("employee_id", employeeId)
    .eq("attendance_date", date)
    .maybeSingle();
  if (selectError) return { ok: false, error: selectError.message };

  if (existing?.punch_in) return { ok: true, alreadyPunchedIn: true };

  // Late cutoff is purely a punch-IN-time check — an employee who's already
  // punched in for the day keeps whatever status was set then, even if this
  // function somehow ran again later; the `existing?.punch_in` check above
  // already returns early in that case, so this only ever runs once/day.
  const status = nowISTTime() > LATE_CUTOFF_HHMM ? "Late" : "Present";

  if (existing) {
    const { error } = await supabase.from("attendance").update({ punch_in: nowISOInstant(), status }).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      company_id: companyId,
      attendance_date: date,
      punch_in: nowISOInstant(),
      status,
      source,
    });
    if (error) return { ok: false, error: error.message };
  }

  // 2026-09-05 — AI Companion: fires from here (not the manual-button
  // action, or the login-hook action separately) so BOTH the automatic
  // login punch-in ("Web Punch") and the manual backup button ("Manual
  // Entry") trigger exactly one reaction — and never a repeat one on a
  // later call the same day (alreadyPunchedIn already returned early above).
  await notifyCompanion(supabase, {
    employeeId,
    eventType: "attendance_marked",
    message: `Attendance marked for today (${status}) 🕒`,
  });

  return { ok: true, alreadyPunchedIn: false, status };
}

export async function recordPunchOut(
  supabase: SupabaseClient<Database>,
  employeeId: string
): Promise<{ ok: true; noPunchInFound: boolean; alreadyPunchedOut: boolean } | { ok: false; error: string }> {
  const date = todayIST();
  const { data: existing, error: selectError } = await supabase
    .from("attendance")
    .select("id, punch_out")
    .eq("employee_id", employeeId)
    .eq("attendance_date", date)
    .maybeSingle();
  if (selectError) return { ok: false, error: selectError.message };
  if (!existing) return { ok: true, noPunchInFound: true, alreadyPunchedOut: false };
  if (existing.punch_out) return { ok: true, noPunchInFound: false, alreadyPunchedOut: true };

  const { error } = await supabase.from("attendance").update({ punch_out: nowISOInstant() }).eq("id", existing.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, noPunchInFound: false, alreadyPunchedOut: false };
}
