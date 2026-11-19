// 2026-11-18b — posting an expense voucher to the double-entry ledger.
//
// The derivation is pure (./journal.ts); this module is the only place that
// talks to the database's fin_post_expense_voucher() RPC, so every caller
// (save-and-post, claim approval, reversal) uses the same rules.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  ExpenseVoucherChargeRow,
  ExpenseVoucherItemRow,
  ExpenseVoucherRow,
  FinAccountRow,
} from "@/types/database";
import { buildExpenseJournalLines, toPostingPayload, type JournalAccounts } from "./journal";
import type { CalculatedCharge, CalculatedLine, VoucherCalculation } from "./expense-calc";
import { expenseBaseUnit, expenseUnitFamily, normalizeExpenseUnit, toBaseExpenseQuantity } from "./line-units";

type Client = SupabaseClient<Database>;

export type AccountLookup = {
  accounts: JournalAccounts | null;
  missing: string[];
};

const CODE_CGST = "1301";
const CODE_SGST = "1302";
const CODE_IGST = "1303";
const CODE_CESS = "1304";
const CODE_OFFICE_EXPENSE = "5100";
const CODE_FREIGHT = "5110";
const CODE_PAYABLE = "2100";
const CODE_EMPLOYEE_PAYABLE = "2110";

/**
 * Resolves the chart-of-accounts ids a posting needs. Falls back to a
 * same-type account when the default code is missing, and reports what is
 * genuinely absent so the user gets "run Accounts Setup" instead of a crash.
 */
export function resolveJournalAccounts(accounts: FinAccountRow[]): AccountLookup {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const firstOfType = (type: string) => accounts.find((a) => a.account_type === type && a.active);

  const expenseDefault = byCode.get(CODE_OFFICE_EXPENSE) ?? firstOfType("expense");
  const payable = byCode.get(CODE_PAYABLE) ?? firstOfType("liability");
  const employeePayable = byCode.get(CODE_EMPLOYEE_PAYABLE) ?? payable;

  const mapping = {
    cgstInput: byCode.get(CODE_CGST),
    sgstInput: byCode.get(CODE_SGST),
    igstInput: byCode.get(CODE_IGST),
    cessInput: byCode.get(CODE_CESS),
    defaultExpense: expenseDefault,
    defaultCharge: byCode.get(CODE_FREIGHT) ?? expenseDefault,
    payable,
    employeePayable,
  };

  const missing: string[] = [];
  if (!mapping.cgstInput) missing.push("Input CGST (1301)");
  if (!mapping.sgstInput) missing.push("Input SGST (1302)");
  if (!mapping.igstInput) missing.push("Input IGST (1303)");
  if (!mapping.cessInput) missing.push("Input Cess (1304)");
  if (!mapping.defaultExpense) missing.push("Office & Administrative Expenses (5100)");
  if (!mapping.payable) missing.push("Sundry Creditors - Office Expenses (2100)");
  if (!mapping.employeePayable) missing.push("Employee Reimbursement Payable (2110)");

  if (missing.length > 0) return { accounts: null, missing };

  return {
    accounts: {
      cgstInput: mapping.cgstInput!.id,
      sgstInput: mapping.sgstInput!.id,
      igstInput: mapping.igstInput!.id,
      cessInput: mapping.cessInput!.id,
      defaultExpense: mapping.defaultExpense!.id,
      defaultCharge: mapping.defaultCharge!.id,
      payable: mapping.payable!.id,
      employeePayable: mapping.employeePayable!.id,
    },
    missing: [],
  };
}

const paise = (value: number | null | undefined) => Math.round(Number(value ?? 0) * 100);

/** Rebuilds the calculated shape from the STORED voucher rows (no re-deriving
 *  GST at posting time — what was saved and approved is what gets posted). */
export function storedVoucherToCalculation(
  voucher: ExpenseVoucherRow,
  items: ExpenseVoucherItemRow[],
  charges: ExpenseVoucherChargeRow[]
): VoucherCalculation {
  const lines: CalculatedLine[] = items.map((item, index) => {
    const tax = paise(item.cgst) + paise(item.sgst) + paise(item.igst) + paise(item.cess);
    return {
      lineNo: item.line_no ?? index + 1,
      description: item.description,
      categoryId: item.category_id,
      ledgerAccountId: item.ledger_account_id,
      qty: item.qty,
      unit: item.unit,
      // Rebuilt from the STORED row only — the size fields are not needed here,
      // the saved quantity already IS the billed area/length/weight.
      unitFamily: expenseUnitFamily(item.unit),
      baseQty:
        item.base_qty != null
          ? Number(item.base_qty)
          : item.qty != null && normalizeExpenseUnit(item.unit)
            ? toBaseExpenseQuantity(Number(item.qty), normalizeExpenseUnit(item.unit)!)
            : null,
      baseUnit: item.base_unit ?? expenseBaseUnit(expenseUnitFamily(item.unit)),
      derivedFromSize: false,
      pieceArea: null,
      rate: item.rate,
      gstRate: Number(item.gst_rate ?? 0),
      gstInclusive: item.gst_inclusive,
      gstApplicable: item.is_gst_applicable,
      itcEligible: item.itc_eligible,
      costCentre: item.cost_centre,
      remarks: item.remarks,
      grossPaise: paise(item.gross_amount),
      discountPaise: paise(item.discount),
      taxablePaise: paise(item.taxable_value),
      cgstPaise: paise(item.cgst),
      sgstPaise: paise(item.sgst),
      igstPaise: paise(item.igst),
      cessPaise: paise(item.cess),
      nonGstPaise: paise(item.non_gst_amount),
      itcPaise: item.itc_eligible ? tax : 0,
      totalPaise: paise(item.total_amount),
    };
  });

  const calculatedCharges: CalculatedCharge[] = charges.map((charge) => {
    const tax = paise(charge.cgst) + paise(charge.sgst) + paise(charge.igst);
    return {
      chargeName: charge.charge_name,
      ledgerAccountId: charge.ledger_account_id,
      allocationMethod: (charge.allocation_method as CalculatedCharge["allocationMethod"]) ?? "value",
      isTaxable: charge.is_taxable,
      itcEligible: charge.itc_eligible,
      amountPaise: paise(charge.amount),
      gstRate: Number(charge.gst_rate ?? 0),
      cgstPaise: paise(charge.cgst),
      sgstPaise: paise(charge.sgst),
      igstPaise: paise(charge.igst),
      itcPaise: charge.itc_eligible ? tax : 0,
      totalPaise: paise(charge.total_amount),
    };
  });

  const cgstPaise = paise(voucher.cgst_total);
  const sgstPaise = paise(voucher.sgst_total);
  const igstPaise = paise(voucher.igst_total);
  const cessPaise = paise(voucher.cess_total);
  const roundOffPaise = paise(voucher.round_off);
  const grandTotalPaise = paise(voucher.grand_total);

  return {
    valid: true,
    errors: [],
    lines,
    charges: calculatedCharges,
    totals: {
      grossPaise: paise(voucher.gross_total),
      discountPaise: paise(voucher.discount_total),
      taxablePaise: paise(voucher.taxable_total),
      cgstPaise,
      sgstPaise,
      igstPaise,
      cessPaise,
      taxPaise: cgstPaise + sgstPaise + igstPaise + cessPaise,
      chargesPaise: paise(voucher.charges_total),
      nonGstPaise: paise(voucher.non_gst_total),
      itcPaise: paise(voucher.itc_total),
      exactTotalPaise: grandTotalPaise - roundOffPaise,
      roundOffPaise,
      grandTotalPaise,
    },
  };
}

export type PostResult = { error: string | null; entries?: number; totalPaise?: number };

/**
 * Posts one voucher inside the database function's transaction. Never throws:
 * a posting failure is returned so the caller can show it (the voucher stays
 * approved and can be retried).
 */
export async function postVoucherById(
  supabase: Client,
  employeeId: string,
  voucher: ExpenseVoucherRow,
  items: ExpenseVoucherItemRow[],
  charges: ExpenseVoucherChargeRow[],
  accounts: FinAccountRow[]
): Promise<PostResult> {
  const mapping = resolveJournalAccounts(accounts);
  if (!mapping.accounts) {
    return {
      error: `The chart of accounts is incomplete (${mapping.missing.join(", ")}). Open Accounts Setup → Create default accounts, then post again.`,
    };
  }

  const calculation = storedVoucherToCalculation(voucher, items, charges);
  const paid = voucher.payment_status === "paid";
  const journal = buildExpenseJournalLines({
    calculation,
    accounts: mapping.accounts,
    paymentAccountId: voucher.payment_account_id,
    paid,
    employeePayable: voucher.expense_type === "Employee Reimbursement",
  });

  if (!journal.balanced || journal.errors.length > 0) {
    return { error: `The voucher cannot be posted: ${journal.errors.join(" ")}` };
  }

  const { data, error } = await supabase.rpc("fin_post_expense_voucher", {
    p_voucher_id: voucher.id,
    p_employee_id: employeeId,
    p_lines: toPostingPayload(journal.lines) as unknown as never,
  });

  if (error) return { error: error.message };

  // A voucher whose money already left is "paid" as well as posted.
  if (paid) {
    await supabase
      .from("expense_vouchers")
      .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", voucher.id);
  }

  const result = (data ?? {}) as { entries?: number; total?: number };
  return { error: null, entries: result.entries, totalPaise: Math.round(Number(result.total ?? 0) * 100) };
}
