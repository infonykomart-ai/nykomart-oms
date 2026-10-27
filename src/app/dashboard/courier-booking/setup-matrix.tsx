"use client";

// Setup Matrix (2026-09-17 — "company ke hisab se courier integration
// easy kiya ja sakta hai"): one glance at ALL companies × ALL couriers —
// which are set up, which aren't, and whether the shipper profile exists.
// Read-only on purpose: editing stays in the per-company Account Setup
// cards (and the company dropdown switches which company you're editing
// as) — this grid answers "kya set up hai kya nahi" without clicking
// through every company. Data comes pre-computed from the page via
// getSetupMatrixStatuses() — booleans only, never secret values.
//
// 2026-10-21 — "ek button jo teeno companies ke liye 'Test connection' chala
// kar ek grid me bata de ki kaunsi company ready hai (abhi har company ke liye
// alag se click karna padta hai)". The saved-vs-env chip only says
// CONFIGURED; it cannot say whether FedEx will actually accept that key +
// account number pair for that company (the 2026-09-17 production bug was a
// saved-looking pair that failed on the first real booking). So this grid now
// has a "Test all" button that runs the SAME real Rate-API check as each
// company's own Test button — one click, every company, results in the FedEx
// column plus a failure list with the exact FedEx message.
import { useState, useTransition } from "react";
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";
import { testFedexAllCompaniesAction, type FedexMatrixTestState } from "./credentials-actions";

export type MatrixCompany = {
  id: string;
  name: string;
  isCurrent: boolean;
  statuses: Record<CourierKey, { configured: boolean; configuredInDb: boolean; hasAccountNumber: boolean; hasShipperProfile: boolean }>;
};

const EMPTY_TEST_STATE: FedexMatrixTestState = { error: null, testedAt: null, results: [] };

export function SetupMatrix({ companies }: { companies: MatrixCompany[] }) {
  const [test, setTest] = useState<FedexMatrixTestState>(EMPTY_TEST_STATE);
  const [isTesting, startTesting] = useTransition();

  const resultByCompany = new Map(test.results.map((r) => [r.companyId, r]));
  const readyCount = test.results.filter((r) => r.status === "ok").length;

  function runTestAll() {
    const fd = new FormData();
    fd.set("company_ids", companies.map((c) => c.id).join(","));
    startTesting(async () => {
      const state = await testFedexAllCompaniesAction(test, fd);
      setTest(state);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Setup Matrix — all companies × all couriers</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Who&apos;s ready to book with whom, at a glance. ✓ Saved here = that company&apos;s own credentials are saved in Account
            Setup (switch the company in the header dropdown to edit its values). 🏠 = ship-from profile saved. Empty = not set up
            yet — bookings for that courier fall back to the shared deployment key (env var) or fail.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <button
            type="button"
            onClick={runTestAll}
            disabled={isTesting || companies.length === 0}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            title="A real FedEx Rate API call for every company — shows whether the key and account number actually work"
          >
            {isTesting ? "⏳ Testing FedEx…" : `📶 Test FedEx — all ${companies.length} companies`}
          </button>
          {test.testedAt && !isTesting && (
            <p className="mt-1 text-[11px] text-slate-500">
              {readyCount}/{test.results.length} ready ·{" "}
              {new Date(test.testedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      </div>

      {test.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{test.error}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-500">Company</th>
              {COURIERS.map((c) => (
                <th key={c.key} className="border-b border-slate-200 px-3 py-2 text-center text-xs font-medium text-slate-500">
                  {c.label}
                  {c.key === "fedex" && <span className="ml-1 text-[10px] text-sky-600">(tested)</span>}
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
                  const tested = c.key === "fedex" ? resultByCompany.get(company.id) : undefined;
                  return (
                    <td key={c.key} className="border-b border-slate-100 px-3 py-2 text-center">
                      {/* Live test verdict wins over the saved-config chip for
                          FedEx: "saved" was never the question the button
                          answers. The old chip stays visible underneath so the
                          Admin can still see WHERE the key came from. */}
                      {tested && (
                        <span
                          className={`mb-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            tested.status === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                          }`}
                          title={tested.message}
                        >
                          {tested.status === "ok" ? "✓ Ready" : "✗ Not ready"}
                        </span>
                      )}
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
                        !tested && <span className="text-xs text-slate-400">—</span>
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
        ✓ Saved = company&apos;s own key · ✓ env = shared env-var key · # = account number saved · 🏠 = ship-from profile saved · ✓
        Ready / ✗ Not ready = whether FedEx accepted or rejected this company&apos;s key + account number
      </p>

      {test.results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {test.results.map((r) => {
            const name = companies.find((c) => c.id === r.companyId)?.name ?? r.companyId;
            const ok = r.status === "ok";
            return (
              <li
                key={r.companyId}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] ${ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
              >
                <span className="font-semibold">{name}:</span> {ok ? "✓" : "✗"} {r.message}
                {r.keySource && (
                  <span className="ml-1 text-[10px] opacity-70">(key: {r.keySource === "company" ? "company" : "shared env"})</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
