// 2026-11-18b — DOUBLE-ENTRY DERIVATION for an expense voucher.
//
// Pure functions: given a calculated voucher and the company's chart of
// accounts, produce the debit/credit lines. The database function
// fin_post_expense_voucher() then re-validates and writes them inside one
// transaction. Keeping the derivation here means it is unit-testable without a
// database, and the rules below are readable in one place.
//
// THE RULES
//   Office expense paid in cash       Dr Office Expense      Cr Cash
//   Office expense paid by bank/UPI   Dr Office Expense      Cr Bank (the real account)
//   Credit purchase (unpaid)          Dr Expense + GST input Cr Vendor payable
//   Employee reimbursement            Dr Expense + GST input Cr Employee payable
//   ITC-INELIGIBLE GST                stays in the expense debit (never a fake
//                                     input-credit asset)
//   Additional charges                each to its own ledger account
//   Round-off                         to the default expense account, signed
//
// Every line is paise. `balanced` is exact equality, never "close enough".

import type { Paise } from "./money";
import type { VoucherCalculation } from "./expense-calc";

export type JournalAccounts = {
  cgstInput: string;
  sgstInput: string;
  igstInput: string;
  cessInput: string;
  /** Fallback expense ledger for a line/category without its own account. */
  defaultExpense: string;
  /** Default ledger for a charge without its own account. */
  defaultCharge: string;
  /** Sundry creditors — the vendor payable account. */
  payable: string;
  /** Employee reimbursement payable. */
  employeePayable: string;
};

export type ExpensePostingInput = {
  calculation: VoucherCalculation;
  accounts: JournalAccounts;
  /** The account the money actually left (required when paid). */
  paymentAccountId: string | null;
  /** payment_status === 'paid' at save time. */
  paid: boolean;
  /** Credit the employee payable instead of the vendor payable. */
  employeePayable?: boolean;
  voucherNo?: string | null;
};

export type JournalLine = {
  accountId: string;
  debitPaise: Paise;
  creditPaise: Paise;
  narration: string;
};

export type JournalBuild = {
  lines: JournalLine[];
  totalDebitPaise: Paise;
  totalCreditPaise: Paise;
  balanced: boolean;
  errors: string[];
};

/** Validates a journal — used both before writing and by the tests. */
export function validateJournal(lines: JournalLine[]): {
  valid: boolean;
  totalDebitPaise: Paise;
  totalCreditPaise: Paise;
  balanced: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (lines.length === 0) errors.push("A journal needs at least one line.");

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;
  let debitLines = 0;
  let creditLines = 0;

  lines.forEach((line, index) => {
    if (!line.accountId) errors.push(`Journal line ${index + 1}: no account.`);
    if (!Number.isInteger(line.debitPaise) || !Number.isInteger(line.creditPaise)) {
      errors.push(`Journal line ${index + 1}: amounts must be whole paise.`);
    }
    if (line.debitPaise < 0 || line.creditPaise < 0) {
      errors.push(`Journal line ${index + 1}: amounts cannot be negative — swap the side instead.`);
    }
    if (line.debitPaise > 0 && line.creditPaise > 0) {
      errors.push(`Journal line ${index + 1}: a line is either a debit or a credit, never both.`);
    }
    if (line.debitPaise === 0 && line.creditPaise === 0) {
      errors.push(`Journal line ${index + 1}: zero-amount line.`);
    }
    if (line.debitPaise > 0) debitLines += 1;
    if (line.creditPaise > 0) creditLines += 1;
    totalDebitPaise += line.debitPaise;
    totalCreditPaise += line.creditPaise;
  });

  if (debitLines === 0) errors.push("A journal needs at least one debit.");
  if (creditLines === 0) errors.push("A journal needs at least one credit.");
  const balanced = totalDebitPaise === totalCreditPaise;
  if (!balanced) {
    errors.push(
      `Journal does not balance: debit ${totalDebitPaise} paise vs credit ${totalCreditPaise} paise.`
    );
  }
  if (balanced && totalDebitPaise === 0) errors.push("Journal total is zero.");

  return { valid: errors.length === 0, totalDebitPaise, totalCreditPaise, balanced, errors };
}

/**
 * Builds the journal for one expense voucher.
 *
 * Returns `errors` (and no lines) rather than throwing, so a Server Action can
 * show the user exactly what is missing before anything is written.
 */
export function buildExpenseJournalLines(input: ExpensePostingInput): JournalBuild {
  const { calculation, accounts, paymentAccountId, paid } = input;
  const errors: string[] = [];
  const lines: JournalLine[] = [];

  if (!calculation.valid) {
    errors.push("The voucher has calculation errors — fix them before posting.");
  }
  for (const key of ["cgstInput", "sgstInput", "igstInput", "cessInput", "defaultExpense", "defaultCharge", "payable", "employeePayable"] as const) {
    if (!accounts[key]) errors.push(`The chart of accounts is missing the "${key}" account.`);
  }

  const pushDebit = (accountId: string, amountPaise: Paise, narration: string) => {
    if (amountPaise > 0) lines.push({ accountId, debitPaise: amountPaise, creditPaise: 0, narration });
  };
  const pushCredit = (accountId: string, amountPaise: Paise, narration: string) => {
    if (amountPaise > 0) lines.push({ accountId, debitPaise: 0, creditPaise: amountPaise, narration });
  };

  // ---- Debits: expense / asset side, with GST separated out where claimable.
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let cessTotal = 0;

  for (const line of calculation.lines) {
    const account = line.ledgerAccountId || accounts.defaultExpense;
    // Ineligible ITC is NOT an asset — it stays part of the cost.
    const expenseDebit = line.totalPaise - line.itcPaise;
    pushDebit(account, expenseDebit, line.description || `Expense line ${line.lineNo}`);
    if (line.itcEligible) {
      cgstTotal += line.cgstPaise;
      sgstTotal += line.sgstPaise;
      igstTotal += line.igstPaise;
      cessTotal += line.cessPaise;
    }
  }

  for (const charge of calculation.charges) {
    const account = charge.ledgerAccountId || accounts.defaultCharge;
    const expenseDebit = charge.totalPaise - charge.itcPaise;
    pushDebit(account, expenseDebit, charge.chargeName || "Additional charge");
    if (charge.itcEligible) {
      cgstTotal += charge.cgstPaise;
      sgstTotal += charge.sgstPaise;
      igstTotal += charge.igstPaise;
    }
  }

  pushDebit(accounts.cgstInput, cgstTotal, "Input CGST");
  pushDebit(accounts.sgstInput, sgstTotal, "Input SGST");
  pushDebit(accounts.igstInput, igstTotal, "Input IGST");
  pushDebit(accounts.cessInput, cessTotal, "Input Cess");

  // ---- Round-off, signed, into the default expense account.
  if (calculation.totals.roundOffPaise > 0) {
    pushDebit(accounts.defaultExpense, calculation.totals.roundOffPaise, "Round off");
  }

  // ---- Credit: where the money came from.
  const payableAccount = input.employeePayable ? accounts.employeePayable : accounts.payable;
  const creditTotal = calculation.totals.grandTotalPaise;

  if (paid) {
    if (!paymentAccountId) {
      errors.push("A paid voucher needs the cash / bank account the money left from.");
    } else {
      pushCredit(paymentAccountId, creditTotal, "Payment");
    }
  } else {
    if (!payableAccount) {
      errors.push("An unpaid voucher needs a payable account (vendor or employee).");
    } else {
      pushCredit(payableAccount, creditTotal, input.employeePayable ? "Employee reimbursement payable" : "Vendor payable");
    }
  }

  // A negative round-off reduces the payable/payment, so it is a debit
  // adjustment to the same credit side — handled by subtracting it here.
  if (calculation.totals.roundOffPaise < 0) {
    pushCredit(accounts.defaultExpense, -calculation.totals.roundOffPaise, "Round off");
  }

  const summary = validateJournal(lines);

  return {
    lines,
    totalDebitPaise: summary.totalDebitPaise,
    totalCreditPaise: summary.totalCreditPaise,
    balanced: summary.balanced,
    errors: [...errors, ...summary.errors],
  };
}

/** The JSON payload fin_post_expense_voucher() expects. */
export function toPostingPayload(lines: JournalLine[]): Array<{
  account_id: string;
  debit: number;
  credit: number;
  narration: string;
}> {
  return lines.map((line) => ({
    account_id: line.accountId,
    debit: line.debitPaise / 100,
    credit: line.creditPaise / 100,
    narration: line.narration,
  }));
}
