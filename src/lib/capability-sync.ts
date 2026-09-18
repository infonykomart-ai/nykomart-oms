// 2026-09-18 — "roles & permission me jo capability update kyu nahi hoti vo
// apne aap section ke according update honi chahiye na": CAPABILITY_INFO
// (src/lib/capability-info.ts) is the app's live list of capabilities — one
// entry per dashboard section — but the `capabilities` TABLE was only ever
// seeded once by db/schema.sql's INSERT, so every capability added to the
// app after that day never appeared in the Roles & Permissions matrix, and
// toggling it was impossible.
//
// Fix: push the live registry into the table via the
// sync_capabilities(p_codes, p_descriptions) Postgres function
// (db/2026-09-18-orders-multi-photo-and-capability-sync.sql). Called from
// the Roles & Permissions page's own loader, so a deploy + one page visit
// is the whole sync — zero manual SQL, grants in role_capabilities are
// never touched, and descriptions are refreshed to the app's current
// wording every time.
//
// SECURITY-DEFINER note: the service-role client is required because
// sync_capabilities() writes to `capabilities`, which admin-UI sessions
// don't need direct table grants for; this is the same pattern every other
// privileged admin action in this app uses (see require-capability's
// callers).
import { CAPABILITY_INFO } from "./capability-info";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function syncCapabilitiesFromRegistry(): Promise<{ synced: number; error: string | null }> {
  // Two capabilities share hrefs/tiles in CAPABILITY_INFO, and "doc_entry"
  // literally appears twice (Document Entry + Order Shipments & Packages).
  // The table's PK is code, so de-dupe here — FIRST occurrence wins, which
  // keeps the matrix's "Document Entry" wording for doc_entry.
  const unique = new Map(CAPABILITY_INFO.map((c) => [c.code, `${c.label} — ${c.description}`]));

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("sync_capabilities", {
    p_codes: Array.from(unique.keys()),
    p_descriptions: Array.from(unique.values()),
  });

  if (error) return { synced: 0, error: error.message };
  // The RPC returns the number of codes processed (see the function's
  // comment); normalize whatever the driver hands back defensively.
  const synced = typeof data === "number" ? data : Number(data ?? 0);
  return { synced: Number.isFinite(synced) ? synced : 0, error: null };
}
