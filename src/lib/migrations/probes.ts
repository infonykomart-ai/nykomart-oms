// 2026-10-21 — "migration status" probes.
//
// WHY THIS EXISTS: this app's recent rounds all ship a dated SQL file that
// has to be run ONCE by hand in Supabase's SQL editor (deliver-not-execute
// rule). The code around every such change is deliberately migration-tolerant
// — reads fall back to the old columns and writes retry without the new ones
// — so the app never breaks on a database that hasn't had the file run. The
// cost of that tolerance is invisibility: a screen quietly keeps showing the
// OLD figures (the reported case: invoice 170 still 5% high in Bill Payment /
// Party Ledger long after the "No GST" fix shipped) and nobody can tell from
// the UI whether the fix is live or the SQL is still pending.
//
// This module answers that question read-only: one probe per dated file,
// checking for the object that file creates (a table, a column, or an RPC).
// Nothing is written, nothing is executed — each check is a `limit(1)` select
// or an rpc call that PostgREST answers with "column/table does not exist"
// when the file hasn't been run. The panel at
// /dashboard/admin/migrations renders the result with the exact file to run.
//
// Same optional-column philosophy as everything else: an unexpected error
// (permissions, network) is reported as "unknown", never as "applied" —
// guessing "applied" would hide a pending migration, which is the whole
// problem this page exists to solve.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// The typed client only accepts a LITERAL table/column name (the select
// string is itself type-checked against the generated schema), which is
// exactly what a probe can't have — table and column are runtime data here.
// These probes only ever run a `limit(1)` select or an rpc call against the
// UNtyped client and discard the data, so the cast is contained to the two
// helpers below and can't smuggle an untyped read anywhere else.
type UntypedClient = SupabaseClient;

export type ProbeState = "applied" | "missing" | "unknown";

export type MigrationProbe = {
  /** The dated file an admin runs in the Supabase SQL editor. */
  file: string;
  label: string;
  /** What quietly degrades while this file is not run. */
  impact: string;
  checks: { name: string; state: ProbeState }[];
};

type MissingError = { code?: string | null; message?: string | null };

/** True when the error is "this database hasn't got that object yet" —
 *  Postgres 42703 (column) / 42P01 (table) / 42883 (function), PostgREST's
 *  PGRST204/PGRST205 and the "not found in the schema cache" wording. */
function isMissingSchemaPiece(error: MissingError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find")
  );
}

async function hasColumn(client: ServiceClient, table: string, column: string): Promise<ProbeState> {
  const { error } = await (client as unknown as UntypedClient).from(table).select(column).limit(1);
  if (!error) return "applied";
  return isMissingSchemaPiece(error) ? "missing" : "unknown";
}

/**
 * One probe per dated SQL file, oldest first. A file counts as applied only
 * when EVERY check for it is "applied" — half-run files are real (the CREATE
 * TABLE and the ALTER TABLE are separate statements, and PostgREST's schema
 * cache needs a moment even after both land), and a half-applied file must
 * still be listed.
 */
export async function probeMigrations(
  client: ServiceClient,
  probeCompanyId: string
): Promise<MigrationProbe[]> {
  async function probe(
    file: string,
    label: string,
    impact: string,
    checks: { name: string; promise: Promise<ProbeState> }[]
  ): Promise<MigrationProbe> {
    return { file, label, impact, checks: await Promise.all(checks.map(async (c) => ({ name: c.name, state: await c.promise }))) };
  }

  const rpcState = (async (): Promise<ProbeState> => {
    const { error } = await (client as unknown as UntypedClient).rpc("get_order_status_counts", { p_company_id: probeCompanyId });
    if (!error) return "applied";
    return isMissingSchemaPiece(error) ? "missing" : "unknown";
  })();

  return Promise.all([
    probe("db/2026-08-17-ebay-indexes-and-order-status-rpc.sql", "eBay tax-line indexes + order-status count RPC",
      "eBay tax invoice lines have no index, and the CRM/Dashboard order counts still count every order row in Node instead of in the database.",
      [{ name: "get_order_status_counts() RPC", promise: rpcState }]),

    probe("db/2026-09-03-courier-account-setup.sql", "Courier Account Setup (per-company API credentials)",
      "Every company would ride on the single set of deployment env vars — a second company can't have its own FedEx/UPS/DHL account.",
      [{ name: "courier_credentials table", promise: hasColumn(client, "courier_credentials", "company_id") }]),

    probe("db/2026-09-30c-employee-telegram-chat-id.sql", "Employee Telegram chat id",
      "Telegram message delivery can't target an employee (messenger/chat notifications).",
      [{ name: "employees.telegram_chat_id", promise: hasColumn(client, "employees", "telegram_chat_id") }]),

    probe("db/2026-10-02-attendance-punch-geo.sql", "Attendance punch GPS",
      "Punch In/Out record no coordinates, so the Location/GPS attendance report has nothing to show.",
      [{ name: "attendance.punch_in_lat", promise: hasColumn(client, "attendance", "punch_in_lat") }]),

    probe("db/2026-10-02b-departments-entity.sql", "Departments",
      "Employees can't be grouped by department anywhere (HR/attendance views).",
      [{ name: "departments table", promise: hasColumn(client, "departments", "id") }]),

    probe("db/2026-10-15-ad-spend-amazon-country.sql", "Store Ad Spend: per-country Amazon rows",
      "An Amazon store can only hold ONE spend row per day — the per-marketplace (US/UK/DE …) split isn't possible.",
      [{ name: "store_ad_spend.country_code", promise: hasColumn(client, "store_ad_spend", "country_code") }]),

    probe("db/2026-10-15b-fx-rate-cache.sql", "Live FX rate cache",
      "On-screen USD→INR conversion shows no live market rate (the legal customs master is unaffected).",
      [{ name: "fx_rate_cache table", promise: hasColumn(client, "fx_rate_cache", "base_currency") }]),

    probe("db/2026-10-17-customs-exchange-rates.sql", "Customs exchange rates (DGFT → ICEGATE → eximin.net)",
      "Export/customs rate-to-INR never refreshes automatically — a manual entry is the only option.",
      [{ name: "customs_exchange_rates table", promise: hasColumn(client, "customs_exchange_rates", "currency_code") }]),

    probe("db/2026-10-17-leave-audit-and-lifecycle.sql", "Leave audit trail + lifecycle (location, timeline, cancel/half-day/shorten)",
      "Leave applications carry no applied-at location or event timeline, and cancel/modify actions are unavailable.",
      [
        { name: "leave_request_events table", promise: hasColumn(client, "leave_request_events", "id") },
        { name: "leave_requests.applied_lat", promise: hasColumn(client, "leave_requests", "applied_lat") },
        { name: "leave_requests.cancelled_at", promise: hasColumn(client, "leave_requests", "cancelled_at") },
      ]),

    probe("db/2026-10-17b-b2b-area-pricing.sql", "B2B area-based (per sq ft) pricing",
      "B2B enquiry/quotation lines can't be sized, so \"₹ per sq ft\" lines bill at a flat qty × rate instead.",
      [
        { name: "b2b_inquiry_items.size", promise: hasColumn(client, "b2b_inquiry_items", "size") },
        { name: "b2b_sales_order_items.size", promise: hasColumn(client, "b2b_sales_order_items", "size") },
      ]),

    probe("db/2026-10-19-leave-approvers.sql", "Designated leave approvers",
      "Leave can only be decided by MD/Admin — no named approver routing, and applications can't be routed to a specific person.",
      [
        { name: "leave_approver_assignments table", promise: hasColumn(client, "leave_approver_assignments", "id") },
        { name: "leave_requests.approver_employee_id", promise: hasColumn(client, "leave_requests", "approver_employee_id") },
      ]),

    probe("db/2026-10-20-purchase-bill-no-gst-and-audit.sql", "Purchase Bill \"No GST\" repair + edit audit stamp",
      "Bills saved as \"No GST\" after 2026-08-17 stay 5% high in Bill Payment / Party Ledger / P&L (the reported invoice-170 case), and Purchase Bills show no \"last updated\" time.",
      [{ name: "purchase_bills.updated_at", promise: hasColumn(client, "purchase_bills", "updated_at") }]),
  ]);
}

/** A file is fully applied only when none of its checks are missing. */
export function migrationApplied(probe: MigrationProbe): boolean {
  return probe.checks.every((c) => c.state === "applied");
}

/** Read-only summary for the panel's headline. */
export function summarizeMigrations(probes: MigrationProbe[]): { pending: number; unknown: number; total: number } {
  return {
    pending: probes.filter((p) => !migrationApplied(p) && p.checks.some((c) => c.state === "missing")).length,
    unknown: probes.filter((p) => !migrationApplied(p) && p.checks.every((c) => c.state !== "missing")).length,
    total: probes.length,
  };
}
