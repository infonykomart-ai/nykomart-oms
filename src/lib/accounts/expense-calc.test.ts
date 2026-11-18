// 2026-11-18b — tests for the expense calculation + double-entry derivation.
// These are the master prompt's acceptance scenarios that can be proven
// without a live database (Tests 1–7, 11, 12).
import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateVoucher, allocateCharges } from "./expense-calc";
import { buildExpenseJournalLines, validateJournal, type JournalAccounts } from "./journal";
import { formatPaise, gstSplit, roundOffToRupee, toPaise } from "./money";
import { measureDimensions } from "../measurement";
import { resolveInterstate } from "./validation";

const accounts: JournalAccounts = {
  cgstInput: "acct-cgst",
  sgstInput: "acct-sgst",
  igstInput: "acct-igst",
  cessInput: "acct-cess",
  defaultExpense: "acct-office-exp",
  defaultCharge: "acct-freight",
  payable: "acct-vendor-payable",
  employeePayable: "acct-employee-payable",
};

const cashAccount = "acct-cash";
const bankAccount = "acct-pnb-bank";

function sumDebit(lines: Array<{ debitPaise: number }>) {
  return lines.reduce((sum, l) => sum + l.debitPaise, 0);
}
function sumCredit(lines: Array<{ creditPaise: number }>) {
  return lines.reduce((sum, l) => sum + l.creditPaise, 0);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("toPaise parses strings, commas, currency symbols and rounds the third decimal", () => {
  assert.equal(toPaise("1,234.56"), 123456);
  assert.equal(toPaise("₹500"), 50000);
  assert.equal(toPaise(19.99), 1999);
  assert.equal(toPaise("10.005"), 1001);
  assert.equal(toPaise("-42.5"), -4250);
  assert.ok(Number.isNaN(toPaise("abc")));
  assert.ok(Number.isNaN(toPaise("")));
});

test("formatPaise prints Indian grouping with two decimals", () => {
  assert.equal(formatPaise(12345678), "1,23,456.78");
});

test("gstSplit splits intrastate half-and-half without losing a paisa", () => {
  const split = gstSplit(500000, 18, false);
  assert.equal(split.cgstPaise, 45000);
  assert.equal(split.sgstPaise, 45000);
  assert.equal(split.igstPaise, 0);
  assert.equal(split.totalPaise, 90000);

  // An odd total tax still adds up exactly.
  const odd = gstSplit(33333, 18, false);
  assert.equal(odd.cgstPaise + odd.sgstPaise, odd.totalPaise);
});

test("roundOffToRupee returns the signed difference to a whole rupee", () => {
  assert.equal(roundOffToRupee(590040), -40); // 5900.40 -> 5900.00
  assert.equal(roundOffToRupee(590070), 30); // 5900.70 -> 5901.00
  assert.equal(roundOffToRupee(590000), 0);
});

// ---------------------------------------------------------------------------
// Test 1 — Office Expense: ₹5,000 electricity + 18% GST
// ---------------------------------------------------------------------------

test("Test 1: ₹5,000 electricity + 18% GST splits CGST/SGST and posts balanced", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Electricity bill", qty: 1, rate: 5000, gstRate: 18, categoryId: "cat-electricity" }],
  });

  assert.equal(calc.valid, true, calc.errors.join("; "));
  assert.equal(calc.totals.taxablePaise, 500000);
  assert.equal(calc.totals.cgstPaise, 45000);
  assert.equal(calc.totals.sgstPaise, 45000);
  assert.equal(calc.totals.grandTotalPaise, 590000);
  assert.equal(calc.totals.itcPaise, 90000);

  const journal = buildExpenseJournalLines({
    calculation: calc,
    accounts,
    paymentAccountId: bankAccount,
    paid: true,
  });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  assert.equal(journal.totalDebitPaise, 590000);
  assert.equal(journal.totalCreditPaise, 590000);
  // Expense carries only the taxable value — GST sits in its own input accounts.
  assert.deepEqual(
    journal.lines.filter((l) => l.debitPaise > 0).map((l) => [l.accountId, l.debitPaise]),
    [
      ["acct-office-exp", 500000],
      ["acct-cgst", 45000],
      ["acct-sgst", 45000],
    ]
  );
  assert.deepEqual(
    journal.lines.filter((l) => l.creditPaise > 0).map((l) => [l.accountId, l.creditPaise]),
    [[bankAccount, 590000]]
  );
});

// ---------------------------------------------------------------------------
// Test 2 — Cash expense: ₹500 stationery, no GST
// ---------------------------------------------------------------------------

test("Test 2: ₹500 stationery paid in cash hits Cash Book and the expense ledger only", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Stationery", amount: 500, gstApplicable: false }],
  });
  assert.equal(calc.valid, true, calc.errors.join("; "));
  assert.equal(calc.totals.nonGstPaise, 50000);
  assert.equal(calc.totals.grandTotalPaise, 50000);

  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: cashAccount, paid: true });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  assert.equal(journal.lines.length, 2);
  assert.equal(journal.lines[0].accountId, "acct-office-exp");
  assert.equal(journal.lines[0].debitPaise, 50000);
  assert.equal(journal.lines[1].accountId, cashAccount);
  assert.equal(journal.lines[1].creditPaise, 50000);
});

// ---------------------------------------------------------------------------
// Test 4 — UPI expense: ₹1,000 internet from PNB
// ---------------------------------------------------------------------------

test("Test 4: UPI ₹1,000 from PNB credits the bank account and never cash", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Internet bill", amount: 1000, gstRate: 18, gstInclusive: true }],
  });
  // 1000 inclusive of GST → 847.46 taxable + 76.27+76.27 GST
  assert.equal(calc.totals.grandTotalPaise, 100000);

  const journal = buildExpenseJournalLines({
    calculation: calc,
    accounts,
    paymentAccountId: bankAccount,
    paid: true,
  });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  const creditLines = journal.lines.filter((l) => l.creditPaise > 0);
  assert.equal(creditLines.length, 1);
  assert.equal(creditLines[0].accountId, bankAccount, "UPI must reduce the linked bank account");
  assert.equal(creditLines[0].creditPaise, 100000);
  assert.ok(!journal.lines.some((l) => l.accountId === cashAccount), "UPI must not touch cash");
  // Posted once: total debits equal the single credit, so no duplicate posting.
  assert.equal(sumDebit(journal.lines), 100000);
  assert.equal(sumCredit(journal.lines), 100000);
});

// ---------------------------------------------------------------------------
// Test 6 — Asset purchase: ₹50,000 computer + ₹9,000 GST
// ---------------------------------------------------------------------------

test("Test 6: ₹50,000 computer + 18% GST capitalises cost and separates input GST", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Computer", amount: 50000, gstRate: 18, ledgerAccountId: "acct-computer-asset" }],
  });
  assert.equal(calc.totals.taxablePaise, 5000000);
  assert.equal(calc.totals.cgstPaise + calc.totals.sgstPaise, 900000);
  assert.equal(calc.totals.grandTotalPaise, 5900000);

  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: bankAccount, paid: true });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  assert.equal(journal.lines.find((l) => l.accountId === "acct-computer-asset")?.debitPaise, 5000000);
  assert.equal(journal.lines.find((l) => l.accountId === "acct-cgst")?.debitPaise, 450000);
});

test("ITC-ineligible GST stays in the cost instead of becoming a fake credit", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Fuel", amount: 1000, gstRate: 18, itcEligible: false }],
  });
  assert.equal(calc.totals.itcPaise, 0);
  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: cashAccount, paid: true });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  // ₹1,000 + 18% GST, no credit available → the whole ₹1,180 is cost.
  assert.equal(journal.lines.find((l) => l.accountId === "acct-office-exp")?.debitPaise, 118000);
  assert.ok(!journal.lines.some((l) => l.accountId === "acct-cgst"));
});

// ---------------------------------------------------------------------------
// Test 11 — GST: same state vs interstate
// ---------------------------------------------------------------------------

test("Test 11: interstate supply uses IGST only", () => {
  const calc = calculateVoucher({
    interstate: true,
    items: [{ description: "Consultancy", amount: 10000, gstRate: 18 }],
  });
  assert.equal(calc.totals.cgstPaise, 0);
  assert.equal(calc.totals.sgstPaise, 0);
  assert.equal(calc.totals.igstPaise, 180000);

  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: bankAccount, paid: true });
  assert.ok(journal.lines.some((l) => l.accountId === "acct-igst" && l.debitPaise === 180000));
  assert.ok(!journal.lines.some((l) => l.accountId === "acct-cgst"));
  assert.equal(journal.balanced, true);
});

test("resolveInterstate compares place of supply with the company's home state", () => {
  assert.equal(resolveInterstate({ homeState: "Delhi", vendorState: "Delhi" }), false);
  assert.equal(resolveInterstate({ homeState: "Delhi", vendorState: "Maharashtra" }), true);
  assert.equal(resolveInterstate({ homeState: "Delhi", vendorState: "Delhi", placeOfSupply: "Haryana" }), true);
  assert.equal(resolveInterstate({ homeState: null, vendorState: null }), false);
  assert.equal(resolveInterstate({ override: true }), true);
});

// ---------------------------------------------------------------------------
// Unpaid vendor bill + employee reimbursement go to the right payable
// ---------------------------------------------------------------------------

test("An unpaid vendor bill credits the vendor payable, an employee claim the employee payable", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Office rent", amount: 5000, gstApplicable: false }],
  });

  const vendor = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: null, paid: false });
  assert.equal(vendor.balanced, true, vendor.errors.join("; "));
  assert.equal(vendor.lines.find((l) => l.creditPaise > 0)?.accountId, "acct-vendor-payable");

  const employee = buildExpenseJournalLines({
    calculation: calc,
    accounts,
    paymentAccountId: null,
    paid: false,
    employeePayable: true,
  });
  assert.equal(employee.lines.find((l) => l.creditPaise > 0)?.accountId, "acct-employee-payable");
  assert.equal(employee.balanced, true);
});

test("A paid voucher without an account is refused", () => {
  const calc = calculateVoucher({ interstate: false, items: [{ description: "Rent", amount: 100 }] });
  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: null, paid: true });
  assert.equal(journal.balanced, false);
  assert.ok(journal.errors.some((e) => e.includes("cash / bank account")));
});

// ---------------------------------------------------------------------------
// GST-inclusive, discounts, charges, round-off, allocation
// ---------------------------------------------------------------------------

test("GST-inclusive input keeps the entered total and extracts the tax", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Broadband", amount: 1180, gstRate: 18, gstInclusive: true }],
  });
  assert.equal(calc.totals.grandTotalPaise, 118000);
  assert.equal(calc.totals.taxablePaise, 100000);
  assert.equal(calc.totals.taxPaise, 18000);
});

test("discount reduces the taxable value before GST", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Chair", qty: 2, rate: 1000, discount: 200, gstRate: 18 }],
  });
  assert.equal(calc.totals.grossPaise, 200000);
  assert.equal(calc.totals.discountPaise, 20000);
  assert.equal(calc.totals.taxablePaise, 180000);
  assert.equal(calc.totals.grandTotalPaise, 212400);
});

test("additional charges are taxed only when marked taxable — no double taxation", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [{ description: "Material", amount: 10000, gstRate: 18 }],
    charges: [
      { chargeName: "Freight", amount: 500, isTaxable: false },
      { chargeName: "Loading", amount: 500, isTaxable: true, gstRate: 18 },
    ],
  });
  assert.equal(calc.totals.chargesPaise, 50000 + 59000);
  assert.equal(calc.totals.igstPaise, 0);
  // Item GST 18% on 10,000 = 1,800; loading GST 18% on 500 = 90.
  assert.equal(calc.totals.cgstPaise + calc.totals.sgstPaise, 180000 + 9000);
  assert.equal(calc.totals.grandTotalPaise, 1000000 + 180000 + 50000 + 59000);

  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: bankAccount, paid: true });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  assert.equal(
    journal.lines.filter((l) => l.accountId === "acct-freight").reduce((s, l) => s + l.debitPaise, 0),
    50000 + 59000 - 9000
  );
});

test("charge allocation by value/equal/quantity always adds back to the charge total", () => {
  const calc = calculateVoucher({
    interstate: false,
    items: [
      { description: "A", qty: 2, rate: 100, gstApplicable: false },
      { description: "B", qty: 1, rate: 100, gstApplicable: false },
    ],
    charges: [
      { chargeName: "Freight", amount: 100.01, allocationMethod: "value" },
      { chargeName: "Packing", amount: 50, allocationMethod: "equal" },
      { chargeName: "Loading", amount: 30, allocationMethod: "quantity" },
    ],
  });
  const shares = allocateCharges(calc.lines, calc.charges);
  assert.equal(shares.length, 3);
  shares.forEach((share, index) => {
    assert.equal(
      share.reduce((s, v) => s + v, 0),
      calc.charges[index].amountPaise,
      `charge ${index} must allocate exactly`
    );
  });
});

test("round-to-rupee adds a signed round-off line and still balances", () => {
  const calc = calculateVoucher({
    interstate: false,
    roundToRupee: true,
    items: [{ description: "Repair", amount: 1234.56, gstApplicable: false }],
  });
  assert.equal(calc.totals.exactTotalPaise, 123456);
  assert.equal(calc.totals.roundOffPaise, 44);
  assert.equal(calc.totals.grandTotalPaise, 123500);

  const journal = buildExpenseJournalLines({ calculation: calc, accounts, paymentAccountId: cashAccount, paid: true });
  assert.equal(journal.balanced, true, journal.errors.join("; "));
  assert.equal(sumDebit(journal.lines), 123500);
  assert.equal(sumCredit(journal.lines), 123500);
});

// ---------------------------------------------------------------------------
// Test 7 — Stock purchase area (10 rugs × 4 × 6 ft) → 240 sq ft
// ---------------------------------------------------------------------------

test("Test 7: 10 rugs of 4 × 6 ft measure 240 sq ft through the shared engine", () => {
  const measured = measureDimensions({ length: 6, width: 4, lengthUnit: "FT", qty: 10, outputUnit: "SQ_FT" });
  assert.equal(measured.ok, true);
  if (measured.ok) {
    assert.equal(Math.round(measured.result.area * 100) / 100, 240);
  }
});

// ---------------------------------------------------------------------------
// Test 12 — Trial Balance: every voucher balances, so the ledger does
// ---------------------------------------------------------------------------

test("Test 12: a set of vouchers produces a ledger whose debits equal credits", () => {
  const vouchers = [
    calculateVoucher({ interstate: false, items: [{ description: "Electricity", amount: 5000, gstRate: 18 }] }),
    calculateVoucher({ interstate: false, items: [{ description: "Stationery", amount: 500, gstApplicable: false }] }),
    calculateVoucher({ interstate: true, items: [{ description: "Consultancy", amount: 10000, gstRate: 18 }] }),
    calculateVoucher({
      interstate: false,
      items: [{ description: "Rent (unpaid)", amount: 5000, gstApplicable: false }],
    }),
  ];

  const all = vouchers.flatMap((calc, index) =>
    buildExpenseJournalLines({
      calculation: calc,
      accounts,
      paymentAccountId: index === 3 ? null : bankAccount,
      paid: index !== 3,
    }).lines
  );

  const summary = validateJournal(all);
  assert.equal(summary.valid, true, summary.errors.join("; "));
  assert.equal(summary.totalDebitPaise, summary.totalCreditPaise);
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test("invalid input is reported, never silently totalled", () => {
  const calc = calculateVoucher({ interstate: false, items: [{ description: "", amount: 0 }] });
  assert.equal(calc.valid, false);
  assert.ok(calc.errors.some((e) => e.includes("description")));
  assert.ok(calc.errors.some((e) => e.includes("greater than zero")));

  const discount = calculateVoucher({
    interstate: false,
    items: [{ description: "X", amount: 100, discount: 500, gstApplicable: false }],
  });
  assert.ok(discount.errors.some((e) => e.includes("discount")));

  const badRate = calculateVoucher({
    interstate: false,
    items: [{ description: "X", amount: 100, gstRate: 17 }],
  });
  assert.ok(badRate.errors.some((e) => e.includes("not a supported GST rate")));
});

test("validateJournal rejects a one-sided or unbalanced journal", () => {
  const unbalanced = validateJournal([
    { accountId: "a", debitPaise: 100, creditPaise: 0, narration: "" },
    { accountId: "b", debitPaise: 0, creditPaise: 90, narration: "" },
  ]);
  assert.equal(unbalanced.valid, false);
  assert.equal(unbalanced.balanced, false);

  const bothSides = validateJournal([
    { accountId: "a", debitPaise: 100, creditPaise: 100, narration: "" },
    { accountId: "b", debitPaise: 0, creditPaise: 0, narration: "" },
  ]);
  assert.equal(bothSides.valid, false);
});
