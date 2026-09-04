"use server";

// "Download All" for the Daily Shipment Report tab (EGS-integration round,
// 2026-09-04) — runs the SAME query as the on-screen table but with the
// higher export row cap (see daily-report-data.ts's ROW_CAP_EXPORT),
// returned as CSV text for the client to save as a file. A plain
// server-action call (not a bound <form>/useActionState) since this is a
// one-shot "give me the data" call triggered from a button, not a form
// submission with pending/error UI state.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getDailyShipmentReport, toCsv, type DailyReportFilters } from "./daily-report-data";

export async function exportDailyShipmentReportCsv(filters: DailyReportFilters): Promise<{ csv: string | null; error: string | null }> {
  try {
    const employee = await requireCapability("courier_booking_shipment");
    const supabase = createServiceRoleClient();
    const rows = await getDailyShipmentReport(supabase, employee.currentCompanyId, filters, true);
    return { csv: toCsv(rows), error: null };
  } catch (err) {
    return { csv: null, error: err instanceof Error ? err.message : String(err) };
  }
}
