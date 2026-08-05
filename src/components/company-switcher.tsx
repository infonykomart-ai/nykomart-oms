"use client";

import { switchCompanyAction } from "@/lib/auth/switch-company";

/**
 * Header dropdown for logins that work across more than one company (see
 * db/schema.sql's employee_company_access, added 2026-08-05 after the user
 * confirmed staff routinely switch companies from one login). Hidden
 * entirely for single-company logins — nothing to switch between.
 */
export function CompanySwitcher({
  companies,
  currentCompanyId,
}: {
  companies: { id: string; name: string }[];
  currentCompanyId: string;
}) {
  if (companies.length <= 1) return null;

  return (
    <form action={switchCompanyAction}>
      <select
        name="company_id"
        defaultValue={currentCompanyId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-amber-500"
        aria-label="Switch company"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
