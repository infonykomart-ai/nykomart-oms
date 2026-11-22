// 2026-11-22b — Phase 3: the ONE read path for an order's Close-Up photos.
//
// Sources, in priority order:
//   1. `order_attachments` rows with attachment_type = 'closeup_photo'
//      (db/2026-11-22b-order-attachments.sql) — the typed index.
//   2. the order's own `photo_urls[2..]` (db/2026-09-18), which stays the
//      authoritative list the Order page writes.
//
// Reading BOTH is deliberate: a database where the attachment migration is
// still pending, or an order saved before it, must keep showing its photos.
// The merge is by URL, so nothing can appear twice.
//
// `syncOrderAttachments()` is called by the Order save paths AFTER the order
// row is written. It never touches `orders.photo_url` / `photo_urls` (they
// stay the source of truth), and it is best-effort: an order save must never
// fail because the attachment table is not there yet.
//
// There is intentionally NO caption / description / notes field anywhere in
// this module or its table — the requirement is photos only.
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import { extractCloseUpPhotoUrls } from "@/lib/whatsapp/reference-photos";
import {
  closeupFileNameFromUrl,
  mergeCloseupPhotoSources,
  planAttachmentSync,
  type CloseupPhoto,
} from "@/lib/orders/closeup-photo-merge";

export type { CloseupPhoto };
// Re-exported for callers that already imported the name from this module.
export { closeupFileNameFromUrl } from "@/lib/orders/closeup-photo-merge";

const ATTACHMENT_TABLE = "order_attachments";
const CLOSEUP_TYPE = "closeup_photo";

export type CloseupPhotoOrder = {
  id?: string | null;
  photo_url?: string | null;
  photo_urls?: (string | null)[] | null;
};

/** The close-up URLs implied by an order row alone (main photo excluded). */
export function closeUpUrlsForOrder(order: CloseupPhotoOrder): string[] {
  return extractCloseUpPhotoUrls({
    id: order.id ?? "",
    ref_no: "",
    photo_url: order.photo_url ?? null,
    photo_urls: order.photo_urls ?? null,
  });
}


async function readAttachmentRows(orderIds: string[]): Promise<Map<string, CloseupPhoto[]>> {
  const byOrder = new Map<string, CloseupPhoto[]>();
  if (!orderIds.length) return byOrder;

  const supabase = createServiceRoleClientUnchecked();
  const { data, error } = await supabase
    .from(ATTACHMENT_TABLE)
    .select("id, order_id, file_url, file_name, sort_order")
    .in("order_id", orderIds)
    .eq("attachment_type", CLOSEUP_TYPE)
    .order("sort_order", { ascending: true });

  // Pending migration (or any failure): fall back to the order columns only.
  if (error) {
    if (!isMissingSchemaPiece(error)) console.error("[closeup-photos] attachment read failed:", error.message);
    return byOrder;
  }

  for (const row of (data ?? []) as {
    id: string;
    order_id: string;
    file_url: string;
    file_name: string | null;
    sort_order: number;
  }[]) {
    if (!row.file_url) continue;
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      url: row.file_url,
      fileName: row.file_name ?? closeupFileNameFromUrl(row.file_url),
      sortOrder: row.sort_order,
    });
    byOrder.set(row.order_id, list);
  }
  return byOrder;
}

async function readOrderPhotoColumns(orderIds: string[]): Promise<Map<string, CloseupPhoto[]>> {
  const byOrder = new Map<string, CloseupPhoto[]>();
  if (!orderIds.length) return byOrder;

  const supabase = createServiceRoleClientUnchecked();
  const { data, error } = await supabase
    .from("orders")
    .select("id, photo_url, photo_urls")
    .in("id", orderIds);

  if (error) {
    console.error("[closeup-photos] order photo read failed:", error.message);
    return byOrder;
  }

  for (const row of (data ?? []) as { id: string; photo_url: string | null; photo_urls: string[] | null }[]) {
    const urls = closeUpUrlsForOrder(row);
    if (!urls.length) continue;
    byOrder.set(
      row.id,
      urls.map((url, index) => ({
        id: `order:${row.id}:${index}`,
        url,
        fileName: closeupFileNameFromUrl(url),
        sortOrder: index,
      }))
    );
  }
  return byOrder;
}

async function resolvePhotos(orderIds: string[]): Promise<Map<string, CloseupPhoto[]>> {
  const [typed, legacy] = await Promise.all([readAttachmentRows(orderIds), readOrderPhotoColumns(orderIds)]);
  const merged = new Map<string, CloseupPhoto[]>();
  for (const id of orderIds) {
    merged.set(id, mergeCloseupPhotoSources(typed.get(id) ?? [], legacy.get(id) ?? []));
  }
  return merged;
}

/** Close-up photos for one order, typed rows first then any legacy URL. */
export async function getOrderCloseupPhotos(orderId: string): Promise<CloseupPhoto[]> {
  const map = await resolvePhotos([orderId]);
  return map.get(orderId) ?? [];
}

/** Same read path for several orders (PO print / list). */
export async function getCloseupPhotosForOrders(orderIds: string[]): Promise<Map<string, CloseupPhoto[]>> {
  return resolvePhotos(Array.from(new Set(orderIds.filter(Boolean))));
}

/**
 * Makes `order_attachments` match the order's saved close-up list.
 *
 * Called after an order is created/edited. Best-effort by design: the order
 * itself is already saved, and a database without the migration (or a
 * transient failure) must never turn that save into an error.
 *
 * `urls` is the close-up list only — the main photo is never stored here.
 */
export async function syncOrderAttachments(orderId: string, urls: string[]): Promise<void> {
  const supabase = createServiceRoleClientUnchecked();
  try {
    const { data: existing, error: readError } = await supabase
      .from(ATTACHMENT_TABLE)
      .select("id, file_url, sort_order")
      .eq("order_id", orderId)
      .eq("attachment_type", CLOSEUP_TYPE);

    if (readError) {
      if (!isMissingSchemaPiece(readError)) {
        console.error("[closeup-photos] attachment sync read failed:", readError.message);
      }
      return;
    }

    // The diff is pure logic (closeup-photo-merge.ts) so it can be tested.
    const plan = planAttachmentSync(
      (existing ?? []) as { id: string; file_url: string; sort_order: number | null }[],
      urls
    );

    if (plan.toDelete.length) {
      const { error } = await supabase.from(ATTACHMENT_TABLE).delete().in("id", plan.toDelete);
      if (error) console.error("[closeup-photos] attachment delete failed:", error.message);
    }

    if (plan.toInsert.length) {
      const { error } = await supabase.from(ATTACHMENT_TABLE).upsert(
        plan.toInsert.map((row) => ({
          order_id: orderId,
          attachment_type: CLOSEUP_TYPE,
          ...row,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "order_id,file_url", ignoreDuplicates: false }
      );
      if (error) console.error("[closeup-photos] attachment upsert failed:", error.message);
    }

    // Keep sort_order in step with the saved order list — but only for the
    // rows whose position actually moved.
    if (plan.toReorder.length) {
      await Promise.all(
        plan.toReorder.map((row) =>
          supabase
            .from(ATTACHMENT_TABLE)
            .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
            .eq("id", row.id)
        )
      );
    }
  } catch (error) {
    console.error("[closeup-photos] attachment sync failed:", error);
  }
}
