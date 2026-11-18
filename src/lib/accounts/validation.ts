// 2026-11-18b — VALIDATION RULES for the Purchase & Accounts module.
//
// Pure and shared: the entry form uses them for inline errors, the Server
// Action uses the same functions before writing anything. No rule exists twice.
//
// The payment-mode → account-kind table is the UPI rule from the master prompt
// in code: UPI is a MODE, but the money must leave a real bank account, so a
// UPI voucher whose payment account is the cash box is rejected.

export const EXPENSE_TYPES = [
  "Office Expense",
  "Cash Expense",
  "Petty Cash Expense",
  "Employee Reimbursement",
  "Advance Settlement",
  "Recurring Expense",
  "Emergency Expense",
] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const PAYMENT_MODES = [
  "Cash",
  "Bank Transfer",
  "UPI",
  "NEFT",
  "RTGS",
  "IMPS",
  "Cheque",
  "Credit Card",
  "Other",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const VOUCHER_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "posted",
  "paid",
  "cancelled",
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/** Indian states / UTs — the place-of-supply list (GST). */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export const GST_RATES = [0, 0.25, 1, 1.5, 2.5, 3, 5, 6, 9, 12, 18, 28] as const;

/** GSTIN: 2-digit state code, PAN, entity no., 'Z', checksum. */
export function isValidGstin(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.trim().toUpperCase());
}

export function gstinStateCode(value: string | null | undefined): string | null {
  if (!isValidGstin(value)) return null;
  return String(value).trim().slice(0, 2);
}

export type InterstateInput = {
  homeState?: string | null;
  vendorState?: string | null;
  placeOfSupply?: string | null;
  /** Explicit override — a bill can be IGST even when the states look equal. */
  override?: boolean | null;
};

/**
 * Same state → CGST + SGST, different state → IGST. When the home state is not
 * configured the voucher is treated as INTRASTATE only if vendor state matches
 * place of supply; otherwise interstate is the safe default (IGST is never
 * wrong for a cross-border supply, a wrong CGST/SGST split is).
 */
export function resolveInterstate(input: InterstateInput): boolean {
  if (input.override === true) return true;
  const supply = (input.placeOfSupply ?? "").trim();
  const vendor = (input.vendorState ?? "").trim();
  const home = (input.homeState ?? "").trim();
  const destination = supply || vendor;
  if (!destination) return Boolean(input.override);
  if (!home) return false;
  return destination.toLowerCase() !== home.toLowerCase();
}

export type PaymentAccountInfo = {
  id: string;
  name: string;
  isCash: boolean;
  isBank: boolean;
  isPettyCash: boolean;
  isCreditCard: boolean;
  active?: boolean;
};

export type RequiredAccountKind = "cash" | "bank" | "petty" | "card" | "any";

/** Which kind of account a payment mode is allowed to touch. */
export function requiredAccountKind(mode: PaymentMode | string): RequiredAccountKind {
  switch (mode) {
    case "Cash":
      return "cash";
    case "UPI":
    case "Bank Transfer":
    case "NEFT":
    case "RTGS":
    case "IMPS":
    case "Cheque":
      return "bank";
    case "Credit Card":
      return "card";
    default:
      return "any";
  }
}

export function accountMatchesKind(
  account: PaymentAccountInfo | null | undefined,
  kind: RequiredAccountKind
): boolean {
  if (!account) return false;
  switch (kind) {
    case "cash":
      return account.isCash || account.isPettyCash;
    case "bank":
      return account.isBank;
    case "petty":
      return account.isPettyCash;
    case "card":
      return account.isCreditCard;
    default:
      return account.isCash || account.isBank || account.isPettyCash || account.isCreditCard;
  }
}

export type VoucherHeaderInput = {
  expenseType: string;
  paymentMode: string;
  voucherDate: string;
  invoiceDate?: string | null;
  gstin?: string | null;
  vendorState?: string | null;
  placeOfSupply?: string | null;
  paid: boolean;
  paymentAccountId?: string | null;
  paymentAccount?: PaymentAccountInfo | null;
  paymentReference?: string | null;
  upiReference?: string | null;
};

export type HeaderValidation = {
  valid: boolean;
  errors: string[];
  requiredKind: RequiredAccountKind;
};

export function validateVoucherHeader(input: VoucherHeaderInput): HeaderValidation {
  const errors: string[] = [];
  const requiredKind = requiredAccountKind(input.paymentMode);

  if (!EXPENSE_TYPES.includes(input.expenseType as ExpenseType)) {
    errors.push(`Unknown expense type "${input.expenseType}".`);
  }
  if (!PAYMENT_MODES.includes(input.paymentMode as PaymentMode)) {
    errors.push(`Unknown payment mode "${input.paymentMode}".`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.voucherDate)) {
    errors.push("Voucher date is required.");
  }
  if (input.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) {
    errors.push("Invoice date must be a real date.");
  }
  if (input.gstin && !isValidGstin(input.gstin)) {
    errors.push("That GSTIN is not valid (15 characters, e.g. 07ABCDE1234F1Z5).");
  }
  if (input.paymentMode === "UPI" && !input.upiReference?.trim() && !input.paymentReference?.trim()) {
    errors.push("A UPI payment needs its UTR / transaction reference.");
  }
  if (input.paid) {
    if (!input.paymentAccountId) {
      errors.push("Select the cash / bank account the money left from.");
    } else if (input.paymentAccount && !accountMatchesKind(input.paymentAccount, requiredKind)) {
      const label =
        requiredKind === "bank" ? "a bank account" : requiredKind === "cash" ? "a cash account" : `a ${requiredKind} account`;
      errors.push(`${input.paymentMode} must be paid from ${label}, not "${input.paymentAccount.name}".`);
    } else if (input.paymentAccount && input.paymentAccount.active === false) {
      errors.push(`"${input.paymentAccount.name}" is inactive — pick an active account.`);
    }
  }
  if (input.expenseType === "Petty Cash Expense" && input.paid && input.paymentAccount && !input.paymentAccount.isPettyCash) {
    errors.push("A Petty Cash expense must be paid from a petty cash account.");
  }
  if (input.expenseType === "Employee Reimbursement" && !input.paid) {
    // allowed: the claim creates a payable
  }

  return { valid: errors.length === 0, errors, requiredKind };
}

/** Status transitions the module allows (server-side guard, not just UI). */
export const ALLOWED_TRANSITIONS: Record<VoucherStatus, VoucherStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "draft"],
  approved: ["posted", "paid", "rejected"],
  rejected: ["draft"],
  posted: ["paid", "cancelled"],
  paid: ["cancelled"],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from as VoucherStatus];
  return Boolean(allowed?.includes(to as VoucherStatus));
}

/** A posted voucher may only be corrected by reversal, never edited. */
export function isImmutable(status: string): boolean {
  return status === "posted" || status === "paid" || status === "cancelled";
}
