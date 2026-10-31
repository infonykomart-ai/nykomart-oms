import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAwbDisputeUpdate, hasAwbDisputeFields, isAwbDisputeStatus } from "./awb-dispute";

// 2026-11-03 — the disputed-AWB form's date/hold rules decide what money is
// held back from a courier payment and how old a case looks on the ageing
// report, so they are pinned here.

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

const none = { dispute_status: "none", dispute_amount: 0, dispute_raised_on: null, dispute_resolved_on: null };

test("raising a dispute stamps raised_on and keeps the held amount", () => {
  const out = buildAwbDisputeUpdate(
    fd({ dispute_status: "under_dispute", dispute_amount: "1250.555", dispute_reason: "Weight 32kg billed, actual 21kg" }),
    none,
    "2026-11-03"
  );
  assert.equal(out.dispute_status, "under_dispute");
  assert.equal(out.dispute_amount, 1250.56);
  assert.equal(out.dispute_raised_on, "2026-11-03");
  assert.equal(out.dispute_resolved_on, null);
  assert.equal(out.dispute_reason, "Weight 32kg billed, actual 21kg");
});

test("editing an open dispute does not reset its age", () => {
  const out = buildAwbDisputeUpdate(
    fd({ dispute_status: "under_dispute", dispute_amount: "900", dispute_reason: "surcharge" }),
    { dispute_status: "under_dispute", dispute_amount: 1000, dispute_raised_on: "2026-10-01", dispute_resolved_on: null },
    "2026-11-03"
  );
  assert.equal(out.dispute_raised_on, "2026-10-01");
  assert.equal(out.dispute_amount, 900);
});

test("resolving keeps the raise date + held amount and stamps the close date", () => {
  const out = buildAwbDisputeUpdate(
    fd({ dispute_status: "resolved", dispute_amount: "", dispute_resolution: "Courier issued CN" }),
    { dispute_status: "under_dispute", dispute_amount: 2500, dispute_raised_on: "2026-10-05", dispute_resolved_on: null },
    "2026-11-03"
  );
  assert.equal(out.dispute_status, "resolved");
  assert.equal(out.dispute_amount, 2500);
  assert.equal(out.dispute_raised_on, "2026-10-05");
  assert.equal(out.dispute_resolved_on, "2026-11-03");
  assert.equal(out.dispute_resolution, "Courier issued CN");
});

test("resolving twice does not move the close date", () => {
  const out = buildAwbDisputeUpdate(
    fd({ dispute_status: "resolved", dispute_amount: "2500" }),
    { dispute_status: "resolved", dispute_amount: 2500, dispute_raised_on: "2026-10-05", dispute_resolved_on: "2026-10-20" },
    "2026-11-03"
  );
  assert.equal(out.dispute_resolved_on, "2026-10-20");
});

test("clearing the dispute wipes the hold (payable becomes payable again)", () => {
  const out = buildAwbDisputeUpdate(
    fd({ dispute_status: "none" }),
    { dispute_status: "under_dispute", dispute_amount: 5000, dispute_raised_on: "2026-09-01", dispute_resolved_on: null },
    "2026-11-03"
  );
  assert.deepEqual(out, {
    dispute_status: "none",
    dispute_amount: 0,
    dispute_reason: null,
    dispute_raised_on: null,
    dispute_resolved_on: null,
    dispute_resolution: null,
  });
});

test("a negative or junk hold never raises the payable", () => {
  const out = buildAwbDisputeUpdate(fd({ dispute_status: "under_dispute", dispute_amount: "-900" }), none, "2026-11-03");
  assert.equal(out.dispute_amount, 0);
  const junk = buildAwbDisputeUpdate(fd({ dispute_status: "under_dispute", dispute_amount: "abc" }), none, "2026-11-03");
  assert.equal(junk.dispute_amount, 0);
});

test("unknown status falls back to none, and the form guard only fires when the block is present", () => {
  assert.equal(buildAwbDisputeUpdate(fd({ dispute_status: "hacked" }), none, "2026-11-03").dispute_status, "none");
  assert.equal(hasAwbDisputeFields(fd({ credit_note_amt: "10" })), false);
  assert.equal(hasAwbDisputeFields(fd({ dispute_status: "none" })), true);
  assert.equal(isAwbDisputeStatus("under_dispute"), true);
  assert.equal(isAwbDisputeStatus("foo"), false);
});
