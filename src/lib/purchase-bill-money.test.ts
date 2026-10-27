import { test } from "node:test";
import assert from "node:assert/strict";
import {
  purchaseGstRate,
  purchaseHasGst,
  purchaseGstTotalPct,
  purchaseGstAmount,
  purchaseBillGrandTotal,
  purchaseBillAmountLabel,
  type PurchaseBillMoneyFields,
} from "./purchase-bill-money";

const bill = (over: Partial<PurchaseBillMoneyFields> = {}): PurchaseBillMoneyFields => ({
  total_amount: 1000,
  gst_rate_pct: null,
  gst_type: null,
  round_off_amt: null,
  g_total_plus_gst: null,
  ...over,
});

// ---------------------------------------------------------------------------
// The three meanings of purchase_bills.gst_rate_pct
// ---------------------------------------------------------------------------

test("gst_rate_pct: >0 is a real rate, 0 is explicit No GST, NULL is legacy", () => {
  assert.equal(purchaseGstRate(5), 5);
  assert.equal(purchaseGstRate("2.5"), 2.5);
  assert.equal(purchaseGstRate(0), 0); // explicit No GST
  assert.equal(purchaseGstRate("0"), 0);
  assert.equal(purchaseGstRate(null), 0); // legacy NULL behaves as no rate
  assert.equal(purchaseGstRate(undefined), 0);
  assert.equal(purchaseGstRate(""), 0);
  assert.equal(purchaseGstRate(-5), 0); // never a negative rate
  assert.equal(purchaseGstRate("abc"), 0);
});

test("purchaseHasGst is false for both explicit No GST and legacy NULL", () => {
  assert.equal(purchaseHasGst(5), true);
  assert.equal(purchaseHasGst("2.5"), true);
  assert.equal(purchaseHasGst(0), false);
  assert.equal(purchaseHasGst(null), false);
});

test("CGST/SGST doubles the picked rate, IGST does not", () => {
  assert.equal(purchaseGstTotalPct(2.5, "CGST/SGST"), 5);
  assert.equal(purchaseGstTotalPct(9, "CGST/SGST"), 18);
  assert.equal(purchaseGstTotalPct(5, "IGST"), 5);
  assert.equal(purchaseGstTotalPct(2.5, null), 5); // missing type defaults to split
  assert.equal(purchaseGstTotalPct(0, "IGST"), 0);
  assert.equal(purchaseGstTotalPct(null, "CGST/SGST"), 0);
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("GST is computed on the taxable amount at the total percentage", () => {
  // A CGST/SGST pick is the PER-SIDE rate; IGST is the total rate.
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: 2.5, gst_type: "CGST/SGST" }), 1000), 50);
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: 5, gst_type: "IGST" }), 1000), 50);
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: 9, gst_type: "CGST/SGST" }), 500), 90);
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: 18, gst_type: "IGST" }), 500), 90);
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: 0 }), 1000), 0);
  assert.equal(purchaseGstAmount(bill({ gst_rate_pct: null }), 1000), 0);
});

test("the stored g_total_plus_gst column is authoritative when present", () => {
  // Whatever the columns below would imply, Finance reads this number.
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 5, g_total_plus_gst: 1260 })), 1260);
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 0, g_total_plus_gst: 1000 })), 1000);
});

test("the fallback path adds GST and round-off when the stored column is missing", () => {
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 2.5, gst_type: "CGST/SGST" })), 1050);
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 0 })), 1000);
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 0, round_off_amt: -0.5 })), 999.5);
  assert.equal(purchaseBillGrandTotal(bill({ gst_rate_pct: 5, gst_type: "IGST", round_off_amt: 0.5 })), 1050.5);
  assert.equal(purchaseBillGrandTotal(bill({ total_amount: null, gst_rate_pct: 0 })), 0);
});

// ---------------------------------------------------------------------------
// The list's amount text
// ---------------------------------------------------------------------------

test("a no-GST bill prints just its amount", () => {
  assert.equal(purchaseBillAmountLabel(bill({ gst_rate_pct: 0 })), "₹1000.00");
  assert.equal(purchaseBillAmountLabel(bill({ gst_rate_pct: null, total_amount: 2500.5 })), "₹2500.50");
});

test("a GST bill spells out the type, the total percentage and the grand total", () => {
  assert.equal(
    purchaseBillAmountLabel(bill({ gst_rate_pct: 2.5, gst_type: "CGST/SGST" })),
    "₹1000.00 + GST (CGST+SGST 5%) = ₹1050.00"
  );
  assert.equal(
    purchaseBillAmountLabel(bill({ gst_rate_pct: 5, gst_type: "IGST" })),
    "₹1000.00 + GST (IGST 5%) = ₹1050.00"
  );
});

test("round-off is shown on the label, in either direction", () => {
  assert.equal(
    purchaseBillAmountLabel(bill({ gst_rate_pct: 0, round_off_amt: 0.5, g_total_plus_gst: 1000.5 })),
    "₹1000.00 + Round Off ₹0.50 = ₹1000.50"
  );
  assert.equal(
    purchaseBillAmountLabel(bill({ gst_rate_pct: 0, round_off_amt: -0.5, g_total_plus_gst: 999.5 })),
    "₹1000.00 − Round Off ₹0.50 = ₹999.50"
  );
  assert.equal(
    purchaseBillAmountLabel(bill({ gst_rate_pct: 2.5, gst_type: "CGST/SGST", round_off_amt: -0.4, g_total_plus_gst: 1049.6 })),
    "₹1000.00 + GST (CGST+SGST 5%) − Round Off ₹0.40 = ₹1049.60"
  );
});
