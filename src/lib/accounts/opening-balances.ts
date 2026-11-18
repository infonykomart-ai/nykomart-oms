// 2026-11-18b — OPENING BALANCES (pure validation for the Phase 2 setup step).
//
// The accounting module cannot start on real data with every balance at zero:
// the first bank payment would make PNB look overdrawn by the full amount and
// the Trial Balance would never reconcile with the actual bank statements.
// Before Phase 2's purchase bills are posted, each existing cash/bank account
// is carried in here and posted once as an opening journal.
//
// Rules enforced before anything is written:
//   • every row is one side only (debit OR credit)
//   • amounts are whole paise and non-negative
//   • the whole set must balance (total debit = total credit)
//   • the financial year must not be locked

import type { Paise } from "./money";

export type OpeningBalanceRow = {
  accountId: string;
  accountName?: string;
  debitPaise: Paise;
  creditPaise: Paise;
};

export type OpeningBalanceValidation = {
  valid: boolean;
  errors: string[];
  debitTotalPaise: Paise;
  creditTotalPaise: Paise;
  differencePaise: Paise;
  /** Accounts with a balance, ready to save. */
  rows: OpeningBalanceRow[];
};

export function validateOpeningBalances(rows: OpeningBalanceRow[], locked = false): OpeningBalanceValidation {
  const errors: string[] = [];
  if (locked) errors.push("This financial year is locked — unlock it in Accounts Settings before entering opening balances.");
  if (rows.length === 0) errors.push("Enter at least one opening balance.");

  const seen = new Set<string>();
  let debitTotal = 0;
  let creditTotal = 0;
  const kept: OpeningBalanceRow[] = [];

  rows.forEach((row, index) => {
    const label = row.accountName || `Row ${index + 1}`;
    if (!row.accountId) {
      errors.push(`${label}: no account selected.`);
      return;
    }
    if (seen.has(row.accountId)) {
      errors.push(`${label}: the same account appears twice.`);
      return;
    }
    seen.add(row.accountId);

    const debit = Number.isFinite(row.debitPaise) ? Math.round(row.debitPaise) : NaN;
    const credit = Number.isFinite(row.creditPaise) ? Math.round(row.creditPaise) : NaN;
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      errors.push(`${label}: amount is not a valid number.`);
      return;
    }
    if (debit < 0 || credit < 0) {
      errors.push(`${label}: amounts cannot be negative.`);
      return;
    }
    if (debit > 0 && credit > 0) {
      errors.push(`${label}: enter either a debit or a credit, not both.`);
      return;
    }
    if (debit === 0 && credit === 0) return; // blank row, simply skipped

    debitTotal += debit;
    creditTotal += credit;
    kept.push({ ...row, debitPaise: debit, creditPaise: credit });
  });

  const difference = debitTotal - creditTotal;
  if (kept.length > 0 && difference !== 0) {
    errors.push(
      `Opening balances must balance — debit ₹${(debitTotal / 100).toFixed(2)} vs credit ₹${(creditTotal / 100).toFixed(2)}.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    debitTotalPaise: debitTotal,
    creditTotalPaise: creditTotal,
    differencePaise: difference,
    rows: kept,
  };
}

/** Indian financial-year label for a date, e.g. 2026-11-18 → "2026-27". */
export function financialYearLabel(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 < 4 ? year - 1 : year;
  const end = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${end}`;
}

/** 1 April → 31 March range for a financial-year label. */
export function financialYearRange(label: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const startYear = Number(match[1]);
  const expectedEnd = String((startYear + 1) % 100).padStart(2, "0");
  if (match[2] !== expectedEnd) return null;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}
