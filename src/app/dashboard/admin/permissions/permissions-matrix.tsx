"use client";

import { useState, useTransition } from "react";
import { toggleRoleCapability } from "./actions";

type Role = { id: string; name: string };
type Capability = { code: string; description: string | null };

export function PermissionsMatrix({
  roles,
  capabilities,
  initialGrants,
}: {
  roles: Role[];
  capabilities: Capability[];
  initialGrants: Record<string, boolean>; // key: `${roleId}:${code}`
}) {
  const [grants, setGrants] = useState(initialGrants);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function key(roleId: string, code: string) {
    return `${roleId}:${code}`;
  }

  function toggle(roleId: string, code: string) {
    const k = key(roleId, code);
    const nextGrant = !grants[k];
    setError(null);
    setPendingKey(k);
    // Optimistic — flip immediately, roll back only if the server refuses.
    setGrants((prev) => ({ ...prev, [k]: nextGrant }));
    startTransition(async () => {
      const result = await toggleRoleCapability(roleId, code, nextGrant);
      if (result.error) {
        setGrants((prev) => ({ ...prev, [k]: !nextGrant }));
        setError(result.error);
      }
      setPendingKey(null);
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 min-w-[220px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left">
                Capability
              </th>
              {roles.map((r) => (
                <th key={r.id} className="border-b border-slate-200 px-3 py-3 text-center">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {capabilities.map((cap) => (
              <tr key={cap.code}>
                <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                  <div className="font-medium text-slate-900">{cap.code}</div>
                  {cap.description && <div className="text-xs text-slate-400">{cap.description}</div>}
                </td>
                {roles.map((r) => {
                  const k = key(r.id, cap.code);
                  const checked = !!grants[k];
                  const isPending = pendingKey === k;
                  return (
                    <td key={r.id} className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => toggle(r.id, cap.code)}
                        aria-pressed={checked}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition disabled:opacity-50 ${
                          checked
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-slate-300 bg-white text-transparent hover:border-amber-400"
                        }`}
                      >
                        ✓
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
