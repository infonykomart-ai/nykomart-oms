// 2026-11-18b — PETTY CASH ARITHMETIC (pure).
//
// The prompt's formula, verbatim:
//   Closing = Opening + Cash Received − Expenses − Cash Returned
// with allocations and replenishments both counting as cash received. Stored
// rows are never a mutated balance column, so the number can always be
// re-derived from the transaction list and audited.
//
// Negative cash is prevented BEFORE a spend is accepted (canSpend), not
// discovered afterwards.

import type { Paise } from "./money";

export type PettyCashTxnType = "allocation" | "replenishment" | "expense" | "return" | "verification";

export type PettyCashTxn = {
  txnType: PettyCashTxnType;
  amountPaise: Paise;
};

export type PettyCashBalance = {
  openingPaise: Paise;
  receivedPaise: Paise;
  spentPaise: Paise;
  returnedPaise: Paise;
  closingPaise: Paise;
  /** The most recent physical count recorded, when there is one. */
  countedPaise: Paise | null;
  /** counted − closing; 0 when nothing was counted. */
  verificationDifferencePaise: Paise;
};

/**
 * Calculates a petty cash account's position.
 *
 * `verification` rows are a physical count, not a movement — they never change
 * the computed balance, they only show the difference against it.
 */
export function pettyCashBalance(openingPaise: Paise, txns: PettyCashTxn[]): PettyCashBalance {
  const opening = Number.isFinite(openingPaise) ? Math.round(openingPaise) : 0;
  let received = 0;
  let spent = 0;
  let returned = 0;
  let counted: number | null = null;

  for (const txn of txns) {
    const amount = Number.isFinite(txn.amountPaise) ? Math.round(txn.amountPaise) : 0;
    switch (txn.txnType) {
      case "allocation":
      case "replenishment":
        received += amount;
        break;
      case "expense":
        spent += amount;
        break;
      case "return":
        returned += amount;
        break;
      case "verification":
        // Last count wins; a later txn list order is the caller's
        // responsibility (the page orders by txn_date, created_at).
        counted = amount;
        break;
      default:
        break;
    }
  }

  const closing = opening + received - spent - returned;
  return {
    openingPaise: opening,
    receivedPaise: received,
    spentPaise: spent,
    returnedPaise: returned,
    closingPaise: closing,
    countedPaise: counted,
    verificationDifferencePaise: counted === null ? 0 : counted - closing,
  };
}

/**
 * True when this spend fits in the available cash. The app refuses a spend
 * that would take a petty cash account negative — except a recorded
 * verification difference, which is how a real shortage gets reconciled.
 */
export function canSpend(balancePaise: Paise, spendPaise: Paise): boolean {
  if (!Number.isFinite(balancePaise) || !Number.isFinite(spendPaise)) return false;
  if (spendPaise <= 0) return false;
  return balancePaise - spendPaise >= 0;
}

/** How much can still be spent from this account. Never negative. */
export function availableToSpend(balancePaise: Paise): Paise {
  return Number.isFinite(balancePaise) && balancePaise > 0 ? Math.round(balancePaise) : 0;
}
