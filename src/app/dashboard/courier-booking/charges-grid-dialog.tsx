"use client";

// 2026-10-24 (2) — "CHARGE HEAD DROP DOWN SE AATA HAI IS SE TO HAR BAAR
// DROPDOWN SE KARNA PADEGA NA IS LIYE ISKO ESE KARO NA KI PURA A4 KA DIALOG
// BOX OPEN HO LANDSCAPE ME SABHI HEAD KA APNA COLUMN HO OR SABHI JUD KE AAYE
// GST AUTO CALCULATE HO OR MANUAL BHI HO DOUBLE CHARGE NAHI AAYE".
//
// So: one wide (landscape-reading) dialog, one SHIPMENT PER ROW, one CHARGE
// HEAD PER COLUMN. Type the courier invoice straight across — base freight /
// fuel / remote / pickup / … / Other — and every row shows its own amount,
// GST and total while the footer adds the whole invoice up.
//
// GST: each column has its own % in the header (default from the head's own
// rate — 18% service charges, 0% for duty/import tax), and it stays editable:
// change the header and every row's GST for that head recalculates. Nothing
// is hard-coded, so a different rate on one invoice is a header edit, not a
// code change.
//
// Duplicate safety: cells that ALREADY have a saved line for that shipment +
// direction + head are pre-filled from the ledger and marked with a dot, and
// the server action updates that line instead of inserting a second one — so
// re-saving the same grid can never double-count a charge.
import { useMemo, useState, useTransition } from "react";
import { A4Dialog } from "@/components/a4-dialog";
import {
  CHARGE_GRID_HEADS,
  CHARGE_GRID_OTHER_HEAD,
  CHARGE_DIRECTIONS,
  chargeHeadShortLabel,
  chargeDirectionLabel,
} from "@/lib/couriers/charge-heads";
import { saveShipmentChargeGrid, searchShipmentTargets, type ChargeGridRow, type ChargeTarget } from "./shipping-charges-actions";
import type { ShippingChargeData } from "./shipping-charges-data";

const COURIER_OPTIONS = ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"];

const GRID_HEADS = [...CHARGE_GRID_HEADS, CHARGE_GRID_OTHER_HEAD];

type Row = {
  key: string;
  orderId: string;
  refNo: string;
  orderShipmentId: string | null;
  awbNo: string | null;
  courier: string;
  direction: string;
  amounts: Record<string, string>;
  /** Heads that already have a saved line — shown with a dot, updated on save. */
  savedHeads: string[];
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountOf = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function ChargesGridDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: ShippingChargeData;
}) {
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<ChargeTarget[]>([]);
  const [searching, startSearch] = useTransition();
  const [rows, setRows] = useState<Row[]>([]);
  const [gstByHead, setGstByHead] = useState<Record<string, string>>(() =>
    Object.fromEntries(GRID_HEADS.map((h) => [h.key, String(h.gstPct)]))
  );
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [saving, startSave] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  /** Existing ledger lines for this shipment, as a head → amount map. */
  function prefillFor(t: ChargeTarget): { amounts: Record<string, string>; savedHeads: string[] } {
    const key = `${t.orderId}::${t.awbNo ?? "no-awb"}::export`;
    const group = data.groups.find((g) => g.key === key) ?? data.groups.find((g) => g.orderId === t.orderId && g.awbNo === t.awbNo);
    const amounts: Record<string, string> = {};
    const savedHeads: string[] = [];
    for (const l of group?.lines ?? []) {
      amounts[l.chargeHead] = String(l.amount);
      savedHeads.push(l.chargeHead);
    }
    return { amounts, savedHeads };
  }

  function addRow(t: ChargeTarget) {
    const rowKey = `${t.orderId}::${t.awbNo ?? "no-awb"}::export`;
    if (rows.some((r) => r.key === rowKey)) return;
    const { amounts, savedHeads } = prefillFor(t);
    setRows((prev) => [
      ...prev,
      {
        key: rowKey,
        orderId: t.orderId,
        refNo: t.refNo,
        orderShipmentId: t.orderShipmentId,
        awbNo: t.awbNo,
        courier: t.courier ?? "FedEx",
        direction: "export",
        amounts,
        savedHeads,
      },
    ]);
    setTargets([]);
    setQuery("");
  }

  /** Add every shipment of the currently-recorded list, charges pre-filled. */
  function addAllFromLedger() {
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.key));
      const next = [...prev];
      for (const g of data.groups) {
        if (g.direction !== "export") continue;
        if (seen.has(g.key)) continue;
        const amounts: Record<string, string> = {};
        const savedHeads: string[] = [];
        for (const l of g.lines) {
          amounts[l.chargeHead] = String(l.amount);
          savedHeads.push(l.chargeHead);
        }
        next.push({
          key: g.key,
          orderId: g.orderId,
          refNo: g.refNo,
          orderShipmentId: null,
          awbNo: g.awbNo,
          courier: g.courier,
          direction: g.direction,
          amounts,
          savedHeads,
        });
      }
      return next;
    });
  }

  function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      setTargets([]);
      return;
    }
    startSearch(async () => {
      const found = await searchShipmentTargets(q);
      setTargets(found);
      if (found.length === 1) addRow(found[0]);
    });
  }

  function setCell(rowKey: string, head: string, value: string) {
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, amounts: { ...r.amounts, [head]: value } } : r)));
  }

  const totals = useMemo(() => {
    let amount = 0;
    let gst = 0;
    for (const r of rows) {
      for (const h of GRID_HEADS) {
        const a = amountOf(r.amounts[h.key]);
        if (a === 0) continue;
        const pct = Number(gstByHead[h.key] ?? "0");
        amount += a;
        gst += (a * (Number.isFinite(pct) ? pct : 0)) / 100;
      }
    }
    return { amount, gst, total: amount + gst };
  }, [rows, gstByHead]);

  function save() {
    setMessage(null);
    const payload: ChargeGridRow[] = rows
      .map((r) => ({
        orderId: r.orderId,
        orderShipmentId: r.orderShipmentId,
        awbNo: r.awbNo,
        courier: r.courier,
        direction: r.direction,
        billNo: billNo.trim() || null,
        billDate: billDate || null,
        lines: GRID_HEADS.filter((h) => amountOf(r.amounts[h.key]) > 0).map((h) => ({
          chargeHead: h.key,
          amount: amountOf(r.amounts[h.key]),
          gstPct: Number(gstByHead[h.key] ?? "0") || 0,
        })),
      }))
      .filter((r) => r.lines.length > 0);

    if (payload.length === 0) {
      setMessage({ tone: "err", text: "Enter at least one charge amount first." });
      return;
    }
    startSave(async () => {
      const res = await saveShipmentChargeGrid(payload);
      if (res.error) setMessage({ tone: "err", text: res.error });
      else
        setMessage({
          tone: "ok",
          text: `Saved — ${res.inserted} new line${res.inserted === 1 ? "" : "s"}${res.updated ? `, ${res.updated} existing updated (no duplicates)` : ""}.`,
        });
    });
  }

  return (
    <A4Dialog
      open={open}
      onClose={onClose}
      wide
      title="Charge grid — all heads at once"
      subtitle="One shipment per row, one charge head per column. Landscape sheet: scroll sideways if your screen is narrow."
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            Amount ₹{money(totals.amount)} · GST ₹{money(totals.gst)} ·{" "}
            <span className="font-semibold text-slate-900">Total ₹{money(totals.total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              Close
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : `Save ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-[11px] font-medium text-slate-500">Add shipment — PO / RF / RG no., order no., AWB or invoice no.</label>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runSearch();
                  }
                }}
                placeholder="PO-A570 · 780123456789 · INV-2026-014"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={searching}
                className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {searching ? "…" : "Find"}
              </button>
              <button
                type="button"
                onClick={addAllFromLedger}
                title="Add every shipment that already has recorded charges, with those charges filled in"
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                + Recorded
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">Courier bill no. (applies to these rows)</label>
            <input
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              className="w-36 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-500"
              placeholder="276437655"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">Bill date</label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {targets.length > 0 && (
          <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {targets.map((t) => (
              <li key={`${t.orderId}-${t.orderShipmentId ?? "no-awb"}`}>
                <button
                  type="button"
                  onClick={() => addRow(t)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-amber-50"
                >
                  <span>
                    <span className="font-semibold text-slate-900">{t.refNo}</span>
                    <span className="ml-2 font-mono text-slate-500">{t.awbNo ?? "no AWB"}</span>
                    {/* 2026-10-26 — the forwarder's own number (aggregator
                        couriers carry a second ref beside the AWB). */}
                    {t.forwardingNo && <span className="ml-2 font-mono text-slate-400">Fwd {t.forwardingNo}</span>}
                    {t.country && <span className="ml-2 text-slate-400">{t.country}</span>}
                  </span>
                  <span className="shrink-0 text-slate-400">{t.courier ?? "—"} · add</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left" style={{ minWidth: `${420 + GRID_HEADS.length * 92}px` }}>
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <th className="px-2 py-1.5">PO / AWB</th>
                <th className="px-2 py-1.5">Courier</th>
                <th className="px-2 py-1.5">Direction</th>
                {GRID_HEADS.map((h) => (
                  <th key={h.key} className="px-1 py-1.5 text-right align-bottom">
                    <div className="whitespace-nowrap text-[10px] normal-case text-slate-600" title={`${h.label} — ${h.when}`}>
                      {chargeHeadShortLabel(h.key)}
                    </div>
                    <div className="mt-0.5 flex items-center justify-end gap-0.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={gstByHead[h.key] ?? "0"}
                        onChange={(e) => setGstByHead((prev) => ({ ...prev, [h.key]: e.target.value }))}
                        className="w-12 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[10px] outline-none focus:border-amber-500"
                        title={`GST % for ${chargeHeadShortLabel(h.key)}`}
                      />
                      <span className="text-[9px] text-slate-400">%</span>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right">Amount</th>
                <th className="px-2 py-1.5 text-right">GST</th>
                <th className="px-2 py-1.5 text-right">Total</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                let rowAmount = 0;
                let rowGst = 0;
                for (const h of GRID_HEADS) {
                  const a = amountOf(r.amounts[h.key]);
                  if (a === 0) continue;
                  const pct = Number(gstByHead[h.key] ?? "0");
                  rowAmount += a;
                  rowGst += (a * (Number.isFinite(pct) ? pct : 0)) / 100;
                }
                return (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <div className="font-semibold text-slate-900">{r.refNo}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.awbNo ?? "no AWB"}</div>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={r.courier}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, courier: e.target.value } : x)))
                        }
                        className="w-24 rounded border border-slate-300 bg-white px-1 py-1 text-[11px] outline-none focus:border-amber-500"
                      >
                        {COURIER_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select
                        value={r.direction}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, direction: e.target.value } : x)))
                        }
                        className="w-24 rounded border border-slate-300 bg-white px-1 py-1 text-[11px] outline-none focus:border-amber-500"
                      >
                        {CHARGE_DIRECTIONS.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.key === "export" ? "Export" : "Return"}
                          </option>
                        ))}
                      </select>
                      <div className="mt-0.5 text-[9px] text-slate-400">{chargeDirectionLabel(r.direction).split(" ")[0]}</div>
                    </td>
                    {GRID_HEADS.map((h) => (
                      <td key={h.key} className="px-0.5 py-1">
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={r.amounts[h.key] ?? ""}
                            onChange={(e) => setCell(r.key, h.key, e.target.value)}
                            placeholder="0"
                            className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-right text-[11px] outline-none focus:border-amber-500"
                          />
                          {r.savedHeads.includes(h.key) && (
                            <span
                              className="absolute -left-0.5 top-1 text-[8px] text-emerald-600"
                              title="Already saved — saving again updates this line instead of adding a second one"
                            >
                              ●
                            </span>
                          )}
                        </div>
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums text-slate-700">{rowAmount ? money(rowAmount) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">{rowGst ? money(rowGst) : "—"}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                      {rowAmount + rowGst ? money(rowAmount + rowGst) : "—"}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                        className="text-[11px] text-red-600 hover:underline"
                        title="Remove this row (saved charges stay until edited or deleted below)"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={GRID_HEADS.length + 7} className="px-3 py-6 text-center text-slate-400">
                    Search a PO / AWB above and add it — each head then gets its own column on that row.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-400 text-[11px] font-bold text-slate-900">
                  <td colSpan={3} className="px-2 py-1.5 text-right">
                    TOTAL ({rows.length} shipment{rows.length === 1 ? "" : "s"})
                  </td>
                  {GRID_HEADS.map((h) => {
                    const sum = rows.reduce((s, r) => s + amountOf(r.amounts[h.key]), 0);
                    return (
                      <td key={h.key} className="px-1 py-1.5 text-right tabular-nums">
                        {sum ? money(sum) : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(totals.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(totals.gst)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="text-[11px] text-slate-500">
          ● = this head is already saved for that shipment; saving the grid again updates that line (amount + GST), it never adds a
          second one. Blank / zero cells are skipped.
        </p>

        {message && (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}
          >
            {message.tone === "ok" ? "✓ " : ""}
            {message.text}
          </p>
        )}
      </div>
    </A4Dialog>
  );
}
