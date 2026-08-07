// Birthday/Anniversary celebration feature (2026-08-07). Computes which
// employees have a birthday or work-anniversary TODAY, scoped to the
// companies the current employee can see. Matching is done in JS on the
// "MM-DD" slice of the stored date string rather than a SQL date_part
// query — simpler to reason about than timezone-sensitive EXTRACT(), and
// the employee count here is small (dozens, not thousands) so there's no
// performance reason to push this into SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Celebration = {
  employeeId: string;
  name: string;
  photoUrl: string | null;
  kind: "birthday" | "anniversary" | "work_anniversary";
  // Only set for kind "work_anniversary" — 1st, 2nd, 3rd year at the
  // company, etc. (2026-08-07: user's explicit ask — "kisi ko company me
  // ek saal ho jaye 1,2,3...10 ese to uska bhi popup aana chahiye").
  years?: number;
};

function monthDay(dateStr: string | null): string | null {
  if (!dateStr) return null;
  // dateStr is "YYYY-MM-DD" from Postgres `date` columns via supabase-js.
  return dateStr.slice(5, 10);
}

export async function getTodaysCelebrations(
  supabase: SupabaseClient<Database>,
  companyIds: string[],
  today: Date = new Date()
): Promise<Celebration[]> {
  if (companyIds.length === 0) return [];

  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, photo_url, dob, anniversary_date, marital_status, active, date_of_joining")
    .in("company_id", companyIds)
    .eq("active", true);

  const todayMonthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const celebrations: Celebration[] = [];
  for (const e of employees ?? []) {
    if (monthDay(e.dob) === todayMonthDay) {
      celebrations.push({ employeeId: e.id, name: e.name, photoUrl: e.photo_url, kind: "birthday" });
    }
    if (e.marital_status === "Married" && monthDay(e.anniversary_date) === todayMonthDay) {
      celebrations.push({ employeeId: e.id, name: e.name, photoUrl: e.photo_url, kind: "anniversary" });
    }
    if (e.date_of_joining && monthDay(e.date_of_joining) === todayMonthDay) {
      const joinYear = Number(e.date_of_joining.slice(0, 4));
      const years = today.getFullYear() - joinYear;
      // Joining-day-itself (years=0) is not a "work anniversary" yet —
      // only 1 full year onward, any count (1..10..whatever).
      if (years >= 1) {
        celebrations.push({ employeeId: e.id, name: e.name, photoUrl: e.photo_url, kind: "work_anniversary", years });
      }
    }
  }
  return celebrations;
}
