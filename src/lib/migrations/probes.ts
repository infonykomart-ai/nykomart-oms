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
 * A dated file that is a pure DATA repair has no schema object to look for.
 * `2026-11-14b` is the first one: it rescales debit-note adjustment rows that
 * were written before the GST fix. Reading every note with its adjustment rows
 * and judging them by the same predicate the file uses answers the only useful
 * question — "does this database still hold rows that file would change?".
 * Read-only; honestly "applied" when there is nothing left to repair (which is
 * also true of a database that never needed the repair).
 */
async function debitNoteAdjustmentsRepaired(client: ServiceClient): Promise<ProbeState> {
  const { data, error } = await (client as unknown as UntypedClient)
    .from("debit_notes")
    .select("id, debit_amount, total_amount, bill_pass_register_adjustments(amount)");
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
