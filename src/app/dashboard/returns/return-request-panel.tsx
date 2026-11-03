"use client";

// 2026-11-03b — returns are approval-gated, refunds are immediate.
//
// Left/upper card: an order-entry employee searches an order and raises a
// return request (optionally asking for a refund with it). NOTHING about the
// order changes at this point.
// Right/lower cards: the MD/Admin queue (only rendered for someone holding
// return_approval) and the requester's own recent requests with their status.
import { useState } from "react";
import { createReturnRequest, decideReturnRequest, searchOrdersForReturn, type ReturnOrderOption } from "./return-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

export type PendingReturnRow = {
  id: string;
  refNo: string;
  buyer: string | null;
  reason: string;
  note: string | null;
  refundAmount: number | null;
  refundCurrency: string | null;
  refundDate: string | null;
  requestedAt: string;
  requestedByName: string | null;
};

export type MyReturnRow = {
  id: string;
  refNo: string;
  status: "Pending" | "Approved" | "Rejected";
  reason: string;
  refundAmount: number | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function ReturnRequestPanel({
  canApprove,
  pending,
  mine,
  currencies,
  migrationPending,
  migrationFile,
}: {
  canApprove: boolean;
  pending: PendingReturnRow[];
  mine: MyReturnRow[];
  currencies: string[];
  migrationPending: boolean;
  migrationFile: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReturnOrderOption[]>([]);
  const [selected, setSelected] = useState<ReturnOrderOption | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [withRefund, setWithRefund] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "INR");
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  async function search() {
    setBusy("search");
    setError(null);
    setNotice(null);
    const result = await searchOrdersForReturn(query);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResults(result.orders);
    if (result.orders.length === 0) setNotice("No order matched. Try the PO/RF/RG number, marketplace order number or buyer name.");
  }

  async function submit() {
    if (!selected) return;
    setBusy("submit");
    setError(null);
    setNotice(null);
    const result = await createReturnRequest({
      orderId: selected.id,
      reason,
      note,
      refundAmount: withRefund && amount ? Number(amount) : null,
      refundCurrency: withRefund ? currency : null,
      refundDate: withRefund ? refundDate : null,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      withRefund
        ? "Return request submitted. The refund is NOT released and the order is unchanged until MD/Admin approve it."
        : "Return request submitted. The order is unchanged until MD/Admin approve it."
    );
    setSelected(null);
    setResults([]);
    setQuery("");
    setReason("");
    setNote("");
    setAmount("");
    setWithRefund(false);
  }

  async function decide(id: string, decision: "Approved" | "Rejected") {
    setBusy(id);
    setError(null);
    setNotice(null);
    const result = await decideReturnRequest({ id, decision, note: decisionNotes[id] ?? "" });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      decision === "Approved"
        ? `Return approved.${result.refundApplied ? " The refund has been released." : " No refund was requested."}`
        : "Return rejected — the order and the accounts are unchanged."
    );
  }

  return (
    <div className="space-y-4 print:hidden">
      {migrationPending ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Return approvals need one SQL step.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1">{migrationFile}</code> in the Supabase SQL editor. Refunds keep working
            meanwhile — only the return-approval queue is unavailable.
          </p>
        </div>
      ) : null}

      {error ? <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      {notice ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}

      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">↩️ Raise a return request (approval required)</h2>
        <p className="mt-1 text-xs text-amber-800">
          Refunds are posted immediately. A <strong>return</strong> only takes effect after an MD/Admin approves it — until then the
          order stays exactly as it is and the request sits in <strong>Pending</strong>.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <label className={labelClass} htmlFor="return-order-search">
              Order (PO / RF / RG no, marketplace order no or buyer)
            </label>
            <input
              id="return-order-search"
              className={inputClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="PO-123 / 171-1234567-1234567"
            />
          </div>
          <button
            type="button"
            onClick={search}
            disabled={busy !== null || query.trim().length < 2 || migrationPending}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {busy === "search" ? "Searching…" : "Find order"}
          </button>
        </div>

        {results.length > 0 && !selected ? (
          <ul className="mt-3 divide-y divide-teal-100 rounded-lg border border-teal-200 bg-white">
            {results.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setSelected(order)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-teal-50"
                >
                  <span>
                    <span className="font-mono text-xs text-teal-800">{order.refNo}</span>
                    <span className="ml-2 text-slate-600">{order.buyer ?? "—"}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {order.status ?? "—"} · {order.currency} {order.value != null ? order.value.toFixed(2) : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selected ? (
          <div className="mt-3 rounded-lg border border-teal-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm">
                <p className="font-mono text-xs text-teal-800">{selected.refNo}</p>
                <p className="text-slate-700">{selected.buyer ?? "—"}</p>
                <p className="text-xs text-slate-500">
                  Status: {selected.status ?? "—"} · Order value: {selected.currency}{" "}
                  {selected.value != null ? selected.value.toFixed(2) : "—"}
                  {selected.marketplaceOrderNo ? ` · ${selected.marketplaceOrderNo}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-500 underline">
                Change order
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="return-reason">
                  Return reason *
                </label>
                <input
                  id="return-reason"
                  className={inputClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. buyer received a damaged rug"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="return-note">
                  Note for the approver
                </label>
                <textarea id="return-note" rows={2} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={withRefund} onChange={(e) => setWithRefund(e.target.checked)} />
              Also release a refund when this return is approved
            </label>

            {withRefund ? (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelClass} htmlFor="return-amount">
                    Refund amount
                  </label>
                  <input
                    id="return-amount"
                    className={inputClass}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="return-currency">
                    Currency
                  </label>
                  <select id="return-currency" className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {(currencies.length > 0 ? currencies : ["INR"]).map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="return-date">
                    Refund date
                  </label>
                  <input
                    id="return-date"
                    type="date"
                    className={inputClass}
                    value={refundDate}
                    onChange={(e) => setRefundDate(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={busy !== null || !reason.trim()}
              className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
            >
              {busy === "submit" ? "Submitting…" : "Submit return for approval"}
            </button>
          </div>
        ) : null}
      </div>

      {canApprove ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Pending return approvals</h2>
          {pending.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Nothing waiting for approval.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {pending.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-mono text-xs text-slate-700">{row.refNo}</p>
                      <p className="text-slate-700">{row.buyer ?? "—"}</p>
                      <p className="text-xs text-slate-500">
                        Raised {formatDateTime(row.requestedAt)}
                        {row.requestedByName ? ` by ${row.requestedByName}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-medium">Reason:</span> {row.reason}
                      </p>
                      {row.note ? <p className="text-xs text-slate-600">{row.note}</p> : null}
                      <p className="mt-1 text-xs font-medium text-slate-700">
                        {row.refundAmount != null
                          ? `Refund requested: ${row.refundCurrency ?? ""} ${row.refundAmount.toFixed(2)}${
                              row.refundDate ? ` on ${row.refundDate}` : ""
                            }`
                          : "No refund requested — return only"}
                      </p>
                    </div>
                  </div>
                  <input
                    className={`${inputClass} mt-2`}
                    placeholder="Decision note (optional)"
                    value={decisionNotes[row.id] ?? ""}
                    onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => decide(row.id, "Approved")}
                      disabled={busy !== null}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                    >
                      {busy === row.id ? "Saving…" : "✅ Approve return"}
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(row.id, "Rejected")}
                      disabled={busy !== null}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">My recent return requests</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">You have not raised any return requests yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {mine.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1.5">
                <span className="font-mono text-slate-700">{row.refNo}</span>
                <span className="flex-1 text-slate-500">{row.reason}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    row.status === "Pending"
                      ? "bg-amber-100 text-amber-800"
                      : row.status === "Approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {row.status}
                </span>
                <span className="text-slate-400">{formatDateTime(row.requestedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
