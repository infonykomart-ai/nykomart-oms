"use client";

// 2026-11-21 — the Employees page's strict-store lockout banner, made
// actionable: a login whose role can use Ad Spend but that has no store
// ticked is listed here AND can be fixed right here. Clicking a name opens
// the same EmployeeStoreAccessForm the row's Actions → Store Access panel
// uses, scoped to the stores of the companies that employee can reach, so
// the warning is never just a dead-end message.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmployeeStoreAccessForm } from "./employee-store-access-form";

export type LockedOutEmployee = {
  id: string;
  name: string;
  /** Stores currently ticked for this login. */
  storeIds: string[];
  /** Companies this login can act in (home company + granted companies). */
  companyIds: string[];
};

export function LockoutWarning({
  employees,
  stores,
}: {
  employees: LockedOutEmployee[];
  stores: { id: string; name: string; company_id: string }[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = employees.find((e) => e.id === openId) ?? null;
  const openStores = open ? stores.filter((s) => open.companyIds.includes(s.company_id)) : [];

  if (employees.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none" aria-hidden>
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-amber-900">
            {employees.length} login{employees.length === 1 ? "" : "s"} have Ad Spend access but no store ticked
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            Store Ad Spend now shows each login ONLY the stores ticked for it — never every store of the company. These
            people would see an empty Ad Spend module until a store is ticked. Click a name to assign it right here.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {employees.map((e) => {
              const active = e.id === openId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenId(active ? null : e.id)}
                  aria-expanded={active}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                    active
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  }`}
                  title={active ? "Close the store picker" : `Assign stores for ${e.name}`}
                >
                  {e.name} · {active ? "close" : "assign stores"}
                </button>
              );
            })}
          </div>

          {open && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] text-amber-700">
                Assigning stores for <b>{open.name}</b> — tick at least one store, then Save.
              </p>
              <EmployeeStoreAccessForm
                key={open.id}
                employeeId={open.id}
                stores={openStores}
                currentStoreIds={open.storeIds}
                onDone={() => {
                  setOpenId(null);
                  // Re-run the page so the banner/badge update from the DB.
                  router.refresh();
                }}
              />
            </div>
          )}

          <p className="mt-2 text-[11px] text-amber-700">
            Roles with the complete-report capability (MD/Admin/Finance/Higher Authority) are not affected — they
            already see every store. The same picker is always available under an employee&apos;s Actions → Store Access.
          </p>
        </div>
      </div>
    </div>
  );
}
