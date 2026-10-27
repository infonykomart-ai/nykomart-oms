// 2026-10-26 — tolerance for "the column this code names isn't in the
// database yet".
//
// This app ships dated SQL patches that the owner runs BY HAND in Supabase's
// SQL editor (see db/MIGRATIONS.md §1–2). The rule every round has followed is
// that the app must keep working on a database where the newest file has not
// been run yet: a missing column may degrade the NEW feature, and must never
// take down the write or the list that carries it. (The reported case that
// made this rule explicit: the 2026-10-17 leave audit columns were selected
// unconditionally, PostgREST answered "column does not exist", the screen
// rendered its EMPTY state over data that was never missing — BRAIN.md §5p.)
//
// Why it matters here specifically: PostgREST rejects an insert/update that
// names an unknown column OUTRIGHT, so leaving the optional column in the
// payload would make the order page's shipping form, Order Shipments &
// Packages, Manual Booking, Bulk Tracking Update and every courier-API booking
// fail with "could not save the shipment" until someone ran the SQL. That is a
// far worse failure than not storing the new number yet.
//
// So the two patterns in this file are: run it with the column, and when the
// ONLY problem is that the column is absent, retry once without it. Anything
// else (permissions, network, a constraint violation) is returned untouched —
// swallowing those would hide real failures, which is worse than the bug this
// avoids.
//
// The column this was written for is db/2026-10-26-order-shipment-forwarding-no.sql
// (order_shipments.forwarding_no / courier_shipments.forwarding_no), but both
// helpers are column-agnostic on purpose: the next optional column reuses
// them instead of growing a third copy of this reasoning.
//
// Discoverability: while the patch is outstanding, Admin → Database /
// Migration Status (src/lib/db/schema-status.ts, which has a probe entry for
// it) lists the exact file to run and what is degraded meanwhile.

type DbError = { code?: string | null; message?: string | null; details?: string | null } | null | undefined;

/**
 * True when the error is "this database hasn't got that table/column" — i.e.
 * the migration is simply not applied yet. Postgres reports 42703 (column) /
 * 42P01 (table); PostgREST's schema cache reports PGRST204/PGRST205 and words
 * it "Could not find the 'x' column ... in the schema cache". A permission or
 * network failure is NOT missing-schema-piece and must surface as a real error.
 */
export function isMissingSchemaPiece(error: DbError): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") return true;
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find the");
}

/**
 * A copy of `payload` with the optional column removed — the payload for the
 * retry once `isMissingSchemaPiece` says the column isn't there. Used for both
 * inserts and updates; `undefined`-valued keys the caller spread in
 * conditionally simply disappear with it.
 */
export function withoutColumn<T extends object, K extends keyof T>(payload: T, key: K): Omit<T, K> {
  const copy = { ...payload } as T & Record<string, unknown>;
  delete copy[key as string];
  return copy as Omit<T, K>;
}

/**
 * Runs a write with `column` in the payload and, when the ONLY failure is that
 * the column isn't in the database yet, runs it once more WITHOUT it. The
 * caller's own result type (including `.data`, for the writes that `.select()`
 * their new row back) is preserved either way.
 *
 *   const { data, error } = await tolerateMissingColumn(payload, "forwarding_no", (p) =>
 *     supabase.from("order_shipments").upsert(p, { onConflict: "order_id,shipment_no" }).select("id").single()
 *   );
 */
export async function tolerateMissingColumn<P extends object, R extends { error: DbError }>(
  payload: P,
  column: keyof P & string,
  attempt: (payload: P) => PromiseLike<R>
): Promise<R> {
  const first = await attempt(payload);
  if (!isMissingSchemaPiece(first.error)) return first;
  // The cast is contained here: dropping one optional key can only ever widen
  // what the write accepts, never change what it means.
  return attempt(withoutColumn(payload, column) as P);
}
