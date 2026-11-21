// 2026-11-21 — Store Ad Spend access is STRICT store access.
//
// "JISKE PASS JO STORE HO VAHI DIKHE SARE STORE NAHI JISKO JO ACCES HAI SIRF
// VAHI." — a login sees the store(s) it has actually been given, never every
// store of its company. That is the Employees → Store Access assignment
// (employee_store_access), and it is now the only source of store access
// here: the company list still bounds what is POSSIBLE (a store outside the
// login's companies can never be returned), but it no longer widens the list
// by itself.
//
// Rules, kept in one place so the Daily Entry, Report and Daily Order Sheet
// tabs and both write actions can never disagree:
//   • ad_spend_report_all → every store of every accessible company (the
//     admin/MD/Finance approval that shows the complete report).
//   • otherwise           → ONLY the stores ticked for this employee under
//     Employees → Store Access (intersected with its companies). An empty
//     assignment means "no store given yet", not "all stores": the page and
//     the entry form say so, and an Admin ticks the stores to grant access.
// A store outside the login's companies is never returned, with or without
// the approval capability: the company boundary is the hard privacy line.
export type AdSpendStore = { id: string; company_id: string };

export type AdSpendStoreScope = {
  /** Companies the login can reach at all (employee.companyIds). */
  companyIds: string[];
  /** Explicit Employee → Store Access assignment — the store-level grant. */
  assignedStoreIds: string[];
  /** True for the approved complete-report capability. */
  canSeeAllStores: boolean;
};

/** The stores this login may see and work on across all three Ad Spend tabs. */
export function storesForAdSpend<T extends AdSpendStore>(allStores: T[], scope: AdSpendStoreScope): T[] {
  const inCompanies = allStores.filter((s) => scope.companyIds.includes(s.company_id));
  if (scope.canSeeAllStores) return inCompanies;
  const assigned = new Set(scope.assignedStoreIds);
  return inCompanies.filter((s) => assigned.has(s.id));
}

/** Server-side re-check for a single store (entry save / entry delete). */
export function canWorkOnAdSpendStore(store: AdSpendStore, scope: AdSpendStoreScope): boolean {
  if (!scope.companyIds.includes(store.company_id)) return false;
  if (scope.canSeeAllStores) return true;
  return scope.assignedStoreIds.includes(store.id);
}
