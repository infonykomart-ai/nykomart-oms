// 2026-09-05 — notifyCompanion(): the one call every wired-up action makes
// to make the live AI Companion react ("jese kisi ne order dala to vo
// kabhi left se aakr bolegi..."). Mirrors the auto-invoice convention
// (maybeAutoGenerateCsbVInvoiceForBooking, courier-booking/actions.ts):
// called AFTER the real write already succeeded, wrapped in try/catch, and
// NEVER allowed to fail or slow down the action it's attached to — an
// employee saving an order must never see an error (or even a delay) just
// because the companion_events insert had a problem.
//
// Deliberately does NOT check employees.companion_enabled before writing —
// the row is written regardless, cheap and harmless (nobody but that one
// employee can ever SELECT it, per the RLS policy in
// db/2026-09-05-ai-companion-live.sql), and the check that actually matters
// happens once, cheaply, at layout load (see dashboard/layout.tsx) to
// decide whether to mount the live widget/subscription for that employee at
// all — so a later Admin toggle-on doesn't require replaying past events.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { CompanionEventType } from "@/components/companion/companion-config";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export async function notifyCompanion(
  supabase: ServiceClient,
  params: {
    /** Employee(s) who should see this reaction — usually just the actor,
     *  but e.g. task assignment notifies the ASSIGNEE, not the assigner. */
    employeeId: string | string[];
    eventType: CompanionEventType;
    message: string;
  }
): Promise<void> {
  try {
    const employeeIds = Array.isArray(params.employeeId) ? params.employeeId : [params.employeeId];
    if (employeeIds.length === 0) return;
    await supabase.from("companion_events").insert(
      employeeIds.map((employeeId) => ({
        employee_id: employeeId,
        event_type: params.eventType,
        message: params.message,
      }))
    );
  } catch {
    // Never block or fail the caller's real action over this.
  }
}
