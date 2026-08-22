"use client";

import { useState, useTransition } from "react";
import {
  calculateFreightEstimate,
  saveFreightEstimate,
  lookupOrderForFreightEstimate,
  type EstimateBreakdown,
  type FreightOrderLookup,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
// One row per (courier, zone) the current company has ANY rate slab for —
// used to build the two cascading dropdowns without a live DB round-trip
// on every keystroke.
type RateOption = { companyId: string; courierName: string; zoneLabel: string };

export function EstimateForm({ companies, rateOptions }: { companies: Company[]; rateOptions: RateOption[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [refNo, setRefNo] = useState("");
  const [orderLookup, setOrderLookup] = useState<FreightOrderLookup | null>(null);
  const [orderId, setOrderId] = useState("");
  const [courierName, setCourierName] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [remark, setRemark] = useState("");
  const [result, setResult] = useState<EstimateBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const companyOptions = rateOptions.filter((r) => r.companyId === companyId);
  const couriers = Array.from(new Set(companyOptions.map((r) => r.courierName))).sort();
  const zones = Array.from(new Set(companyOptions.filter((r) => r.courierName === courierName).map((r) => r.zoneLabel))).sort();

  function handleLookup() {
    startTransition(async () => {
      const r = await lookupOrderForFreightEstimate(refNo);
      setOrderLookup(r);
      setOrderId(r.order?.id ?? "");
      if (r.order?.company_id) setCompanyId(r.order.company_id);
    });
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("company_id", companyId);
    fd.set("order_id", orderId);
    fd.set("courier_name", courierName);
    fd.set("zone_label", zoneLabel);
    fd.set("weight_kg", weightKg);
    fd.set("remark", remark);
    return fd;
  }

  function handleCalculate() {
    setError(null);
    setSavedMsg(null);
    startTransition(async () => {
      const r = await calculateFreightEstimate(buildFormData());
      setResult(r.breakdown);
      setError(r.error);
    });
  }

  function handleSave() {
    setError(null);
    setSavedMsg(null);
    startTransition(async () => {
      const r = await saveFreightEstimate(buildFormData());
      setResult(r.breakdown);
      setError(r.error);
      if (r.saved) setSavedMsg("✓ Estimate saved.");
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Estimate Freight Cost</h2>

        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className={labelClass}>Link to an order by PO/RF/RG No. (optional)</label>
          <div className="flex gap-2">
            <input
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleLookup())}
              placeholder="e.g. PO-0001"
              className={inputClass}
            />
            <button
              type="button"
              onClick={handleLookup}
              disabled={isPending}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Find
            </button>
          </div>
          {orderLookup?.error && <p className="mt-2 text-xs text-red-600">{orderLookup.error}</p>}
          {orderLookup?.order && (
            <p className="mt-2 text-xs text-teal-700">
              ✓ {orderLookup.order.ref_no} — {orderLookup.order.buyer_name_address ?? "—"}
              {orderLookup.order.destination_country ? ` (${orderLookup.order.destination_country})` : ""}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="fe_company">Company *</label>
            <select
              id="fe_company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setCourierName("");
                setZoneLabel("");
              }}
              className={inputClass}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="fe_weight">Weight (kg) *</label>
            <input id="fe_weight" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} type="number" step="0.001" min="0.001" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fe_courier">Courier *</label>
            <select
              id="fe_courier"
              value={courierName}
              onChange={(e) => {
                setCourierName(e.target.value);
                setZoneLabel("");
              }}
              className={inputClass}
            >
              <option value="">Select courier</option>
              {couriers.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="fe_zone">Zone *</label>
            <select id="fe_zone" value={zoneLabel} onChange={(e) => setZoneLabel(e.target.value)} className={inputClass} disabled={!courierName}>
              <option value="">Select zone</option>
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
        </div>
        {couriers.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            No rate slabs entered yet for this company — add some on the Courier Rate Card page first.
          </p>
        )}
        <div className="mt-3">
          <label className={labelClass} htmlFor="fe_remark">Remark</label>
          <input id="fe_remark" value={remark} onChange={(e) => setRemark(e.target.value)} className={inputClass} />
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
        {savedMsg && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{savedMsg}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={isPending}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Calculate
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            Save Estimate
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Breakdown</h2>
        {!result ? (
          <p className="text-xs text-slate-400">Fill in the form and click Calculate to see an estimate.</p>
        ) : (
          <div className="space-y-1.5 text-sm">
            <Row label="Courier" value={`${result.courierName} · ${result.zoneLabel}`} />
            <Row label="Weight" value={`${result.weightKg} kg`} />
            <Row label="Base Rate" value={result.baseRate.toFixed(2)} />
            <Row label="Weight Charge" value={result.weightCharge.toFixed(2)} />
            <Row label="Fuel Surcharge" value={result.fuelSurchargeAmt.toFixed(2)} />
            <Row label="Other Charges" value={result.otherCharges.toFixed(2)} />
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
              <span>Estimated Total</span>
              <span>{result.currency} {result.estimatedTotal.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
