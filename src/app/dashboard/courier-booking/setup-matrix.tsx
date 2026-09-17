"use client";

// Setup Matrix (2026-09-17 — "company ke hisab se courier integration
// easy kiya ja sakta hai"): one glance at ALL companies × ALL couriers —
// which are set up, which aren't, and whether the shipper profile exists.
// Read-only on purpose: editing stays in the per-company Account Setup
// cards (and the company dropdown switches which company you're editing
// as) — this grid answers "kya set up hai kya nahi" without clicking
// through every company. Data comes pre-computed from the page via
// getSetupMatrixStatuses() — booleans only, never secret values.
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";

export type MatrixCompany = {
  id: string;
  name: string;
  isCurrent: boolean;
  statuses: Record<CourierKey, { configured: boolean; configuredInDb: boolean; hasAccountNumber: boolean; hasShipperProfile: boolean }>;
};

export function SetupMatrix({ companies }: { companies: MatrixCompany[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">Setup Matrix — all companies × all couriers</h2>
      <p className="mt-1 text-xs text-slate-500">
        Who&apos;s ready to book with whom, at a glance. ✓ Saved here = that company&apos;s own credentials are saved in Account
        Setup (switch the company in the header dropdown to edit its values). 🏠 = ship-from profile saved. Empty = not set up
        yet — bookings for that courier fall back to the shared deployment key (env var) or fail.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-500">Company</th>
              {COURIERS.map((c) => (
                <th key={c.key} className="border-b border-slate-200 px-3 py-2 text-center text-xs font-medium text-slate-500">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}>
                <td className="border-b border-slate-100 px-3 py-2">
                  <span className="font-medium text-slate-800">{company.name}</span>
                  {company.isCurrent && (
                    <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">editing now</span>
                  )}
                </td>
                {COURIERS.map((c) => {
                  const s = company.statuses[c.key];
                  return (
                    <td key={c.key} className="border-b border-slate-100 px-3 py-2 text-center">
                      {s.configured ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.configuredInDb ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}
                          title={
                            s.configuredInDb
                              ? "This company's own API credentials are saved in Account Setup"
                              : "Riding on the shared deployment env-var key — save the company's own credentials in Account Setup to isolate it"
                          }
                        >
                          ✓ {s.configuredInDb ? "Saved" : "env"}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                      {s.hasAccountNumber && (
                        <span className="ml-1 text-xs text-slate-500" title="Account number saved (auto-fills on booking)">
                          #
                        </span>
                      )}
                      {s.hasShipperProfile && (
                        <span className="ml-1 text-xs" title="Ship-from profile saved">
                          🏠
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        ✓ Saved = company&apos;s own key · ✓ env = shared env-var key · # = account number saved · 🏠 = ship-from profile saved
      </p>
    </div>
  );
}
