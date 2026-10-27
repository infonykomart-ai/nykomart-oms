// 2026-10-21 — Schema / Migration Status: which db/*.sql files have NOT been
// run against the live Supabase project yet, and which features that
// degrades. Answer to "admin ko dikhta nahi ki kaunsi migration abhi bhi
// pending hai".
//
// WHY PROBES INSTEAD OF A LEDGER TABLE: the app has no migration bookkeeping
// table (every db/*.sql file is applied by hand in the Supabase SQL editor),
// and adding one would require... a migration. So each tracked migration
// declares the ONE object it is guaranteed to create — a column or a table —
// and this module asks PostgREST for it. That is also exactly the failure
// mode being reported: optional columns are read with tolerant fallbacks, so
// a missing column silently degrades a feature instead of erroring.
//
// DELIBERATELY A SMALL, HIGH-VALUE LIST. Every probe costs one round-trip, so
// this tracks the migrations whose absence silently changes what the app
// SHOWS (audit stamps, leave routing, Telegram delivery, FX/customs rates,
// B2B export fields) — not all ~170 historical files. Adding one is one entry
// below; keep it to the newest/highest-impact ones.
//
// Nothing here is a security boundary: a probe only reports "column/table
// present or not", never reads a row of data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type SchemaCheck = {
  /** db/<file>.sql — the exact file the Admin has to run. */
  file: string;
  /** Short human title of the round. */
  title: string;
  /** Table + column this migration is guaranteed to create. */
  probe: { table: keyof Database["public"]["Tables"] & string; column: string };
  /** What the user loses while it is not applied. */
  features: string[];
};

/**
 * Newest first — the panel shows pending ones in this order, so a just-added
 * round shows up at the top instead of being buried under old history.
 */
export const SCHEMA_CHECKS: SchemaCheck[] = [
  {
    // 2026-10-26 — aggregator couriers (Shiprocket / Shipglobal / OnPoint /
    // Delhivery) hand out TWO numbers per parcel: the carrier's tracking no.
    // and their own forwarding reference. Without the column, every save of
    // the second number is rejected by PostgREST, so the field is simply
    // never usable — silent, which is exactly what this panel exists for.
    file: "2026-10-26-order-shipment-forwarding-no.sql",
    title: "Second tracking number per shipment (forwarding / partner no.)",
    probe: { table: "order_shipments", column: "forwarding_no" },
    features: [
      "Order page / Order Shipments & Packages / Manual booking: the Forwarding No. field cannot be saved (every write to it errors)",
      "Courier Ops → Track Shipments: no second number to search or display alongside the AWB",
      "Shiprocket / Shipglobal API bookings: the forwarder's own reference is never captured automatically",
    ],
  },
  {
    // 2026-10-24 — added because this file's absence was reported as "bill
    // ki sheet par 404 aa raha hai": every A4 sheet named one of its columns
    // in its SELECT, and a single missing column rejects the whole query. The
    // sheets are tolerant now (`select("*")`), so what remains is the quiet
    // half — figures falling back to pre-migration values.
    file: "2026-10-24b-round-figure-printing-bill-and-size-mode.sql",
    title: "Round-figure bills, printing-bill section, 'as billed' sizes",
    probe: { table: "purchase_bills", column: "size_mode" },
    features: [
      "Purchase / Courier / Duty / Washing bills: ROUND OFF line prints ₹0.00 (net payable is short by the vendor's rounding)",
      "Purchase Bill entry: the separate 'Printing' bill tab is unavailable",
      "Fabric bills can't be marked 'as billed' — every size prints as a Sq Ft area even when the vendor billed running metres",
      "Courier bill sheets: per-AWB GST breakup falls back to the flat 18% estimate",
    ],
  },
  {
    file: "2026-10-24-shipment-charge-lines.sql",
    title: "Courier charge ledger (charge heads, export vs return-to-India)",
    probe: { table: "shipment_charge_lines", column: "charge_head" },
    features: [
      "Courier Ops → Charges tab shows a \"run this SQL\" notice instead of the entry form",
      "Courier charges can only be recorded in a freight bill's four fixed Base/Fuel/Remote/Other columns",
      "No per-shipment charge breakdown (customs, duty, RTO, weight discrepancy, …) for export or return-to-India shipments",
    ],
  },
  {
    file: "2026-10-21-purchase-bill-entered-by.sql",
    title: "Purchase Bill — entered by + edit history",
    probe: { table: "purchase_bills", column: "entered_by_employee_id" },
    features: [
      "Purchase Bill list: \"Entered by <name>\" (new entries only — legacy rows stay blank on purpose)",
      "Admin's per-invoice History chain still works, but nothing stamps WHO entered it",
    ],
  },
  {
    file: "2026-10-20-purchase-bill-no-gst-and-audit.sql",
    title: "Purchase Bill — No GST fix + entry/edited timestamps",
    probe: { table: "purchase_bills", column: "updated_at" },
    features: [
      "Purchase Bill \"Entered / Last updated\" timestamps (Admin only) disappear",
      "A bill saved as \"No GST\" still posts 5% higher in Bill Payment / Party Ledger than the entry screen shows",
    ],
  },
  {
    file: "2026-10-19-leave-approvers.sql",
    title: "Leave — designated approvers",
    probe: { table: "leave_requests", column: "approver_employee_id" },
    features: [
      "Apply-for-Leave \"Send for approval to\" picker stops working",
      "Every request falls back to MD/Admin-only approval routing",
    ],
  },
  {
    file: "2026-10-17-customs-exchange-rates.sql",
    title: "Customs exchange rates",
    probe: { table: "customs_exchange_rates", column: "export_rate" },
    features: [
      "Customs / shipping documents fall back to the manual exchange_rates table",
      "Import-vs-export customs rate difference is not available",
    ],
  },
  {
    file: "2026-10-15b-fx-rate-cache.sql",
    title: "Live FX rate cache",
    probe: { table: "fx_rate_cache", column: "rate" },
    features: [
      "Amazon country-wise ad-spend conversion to INR falls back to a stale/hard-coded rate",
      "FX rates never refresh automatically",
    ],
  },
  {
    file: "2026-10-13-b2b-pi-export-details.sql",
    title: "B2B PI export details",
    probe: { table: "b2b_quotations", column: "product_specs" },
    features: [
      "B2B Proforma Invoice / export sheet prints without buyer address, specs, payment & shipping terms, bank details",
      "Company IEC no. and business address are missing from export documents",
    ],
  },
  {
    file: "2026-09-30c-employee-telegram-chat-id.sql",
    title: "Employee Telegram chat id",
    probe: { table: "employees", column: "telegram_chat_id" },
    features: [
      "Attendance punch notifications never reach Telegram",
      "Leave daily digest (leave-digest cron) has no recipient and sends nothing",
    ],
  },
  {
    file: "2026-09-11-leave-types-and-balances.sql",
    title: "Leave types + balances",
    probe: { table: "leave_requests", column: "leave_type_id" },
    features: [
      "Apply-for-Leave \"Leave Type\" picker and paid/unpaid tagging disappear",
      "Leave balance debits are not recorded",
    ],
  },
  {
    file: "2026-10-02b-departments-entity.sql",
    title: "Departments master",
    probe: { table: "employees", column: "department_id" },
    features: [
      "Employee → department assignment is not saved",
      "Department-wise attendance / performance grouping is empty",
    ],
  },
  {
    file: "2026-08-24-audit-log.sql",
    title: "Audit log",
    probe: { table: "audit_log", column: "changes" },
    features: [
      "Purchase Bill / Courier / Duty Bill delete and edit history is not recorded at all",
      "Admin → Audit Log page is empty; the new per-invoice History chain has nothing to show",
    ],
  },
];

export type SchemaCheckResult = {
  file: string;
  title: string;
  features: string[];
  /**
   * applied    = the object exists, the migration has been run
   * missing    = PostgREST says it does not exist -> ACTION NEEDED
   * unverified = the check itself failed (network/env/permission), NOT a
   *              pending migration — never cried wolf about.
   */
  state: "applied" | "missing" | "unverified";
  /** PostgREST/column error text when state is not "applied". */
  error: string | null;
};

export type SchemaStatus = {
  results: SchemaCheckResult[];
  /** Migrations that are genuinely NOT applied (action needed). */
  pending: SchemaCheckResult[];
  /** Checks that could not run at all (shown muted, not as pending). */
  unverified: SchemaCheckResult[];
  checkedAt: string;
};

/**
 * True when PostgREST's error means "that table/column does not exist"
 * (as opposed to a network/auth failure, which must be reported as
 * "couldn't check" — not as "migration pending", or the card would cry wolf
 * every time Supabase hiccups).
 */
function isMissingObjectError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the") || // PGRST204: Could not find the 'x' column ...
    m.includes("undefined column") ||
    m.includes("schema cache") ||
    m.includes("undefined table")
  );
}

/**
 * Probes every tracked migration. One round-trip each, in parallel; a probe
 * NEVER throws — a failure is reported per entry so one bad network call
 * cannot blank the whole panel.
 */
export async function checkSchemaStatus(supabase: Client): Promise<SchemaStatus> {
  const results = await Promise.all(
    SCHEMA_CHECKS.map(async (check): Promise<SchemaCheckResult> => {
      const base = { file: check.file, title: check.title, features: check.features };
      try {
        const { error } = await supabase
          .from(check.probe.table)
          .select(check.probe.column)
          .limit(1);
        if (!error) return { ...base, state: "applied", error: null };
        // A missing object is a real "run the SQL" signal; anything else is
        // "couldn't verify" and is shown with its raw message instead of
        // being mistaken for a pending migration.
        return {
          ...base,
          state: isMissingObjectError(error.message) ? "missing" : "unverified",
          error: error.message,
        };
      } catch (err) {
        return {
          ...base,
          state: "unverified",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return {
    results,
    pending: results.filter((r) => r.state === "missing"),
    unverified: results.filter((r) => r.state === "unverified"),
    checkedAt: new Date().toISOString(),
  };
}
