// 2026-11-18b — petty cash + opening balances + header validation tests.
import { test } from "node:test";
import assert from "node:assert/strict";

import { canSpend, pettyCashBalance } from "./petty-cash";
import { financialYearLabel, financialYearRange, validateOpeningBalances } from "./opening-balances";
import {
  canTransition,
  isValidGstin,
  resolveInterstate,
  validateVoucherHeader,
  type PaymentAccountInfo,
} from "./validation";

const cashAccount: PaymentAccountInfo = { id: "cash", name: "Main Cash", isCash: true, isBank: false, isPettyCash: false, isCreditCard: false };
const bankAccount: PaymentAccountInfo = { id: "pnb", name: "PNB Current", isCash: false, isBank: true, isPettyCash: false, isCreditCard: false };
const cardAccount: PaymentAccountInfo = { id: "card", name: "HDFC Credit Card", isCash: false, isBank: false, isPettyCash: false, isCreditCard: true };

// ---------------------------------------------------------------------------
// Test 5 — Petty cash: opening 5,000, expense 1,500, replenishment 2,000 → 5,500
// ---------------------------------------------------------------------------

test("Test 5: petty cash closes at ₹5,500 for the prompt's scenario", () => {
  // Opening ₹5,000 is the account's own opening balance — allocations are
  // EXTRA cash handed over later, so none is added for the opening here.
  const balance = pettyCashBalance(500000, [
    { txnType: "expense", amountPaise: 150000 },
    { txnType: "replenishment", amountPaise: 200000 },
  ]);
  assert.equal(balance.receivedPaise, 200000);
  assert.equal(balance.spentPaise, 150000);
  assert.equal(balance.closingPaise, 550000);
});

test("petty cash refuses a spend larger than the cash on hand", () => {
  const balance = pettyCashBalance(100000, [{ txnType: "expense", amountPaise: 60000 }]);
  assert.equal(balance.closingPaise, 40000);
  assert.equal(canSpend(balance.closingPaise, 40000), true);
  assert.equal(canSpend(balance.closingPaise, 40001), false);
  assert.equal(canSpend(balance.closingPaise, 0), false);
});

test("a physical verification is a count, not a movement", () => {
  const balance = pettyCashBalance(500000, [
    { txnType: "expense", amountPaise: 150000 },
    { txnType: "verification", amountPaise: 340000 },
  ]);
  assert.equal(balance.closingPaise, 350000);
  assert.equal(balance.countedPaise, 340000);
  assert.equal(balance.verificationDifferencePaise, -10000);
});

test("cash returned reduces the balance", () => {
  const balance = pettyCashBalance(500000, [
    { txnType: "allocation", amountPaise: 200000 },
    { txnType: "return", amountPaise: 100000 },
  ]);
  assert.equal(balance.closingPaise, 600000);
});

// ---------------------------------------------------------------------------
// Opening balances (Phase 2 setup prerequisite)
// ---------------------------------------------------------------------------

test("opening balances must balance before they can be posted", () => {
  const unbalanced = validateOpeningBalances([
    { accountId: "cash", accountName: "Main Cash", debitPaise: 500000, creditPaise: 0 },
    { accountId: "pnb", accountName: "PNB Current", debitPaise: 1000000, creditPaise: 0 },
  ]);
  assert.equal(unbalanced.valid, false);
  assert.equal(unbalanced.differencePaise, 1500000);
  assert.ok(unbalanced.errors.some((e) => e.includes("must balance")));
});

test("a balanced opening set is accepted and totals exactly", () => {
  const result = validateOpeningBalances([
    { accountId: "cash", accountName: "Main Cash", debitPaise: 500000, creditPaise: 0 },
    { accountId: "pnb", accountName: "PNB Current", debitPaise: 1000000, creditPaise: 0 },
    { accountId: "capital", accountName: "Owner Capital", debitPaise: 0, creditPaise: 1500000 },
  ]);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.debitTotalPaise, 1500000);
  assert.equal(result.creditTotalPaise, 1500000);
  assert.equal(result.rows.length, 3);
});

test("one account cannot be entered twice, on both sides, or negative", () => {
  const duplicate = validateOpeningBalances([
    { accountId: "cash", debitPaise: 100, creditPaise: 0 },
    { accountId: "cash", debitPaise: 100, creditPaise: 0 },
  ]);
  assert.ok(duplicate.errors.some((e) => e.includes("same account")));

  const bothSides = validateOpeningBalances([
    { accountId: "cash", debitPaise: 100, creditPaise: 100 },
    { accountId: "cap", debitPaise: 0, creditPaise: 0 },
  ]);
  assert.ok(bothSides.errors.some((e) => e.includes("either a debit or a credit")));

  const negative = validateOpeningBalances([{ accountId: "cash", debitPaise: -5, creditPaise: 0 }]);
  assert.ok(negative.errors.some((e) => e.includes("negative")));
});

test("a locked financial year blocks opening balances", () => {
  const result = validateOpeningBalances(
    [
      { accountId: "cash", debitPaise: 100, creditPaise: 0 },
      { accountId: "cap", debitPaise: 0, creditPaise: 100 },
    ],
    true
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("locked")));
});

test("financial year label and range follow the Indian April–March year", () => {
  assert.equal(financialYearLabel("2026-04-01"), "2026-27");
  assert.equal(financialYearLabel("2026-03-31"), "2025-26");
  assert.equal(financialYearLabel("2026-11-18"), "2026-27");
  assert.deepEqual(financialYearRange("2026-27"), { start: "2026-04-01", end: "2027-03-31" });
  assert.equal(financialYearRange("2026-28"), null);
});

// ---------------------------------------------------------------------------
// Header validation — the UPI rule and GSTIN
// ---------------------------------------------------------------------------

test("Test 4 rule: UPI must be paid from a bank account, never cash", () => {
  const upiFromCash = validateVoucherHeader({
    expenseType: "Office Expense",
    paymentMode: "UPI",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "cash",
    paymentAccount: cashAccount,
    upiReference: "UTR123456",
  });
  assert.equal(upiFromCash.valid, false);
  assert.ok(upiFromCash.errors.some((e) => e.includes("must be paid from a bank account")));
  assert.equal(upiFromCash.requiredKind, "bank");

  const upiFromBank = validateVoucherHeader({
    expenseType: "Office Expense",
    paymentMode: "UPI",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "pnb",
    paymentAccount: bankAccount,
    upiReference: "UTR123456",
  });
  assert.equal(upiFromBank.valid, true, upiFromBank.errors.join("; "));
});

test("UPI without a UTR is refused, cash from a bank account is refused", () => {
  const noReference = validateVoucherHeader({
    expenseType: "Office Expense",
    paymentMode: "UPI",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "pnb",
    paymentAccount: bankAccount,
  });
  assert.ok(noReference.errors.some((e) => e.includes("UTR")));

  const cashFromBank = validateVoucherHeader({
    expenseType: "Cash Expense",
    paymentMode: "Cash",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "pnb",
    paymentAccount: bankAccount,
  });
  assert.ok(cashFromBank.errors.some((e) => e.includes("must be paid from a cash account")));
});

test("credit card payments require a card account", () => {
  const wrong = validateVoucherHeader({
    expenseType: "Recurring Expense",
    paymentMode: "Credit Card",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "pnb",
    paymentAccount: bankAccount,
  });
  assert.equal(wrong.valid, false);

  const right = validateVoucherHeader({
    expenseType: "Recurring Expense",
    paymentMode: "Credit Card",
    voucherDate: "2026-11-18",
    paid: true,
    paymentAccountId: "card",
    paymentAccount: cardAccount,
  });
  assert.equal(right.valid, true, right.errors.join("; "));
});

test("an unpaid voucher needs no payment account", () => {
  const result = validateVoucherHeader({
    expenseType: "Office Expense",
    paymentMode: "Bank Transfer",
    voucherDate: "2026-11-18",
    paid: false,
  });
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("GSTIN is validated and the state comes from its first two digits", () => {
  assert.equal(isValidGstin("07ABCDE1234F1Z5"), true);
  assert.equal(isValidGstin("07ABCDE1234F1Z"), false);
  assert.equal(isValidGstin(""), false);
  assert.equal(resolveInterstate({ homeState: "Delhi", vendorState: "Maharashtra" }), true);
});

test("status transitions match the approval workflow", () => {
  assert.equal(canTransition("draft", "submitted"), true);
  assert.equal(canTransition("submitted", "approved"), true);
  assert.equal(canTransition("approved", "posted"), true);
  assert.equal(canTransition("posted", "approved"), false);
  assert.equal(canTransition("posted", "cancelled"), true);
  assert.equal(canTransition("cancelled", "draft"), false);
  assert.equal(canTransition("submitted", "posted"), false);
});
