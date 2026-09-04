import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// 2026-09-04 — Daily Work Planner (fixed/recurring templates). See
// db/2026-09-04-work-plan-templates.sql for the full schema design
// reasoning. Two layers of "fixed work", both applying at once:
//   - scope='role' rows: Admin/HR-managed (attendance/admin/actions.ts),
//     apply to every employee whose roleName (getAuthedEmployee().roleName
//     — require-capability.ts) matches role_name, within that company.
//   - scope='employee' rows: self-managed (attendance/actions.ts), apply
//     only to that one employee_id, on top of whatever role template(s)
//     also apply to them.
//
// materializeWorkPlanTemplatesForToday() is a plain function (not a
// "use server" action), called directly from the Attendance page (a
// Server Component) before its own daily_work_logs queries run, using the
// service-role client — same "deliberately not a Server Action, server
// re-check, never trust the client" posture as carryOverPendingDailyLogs()
// (carry-over.ts), which this is modeled on line-for-line.

/**
 * Any bare template item — the columns actually copied into a
 * materialized daily_work_logs row.
 */
type TemplateItem = {
  id: string;
  category: string | null;
  description: string;
  target_qty: string | null;
};

/**
 * For a given employee (their id, current company, and resolved role
 * name), find every active template (role-scope matching their role, OR
 * employee-scope matching their own id) that doesn't already have a
 * daily_work_logs row for `todayStr`, and insert one — work_status
 * 'Pending', source_template_id set so it can carry the "🗂️ Template"
 * badge. From there it's a completely normal row: editable, completable,
 * carry-forward-able, deletable — no special-casing anywhere else in the
 * Daily Work Report flow.
 *
 * Idempotency: db/2026-09-04-work-plan-templates.sql's partial unique
 * index `idx_daily_work_logs_source_template_unique ON daily_work_logs
 * (employee_id, log_date, source_template_id) WHERE source_template_id IS
 * NOT NULL` is the real guard (a concurrent double-open of this page, or a
 * retried request, hits that unique-violation instead of creating a
 * duplicate row) — the pre-check below just avoids a redundant insert
 * attempt in the common case.
 */
export async function materializeWorkPlanTemplatesForToday(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  companyId: string,
  roleName: string,
  todayStr: string
): Promise<void> {
  const [{ data: roleTemplates }, { data: employeeTemplates }, { data: alreadyMaterialized }] = await Promise.all([
    roleName
      ? supabase
          .from("work_plan_templates")
          .select("id, category, description, target_qty")
          .eq("company_id", companyId)
          .eq("scope", "role")
          .eq("role_name", roleName)
          .eq("active", true)
      : Promise.resolve({ data: [] as TemplateItem[] }),
    supabase
      .from("work_plan_templates")
      .select("id, category, description, target_qty")
      .eq("scope", "employee")
      .eq("employee_id", employeeId)
      .eq("active", true),
    supabase
      .from("daily_work_logs")
      .select("source_template_id")
      .eq("employee_id", employeeId)
      .eq("log_date", todayStr)
      .not("source_template_id", "is", null),
  ]);

  const templates: TemplateItem[] = [...(roleTemplates ?? []), ...(employeeTemplates ?? [])];
  if (templates.length === 0) return;

  const existingTemplateIds = new Set((alreadyMaterialized ?? []).map((r) => r.source_template_id));
  const missing = templates.filter((t) => !existingTemplateIds.has(t.id));
  if (missing.length === 0) return;

  for (const t of missing) {
    const { error: insertError } = await supabase.from("daily_work_logs").insert({
      employee_id: employeeId,
      company_id: companyId,
      log_date: todayStr,
      category: t.category,
      description: t.description,
      target_qty: t.target_qty,
      work_status: "Pending",
      source_template_id: t.id,
    });
    // 23505 = unique-violation on idx_daily_work_logs_source_template_unique
    // — someone else's concurrent request (or a retry) already
    // materialized this exact template for today; nothing further to do,
    // same "treat the unique-violation as success" handling as
    // carryOverPendingDailyLogs() above.
    if (insertError && insertError.code !== "23505") {
      console.error("materializeWorkPlanTemplatesForToday: failed to insert", t.id, insertError);
    }
  }
}
