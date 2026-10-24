"use client";

// 2026-10-24 — the Courier Ops "Charges" tab.
//
// Why it exists: there was no place to ADD a courier charge that isn't one of
// the four fixed bill columns — and no place at all before a freight bill
// existed. Here you search the shipment by PO / RF / RG / marketplace order
// no. / AWB / invoice no., pick the exact AWB, and record each charge with
// the courier's own charge head (base freight, fuel, remote area, customs
// clearance, duty, RTO, … — see src/lib/couriers/charge-heads.ts). The same
// form covers a PO coming BACK to India: direction = "Return to India", so an
// inbound return's freight / customs / duty stay separate from the export
// cost of that PO.
//
// Existing charges are listed grouped per shipment (PO + AWB + direction)
// with running totals, so "iski shipping me total kitna laga" is one glance
// instead of a spreadsheet.
import { useActionState, useMemo, useState, useTransition } from "react";
import { addShipmentCharge, deleteShipmentCharge, searchShipmentTargets, type ChargeActionResult, type ChargeTarget } from "./shipping-charges-actions";
import { CHARGE_DIRECTIONS, SHIPPING_CHARGE_HEADS, chargeHeadLabel, chargeDirectionLabel } from "@/lib/couriers/charge-heads";
import type { ShippingChargeData } from "./shipping-charges-data";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const COURIER_OPTIONS = ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"];

const initialState: ChargeActionResult = { error: null, success: false };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ShippingCharges({ data }: { data: ShippingChargeData }) {
  const [state, formAction, pending] = useActionState(addShipmentCharge, initialState);

  // Search → select the shipment.
  const [search, setSearch] = useState("");
  const [targets, setTargets] = useState<ChargeTarget[]>([]);
  const [searching, startSearch] = useTransition();
  const [selected, setSelected] = useState<ChargeTarget | null>(null);

  // Charge form fields we control (charge head drives the GST default).
  const [headKey, setHeadKey] = useState(SHIPPING_CHARGE_HEADS[0].key);
  const [gstPct, setGstPct] = useState(String(SHIPPING_CHARGE_HEADS[0].gstPct));
  const [courier, setCourier] = useState("FedEx");
  const [direction, setDirection] = useState<string>("export");

  // Existing-charges filters.
  const [listQuery, setListQuery] = useState("");
  const [dirFilter, setDirFilter] = useState("all");

  const head = SHIPPING_CHARGE_HEADS.find((h) => h.key === headKey) ?? SHIPPING_CHARGE_HEADS[0];

  function runSearch() {
    const q = search.trim();
    if (q.length < 2) {
      setTargets([]);
      return;
    }
    startSearch(async () => {
      const found = await searchShipmentTargets(q);
      setTargets(found);
      // One match = pick it straight away; nobody wants a second click.
      if (found.length === 1) pick(found[0]);
    });
  }

  function pick(t: ChargeTarget) {
    setSelected(t);
    if (t.courier) {
      const match = COURIER_OPTIONS.find((c) => c.toLowerCase() === (t.courier ?? "").toLowerCase());
      if (match) setCourier(match);
    }
    setTargets([]);
    setSearch(t.awbNo ?? t.refNo);
  }

  function onHeadChange(key: string) {
    setHeadKey(key);
    const h = SHIPPING_CHARGE_HEADS.find((x) => x.key === key);
    if (h) setGstPct(String(h.gstPct));
  }

  const visibleGroups = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return data.groups
      .filter((g) => (dirFilter === "all" ? true : g.direction === dirFilter))
      .filter((g) =>
        q
          ? g.refNo.toLowerCase().includes(q) ||
            (g.awbNo ?? "").toLowerCase().includes(q) ||
            g.lines.some((l) => (l.billNo ?? "").toLowerCase().includes(q) || chargeHeadLabel(l.chargeHead).toLowerCase().includes(q))
          : true
      );
  }, [data.groups, dirFilter, listQuery]);

  const totals = useMemo(() => {
    let amount = 0;
    let gst = 0;
    let total = 0;
    let exportTotal = 0;
    let returnTotal = 0;
    for (const g of visibleGroups) {
      amount += g.amount;
      gst += g.gst;
      total += g.total;
      if (g.direction === "return_to_india") returnTotal += g.total;
      else exportTotal += g.total;
    }
    return { amount, gst, total, exportTotal, returnTotal };
  }, [visibleGroups]);

  if (!data.available) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">Charge ledger not set up yet</p>
        <p className="mt-1">
          Run <code className="rounded bg-white px-1 py-0.5 text-xs">db/2026-10-24-shipment-charge-lines.sql</code> in the
          Supabase SQL editor once. Until then courier charges can only be recorded on a freight bill&apos;s fixed
          Base / Fuel / Remote / Other columns.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Could not load saved charges: {data.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Export charges</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">₹{money(totals.exportTotal)}</p>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-xs font-medium text-indigo-700">Return-to-India charges</p>
          <p className="mt-1 text-lg font-semibold text-indigo-900">₹{money(totals.returnTotal)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">GST on these charges</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">₹{money(totals.gst)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Total courier cost</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">₹{money(totals.total)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ---------- Add a charge ---------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Add a courier charge</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Search by PO / RF / RG no., marketplace order no., AWB or invoice no.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="PO-A570 · 780123456789 · INV-2026-014"
              className={inputClass}
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {searching ? "Searching…" : "Find"}
            </button>
          </div>

          {targets.length > 0 && (
            <ul className="mt-2 max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {targets.map((t) => (
                <li key={`${t.orderId}-${t.orderShipmentId ?? "no-awb"}`}>
                  <button
                    type="button"
                    onClick={() => pick(t)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-amber-50"
                  >
                    <span>
                      <span className="font-semibold text-slate-900">{t.refNo}</span>
                      <span className="ml-2 font-mono text-slate-500">{t.awbNo ?? "no AWB yet"}</span>
                      {t.country && <span className="ml-2 text-slate-400">{t.country}</span>}
                    </span>
                    <span className="shrink-0 text-slate-400">{t.courier ?? "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {targets.length === 0 && search.trim().length >= 2 && !searching && selected == null && (
            <p className="mt-2 text-xs text-slate-400">No shipment matched that number.</p>
          )}

          {selected && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Selected: <strong>{selected.refNo}</strong>
              {selected.awbNo ? ` · AWB ${selected.awbNo}` : " · no AWB (charge will sit on the order)"}
              <button type="button" onClick={() => setSelected(null)} className="ml-2 underline">
                change
              </button>
            </div>
          )}

          <form action={formAction} className="mt-3 space-y-3">
            <input type="hidden" name="order_id" value={selected?.orderId ?? ""} />
            <input type="hidden" name="order_shipment_id" value={selected?.orderShipmentId ?? ""} />
            <input type="hidden" name="awb_no" value={selected?.awbNo ?? ""} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="charge_head">
                  Charge head *
                </label>
                <select id="charge_head" name="charge_head" value={headKey} onChange={(e) => onHeadChange(e.target.value)} className={inputClass}>
                  {SHIPPING_CHARGE_HEADS.map((h) => (
                    <option key={h.key} value={h.key}>
                      {h.label}
                      {(h.couriers as string[]).includes(courier) ? "" : " (unusual for this courier)"}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">{head.when}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass} htmlFor="courier_name">
                    Courier
                  </label>
                  <select id="courier_name" name="courier_name" value={courier} onChange={(e) => setCourier(e.target.value)} className={inputClass}>
                    {COURIER_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="direction">
                    Direction
                  </label>
                  <select id="direction" name="direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={inputClass}>
                    {CHARGE_DIRECTIONS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass} htmlFor="amount">
                  Amount (₹) *
                </label>
                <input id="amount" name="amount" type="number" step="0.01" min="0" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="gst_pct">
                  GST %
                </label>
                <input
                  id="gst_pct"
                  name="gst_pct"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={gstPct}
                  onChange={(e) => setGstPct(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="bill_date">
                  Bill date
                </label>
                <input id="bill_date" name="bill_date" type="date" className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="bill_no">
                  Courier bill / invoice no.
                </label>
                <input id="bill_no" name="bill_no" className={inputClass} placeholder="e.g. 276437655" />
              </div>
              <div>
                <label className={labelClass} htmlFor="remark">
                  Remark
                </label>
                <input id="remark" name="remark" className={inputClass} placeholder="optional" />
              </div>
            </div>

            {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
            {state.success && !state.error && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ Charge saved.</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Add charge"}
            </button>
          </form>
        </div>

        {/* ---------- Filters + saved charges ---------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Recorded charges</h2>
            <div className="flex items-center gap-2">
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Filter PO / AWB / bill no."
                className="w-44 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500"
              />
              <select
                value={dirFilter}
                onChange={(e) => setDirFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500"
              >
                <option value="all">All directions</option>
                {CHARGE_DIRECTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto">
            {visibleGroups.map((g) => (
              <div key={g.key} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                  <div className="text-xs">
                    <span className="font-semibold text-slate-900">{g.refNo}</span>
                    <span className="ml-2 font-mono text-slate-500">{g.awbNo ?? "no AWB"}</span>
                    <span className="ml-2 text-slate-500">{g.courier}</span>
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        g.direction === "return_to_india" ? "bg-indigo-100 text-indigo-800" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {chargeDirectionLabel(g.direction)}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900">₹{money(g.total)}</div>
                </div>
                <table className="w-full border-collapse text-left text-xs">
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-slate-700">{chargeHeadLabel(l.chargeHead)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">₹{money(l.amount)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">
                          {l.gstPct}% · ₹{money(l.gst)}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{l.billNo ?? "—"}</td>
                        <td className="px-2 py-1.5 text-slate-400">{l.billDate ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right print:hidden">
                          <form action={deleteShipmentCharge}>
                            <input type="hidden" name="id" value={l.id} />
                            <button
                              type="submit"
                              className="text-[11px] text-red-600 hover:underline"
                              title="Delete this charge line"
                            >
                              Delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {visibleGroups.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                No charges recorded yet. Search a shipment on the left and add the courier&apos;s charge heads.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
