// Split out of actions.ts (2026-08-22 hotfix): a "use server" file may only
// export async functions — every other export becomes a callable server
// reference, and a plain array/object export fails hard at runtime ("A
// 'use server' file can only export async functions, found object"). This
// constant needs to be read by both server code (actions.ts, for
// validation) and client components (the two forms below), so it lives in
// its own plain module instead.
export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Fuel",
  "Internet/Phone",
  "Office Supplies",
  "Repairs & Maintenance",
  "Salary/Wages (Cash)",
  "Travel/Conveyance",
  "Bank/Card Charges",
  // 2026-08-20 — added per user request: P&L formula is
  // "sale value - (purchase + freight + duty + washing + store expense)
  // = net amount". Washing (rug/product washing before dispatch) and
  // Store Expense (day-to-day store/office running costs) had no home
  // anywhere in the schema — purchase_bills has zero rows for either,
  // and this internal_expenses table (the obvious fit — company-wide,
  // already subtracted in pl_dashboard_by_company_view/
  // pl_dashboard_by_month_view as total_internal_expenses_inr) was
  // completely empty. User confirmed: log both here going forward: no
  // SQL/view change needed, the P&L views already fold this table in.
  "Washing",
  "Store Expense",
  "Other",
] as const;
