import assert from "node:assert/strict";
import test from "node:test";
import { setOrderStatus } from "./set-order-status";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function fakeOrders(row: { id: string; status: string } | null, updateError: string | null = null) {
  const updates: Record<string, unknown>[] = [];
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { eq: async () => ({ error: updateError ? { message: updateError } : null }) };
        },
      };
    },
  };
  return { client: client as unknown as ServiceClient, updates };
}

function collect() {
  const scheduled: Array<() => Promise<void>> = [];
  return { scheduled, schedule: (task: () => Promise<void>) => scheduled.push(task) };
}

test("a real transition writes the status and schedules one message", async () => {
  const { client, updates } = fakeOrders({ id: "o1", status: "Pending" });
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, { orderId: "o1", toStatus: "Hold", schedule });

  assert.equal(result.error, null);
  assert.equal(result.changed, true);
  assert.equal(result.previousStatus, "Pending");
  assert.deepEqual(updates, [{ status: "Hold" }]);
  assert.equal(scheduled.length, 1);
});

test("saving the same status again writes nothing and sends nothing", async () => {
  const { client, updates } = fakeOrders({ id: "o1", status: "Hold" });
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, { orderId: "o1", toStatus: "Hold", schedule });

  assert.equal(result.error, null);
  assert.equal(result.changed, false);
  assert.deepEqual(updates, []);
  assert.equal(scheduled.length, 0);
});

test("a patch is written with an unchanged status, without a message", async () => {
  const { client, updates } = fakeOrders({ id: "o1", status: "Dispatched" });
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, {
    orderId: "o1",
    toStatus: "Dispatched",
    patch: { dispatch_date: "2026-11-27" },
    schedule,
  });

  assert.equal(result.error, null);
  assert.equal(result.changed, false);
  assert.deepEqual(updates, [{ dispatch_date: "2026-11-27", status: "Dispatched" }]);
  assert.equal(scheduled.length, 0);
});

test("notify:false keeps the write but sends nothing", async () => {
  const { client, updates } = fakeOrders({ id: "o1", status: "Pending" });
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, {
    orderId: "o1",
    toStatus: "Cancelled",
    notify: false,
    schedule,
  });

  assert.equal(result.error, null);
  assert.equal(result.changed, true);
  assert.deepEqual(updates, [{ status: "Cancelled" }]);
  assert.equal(scheduled.length, 0);
});

test("a failed update is returned and nothing is scheduled", async () => {
  const { client } = fakeOrders({ id: "o1", status: "Pending" }, "update failed");
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, { orderId: "o1", toStatus: "Hold", schedule });

  assert.equal(result.error, "update failed");
  assert.equal(result.changed, false);
  assert.equal(scheduled.length, 0);
});

test("a missing order is an error, not a silent success", async () => {
  const { client, updates } = fakeOrders(null);
  const { scheduled, schedule } = collect();

  const result = await setOrderStatus(client, { orderId: "o1", toStatus: "Hold", schedule });

  assert.equal(result.error, "This order was not found.");
  assert.deepEqual(updates, []);
  assert.equal(scheduled.length, 0);
});
