// 2026-11-21 — Store Ad Spend access follows ORDER-ENTRY access.
//
// Order Entry is company-scoped: the New Order form lists every active store
// of the company the login is acting as (orders/new/page.tsx), and the order
// list / bulk upload cover every company in employee.companyIds. So the stores
// a login can enter orders for are exactly the stores of its accessible
// companies. Ad Spend used to scope ONLY on the separate employee_store_access
// list, so a login that could enter orders for a company still saw nothing (or
// just a subset) on all three Ad Spend tabs until someone ticked stores under
// Employees → Store Access as well.
//
// Rules, kept in one place so the Daily Entry, Report and Daily Order Sheet
// tabs and both write actions can never disagree:
//   • ad_spend_report_all → every store of every accessible company (the
//     admin/MD/Finance approval that shows the complete report).
//   • otherwise           → every store of the accessible companies, NARROWED
//     to the explicit Store Access assignment when one exists. An empty
//     assignment is "no restriction" (order-entry access), never "see
//     nothing" — an admin who really wants to restrict a login ticks the
//     stores it may use.
// A store outside the login's companies is never returned, with or without the
// approval capability: the company boundary is the hard privacy line, so
// nobody can ever reach another company's store data from here.
export type AdSpendStore = { id: string; company_id: string };

export type AdSpendStoreScope = {
  /** Companies the login can enter orders for (employee.companyIds). */
  companyIds: string[];
  /** Explicit Employee → Store Access assignment (may be empty). */
  assignedStoreIds: string[];
  /** True for the approved complete-report capability. */
  canSeeAllStores: boolean;
};

/** The stores this login may see and work on across all three Ad Spend tabs. */
export function storesForAdSpend<T extends AdSpendStore>(allStores: T[], scope: AdSpendStoreScope): T[] {
  const inCompanies = allStores.filter((s) => scope.companyIds.includes(s.company_id));
  if (scope.canSeeAllStores || scope.assignedStoreIds.length === 0) return inCompanies;
  const assigned = new Set(scope.assignedStoreIds);
  return inCompanies.filter((s) => assigned.has(s.id));
}

/** Server-side re-check for a single store (entry save / entry delete). */
export function canWorkOnAdSpendStore(store: AdSpendStore, scope: AdSpendStoreScope): boolean {
  if (!scope.companyIds.includes(store.company_id)) return false;
  if (scope.canSeeAllStores || scope.assignedStoreIds.length === 0) return true;
  return scope.assignedStoreIds.includes(store.id);
}
