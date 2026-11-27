// 2026-11-27 — ONE place that writes orders.status.
//
// Before this file every status change was its own UPDATE plus its own
// WhatsApp call, so the two could drift apart:
//   • the invoice/dispatch paths wrote status and sent nothing;
//   • Hold, Cancel and Return each repeated the notify block by hand;
//   • a new writer could quietly skip the message (or invent its own
//     fromStatus) and nobody would notice.
//
// setOrderStatus() now owns the whole transition:
//   1. reads the status the row actually holds — the only honest fromStatus,
//   2. writes the new status together with any extra columns (dispatch_date),
//   3. schedules the order-status WhatsApp message AFTER the response.
//
// The row is the master: notifyOrderStatusChange never throws, so a WhatsApp
// outage can never fail the write, and it records its own failed/retry row.
// Saving the same status again writes nothing and sends nothing; the message
// itself is also guarded by the notifier's transition check and its
// (order, message_type, event_id) unique key.

import { after } from "next/server";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { notifyOrderStatusChange } from "@/lib/whatsapp/order-status-notify";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
export type OrderStatus = Database["public"]["Enums"]["order_status"];
type OrderUpdate = Database["public"]["Tables"]["orders"]["Update"];

export type StatusNotification = {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorEmployeeId: string | null;
};

export type SetOrderStatusParams = {
  orderId: string;
  toStatus: OrderStatus;
  /**
   * Extra columns written in the SAME UPDATE — e.g. dispatch_date when an AWB
   * marks the order Dispatched. A patch is still written when the status is
   * already the requested one (a missing dispatch date gets stamped).
   */
  patch?: Omit<OrderUpdate, "status">;
  actorEmployeeId?: string | null;
  /** false = write the status without the automatic WhatsApp message. */
  notify?: boolean;
  /** Test seam: replaces next/server's after(). */
  schedule?: (task: () => Promise<void>) => void;
};

export type SetOrderStatusResult = {
  previousStatus: OrderStatus | null;
  changed: boolean;
  error: string | null;
};

function defaultSchedule(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request scope (script, cron helper, test): there is no
    // response to run after, so run it now. notifyOrderStatusChange never
    // throws, so this still cannot fail the status write.
    void task();
  }
}

/**
 * Save one order-status transition and send its WhatsApp message.
 *
 * Callers own authorisation and any follow-up work (stock release,
 * revalidation, audit rows); this function owns the status column and the
 * message, so those two can never disagree.
 */
export async function setOrderStatus(
  supabase: ServiceClient,
  params: SetOrderStatusParams
): Promise<SetOrderStatusResult> {
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", params.orderId)
    .maybeSingle();

  if (readError) return { previousStatus: null, changed: false, error: readError.message };
  if (!current) return { previousStatus: null, changed: false, error: "This order was not found." };

  const previousStatus = (current.status ?? null) as OrderStatus | null;
  const changed = previousStatus !== params.toStatus;
  const hasPatch = !!params.patch && Object.keys(params.patch).length > 0;

  // Same status and nothing else to write: no UPDATE, no message.
  if (!changed && !hasPatch) {
    return { previousStatus, changed: false, error: null };
  }

  const { error } = await supabase
    .from("orders")
    .update({ ...(params.patch ?? {}), status: params.toStatus })
    .eq("id", params.orderId);
  if (error) return { previousStatus, changed: false, error: error.message };

  if (changed && params.notify !== false) {
    const notification: StatusNotification = {
      orderId: params.orderId,
      fromStatus: previousStatus,
      toStatus: params.toStatus,
      actorEmployeeId: params.actorEmployeeId ?? null,
    };
    (params.schedule ?? defaultSchedule)(async () => {
      await notifyOrderStatusChange(supabase, notification);
    });
  }

  return { previousStatus, changed, error: null };
}
