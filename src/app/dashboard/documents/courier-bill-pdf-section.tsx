"use client";

import { useState, useTransition } from "react";
import {
  parseCourierBillPdfAction,
  commitCourierBillPdfAction,
  type ParsedBillReview,
} from "./courier-bill-pdf-actions";
import { lookupOrderForReconciliation, type ReconciliationLookup } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Row = {
  trackingNo: string;
  courierRefNo: string | null;
  dims: string | null;
  consignee: string | null;
  weightKg: number | null;
  amount: number | null; // duty bills only — Import Duty portion
  otherAmt: number | null; // duty bills only — service/disbursement fee portion
  orderId: string | null;
  orderShipmentId: string | null;
  orderRefNo: string | null;
  alreadyAssigned: boolean;
};

// Courier Bill PDF Upload — auto-extract via src/lib/courier-bills, review
// on screen (with a manual "Fix match" lookup reusing the same PO/RF/RG-or-
// AWB box as the hand-entry tabs), then commit. See courier-bill-pdf-
// actions.ts's header comment for the 2-step design and "MANUAL BHI HOYE".
export function CourierBillPdfSection() {
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, startParse] = useTransition();
  const [meta, setMeta] = useState<Omit<ParsedBillReview, "shipments"> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string>("");

  const [isSaving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<{ docNo: string; assignedCount: number; skippedCount: number } | null>(null);

  function reset() {
    setMeta(null);
    setRows([]);
    setParseError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setFileName("");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    const fd = new FormData();
    fd.set("file", file);
    startParse(async () => {
      const result = await parseCourierBillPdfAction(fd);
      if (result.error || !result.bill) {
        setParseError(result.error ?? "Could not parse this PDF.");
        return;
      }
      const { shipments, ...rest } = result.bill;
      setMeta(rest);
      setRows(
        shipments.map((s) => ({
          trackingNo: s.trackingNo,
          courierRefNo: s.courierRefNo,
          dims: s.dims,
          consignee: s.consignee,
          weightKg: s.weightKg,
          amount: s.dutyAmt,
          otherAmt: s.otherAmt,
          orderId: s.alreadyAssigned ? null : s.orderId,
          orderShipmentId: s.alreadyAssigned ? null : s.orderShipmentId,
          orderRefNo: s.alreadyAssigned ? null : s.orderRefNo,
          alreadyAssigned: s.alreadyAssigned,
        }))
      );
    });
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleSave() {
    if (!meta) return;
    setSaveError(null);
    startSave(async () => {
      const result = await commitCourierBillPdfAction({
        billCategory: meta.billCategory,
        invoiceNo: meta.invoiceNo,
        invoiceDate: meta.invoiceDate,
        freightAmt: meta.freightAmt,
        fuelAmt: meta.fuelAmt,
        otherCharges: meta.otherCharges,
        dutyTaxAmtUsd: null,
        dutyTaxAmtInr: meta.dutyTaxAmtInr,
        gstAmt: meta.gstAmt,
        shipments: rows.map((r) => ({
          trackingNo: r.trackingNo,
          orderId: r.orderId,
          orderShipmentId: r.orderShipmentId,
          weightKg: r.weightKg,
          amount: r.amount,
          otherAmt: r.otherAmt,
        })),
      });
      if (result.error) setSaveError(result.error);
      else if (result.success) setSaveSuccess(result.success);
    });
  }

  const matchedCount = rows.filter((r) => r.orderId).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Upload Courier Bill PDF</h3>
        <p className="mt-1 text-xs text-slate-500">
          Supports UPS Bill of Supply, UPS Tax Invoice (Freight / Disbursement Fee), and FedEx Freight/Tax &amp; Duty &amp; Tax
          Invoices. Shipments are matched to orders by tracking number (AWB) — review and fix any match below before saving.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input type="file" accept="application/pdf" onChange={handleFileChange} className="text-xs" disabled={isParsing} />
          {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          {isParsing && <span className="text-xs text-amber-600">Reading PDF…</span>}
        </div>
        {parseError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{parseError}</p>}
      </div>

      {meta && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {meta.courier} — {meta.billCategory === "freight" ? "Courier Bill (Freight)" : "Duty & Tax Bill"}
            </h3>
            <button type="button" onClick={reset} className="text-xs font-medium text-slate-500 hover:text-slate-700">
              Upload a different file
            </button>
          </div>

          {saveSuccess ? (
            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
              Saved — <strong>{saveSuccess.docNo}</strong>. {saveSuccess.assignedCount} shipment(s) assigned
              {saveSuccess.skippedCount > 0 ? `, ${saveSuccess.skippedCount} skipped (no confirmed match).` : "."} View it under the{" "}
              {meta.billCategory === "freight" ? '"Courier Bill"' : '"Duty & Tax Bill"'} tab.
            </p>
          ) : (
            <>
              {saveError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{saveError}</p>}

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Invoice No.</label>
                  <input
                    className={inputClass}
                    value={meta.invoiceNo}
                    onChange={(e) => setMeta({ ...meta, invoiceNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Invoice Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={meta.invoiceDate ?? ""}
                    onChange={(e) => setMeta({ ...meta, invoiceDate: e.target.value || null })}
                  />
                </div>
                {meta.billCategory === "freight" ? (
                  <>
                    <div>
                      <label className={labelClass}>Freight Amt</label>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={meta.freightAmt ?? ""}
                        onChange={(e) => setMeta({ ...meta, freightAmt: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Other Charges</label>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={meta.otherCharges ?? ""}
                        onChange={(e) => setMeta({ ...meta, otherCharges: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={labelClass}>Duty/Tax Amt (INR)</label>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={meta.dutyTaxAmtInr ?? ""}
                        onChange={(e) => setMeta({ ...meta, dutyTaxAmtInr: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>GST @18% Amt</label>
                      <input
                        type="number"
                        step="0.01"
                        className={inputClass}
                        value={meta.gstAmt ?? ""}
                        onChange={(e) => setMeta({ ...meta, gstAmt: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  </>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-400">
                Bill states Total Amount Due ₹{meta.totalAmountDue ?? "—"} · computed from the fields above: ₹{meta.computedGross ?? "—"}
                {meta.totalAmountDue != null && meta.computedGross != null && Math.abs(meta.totalAmountDue - meta.computedGross) > 1 && (
                  <span className="text-amber-600"> — mismatch, double-check before saving.</span>
                )}
              </p>

              <div className="mt-4 space-y-1.5">
                <p className="text-xs font-medium text-slate-600">
                  {rows.length} shipment(s) found · {matchedCount} matched
                </p>
                {rows.map((row, i) => (
                  <ShipmentRow
                    key={row.trackingNo + i}
                    row={row}
                    billCategory={meta.billCategory}
                    onChange={(patch) => updateRow(i, patch)}
                  />
                ))}
              </div>

              <button
                type="button"
                disabled={isSaving || rows.length === 0}
                onClick={handleSave}
                className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : `Save ${meta.billCategory === "freight" ? "Courier Bill" : "Duty & Tax Bill"}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShipmentRow({
  row,
  billCategory,
  onChange,
}: {
  row: Row;
  billCategory: "freight" | "duty";
  onChange: (patch: Partial<Row>) => void;
}) {
  const [fixing, setFixing] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium text-slate-900">{row.trackingNo}</span>
          {row.courierRefNo && <span className="ml-2 text-slate-400">Ref: {row.courierRefNo}</span>}
          {row.consignee && <span className="ml-2 text-slate-400">· {row.consignee}</span>}
        </div>
        <div>
          {row.orderId ? (
            <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-800">Matched: {row.orderRefNo}</span>
          ) : row.alreadyAssigned ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">⚠ Already billed — skipped</span>
          ) : (
            <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800">Not matched</span>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Weight (kg)</label>
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={row.weightKg ?? ""}
            onChange={(e) => onChange({ weightKg: e.target.value ? Number(e.target.value) : null })}
          />
        </div>
        {billCategory === "duty" && (
          <>
            <div>
              <label className={labelClass}>Duty Amt</label>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={row.amount ?? ""}
                onChange={(e) => onChange({ amount: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <label className={labelClass}>Other Charge</label>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={row.otherAmt ?? ""}
                onChange={(e) => onChange({ otherAmt: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setFixing((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            {fixing ? "Cancel" : row.orderId ? "Change match" : "Find match"}
          </button>
          {row.orderId && !fixing && (
            <button
              type="button"
              onClick={() => onChange({ orderId: null, orderShipmentId: null, orderRefNo: null })}
              className="rounded border border-red-200 bg-white px-2 py-1.5 font-medium text-red-600 hover:bg-red-50"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {fixing && (
        <FixMatchBox
          billKind={billCategory}
          onPicked={(orderId, orderShipmentId, orderRefNo) => {
            onChange({ orderId, orderShipmentId, orderRefNo });
            setFixing(false);
          }}
        />
      )}
    </div>
  );
}

function FixMatchBox({
  billKind,
  onPicked,
}: {
  billKind: "freight" | "duty";
  onPicked: (orderId: string, orderShipmentId: string, orderRefNo: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<ReconciliationLookup | null>(null);
  const [isLooking, startLookup] = useTransition();

  function handleLookup() {
    startLookup(async () => {
      const r = await lookupOrderForReconciliation(query, billKind);
      setLookup(r);
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
      <label className={labelClass}>Find order by PO/RF/RG or AWB No.</label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleLookup())}
          placeholder="e.g. PO-0001 or AWB123456"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={isLooking}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isLooking ? "..." : "Find"}
        </button>
      </div>
      {lookup?.error && <p className="mt-2 text-red-600">{lookup.error}</p>}
      {lookup?.order && (
        <div className="mt-2 flex items-center justify-between rounded bg-slate-50 p-2">
          <span>
            <strong>{lookup.order.ref_no}</strong>
            {lookup.alreadyAssigned && <span className="ml-2 text-amber-600">⚠ Already assigned to a bill</span>}
          </span>
          {!lookup.alreadyAssigned && lookup.orderShipmentId && (
            <button
              type="button"
              onClick={() => onPicked(lookup.order!.id, lookup.orderShipmentId!, lookup.order!.ref_no)}
              className="rounded bg-amber-500 px-2 py-1 font-semibold text-white hover:bg-amber-600"
            >
              Use this order
            </button>
          )}
        </div>
      )}
    </div>
  );
}
