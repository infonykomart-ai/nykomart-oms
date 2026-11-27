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
import { round2 } from "@/lib/ledger/apportion";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// The typed client only accepts a LITERAL table/column name (the select
// string is itself type-checked against the generated schema), which is
// exactly what a probe can't have — table and column are runtime data here.
// These probes only ever run a `limit(1)` select or an rpc call against the
// UNtyped client and discard the data, so the cast is contained to the two
// helpers below and can't smuggle an untyped read anywhere else.
type UntypedClient = SupabaseClient;

// 2026-11-23 — "manual" is for a dated file that creates nothing PostgREST can
// read (an index, an RLS policy, a storage bucket, a one-off data repair). It is
// listed so every file in db/ is visible, and it is never reported as applied:
// the panel must not claim to have verified something it cannot see.
export type ProbeState = "applied" | "missing" | "unknown" | "manual";

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

// ---------------------------------------------------------------------------
// 2026-11-23 — the panel now covers every dated file (~173 probes, ~350
// read-only checks). Firing all of them at once on every page load is a burst
// of hundreds of concurrent PostgREST requests — exactly the load a diagnostic
// page should never create. Three guards, in order of effect:
//   1. a short result cache, so reloading / back-navigating does not re-query
//      at all (the page passes force:true for an explicit "Check again");
//   2. a small concurrency pool, so at most PROBE_CONCURRENCY queries are ever
//      in flight;
//   3. an identical-check cache per client, so two files probing the same
//      table.column issue ONE query.
// The checks stay read-only and individually cheap (limit(1) selects / RPC).
// ---------------------------------------------------------------------------
export const PROBE_CONCURRENCY = 6;
let probeInFlight = 0;
const probeWaiters: (() => void)[] = [];

/** Run one read-only check inside the bounded pool. */
export async function withProbeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (probeInFlight >= PROBE_CONCURRENCY) {
    await new Promise<void>((resolve) => probeWaiters.push(resolve));
  }
  probeInFlight += 1;
  try {
    return await task();
  } finally {
    probeInFlight -= 1;
    probeWaiters.shift()?.();
  }
}

// Per-client so two requests can never share a half-finished answer, and so the
// cache dies with the request's client instead of going stale across renders.
const checkCache = new WeakMap<object, Map<string, Promise<ProbeState>>>();

async function hasColumn(client: ServiceClient, table: string, column: string): Promise<ProbeState> {
  let cache = checkCache.get(client);
  if (!cache) {
    cache = new Map();
    checkCache.set(client, cache);
  }
  const key = `${table}\u0000${column}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const task = withProbeSlot(async (): Promise<ProbeState> => {
    const { error } = await (client as unknown as UntypedClient).from(table).select(column).limit(1);
    if (!error) return "applied";
    return isMissingSchemaPiece(error) ? "missing" : "unknown";
  });
  cache.set(key, task);
  return task;
}

/**
 * A dated file that is a pure DATA repair has no schema object to look for.
 * `2026-11-14b` is the first one: it rescales debit-note adjustment rows that
 * were written before the GST fix. Reading every note with its adjustment rows
 * and judging them by the same predicate the file uses answers the only useful
 * question — "does this database still hold rows that file would change?".
 * Read-only; honestly "applied" when there is nothing left to repair (which is
 * also true of a database that never needed the repair).
 */
async function debitNoteAdjustmentsRepaired(client: ServiceClient): Promise<ProbeState> {
  const { data, error } = await withProbeSlot(async () => {
    return await (client as unknown as UntypedClient)
      .from("debit_notes")
      .select("id, debit_amount, total_amount, bill_pass_register_adjustments(amount)");
  });
  if (error) return isMissingSchemaPiece(error) ? "missing" : "unknown";

  type NoteRow = {
    debit_amount: number | string | null;
    total_amount: number | string | null;
    bill_pass_register_adjustments: { amount: number | string | null }[] | null;
  };
  const notes = (data ?? []) as unknown as NoteRow[];

  const stillPreGst = notes.some((note) => {
    const adjustments = note.bill_pass_register_adjustments ?? [];
    if (adjustments.length === 0) return false;
    const total = Number(note.total_amount ?? 0);
    if (!(total > 0)) return false;
    const sum = adjustments.reduce((acc, a) => acc + Number(a.amount ?? 0), 0);
    const debit = Number(note.debit_amount ?? 0);
    return Math.abs(sum - debit) < 0.01 && Math.abs(sum - total) >= 0.01;
  });

  return stillPreGst ? "missing" : "applied";
}

/**
 * 2026-11-26 — the Purchase Bill share-split invariant.
 *
 * A Purchase Bill invoice is booked as one bill_pass_register row per item,
 * each holding a PROPORTIONAL share of the invoice group total. An edit used to
 * overwrite one row with its own whole g_total, so the group's payable moved
 * and every sibling share stayed stale (fixed in code 2026-11-25; repaired by
 * db/2026-11-26-purchase-bill-share-resplit.sql).
 *
 * Read-only check of exactly what that repair restores: every invoice group
 * (vendor party + vendor invoice no. + invoice date) must have its live shares
 * proportional to the items' own weights, splitting that group's OWN posted
 * total — so at most the one remainder row may sit a paise or two away, never
 * a row carrying a whole line value. Groups with a single live share are
 * trivially proportional and are skipped, and a group with no usable weight is
 * left alone exactly as the repair leaves it.
 *
 * "applied" therefore means "no group this file would change" — true both of
 * a repaired database and of one that never drifted.
 */
async function purchaseBillShareSplitInStep(client: ServiceClient): Promise<ProbeState> {
  const billsRes = await withProbeSlot(async () =>
    (client as unknown as UntypedClient)
      .from("purchase_bills")
      .select("id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, g_total_plus_gst, total_amount")
  );
  if (billsRes.error) return isMissingSchemaPiece(billsRes.error) ? "missing" : "unknown";

  const mirrorsRes = await withProbeSlot(async () =>
    (client as unknown as UntypedClient)
      .from("bill_pass_register")
      .select("id, source_id, total_amt, merged_into_bill_id")
      .eq("source", "purchase_bill")
  );
  if (mirrorsRes.error) return isMissingSchemaPiece(mirrorsRes.error) ? "missing" : "unknown";

  type BillRow = {
    id: string;
    vendor_party_id: string | null;
    vendor_invoice_no: string | null;
    vendor_invoice_date: string | null;
    g_total_plus_gst: number | string | null;
    total_amount: number | string | null;
  };
  type MirrorRow = {
    id: string;
    source_id: string | null;
    total_amt: number | string | null;
    merged_into_bill_id: string | null;
  };

  const bills = new Map<string, BillRow>();
  for (const bill of (billsRes.data ?? []) as unknown as BillRow[]) bills.set(bill.id, bill);

  // Same group identity and same "live" rule the posting/edit path and the
  // SQL repair use: source_id set, not a merged duplicate, party + number known.
  const groups = new Map<string, { mirrorId: string; weight: number; amount: number }[]>();
  for (const mirror of (mirrorsRes.data ?? []) as unknown as MirrorRow[]) {
    if (!mirror.source_id || mirror.merged_into_bill_id) continue;
    const bill = bills.get(mirror.source_id);
    if (!bill || !bill.vendor_party_id) continue;
    const invoiceNo = (bill.vendor_invoice_no ?? "").trim().toLowerCase();
    if (!invoiceNo) continue;
    const key = `${bill.vendor_party_id}\u0000${invoiceNo}\u0000${bill.vendor_invoice_date ?? ""}`;
    const weight = Math.max(0, Number(bill.g_total_plus_gst ?? bill.total_amount ?? 0));
    const entry = { mirrorId: mirror.id, weight, amount: Number(mirror.total_amt ?? 0) };
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  for (const shares of groups.values()) {
    if (shares.length < 2) continue;
    // The repair's remainder row is the highest ledger-row id in the group.
    shares.sort((a, b) => (a.mirrorId < b.mirrorId ? -1 : a.mirrorId > b.mirrorId ? 1 : 0));
    const total = round2(shares.reduce((sum, share) => sum + share.amount, 0));
    const weightSum = shares.reduce((sum, share) => sum + share.weight, 0);
    if (!(weightSum > 0)) continue;

    let offCount = 0;
    let maxOff = 0;
    for (const share of shares) {
      const exact = round2((share.weight / weightSum) * total);
      const diff = Math.abs(round2(share.amount) - exact);
      if (diff > 0.01) {
        offCount += 1;
        maxOff = Math.max(maxOff, diff);
      }
    }
    // One row may absorb the paise remainder; anything more is the pre-fix
    // shape (a row holding its whole line value).
    if (offCount > 1) return "missing";
    if (offCount === 1 && maxOff > round2(0.01 * (shares.length - 1)) + 0.001) return "missing";
  }

  return "applied";
}

/** A file the API cannot check — see ProbeState's "manual". */
export function manualProbe(): Promise<ProbeState> {
  return Promise.resolve("manual");
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

  const rpcState = withProbeSlot(async (): Promise<ProbeState> => {
    const { error } = await (client as unknown as UntypedClient).rpc("get_order_status_counts", { p_company_id: probeCompanyId });
    if (!error) return "applied";
    return isMissingSchemaPiece(error) ? "missing" : "unknown";
  });

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

    // 2026-10-28e — per-AWB/order round-off on Courier and Duty bills. Until
    // this file is run the AWB forms still save (the actions retry without
    // the column), but the per-AWB round-off is dropped and the bill's
    // payable stays the plain AWB gross.
    probe("db/2026-10-28e-awb-round-off.sql", "Per-AWB round-off on Courier / Duty bills",
      "AWB assignment forms can't store a per-order round-off — the bill's payable stays gross only, and only the bill-level round-off box is effective.",
      [
        { name: "freight_bill_awb_assignments.round_off_amt", promise: hasColumn(client, "freight_bill_awb_assignments", "round_off_amt") },
        { name: "duty_bill_awb_assignments.round_off_amt", promise: hasColumn(client, "duty_bill_awb_assignments", "round_off_amt") },
      ]),

    // 2026-11-02 — Stair Rug set-based quantity on orders. Until this file is
    // run, order entry/editing still saves (the stair columns are retried
    // away — see src/lib/db/missing-column.ts), but the sets / pieces-per-set /
    // per-piece dimensions are dropped: the order keeps its total piece count
    // and simply can't show either the set breakdown or the area.
    probe("db/2026-11-02-stair-rug-set-quantity.sql", "Stair Rug set quantity + per-piece area",
      "A Stair Rug order saves only its total piece count — Sets, Pieces Per Set and the per-piece dimensions/area are dropped, so the order page and the packing WhatsApp caption can't show them.",
      [
        { name: "orders.sets_count", promise: hasColumn(client, "orders", "sets_count") },
        { name: "orders.pieces_per_set", promise: hasColumn(client, "orders", "pieces_per_set") },
        { name: "orders.dimension_length", promise: hasColumn(client, "orders", "dimension_length") },
      ]),

    // 2026-10-29 — round-off on Credit Note / Debit Note / Internal Invoice /
    // Journal Voucher. Until this file is run those four forms still save
    // (round_off_amt simply stays 0), so their totals just can’t be rounded.
    probe("db/2026-10-29-round-off-all-documents.sql", "Round off on Credit/Debit Note, Internal Invoice and Journal Voucher",
      "Those four document forms can’t store a round-off — their totals always stay the exact calculated figure, with no round-figure adjustment line.",
      [
        { name: "credit_notes.round_off_amt", promise: hasColumn(client, "credit_notes", "round_off_amt") },
        { name: "debit_notes.round_off_amt", promise: hasColumn(client, "debit_notes", "round_off_amt") },
        { name: "internal_invoices.round_off_amt", promise: hasColumn(client, "internal_invoices", "round_off_amt") },
        { name: "journal_vouchers.round_off_amt", promise: hasColumn(client, "journal_vouchers", "round_off_amt") },
      ]),

    // 2026-11-03b — Returns that need MD/Admin approval. Without the file: no
    // approval queue exists, so the Returns page shows a "run this migration"
    // banner and only the (immediate) refund section is offered.
    probe("db/2026-11-03b-return-approval.sql", "Return requests with mandatory MD/Admin approval",
      "Returns cannot be handed in for approval — order-entry staff would have to change the order directly, with no approval trail.",
      [{ name: "return_requests table", promise: hasColumn(client, "return_requests", "status") }]),

    // 2026-11-06 — pending return edit/cancel, measurement extensions and the
    // biometric bridge. The app checks these pieces individually, so a
    // database that only ran 2026-11-03b keeps its old (working) behaviour.
    probe("db/2026-11-06-return-lifecycle-measurement-biometric.sql", "Return lifecycle, weight/count measurement and biometric attendance",
      "Pending returns cannot be edited/cancelled by their creator, washing/expense entries cannot store weight or quantity units, and biometric punches cannot be received.",
      [
        { name: "return_requests.updated_at", promise: hasColumn(client, "return_requests", "updated_at") },
        { name: "company_measurement_settings.rounding_mode", promise: hasColumn(client, "company_measurement_settings", "rounding_mode") },
        { name: "washing_entries.area_value", promise: hasColumn(client, "washing_entries", "area_value") },
        { name: "purchase_bills.measurement_rounding", promise: hasColumn(client, "purchase_bills", "measurement_rounding") },
        { name: "internal_expenses.qty_unit", promise: hasColumn(client, "internal_expenses", "qty_unit") },
        { name: "biometric_devices table", promise: hasColumn(client, "biometric_devices", "device_key") },
        { name: "biometric_employee_map table", promise: hasColumn(client, "biometric_employee_map", "device_employee_id") },
        { name: "biometric_punch_events table", promise: hasColumn(client, "biometric_punch_events", "source_event_id") },
        { name: "attendance.attendance_verification", promise: hasColumn(client, "attendance", "attendance_verification") },
      ]),

    // 2026-11-03 — Vendor Agreements (Legal & Compliance → Agreement Generator).
    // Without the file: the generator shows a "run this migration" banner and
    // refuses to create documents, because numbering, the template registry and
    // the private PDF bucket all live in it.
    // 2026-11-22b — typed close-up photo index. Without it the reader falls
    // back to orders.photo_urls and no attachment row (file name / sort
    // order) is stored.
    // 2026-11-23 — the Purchase Orders probe was removed with that module.
    // 2026-11-24 — Etsy SEO generator: source-content hashes for cache reuse.
    // The app tolerates the columns being absent by never caching, which is
    // exactly the invisible degradation this panel exists to surface: the
    // generator still works, it just spends AI credits regenerating every
    // language and re-running keyword research on unchanged products.
    probe("db/2026-11-24-etsy-seo-generation-speed.sql", "Etsy SEO generator: source hashes for cache reuse",
      "Unchanged products are regenerated from scratch: keyword research and all ten localized listings are re-run (and re-charged as AI usage) instead of being reused, because etsy_seo_projects.source_hash and etsy_seo_listings.source_hash never match.",
      [
        { name: "etsy_seo_projects.source_hash", promise: hasColumn(client, "etsy_seo_projects", "source_hash") },
        { name: "etsy_seo_listings.source_hash", promise: hasColumn(client, "etsy_seo_listings", "source_hash") },
        // An index has no PostgREST-visible shape — listed so the file is fully
        // accounted for, and "manual" alone never makes a file look applied
        // (the two column checks above still decide that).
        { name: "idx_etsy_seo_listings_source_hash (index, not API-visible)", promise: manualProbe() },
      ]),

    // 2026-11-25 — automatic order-status WhatsApp messages. Until this file
    // is run there is no delivery lifecycle on order_whatsapp_messages and no
    // settings row: status changes still save, but no customer message is
    // queued and the admin WhatsApp page has nothing to configure.
    probe("db/2026-11-25-whatsapp-order-status.sql", "Automatic WhatsApp order-status messages + admin settings",
      "Changing an order to Hold / Cancelled / In Production queues no customer WhatsApp message — and the admin settings page has no toggles, templates or history.",
      [
        { name: "order_whatsapp_messages.new_status", promise: hasColumn(client, "order_whatsapp_messages", "new_status") },
        { name: "order_whatsapp_messages.provider_message_id", promise: hasColumn(client, "order_whatsapp_messages", "provider_message_id") },
        { name: "company_whatsapp_settings table", promise: hasColumn(client, "company_whatsapp_settings", "auto_status_enabled") },
      ]),

    // 2026-11-25 — Daily Entry edit + soft delete. Without it, edits have no
    // creation facts to keep, and delete has to stay a hard DELETE.
    probe("db/2026-11-25-ad-spend-entry-audit.sql", "Store Ad Spend: entry edit + soft delete",
      "An edited day has no original creation time/author, and Delete physically removes the row instead of hiding it restorably.",
      [
        { name: "store_ad_spend.created_at", promise: hasColumn(client, "store_ad_spend", "created_at") },
        { name: "store_ad_spend.deleted_at", promise: hasColumn(client, "store_ad_spend", "deleted_at") },
      ]),

    // 2026-11-26 — one-off repair of the Purchase Bill share drift the
    // 2026-11-25 edit fix stopped creating. Until it is run, an invoice edited
    // before that fix keeps one ledger row holding its whole line value: Bill
    // Payment / Party Ledger show a payable that is not the split finance
    // reviewed. Nothing degrades in the app itself — the code is already right
    // — so this probe is the only place the pending repair is visible.
    probe("db/2026-11-26-purchase-bill-share-resplit.sql", "Purchase Bill: re-split drifted Finance shares",
      "An invoice edited before 2026-11-25 still has one ledger row holding its whole line value instead of its proportional share — Bill Payment / Party Ledger keep showing a group payable that is not the split Finance reviewed.",
      [{ name: "invoice groups proportional to their bills", promise: purchaseBillShareSplitInStep(client) }]),

    // 2026-11-26 — the migration LEDGER itself. Without this file the admin page
    // still shows probe results (what exists), but no applied file is recorded
    // with its SHA-256 — so an already-run file that was edited later cannot be
    // told apart from an applied one. See db/2026-11-26-schema-migrations-ledger.sql.
    probe("db/2026-11-26-schema-migrations-ledger.sql", "Migration ledger (schema_migrations)",
      "Nothing records WHICH version of each file was applied — probe results show the objects exist, but a file edited after it was run is indistinguishable from an applied one.",
      [{ name: "schema_migrations.sha256", promise: hasColumn(client, "schema_migrations", "sha256") }]),

    // 2026-11-27 — audit #2: company-scoped RLS. Policies are not API-visible,
    // so this one is manual-only; src/lib/security/rls-company-scope.test.ts
    // pins what the file covers instead.
    probe("db/2026-11-27-company-scoped-rls.sql", "Company-group-scoped RLS (linked companies share, outsiders closed)",
      "Any signed-in employee can read and write every company's orders, invoices, payroll and WhatsApp log straight through the Supabase REST API — the app's company filter never applied to that path. The fix keeps the three linked companies seeing each other (companies.group_company_id) and closes access to companies outside the group.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // 2026-11-27 — audit 3.12: the ledger gets an EXPLICIT run order. Until this
    // file is run, "which order?" is re-derived from the file names, and the
    // compact 20260805… legacy names sort after every 2026-08-05-… file.
    probe("db/2026-11-27-schema-migrations-sequence.sql", "Migration ledger: explicit run order",
      "The ledger stores no order — the admin list re-derives it from file names, which puts the oldest 20260805… files last.",
      [{ name: "schema_migrations.sequence_no", promise: hasColumn(client, "schema_migrations", "sequence_no") }]),

    // 2026-11-27 — audit 3.10: marks orders.whatsapp_sent_at deprecated in the
    // database itself. A column comment is not API-visible, so this one is
    // manual-only and never auto-recorded.
    probe("db/2026-11-27-orders-whatsapp-sent-at-deprecated.sql", "Deprecate orders.whatsapp_sent_at",
      "Nothing this page can read from the API (a column comment) — the badges already read order_whatsapp_messages; this file only makes the deprecation visible in the schema.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-11-22b-order-attachments.sql", "Order attachments (typed close-up photo index)",
      "Close-up photos are read from orders.photo_urls only — no attachment row (file name / sort order) is stored.",
      [{ name: "order_attachments.file_url", promise: hasColumn(client, "order_attachments", "file_url") }]),

    probe("db/2026-11-03-vendor-agreements.sql", "Vendor agreements (numbering, versions, signatures, letterhead)",
      "The Agreement Generator cannot create or store any agreement — no NKM-AGR numbering function, no template registry, no private PDF bucket.",
      [
        { name: "agreement_documents table", promise: hasColumn(client, "agreement_documents", "ref_no") },
        { name: "agreement_document_versions table", promise: hasColumn(client, "agreement_document_versions", "pdf_sha256") },
        { name: "agreement_signature_records table", promise: hasColumn(client, "agreement_signature_records", "kind") },
        { name: "agreement_letterhead_settings table", promise: hasColumn(client, "agreement_letterhead_settings", "brand_color") },
        // NOTE: deliberately NOT an rpc("next_agreement_ref") probe — that
        // function INCREMENTS a counter row, and this panel must stay
        // strictly read-only. The counters table existing is proof enough that
        // the file ran.
        { name: "agreement_number_counters table", promise: hasColumn(client, "agreement_number_counters", "last_value") },
      ]),

    // ---------------------------------------------------------------------
    // 2026-11-23 — the rest of db/: one probe per dated file OLDER than
    // 2026-11-14, so this panel lists every migration instead of only the
    // recent ones. Each probe checks an object the file creates that still
    // exists in db/schema.sql, so a column renamed or a table dropped later
    // cannot leave behind a probe that can never pass.
    // A probe answers "does this object exist", not "was this exact file
    // run": on a database built from schema.sql, an object created later by
    // another file also counts as present. That is the same rule the older
    // probes here have always used.
    // Files that create nothing PostgREST can read (indexes, RLS policies,
    // storage buckets, one-off data repairs) are listed with a `manual` check:
    // visible in the list, honestly not verifiable from the API.
    // ---------------------------------------------------------------------

    // The five oldest files use a different name shape (20260805…), so they are
    // here by hand rather than by the dated pattern. Four are a data seed or an
    // RLS fix with nothing for the API to read; only the HSN add-column file has
    // an object to check.
    probe("db/20260805fixrlsblockinglogin.sql", "Fix RLS Blocking Login",
      "Nothing this page can read from the API (an RLS policy change) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/20260806itemcategoryhsncodes.sql", "Item Category HSN Codes",
      "`item_categories.hsn_code` is missing — CSB-V / CSB-IV invoices cannot print each line's HSN code.",
      [{ name: "item_categories.hsn_code", promise: hasColumn(client, "item_categories", "hsn_code") }]),

    probe("db/20260806itemcategoryhsncodesbatch2.sql", "Item Category HSN Codes Batch 2",
      "Nothing this page can read from the API (a data update to the HSN codes) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/20260806seeditemcategories.sql", "Seed Item Categories",
      "Nothing this page can read from the API (seed rows for the Item Category dropdown) — listed so every file is visible; run it once by hand if the dropdown is empty.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/20260806seedsizesandcategories.sql", "Seed Sizes and Categories",
      "Nothing this page can read from the API (seed rows for the Size and Item Category dropdowns) — listed so every file is visible; run it once by hand if those lists are empty.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-08-employee-store-access.sql", "Employee Store Access",
      "The `employee_store_access` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "employee_store_access.employee_id", promise: hasColumn(client, "employee_store_access", "employee_id") },
        { name: "employee_store_access.store_id", promise: hasColumn(client, "employee_store_access", "store_id") },
      ]),

    // Not auto-checkable: 2026-08-08-enable-rls.sql
    probe("db/2026-08-08-enable-rls.sql", "Enable RLS",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-08-inventory-finished-stock.sql", "Inventory Finished Stock",
      "The `finished_stock` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "finished_stock.item_category_id", promise: hasColumn(client, "finished_stock", "item_category_id") },
        { name: "finished_stock.sku_label", promise: hasColumn(client, "finished_stock", "sku_label") },
        { name: "finished_stock_movements.item_category_id", promise: hasColumn(client, "finished_stock_movements", "item_category_id") },
      ]),

    probe("db/2026-08-08-marketplace-connectors.sql", "Marketplace Connectors",
      "The `marketplace_credentials` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "marketplace_credentials.store_id", promise: hasColumn(client, "marketplace_credentials", "store_id") },
        { name: "marketplace_credentials.provider", promise: hasColumn(client, "marketplace_credentials", "provider") },
        { name: "marketplace_sync_log.store_id", promise: hasColumn(client, "marketplace_sync_log", "store_id") },
      ]),

    probe("db/2026-08-08-order-hold-cancel-refund.sql", "Order Hold Cancel Refund",
      "The `order_refunds` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "order_refunds.order_id", promise: hasColumn(client, "order_refunds", "order_id") },
        { name: "order_refunds.refund_amount", promise: hasColumn(client, "order_refunds", "refund_amount") },
      ]),

    probe("db/2026-08-10-invoice-value-breakdown.sql", "Invoice Value Breakdown",
      "`sales_invoices.value_percent` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "sales_invoices.value_percent", promise: hasColumn(client, "sales_invoices", "value_percent") },
        { name: "sales_invoices.taxable_value_inr", promise: hasColumn(client, "sales_invoices", "taxable_value_inr") },
        { name: "sales_invoices.declared_value_words", promise: hasColumn(client, "sales_invoices", "declared_value_words") },
      ]),

    probe("db/2026-08-10-shipglobal.sql", "Shipglobal",
      "The `shipglobal_seller_profiles` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "shipglobal_seller_profiles.company_id", promise: hasColumn(client, "shipglobal_seller_profiles", "company_id") },
        { name: "shipglobal_seller_profiles.seller_nickname", promise: hasColumn(client, "shipglobal_seller_profiles", "seller_nickname") },
        { name: "shipglobal_shipments.order_id", promise: hasColumn(client, "shipglobal_shipments", "order_id") },
      ]),

    probe("db/2026-08-11-attendance-salary-holidays-worklog.sql", "Attendance Salary Holidays Worklog",
      "The `holidays` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "holidays.company_id", promise: hasColumn(client, "holidays", "company_id") },
        { name: "holidays.holiday_date", promise: hasColumn(client, "holidays", "holiday_date") },
        { name: "employee_salary.employee_id", promise: hasColumn(client, "employee_salary", "employee_id") },
      ]),

    probe("db/2026-08-11-daily-report-manual-time-entry.sql", "Daily Report Manual Time Entry",
      "`daily_work_logs.estimated_time_minutes` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "daily_work_logs.estimated_time_minutes", promise: hasColumn(client, "daily_work_logs", "estimated_time_minutes") },
      ]),

    probe("db/2026-08-11-daily-report-submit-and-task-merge.sql", "Daily Report Submit and Task Merge",
      "`daily_work_logs.submitted_at` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "daily_work_logs.submitted_at", promise: hasColumn(client, "daily_work_logs", "submitted_at") },
      ]),

    // Not auto-checkable: 2026-08-11-harmonized-tariff-number-values.sql
    probe("db/2026-08-11-harmonized-tariff-number-values.sql", "Harmonized Tariff Number Values",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-11-invoice-broker-duty.sql", "Invoice Broker Duty",
      "`sales_invoices.broker_name` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "sales_invoices.broker_name", promise: hasColumn(client, "sales_invoices", "broker_name") },
        { name: "sales_invoices.broker_tel", promise: hasColumn(client, "sales_invoices", "broker_tel") },
      ]),

    probe("db/2026-08-11-item-category-harmonized-tariff-number.sql", "Item Category Harmonized Tariff Number",
      "`item_categories.harmonized_tariff_number` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "item_categories.harmonized_tariff_number", promise: hasColumn(client, "item_categories", "harmonized_tariff_number") },
      ]),

    probe("db/2026-08-11-order-tax-destination-and-invoice-currency.sql", "Order Tax Destination and Invoice Currency",
      "`orders.vat_number` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "orders.vat_number", promise: hasColumn(client, "orders", "vat_number") },
        { name: "orders.eori_number", promise: hasColumn(client, "orders", "eori_number") },
        { name: "sales_invoices.invoice_currency", promise: hasColumn(client, "sales_invoices", "invoice_currency") },
      ]),

    probe("db/2026-08-11-tasks-report-timer-carryover.sql", "Tasks Report Timer Carryover",
      "The `tasks` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "tasks.company_id", promise: hasColumn(client, "tasks", "company_id") },
        { name: "tasks.assigned_by_employee_id", promise: hasColumn(client, "tasks", "assigned_by_employee_id") },
        { name: "daily_work_logs.timer_started_at", promise: hasColumn(client, "daily_work_logs", "timer_started_at") },
      ]),

    probe("db/2026-08-12-advance-recovery-schedule.sql", "Advance Recovery Schedule",
      "`employee_advances.recovery_months` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "employee_advances.recovery_months", promise: hasColumn(client, "employee_advances", "recovery_months") },
        { name: "employee_advances.monthly_installment", promise: hasColumn(client, "employee_advances", "monthly_installment") },
      ]),

    probe("db/2026-08-12-finance-salary-advance.sql", "Finance Salary Advance",
      "The `employee_advances` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "employee_advances.employee_id", promise: hasColumn(client, "employee_advances", "employee_id") },
        { name: "employee_advances.company_id", promise: hasColumn(client, "employee_advances", "company_id") },
        { name: "salary_payments.employee_id", promise: hasColumn(client, "salary_payments", "employee_id") },
      ]),

    probe("db/2026-08-12-leave-requests-coverage.sql", "Leave Requests Coverage",
      "The `leave_requests` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "leave_requests.employee_id", promise: hasColumn(client, "leave_requests", "employee_id") },
        { name: "leave_requests.company_id", promise: hasColumn(client, "leave_requests", "company_id") },
        { name: "leave_coverage_assignments.leave_request_id", promise: hasColumn(client, "leave_coverage_assignments", "leave_request_id") },
      ]),

    probe("db/2026-08-12-round10-purchase-courier-duty.sql", "Round10 Purchase Courier Duty",
      "`freight_bill_awb_assignments.dimensional_weight_kg` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "freight_bill_awb_assignments.dimensional_weight_kg", promise: hasColumn(client, "freight_bill_awb_assignments", "dimensional_weight_kg") },
        { name: "freight_bill_awb_assignments.credit_note_no", promise: hasColumn(client, "freight_bill_awb_assignments", "credit_note_no") },
        { name: "freight_bill_awb_assignments.credit_note_date", promise: hasColumn(client, "freight_bill_awb_assignments", "credit_note_date") },
      ]),

    probe("db/2026-08-12-round11-unbuilt-dashboard-sections.sql", "Round11 Unbuilt Dashboard Sections",
      "The `bill_pass_register_payments` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "bill_pass_register_payments.bill_pass_register_id", promise: hasColumn(client, "bill_pass_register_payments", "bill_pass_register_id") },
        { name: "bill_pass_register_payments.amount", promise: hasColumn(client, "bill_pass_register_payments", "amount") },
        { name: "bill_pass_register.approval_status", promise: hasColumn(client, "bill_pass_register", "approval_status") },
      ]),

    probe("db/2026-08-13-etsy-order-matching-and-invoice-fix.sql", "Etsy Order Matching and Invoice Fix",
      "`etsy_monthly_tax_invoices.listing_fees_other` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "etsy_monthly_tax_invoices.listing_fees_other", promise: hasColumn(client, "etsy_monthly_tax_invoices", "listing_fees_other") },
        { name: "etsy_monthly_tax_invoices.subtotal_inr", promise: hasColumn(client, "etsy_monthly_tax_invoices", "subtotal_inr") },
        { name: "etsy_monthly_tax_invoices.gst_amount_inr", promise: hasColumn(client, "etsy_monthly_tax_invoices", "gst_amount_inr") },
      ]),

    probe("db/2026-08-13b-etsy-renew-fees-columns.sql", "Etsy Renew Fees Columns",
      "`etsy_monthly_tax_invoices.renew_fees_qty` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "etsy_monthly_tax_invoices.renew_fees_qty", promise: hasColumn(client, "etsy_monthly_tax_invoices", "renew_fees_qty") },
        { name: "etsy_monthly_tax_invoices.renew_fees", promise: hasColumn(client, "etsy_monthly_tax_invoices", "renew_fees") },
        { name: "etsy_monthly_tax_invoices.renew_expired_fees_other", promise: hasColumn(client, "etsy_monthly_tax_invoices", "renew_expired_fees_other") },
      ]),

    probe("db/2026-08-13c-ebay-tax-invoice-fix-and-financial-statement.sql", "EBay Tax Invoice Fix and Financial Statement",
      "The `ebay_monthly_financial_statement` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "ebay_monthly_financial_statement.company_id", promise: hasColumn(client, "ebay_monthly_financial_statement", "company_id") },
        { name: "ebay_monthly_financial_statement.statement_number", promise: hasColumn(client, "ebay_monthly_financial_statement", "statement_number") },
      ]),

    probe("db/2026-08-13d-amazon-transactions.sql", "Amazon Transactions",
      "The `amazon_transactions` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "amazon_transactions.company_id", promise: hasColumn(client, "amazon_transactions", "company_id") },
        { name: "amazon_transactions.txn_date", promise: hasColumn(client, "amazon_transactions", "txn_date") },
      ]),

    // Not auto-checkable: 2026-08-13h-fix-duplicate-amazon-usd-rows.sql
    probe("db/2026-08-13h-fix-duplicate-amazon-usd-rows.sql", "Fix Duplicate Amazon USD Rows",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-13k-fix-missing-rls-policies.sql
    probe("db/2026-08-13k-fix-missing-rls-policies.sql", "Fix Missing RLS Policies",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-14-csb-filings.sql", "CSB Filings",
      "The `csb_filings` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "csb_filings.csb_number", promise: hasColumn(client, "csb_filings", "csb_number") },
        { name: "csb_filings.exchange_rate", promise: hasColumn(client, "csb_filings", "exchange_rate") },
      ]),

    // Not auto-checkable: 2026-08-17-chalan-tables-rls-policy-fix.sql
    probe("db/2026-08-17-chalan-tables-rls-policy-fix.sql", "Chalan Tables RLS Policy Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-17-freight-duty-bills-vendor-party.sql", "Freight Duty Bills Vendor Party",
      "`freight_bills.vendor_party_id` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "freight_bills.vendor_party_id", promise: hasColumn(client, "freight_bills", "vendor_party_id") },
        { name: "duty_tax_bills.vendor_party_id", promise: hasColumn(client, "duty_tax_bills", "vendor_party_id") },
      ]),

    probe("db/2026-08-17-material-out-and-shipment-handover-chalans.sql", "Material Out and Shipment Handover Chalans",
      "The `material_out_chalans` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "material_out_chalans.company_id", promise: hasColumn(client, "material_out_chalans", "company_id") },
        { name: "material_out_chalans.party_id", promise: hasColumn(client, "material_out_chalans", "party_id") },
        { name: "shipment_handover_chalans.company_id", promise: hasColumn(client, "shipment_handover_chalans", "company_id") },
      ]),

    probe("db/2026-08-17-purchase-bills-gst.sql", "Purchase Bills GST",
      "`purchase_bills.gst_rate_pct` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.gst_rate_pct", promise: hasColumn(client, "purchase_bills", "gst_rate_pct") },
        { name: "purchase_bills.gst_type", promise: hasColumn(client, "purchase_bills", "gst_type") },
        { name: "purchase_bills.g_total_plus_gst", promise: hasColumn(client, "purchase_bills", "g_total_plus_gst") },
      ]),

    probe("db/2026-08-17-purchase-bills-optional-order-company-id.sql", "Purchase Bills Optional Order Company Id",
      "`purchase_bills.company_id` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.company_id", promise: hasColumn(client, "purchase_bills", "company_id") },
      ]),

    probe("db/2026-08-17-purchase-bills-qty-unit.sql", "Purchase Bills Qty Unit",
      "`purchase_bills.qty_unit` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.qty_unit", promise: hasColumn(client, "purchase_bills", "qty_unit") },
      ]),

    probe("db/2026-08-17-purchase-bills-round-off.sql", "Purchase Bills Round Off",
      "`purchase_bills.round_off_amt` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.round_off_amt", promise: hasColumn(client, "purchase_bills", "round_off_amt") },
        { name: "purchase_bills.g_total_plus_gst", promise: hasColumn(client, "purchase_bills", "g_total_plus_gst") },
      ]),

    // Not auto-checkable: 2026-08-17-rls-policy-audit-fix.sql
    probe("db/2026-08-17-rls-policy-audit-fix.sql", "RLS Policy Audit Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-17-stock-out-order-links.sql", "Stock Out Order Links",
      "The `stock_out_order_links` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "stock_out_order_links.stock_out_id", promise: hasColumn(client, "stock_out_order_links", "stock_out_id") },
        { name: "stock_out_order_links.order_id", promise: hasColumn(client, "stock_out_order_links", "order_id") },
      ]),

    // Not auto-checkable: 2026-08-18-bill-pass-due-date-index.sql
    probe("db/2026-08-18-bill-pass-due-date-index.sql", "Bill Pass Due Date Index",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18-bill-pass-register-purchase-sync-fix.sql
    probe("db/2026-08-18-bill-pass-register-purchase-sync-fix.sql", "Bill Pass Register Purchase Sync Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18-courier-parties.sql
    probe("db/2026-08-18-courier-parties.sql", "Courier Parties",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18-onpoint-express-ledger-reconciliation.sql
    probe("db/2026-08-18-onpoint-express-ledger-reconciliation.sql", "Onpoint Express Ledger Reconciliation",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18-order-photos-bucket.sql
    probe("db/2026-08-18-order-photos-bucket.sql", "Order Photos Bucket",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18c-aramex-RJ2425004810-double-payment-adjustment.sql
    probe("db/2026-08-18c-aramex-RJ2425004810-double-payment-adjustment.sql", "Aramex Rj2425004810 Double Payment Adjustment",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-18d-aramex-RJ2625901709-missing-duty-bill.sql
    probe("db/2026-08-18d-aramex-RJ2625901709-missing-duty-bill.sql", "Aramex Rj2625901709 Missing Duty Bill",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-19-aramex-RJ2425005435-credit-note-fix.sql
    probe("db/2026-08-19-aramex-RJ2425005435-credit-note-fix.sql", "Aramex Rj2425005435 Credit Note Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-19-shivam-enterprises-duplicate-payment-fix-v2.sql
    probe("db/2026-08-19-shivam-enterprises-duplicate-payment-fix-v2.sql", "Shivam Enterprises Duplicate Payment Fix V2",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-19-shivam-enterprises-duplicate-payment-fix.sql
    probe("db/2026-08-19-shivam-enterprises-duplicate-payment-fix.sql", "Shivam Enterprises Duplicate Payment Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-20-freight-rate-card-and-estimator.sql", "Freight Rate Card and Estimator",
      "The `courier_rate_cards` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "courier_rate_cards.company_id", promise: hasColumn(client, "courier_rate_cards", "company_id") },
        { name: "courier_rate_cards.courier_name", promise: hasColumn(client, "courier_rate_cards", "courier_name") },
        { name: "freight_cost_estimates.company_id", promise: hasColumn(client, "freight_cost_estimates", "company_id") },
      ]),

    probe("db/2026-08-20-internal-expenses.sql", "Internal Expenses",
      "The `internal_expenses` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "internal_expenses.company_id", promise: hasColumn(client, "internal_expenses", "company_id") },
        { name: "internal_expenses.expense_date", promise: hasColumn(client, "internal_expenses", "expense_date") },
      ]),

    probe("db/2026-08-20-order-shipments-and-packages.sql", "Order Shipments and Packages",
      "The `order_shipments` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "order_shipments.order_id", promise: hasColumn(client, "order_shipments", "order_id") },
        { name: "order_shipments.shipment_no", promise: hasColumn(client, "order_shipments", "shipment_no") },
        { name: "order_packages.order_shipment_id", promise: hasColumn(client, "order_packages", "order_shipment_id") },
      ]),

    probe("db/2026-08-20-order-value-fix.sql", "Order Value Fix",
      "The `freight_reconciliation_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "freight_reconciliation_view view", promise: hasColumn(client, "freight_reconciliation_view", "*") },
      ]),

    probe("db/2026-08-20-pl-dashboard-live.sql", "P&L Dashboard Live",
      "The `order_courier_duty_expense_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "order_courier_duty_expense_view view", promise: hasColumn(client, "order_courier_duty_expense_view", "*") },
      ]),

    // Not auto-checkable: 2026-08-20-reconciliation-decisions.sql
    probe("db/2026-08-20-reconciliation-decisions.sql", "Reconciliation Decisions",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-20-vendor-ledger-round3-agcomputer-fix.sql
    probe("db/2026-08-20-vendor-ledger-round3-agcomputer-fix.sql", "Vendor Ledger Round3 Agcomputer Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-22-backup-export-admin.sql
    probe("db/2026-08-22-backup-export-admin.sql", "Backup Export Admin",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-22-employee-photos-bucket.sql
    probe("db/2026-08-22-employee-photos-bucket.sql", "Employee Photos Bucket",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-22-employee-theme-prefs.sql", "Employee Theme Prefs",
      "`employees.theme_id` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "employees.theme_id", promise: hasColumn(client, "employees", "theme_id") },
        { name: "employees.custom_accent_color", promise: hasColumn(client, "employees", "custom_accent_color") },
      ]),

    probe("db/2026-08-22-orders-buyer-country.sql", "Orders Buyer Country",
      "`orders.buyer_country` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "orders.buyer_country", promise: hasColumn(client, "orders", "buyer_country") },
      ]),

    probe("db/2026-08-24-audit-log.sql", "Audit Log",
      "The `audit_log` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "audit_log.company_id", promise: hasColumn(client, "audit_log", "company_id") },
        { name: "audit_log.employee_id", promise: hasColumn(client, "audit_log", "employee_id") },
      ]),

    probe("db/2026-08-24-automation-rules.sql", "Automation Rules",
      "The `automation_rules` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "automation_rules.company_id", promise: hasColumn(client, "automation_rules", "company_id") },
        { name: "automation_rules.name", promise: hasColumn(client, "automation_rules", "name") },
        { name: "automation_rule_logs.rule_id", promise: hasColumn(client, "automation_rule_logs", "rule_id") },
      ]),

    probe("db/2026-08-25-return-status-and-refund-breakdown.sql", "Return Status and Refund Breakdown",
      "`order_refunds.refund_basis_percent` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "order_refunds.refund_basis_percent", promise: hasColumn(client, "order_refunds", "refund_basis_percent") },
        { name: "order_refunds.order_value_refund_amount", promise: hasColumn(client, "order_refunds", "order_value_refund_amount") },
      ]),

    // Not auto-checkable: 2026-08-27-credit-note-party-link.sql
    probe("db/2026-08-27-credit-note-party-link.sql", "Credit Note Party Link",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-27-hr-letters-record-and-dispatch-no.sql", "HR Letters Record and Dispatch No",
      "`hr_letters.template_slug` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "hr_letters.template_slug", promise: hasColumn(client, "hr_letters", "template_slug") },
        { name: "hr_letters.employee_address", promise: hasColumn(client, "hr_letters", "employee_address") },
      ]),

    probe("db/2026-08-27-note-linking-and-adjustments.sql", "Note Linking and Adjustments",
      "The `bill_pass_register_adjustments` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "bill_pass_register_adjustments.bill_pass_register_id", promise: hasColumn(client, "bill_pass_register_adjustments", "bill_pass_register_id") },
        { name: "bill_pass_register_adjustments.debit_note_id", promise: hasColumn(client, "bill_pass_register_adjustments", "debit_note_id") },
        { name: "bill_pass_register.adj_amt", promise: hasColumn(client, "bill_pass_register", "adj_amt") },
      ]),

    // Not auto-checkable: 2026-08-27-purchase-bills-pcs-unit.sql
    probe("db/2026-08-27-purchase-bills-pcs-unit.sql", "Purchase Bills Pcs Unit",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-08-29-credit-note-rate-difference.sql
    probe("db/2026-08-29-credit-note-rate-difference.sql", "Credit Note Rate Difference",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-08-29-debit-note-rate-difference.sql", "Debit Note Rate Difference",
      "`debit_notes.po_rate` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "debit_notes.po_rate", promise: hasColumn(client, "debit_notes", "po_rate") },
        { name: "debit_notes.billed_rate", promise: hasColumn(client, "debit_notes", "billed_rate") },
      ]),

    probe("db/2026-08-29-journal-voucher.sql", "Journal Voucher",
      "The `journal_vouchers` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "journal_vouchers.company_id", promise: hasColumn(client, "journal_vouchers", "company_id") },
        { name: "journal_vouchers.jv_no", promise: hasColumn(client, "journal_vouchers", "jv_no") },
      ]),

    probe("db/2026-08-29-received-chalan-and-moc-fields.sql", "Received Chalan and MOC Fields",
      "The `received_chalans` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "received_chalans.company_id", promise: hasColumn(client, "received_chalans", "company_id") },
        { name: "received_chalans.party_id", promise: hasColumn(client, "received_chalans", "party_id") },
        { name: "received_chalan_items.chalan_id", promise: hasColumn(client, "received_chalan_items", "chalan_id") },
      ]),

    probe("db/2026-09-01-daily-work-carry-forward.sql", "Daily Work Carry Forward",
      "`daily_work_logs.priority` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "daily_work_logs.priority", promise: hasColumn(client, "daily_work_logs", "priority") },
        { name: "daily_work_logs.carried_to_date", promise: hasColumn(client, "daily_work_logs", "carried_to_date") },
      ]),

    // Not auto-checkable: 2026-09-01-dhl-courier-booking.sql
    probe("db/2026-09-01-dhl-courier-booking.sql", "DHL Courier Booking",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-01-multi-courier-booking-and-freight-recon.sql", "Multi Courier Booking and Freight Recon",
      "The `courier_shipper_profiles` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "courier_shipper_profiles.company_id", promise: hasColumn(client, "courier_shipper_profiles", "company_id") },
        { name: "courier_shipper_profiles.contact_name", promise: hasColumn(client, "courier_shipper_profiles", "contact_name") },
        { name: "courier_shipments.courier", promise: hasColumn(client, "courier_shipments", "courier") },
      ]),

    probe("db/2026-09-02-group-messaging.sql", "Group Messaging",
      "The `conversations` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "conversations.name", promise: hasColumn(client, "conversations", "name") },
        { name: "conversations.created_by_employee_id", promise: hasColumn(client, "conversations", "created_by_employee_id") },
        { name: "conversation_members.conversation_id", promise: hasColumn(client, "conversation_members", "conversation_id") },
      ]),

    // Not auto-checkable: 2026-09-02-performance-dashboard.sql
    probe("db/2026-09-02-performance-dashboard.sql", "Performance Dashboard",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-04-egs-integration-pickup-and-cancel.sql", "EGS Integration Pickup and Cancel",
      "The `courier_pickup_requests` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "courier_pickup_requests.company_id", promise: hasColumn(client, "courier_pickup_requests", "company_id") },
        { name: "courier_pickup_requests.courier", promise: hasColumn(client, "courier_pickup_requests", "courier") },
        { name: "courier_pickup_request_awbs.pickup_request_id", promise: hasColumn(client, "courier_pickup_request_awbs", "pickup_request_id") },
      ]),

    probe("db/2026-09-04-manual-external-booking.sql", "Manual External Booking",
      "`courier_shipments.manual_courier_name` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "courier_shipments.manual_courier_name", promise: hasColumn(client, "courier_shipments", "manual_courier_name") },
      ]),

    probe("db/2026-09-04-work-plan-templates.sql", "Work Plan Templates",
      "The `work_plan_templates` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "work_plan_templates.company_id", promise: hasColumn(client, "work_plan_templates", "company_id") },
        { name: "work_plan_templates.scope", promise: hasColumn(client, "work_plan_templates", "scope") },
      ]),

    probe("db/2026-09-05-ai-companion-live.sql", "Ai Companion Live",
      "The `companion_events` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "companion_events.employee_id", promise: hasColumn(client, "companion_events", "employee_id") },
        { name: "companion_events.event_type", promise: hasColumn(client, "companion_events", "event_type") },
      ]),

    probe("db/2026-09-05-ai-companion-refinements.sql", "Ai Companion Refinements",
      "The `companion_character_image` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "companion_character_image.image_url", promise: hasColumn(client, "companion_character_image", "image_url") },
        { name: "companion_character_image.prompt", promise: hasColumn(client, "companion_character_image", "prompt") },
      ]),

    probe("db/2026-09-08-error-log.sql", "Error Log",
      "The `entry_errors` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "entry_errors.company_id", promise: hasColumn(client, "entry_errors", "company_id") },
        { name: "entry_errors.source", promise: hasColumn(client, "entry_errors", "source") },
      ]),

    // Not auto-checkable: 2026-09-08-nova-theme.sql
    probe("db/2026-09-08-nova-theme.sql", "Nova Theme",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-08-order-address-fields-and-vendor-assignments.sql", "Order Address Fields and Vendor Assignments",
      "The `order_vendor_assignments` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "order_vendor_assignments.order_id", promise: hasColumn(client, "order_vendor_assignments", "order_id") },
        { name: "order_vendor_assignments.cycle_no", promise: hasColumn(client, "order_vendor_assignments", "cycle_no") },
        { name: "orders.buyer_address1", promise: hasColumn(client, "orders", "buyer_address1") },
      ]),

    // Not auto-checkable: 2026-09-09-clay-theme.sql
    probe("db/2026-09-09-clay-theme.sql", "Clay Theme",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-09-task-daily-time-log.sql", "Task Daily Time Log",
      "The `task_daily_time_log` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "task_daily_time_log.task_id", promise: hasColumn(client, "task_daily_time_log", "task_id") },
        { name: "task_daily_time_log.log_date", promise: hasColumn(client, "task_daily_time_log", "log_date") },
      ]),

    // Not auto-checkable: 2026-09-10-courier-perf-indexes.sql
    probe("db/2026-09-10-courier-perf-indexes.sql", "Courier Perf Indexes",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-11-core-hr-onboarding-orgchart-documents.sql", "Core HR Onboarding Orgchart Documents",
      "The `onboarding_checklist_items` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "onboarding_checklist_items.company_id", promise: hasColumn(client, "onboarding_checklist_items", "company_id") },
        { name: "onboarding_checklist_items.title", promise: hasColumn(client, "onboarding_checklist_items", "title") },
        { name: "employee_onboarding_progress.employee_id", promise: hasColumn(client, "employee_onboarding_progress", "employee_id") },
      ]),

    probe("db/2026-09-11-fnf-settlement.sql", "Fnf Settlement",
      "The `employee_settlements` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "employee_settlements.employee_id", promise: hasColumn(client, "employee_settlements", "employee_id") },
        { name: "employee_settlements.company_id", promise: hasColumn(client, "employee_settlements", "company_id") },
        { name: "employee_settlement_line_items.settlement_id", promise: hasColumn(client, "employee_settlement_line_items", "settlement_id") },
      ]),

    probe("db/2026-09-11-leave-types-and-balances.sql", "Leave Types and Balances",
      "The `leave_types` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "leave_types.company_id", promise: hasColumn(client, "leave_types", "company_id") },
        { name: "leave_types.name", promise: hasColumn(client, "leave_types", "name") },
        { name: "leave_balance_adjustments.employee_id", promise: hasColumn(client, "leave_balance_adjustments", "employee_id") },
      ]),

    probe("db/2026-09-11-payroll-ctc-structure-and-statutory-fields.sql", "Payroll CTC Structure and Statutory Fields",
      "`employees.pan_number` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "employees.pan_number", promise: hasColumn(client, "employees", "pan_number") },
        { name: "employees.uan_number", promise: hasColumn(client, "employees", "uan_number") },
        { name: "employee_salary.ctc_annual", promise: hasColumn(client, "employee_salary", "ctc_annual") },
      ]),

    probe("db/2026-09-13-credit-note-awb-and-duplicate-guard.sql", "Credit Note AWB and Duplicate Guard",
      "`credit_notes.awb_no` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "credit_notes.awb_no", promise: hasColumn(client, "credit_notes", "awb_no") },
      ]),

    probe("db/2026-09-13-credit-note-kinds-and-gst-slabs.sql", "Credit Note Kinds and GST Slabs",
      "`credit_notes.cn_kind` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "credit_notes.cn_kind", promise: hasColumn(client, "credit_notes", "cn_kind") },
      ]),

    probe("db/2026-09-13-credit-note-vendor-no-and-gst.sql", "Credit Note Vendor No and GST",
      "`credit_notes.vendor_cn_no` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "credit_notes.vendor_cn_no", promise: hasColumn(client, "credit_notes", "vendor_cn_no") },
        { name: "credit_notes.gst_rate_pct", promise: hasColumn(client, "credit_notes", "gst_rate_pct") },
      ]),

    // Not auto-checkable: 2026-09-14-bill-merge.sql
    probe("db/2026-09-14-bill-merge.sql", "Bill Merge",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-14-courier-cn-audit-view.sql", "Courier CN Audit View",
      "The `courier_cn_audit_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "courier_cn_audit_view view", promise: hasColumn(client, "courier_cn_audit_view", "*") },
      ]),

    probe("db/2026-09-15-courier-wallet.sql", "Courier Wallet",
      "The `party_wallet_txns` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "party_wallet_txns.company_id", promise: hasColumn(client, "party_wallet_txns", "company_id") },
        { name: "party_wallet_txns.party_id", promise: hasColumn(client, "party_wallet_txns", "party_id") },
      ]),

    probe("db/2026-09-15-recurring-card-debits.sql", "Recurring Card Debits",
      "The `recurring_card_debits` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "recurring_card_debits.company_id", promise: hasColumn(client, "recurring_card_debits", "company_id") },
        { name: "recurring_card_debits.vendor_name", promise: hasColumn(client, "recurring_card_debits", "vendor_name") },
      ]),

    probe("db/2026-09-17-bank-recon.sql", "Bank Recon",
      "The `bank_recon_accounts` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "bank_recon_accounts.company_id", promise: hasColumn(client, "bank_recon_accounts", "company_id") },
        { name: "bank_recon_accounts.account_type", promise: hasColumn(client, "bank_recon_accounts", "account_type") },
        { name: "bank_recon_links.statement_line_id", promise: hasColumn(client, "bank_recon_links", "statement_line_id") },
      ]),

    // Not auto-checkable: 2026-09-17-fy-date-validation.sql
    probe("db/2026-09-17-fy-date-validation.sql", "FY Date Validation",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-17-pl-cn-allocation-and-portal-real.sql", "P&L CN Allocation and Portal Real",
      "The `freight_awb_net_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "freight_awb_net_view view", promise: hasColumn(client, "freight_awb_net_view", "*") },
      ]),

    // Not auto-checkable: 2026-09-17-pl-expense-breakdown.sql
    probe("db/2026-09-17-pl-expense-breakdown.sql", "P&L Expense Breakdown",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-09-17-rls-policy-followup.sql
    probe("db/2026-09-17-rls-policy-followup.sql", "RLS Policy Followup",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-17b-pl-usd-and-company-month.sql", "P&L USD and Company Month",
      "The `pl_dashboard_by_company_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "pl_dashboard_by_company_view view", promise: hasColumn(client, "pl_dashboard_by_company_view", "*") },
      ]),

    probe("db/2026-09-18-orders-multi-photo-and-capability-sync.sql", "Orders Multi Photo and Capability Sync",
      "`orders.photo_urls` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "orders.photo_urls", promise: hasColumn(client, "orders", "photo_urls") },
      ]),

    probe("db/2026-09-18-pl-by-marketplace-store.sql", "P&L by Marketplace Store",
      "The `pl_dashboard_by_store_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "pl_dashboard_by_store_view view", promise: hasColumn(client, "pl_dashboard_by_store_view", "*") },
      ]),

    probe("db/2026-09-18-pl-month-per-company.sql", "P&L Month Per Company",
      "The `pl_dashboard_by_month_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "pl_dashboard_by_month_view view", promise: hasColumn(client, "pl_dashboard_by_month_view", "*") },
      ]),

    // Not auto-checkable: 2026-09-18b-finance-dashboard-rpc.sql
    probe("db/2026-09-18b-finance-dashboard-rpc.sql", "Finance Dashboard RPC",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-18c-pl-purchase-washing-order-linked.sql", "P&L Purchase Washing Order Linked",
      "The `pl_dashboard_by_store_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "pl_dashboard_by_store_view view", promise: hasColumn(client, "pl_dashboard_by_store_view", "*") },
      ]),

    // Not auto-checkable: 2026-09-19-entry-errors-system-source.sql
    probe("db/2026-09-19-entry-errors-system-source.sql", "Entry Errors System Source",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-09-19-function-search-path-hardening.sql
    probe("db/2026-09-19-function-search-path-hardening.sql", "Function Search Path Hardening",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-09-19-messaging-companion-rls-scope-fix.sql
    probe("db/2026-09-19-messaging-companion-rls-scope-fix.sql", "Messaging Companion RLS Scope Fix",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-19-pl-store-finance-purchase-cn-netting.sql", "P&L Store Finance Purchase CN Netting",
      "The `pl_dashboard_by_store_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "pl_dashboard_by_store_view view", promise: hasColumn(client, "pl_dashboard_by_store_view", "*") },
      ]),

    // Not auto-checkable: 2026-09-19-sales-invoices-master-invoice-no-unique.sql
    probe("db/2026-09-19-sales-invoices-master-invoice-no-unique.sql", "Sales Invoices Master Invoice No Unique",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-09-19-security-definer-views-revoke-authenticated.sql
    probe("db/2026-09-19-security-definer-views-revoke-authenticated.sql", "Security Definer Views Revoke Authenticated",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-21-freight-awb-billed-charge-breakup.sql", "Freight AWB Billed Charge Breakup",
      "`freight_bill_awb_assignments.billed_base_amt` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "freight_bill_awb_assignments.billed_base_amt", promise: hasColumn(client, "freight_bill_awb_assignments", "billed_base_amt") },
        { name: "freight_bill_awb_assignments.billed_fuel_amt", promise: hasColumn(client, "freight_bill_awb_assignments", "billed_fuel_amt") },
      ]),

    // Not auto-checkable: 2026-09-29-team-directory.sql
    probe("db/2026-09-29-team-directory.sql", "Team Directory",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-09-30-b2b-inquiries.sql", "B2B Inquiries",
      "The `b2b_inquiries` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "b2b_inquiries.company_id", promise: hasColumn(client, "b2b_inquiries", "company_id") },
        { name: "b2b_inquiries.inquiry_no", promise: hasColumn(client, "b2b_inquiries", "inquiry_no") },
        { name: "b2b_inquiry_items.inquiry_id", promise: hasColumn(client, "b2b_inquiry_items", "inquiry_id") },
      ]),

    probe("db/2026-09-30b-b2b-documents.sql", "B2B Documents",
      "The `b2b_quotation_items` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "b2b_quotation_items.quotation_id", promise: hasColumn(client, "b2b_quotation_items", "quotation_id") },
        { name: "b2b_quotation_items.description", promise: hasColumn(client, "b2b_quotation_items", "description") },
        { name: "b2b_documents.quotation_id", promise: hasColumn(client, "b2b_documents", "quotation_id") },
      ]),

    // Not auto-checkable: 2026-10-02-employee-department.sql
    probe("db/2026-10-02-employee-department.sql", "Employee Department",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-10-02c-attendance-gps-approval.sql
    probe("db/2026-10-02c-attendance-gps-approval.sql", "Attendance GPS Approval",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-10-02d-b2b-export-erp.sql", "B2B Export ERP",
      "The `b2b_buyers` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "b2b_buyers.company_id", promise: hasColumn(client, "b2b_buyers", "company_id") },
        { name: "b2b_buyers.name", promise: hasColumn(client, "b2b_buyers", "name") },
        { name: "b2b_products.company_id", promise: hasColumn(client, "b2b_products", "company_id") },
      ]),

    probe("db/2026-10-13-b2b-pi-export-details.sql", "B2B Pi Export Details",
      "`b2b_quotations.buyer_address` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "b2b_quotations.buyer_address", promise: hasColumn(client, "b2b_quotations", "buyer_address") },
        { name: "b2b_quotations.product_specs", promise: hasColumn(client, "b2b_quotations", "product_specs") },
        { name: "b2b_quotations.payment_terms", promise: hasColumn(client, "b2b_quotations", "payment_terms") },
      ]),

    probe("db/2026-10-13-b2b-pi-export-fields.sql", "B2B Pi Export Fields",
      "The `b2b_export_profiles` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "b2b_export_profiles.company_id", promise: hasColumn(client, "b2b_export_profiles", "company_id") },
        { name: "b2b_export_profiles.seller_address", promise: hasColumn(client, "b2b_export_profiles", "seller_address") },
        { name: "b2b_quotations.buyer_address", promise: hasColumn(client, "b2b_quotations", "buyer_address") },
      ]),

    probe("db/2026-10-21-purchase-bill-entered-by.sql", "Purchase Bill Entered by",
      "`purchase_bills.entered_by_employee_id` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.entered_by_employee_id", promise: hasColumn(client, "purchase_bills", "entered_by_employee_id") },
        { name: "purchase_bills.entered_by_name", promise: hasColumn(client, "purchase_bills", "entered_by_name") },
      ]),

    probe("db/2026-10-24-live-order-country-on-bill-views.sql", "Live Order Country on Bill Views",
      "The `freight_reconciliation_view` view is missing — every report that reads it falls back to older figures or shows nothing.",
      [
        { name: "freight_reconciliation_view view", promise: hasColumn(client, "freight_reconciliation_view", "*") },
      ]),

    probe("db/2026-10-24-shipment-charge-lines.sql", "Shipment Charge Lines",
      "The `shipment_charge_lines` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "shipment_charge_lines.order_id", promise: hasColumn(client, "shipment_charge_lines", "order_id") },
        { name: "shipment_charge_lines.order_shipment_id", promise: hasColumn(client, "shipment_charge_lines", "order_shipment_id") },
      ]),

    probe("db/2026-10-24b-round-figure-printing-bill-and-size-mode.sql", "Round Figure Printing Bill and Size Mode",
      "`purchase_bills.bill_kind` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "purchase_bills.bill_kind", promise: hasColumn(client, "purchase_bills", "bill_kind") },
        { name: "purchase_bills.size_mode", promise: hasColumn(client, "purchase_bills", "size_mode") },
        { name: "freight_bills.round_off_amt", promise: hasColumn(client, "freight_bills", "round_off_amt") },
      ]),

    probe("db/2026-10-26-order-shipment-forwarding-no.sql", "Order Shipment Forwarding No",
      "`order_shipments.forwarding_no` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "order_shipments.forwarding_no", promise: hasColumn(client, "order_shipments", "forwarding_no") },
        { name: "courier_shipments.forwarding_no", promise: hasColumn(client, "courier_shipments", "forwarding_no") },
      ]),

    probe("db/2026-10-28-internal-expense-bills.sql", "Internal Expense Bills",
      "`internal_expenses.party_id` is missing — the form still saves (the column is dropped) and the screen keeps showing the pre-file shape, so this file's change is not actually live.",
      [
        { name: "internal_expenses.party_id", promise: hasColumn(client, "internal_expenses", "party_id") },
        { name: "internal_expenses.invoice_no", promise: hasColumn(client, "internal_expenses", "invoice_no") },
        { name: "internal_expenses.invoice_date", promise: hasColumn(client, "internal_expenses", "invoice_date") },
      ]),

    // Not auto-checkable: 2026-10-28b-office-expense-finance.sql
    probe("db/2026-10-28b-office-expense-finance.sql", "Office Expense Finance",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-10-31e-purchase-invoice-company-attribution.sql
    probe("db/2026-10-31e-purchase-invoice-company-attribution.sql", "Purchase Invoice Company Attribution",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    // Not auto-checkable: 2026-11-02-courier-cn-ledger-line.sql
    probe("db/2026-11-02-courier-cn-ledger-line.sql", "Courier CN Ledger Line",
      "Nothing this page can read from the API (index, RLS policy, storage bucket or a one-off data repair) — listed so every file is visible; run it once by hand if you are unsure it was applied.",
      [{ name: "no API-visible object", promise: manualProbe() }]),

    probe("db/2026-11-05-refund-edit-delete-and-measurement.sql", "Refund Edit Delete and Measurement",
      "The `company_measurement_settings` table is missing — nothing this file adds can be stored or read, and the screens that use it stay on their earlier shape.",
      [
        { name: "company_measurement_settings.company_id", promise: hasColumn(client, "company_measurement_settings", "company_id") },
        { name: "company_measurement_settings.default_dimension_unit", promise: hasColumn(client, "company_measurement_settings", "default_dimension_unit") },
        { name: "purchase_bills.length_value", promise: hasColumn(client, "purchase_bills", "length_value") },
      ]),

    // ---------------------------------------------------------------------
    // 2026-11-23 — every SQL file from 2026-11-14 onward now has a probe.
    // The panel could not see these files at all, which is exactly how a fix
    // ships and the screen keeps showing the old figure: the code is tolerant
    // of the missing object, so nothing looks broken. Oldest first.
    // ---------------------------------------------------------------------

    probe("db/2026-11-14-customs-exchange-rate-module.sql", "Customs exchange-rate module (verified rates, audit, sync log, as-of lookup)",
      "Customs rates are read from the pre-2026-11-14 table: no verification, no audit trail, no sync log and no as-of (historical-date) rate lookup — and the old table was renamed to customs_rate_snapshot by this file.",
      [
        { name: "customs_exchange_rates.currency_unit", promise: hasColumn(client, "customs_exchange_rates", "currency_unit") },
        { name: "customs_exchange_rate_audit.action", promise: hasColumn(client, "customs_exchange_rate_audit", "action") },
        { name: "customs_rate_sync_log.status", promise: hasColumn(client, "customs_rate_sync_log", "status") },
      ]),

    // Data repair only — no table or column is created by this file.
    probe("db/2026-11-14b-debit-note-gst-adjustment.sql", "Debit Note GST repair (adjustment rows already written with the pre-GST amount)",
      "Debit notes created before the fix still reduce vendor bills by their PRE-GST amount (e.g. 4,140 instead of 4,347), leaving the GST portion showing as payable.",
      [{ name: "no pre-GST adjustment rows remain", promise: debitNoteAdjustmentsRepaired(client) }]),

    probe("db/2026-11-14c-inventory-management-module.sql", "Inventory management module (ledger, balances, reservations, challans, adjustments)",
      "The Inventory module has no ledger, balances, reservations or challans — stock cannot be counted, reserved, moved or issued.",
      [
        { name: "inventory_balances.stage", promise: hasColumn(client, "inventory_balances", "stage") },
        { name: "inventory_challans.chalan_no", promise: hasColumn(client, "inventory_challans", "chalan_no") },
        { name: "inventory_idempotency.idempotency_key", promise: hasColumn(client, "inventory_idempotency", "idempotency_key") },
      ]),

    probe("db/2026-11-16-phase4-order-stock.sql", "Order stock reservation (purchase requirements + reserve/release RPCs)",
      "Placing an order never creates a purchase requirement nor reserves stock, so overselling stays invisible until dispatch.",
      [
        { name: "inventory_purchase_requirements.purchased_pcs", promise: hasColumn(client, "inventory_purchase_requirements", "purchased_pcs") },
      ]),

    probe("db/2026-11-16c-office-asset-expenses.sql", "Office Asset expenses excluded from the P&L views",
      "The P&L still counts Office Asset spend (building work, office equipment) as an operating cost, so that money wrongly reduces net profit and appears in monthly rows.",
      [
        { name: "pl_dashboard_by_company_view.net_earn_after_overhead", promise: hasColumn(client, "pl_dashboard_by_company_view", "net_earn_after_overhead") },
        { name: "pl_dashboard_by_month_view.net_earn_after_overhead", promise: hasColumn(client, "pl_dashboard_by_month_view", "net_earn_after_overhead") },
      ]),

    probe("db/2026-11-17-etsy-translations.sql", "Etsy product translations",
      "Etsy translations cannot be stored — there is no product/translation table, so translated titles and descriptions have nowhere to live.",
      [
        { name: "etsy_products.original_title", promise: hasColumn(client, "etsy_products", "original_title") },
        { name: "etsy_product_translations.language_code", promise: hasColumn(client, "etsy_product_translations", "language_code") },
      ]),

    probe("db/2026-11-18-etsy-seo-generator.sql", "Etsy SEO generator (projects, listings, versions, keywords, usage)",
      "The Etsy SEO Generator has no schema: generated titles/descriptions, keyword research, listing versions and AI usage cannot be saved.",
      [
        { name: "etsy_seo_projects.sku", promise: hasColumn(client, "etsy_seo_projects", "sku") },
        { name: "etsy_seo_listings.validation_status", promise: hasColumn(client, "etsy_seo_listings", "validation_status") },
        { name: "etsy_seo_categories.name", promise: hasColumn(client, "etsy_seo_categories", "name") },
      ]),

    probe("db/2026-11-18b-purchase-accounts-phase1.sql", "Purchase accounts phase 1 (chart of accounts, financial years, vouchers, journal)",
      "There is no chart of accounts, financial year, expense voucher or journal entry table — expense vouchers cannot be posted to accounts.",
      [
        { name: "fin_accounts.code", promise: hasColumn(client, "fin_accounts", "code") },
        { name: "expense_vouchers.voucher_no", promise: hasColumn(client, "expense_vouchers", "voucher_no") },
        { name: "fin_settings.gstin", promise: hasColumn(client, "fin_settings", "gstin") },
      ]),

    probe("db/2026-11-18d-expense-line-units.sql", "Expense voucher lines: base quantity and unit",
      "Expense voucher lines store only the entered quantity, not the base quantity/unit, so lines entered in mixed units total wrongly.",
      [
        { name: "expense_voucher_items.base_qty", promise: hasColumn(client, "expense_voucher_items", "base_qty") },
        { name: "expense_voucher_items.base_unit", promise: hasColumn(client, "expense_voucher_items", "base_unit") },
      ]),

    probe("db/2026-11-20-whatsapp-reference-photos.sql", "WhatsApp reference-photo message log",
      "Automated WhatsApp photo sends are not recorded, so a resend cannot be recognised as a duplicate and delivery status is unknown.",
      [{ name: "order_whatsapp_messages.event_id", promise: hasColumn(client, "order_whatsapp_messages", "event_id") }]),

    probe("db/2026-11-20b-inventory-master-sku-foundation.sql", "Inventory master SKUs (master product/variant, store SKU map, stock entries, photos, reviews)",
      "The Inventory Master is unavailable: no master SKU or variant, no store-SKU mapping, no stock entries, entry photos, corrections or order matches.",
      [
        { name: "inventory_master_products.master_code", promise: hasColumn(client, "inventory_master_products", "master_code") },
        { name: "inventory_store_sku_map.store_sku", promise: hasColumn(client, "inventory_store_sku_map", "store_sku") },
        { name: "inventory_stock_entries.master_variant_id", promise: hasColumn(client, "inventory_stock_entries", "master_variant_id") },
        { name: "inventory_reviews.match_id", promise: hasColumn(client, "inventory_reviews", "match_id") },
      ]),

    probe("db/2026-11-20c-inventory-master-merge.sql", "Inventory master-variant merge + merge log",
      "Duplicate master variants cannot be merged — the merge log table and the merge function do not exist.",
      [{ name: "inventory_master_merge_log.source_master_sku", promise: hasColumn(client, "inventory_master_merge_log", "source_master_sku") }]),

    probe("db/2026-11-20d-inventory-master-photos.sql", "Inventory master-variant photos",
      "Master-variant photos (product main / size measurement) cannot be stored at all.",
      [{ name: "inventory_master_variant_photos.image_path", promise: hasColumn(client, "inventory_master_variant_photos", "image_path") }]),

    probe("db/2026-11-20e-store-ad-spend-attributed-orders.sql", "Store Ad Spend: ad-attributed orders",
      "Ad-attributed order counts cannot be recorded, so the report hides the ad/organic split instead of showing it.",
      [{ name: "store_ad_spend.ad_orders", promise: hasColumn(client, "store_ad_spend", "ad_orders") }]),

    probe("db/2026-11-21-store-ad-spend-channel-metrics.sql", "Store Ad Spend: channel metrics (clicks, impressions, visits, Etsy conversions)",
      "Clicks, impressions, visits and Etsy conversion/revenue figures are dropped on save — the ad report can only show budget and spend.",
      [
        { name: "store_ad_spend.clicks", promise: hasColumn(client, "store_ad_spend", "clicks") },
        { name: "store_ad_spend.etsy_conversion_rate_monthly", promise: hasColumn(client, "store_ad_spend", "etsy_conversion_rate_monthly") },
      ]),

    probe("db/2026-11-21b-ad-spend-report-upgrades.sql", "Ad spend report upgrades (ad revenue, store targets, access validity + log)",
      "Ad revenue cannot be stored, store targets do not exist, and store access has no expiry date or access log.",
      [
        { name: "store_ad_spend.ad_revenue_usd", promise: hasColumn(client, "store_ad_spend", "ad_revenue_usd") },
        { name: "store_ad_targets.roas_target", promise: hasColumn(client, "store_ad_targets", "roas_target") },
        { name: "employee_store_access.valid_until", promise: hasColumn(client, "employee_store_access", "valid_until") },
        { name: "employee_store_access_log.action", promise: hasColumn(client, "employee_store_access_log", "action") },
      ]),

    probe("db/2026-11-22-address-engine.sql", "Address engine: original paste + Parsed / Verified / Needs Review status",
      "Orders still save, but the pasted address and its review status are not stored — the order list and detail cannot show whether an address was checked.",
      [
        { name: "orders.buyer_address_raw", promise: hasColumn(client, "orders", "buyer_address_raw") },
        { name: "orders.address_status", promise: hasColumn(client, "orders", "address_status") },
      ]),

    // The Purchase Orders feature was removed on 2026-11-23, so this file can
    // be left unrun. It is listed only because the panel should cover every
    // dated file on disk — no data is lost by skipping it.
    probe("db/2026-11-22c-purchase-orders.sql", "Purchase Orders tables (feature removed 2026-11-23 — optional)",
      "Nothing. The Purchase Orders section no longer exists, so this file is optional; the app does not read these tables.",
      [
        { name: "purchase_orders.po_no", promise: hasColumn(client, "purchase_orders", "po_no") },
        { name: "purchase_order_items.qty", promise: hasColumn(client, "purchase_order_items", "qty") },
      ]),
  ]);
}

const PROBE_RESULT_TTL_MS = 5 * 60 * 1000;
const resultCache = new Map<string, { probes: MigrationProbe[]; checkedAt: number }>();

export type ProbeRun = {
  probes: MigrationProbe[];
  checkedAt: number;
  /** Whole minutes since this run, computed here so the page stays pure. */
  ageMinutes: number;
  fromCache: boolean;
};

/**
 * The panel's entry point: returns a run checked less than five minutes ago
 * when one exists, so opening the page twice does not hit the database twice.
 * `force` is the explicit "Check again" (the page passes it from ?refresh=1).
 * The cache is per company because the one RPC probe takes a company id; every
 * other check is schema-level and identical for everyone.
 */
export async function probeMigrationsCached(
  client: ServiceClient,
  companyId: string,
  options: { force?: boolean } = {}
): Promise<ProbeRun> {
  const cached = resultCache.get(companyId);
  if (!options.force && cached && Date.now() - cached.checkedAt < PROBE_RESULT_TTL_MS) {
    const ageMinutes = Math.floor((Date.now() - cached.checkedAt) / 60000);
    return { probes: cached.probes, checkedAt: cached.checkedAt, ageMinutes, fromCache: true };
  }

  const probes = await probeMigrations(client, companyId);
  const checkedAt = Date.now();
  resultCache.set(companyId, { probes, checkedAt });
  return { probes, checkedAt, ageMinutes: 0, fromCache: false };
}

/** A file with only `manual` checks: visible, but nothing was verified. */
export function migrationIsManual(probe: MigrationProbe): boolean {
  return probe.checks.length > 0 && probe.checks.every((c) => c.state === "manual");
}

/**
 * A file is applied when at least one real check passed and none failed. A
 * `manual` check next to an applied one does not block it — the object it
 * would have described is simply not readable from the API.
 */
export function migrationApplied(probe: MigrationProbe): boolean {
  return (
    probe.checks.some((c) => c.state === "applied") &&
    probe.checks.every((c) => c.state === "applied" || c.state === "manual")
  );
}

/** Read-only summary for the panel's headline. */
export function summarizeMigrations(probes: MigrationProbe[]): {
  pending: number;
  unknown: number;
  manual: number;
  total: number;
} {
  return {
    pending: probes.filter((p) => p.checks.some((c) => c.state === "missing")).length,
    manual: probes.filter((p) => migrationIsManual(p)).length,
    unknown: probes.filter(
      (p) =>
        !migrationIsManual(p) &&
        !migrationApplied(p) &&
        !p.checks.some((c) => c.state === "missing")
    ).length,
    total: probes.length,
  };
}
