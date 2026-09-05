"use client";

import { useState, useTransition } from "react";
import { setCompanionEnabled } from "./actions";

type EmployeeRow = {
  id: string;
  name: string;
  roleName: string;
  active: boolean;
  photoUrl: string | null;
  companionEnabled: boolean;
};

function initialsOf(name: string): string {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function CompanionAccessClient({ employees }: { employees: EmployeeRow[] }) {
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(
    Object.fromEntries(employees.map((e) => [e.id, e.companionEnabled]))
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(id: string) {
    const next = !enabledMap[id];
    setError(null);
    setPendingId(id);
    // Optimistic — flip immediately, roll back only if the server refuses.
    setEnabledMap((prev) => ({ ...prev, [id]: next }));
    startTransition(async () => {
      const result = await setCompanionEnabled(id, next);
      if (result.error) {
        setEnabledMap((prev) => ({ ...prev, [id]: !next }));
        setError(result.error);
      }
      setPendingId(null);
    });
  }

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <p className="mb-3 text-xs font-medium text-slate-500">
        {enabledCount} of {employees.length} employees enabled
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-200 px-4 py-3 text-left">Employee</th>
              <th className="border-b border-slate-200 px-3 py-3 text-left">Role</th>
              <th className="border-b border-slate-200 px-3 py-3 text-center">AI Companion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((e) => {
              const enabled = !!enabledMap[e.id];
              const isPending = pendingId === e.id;
              return (
                <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {e.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.photoUrl} alt={e.name} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                          {initialsOf(e.name)}
                        </div>
                      )}
                      <span className="font-medium text-slate-900">
                        {e.name}
                        {!e.active && <span className="ml-1.5 text-xs font-normal text-slate-400">(inactive)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{e.roleName}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      disabled={isPending}
                      onClick={() => toggle(e.id)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
                        enabled ? "bg-amber-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
