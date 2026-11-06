"use client";

// 2026-11-06 — "My Return & Refund Requests" workspace.
//
// Returns are approval-gated; refunds are already posted immediately. Both
// appear here so an employee can see their own complete return/refund history.
// Only a Return that is still Pending and owned by the caller exposes Edit /
// Delete — approved/rejected/cancelled rows are read-only, and the server
// re-checks ownership, status and the loaded updated_at version on every write.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelReturnRequest,
  decideReturnRequest,
  searchOrdersForReturn,
  updateReturnRequest,
  type ReturnOrderOption,
} from "./return-actions";

export type RequestRow = {
  id: string;
  orderId: string;
  kind: "Return" | "Refund";
  refNo: string;
  buyer: string | null;
  company: string;
  store: string | null;
  reason: string;
  note: string | null;
  amount: number | null;
  currency: string | null;
  refundDate: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  requestedAt: string;
  updatedAt: string;
  requestedBy: string | null;
  requestedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  mine: boolean;
  refundId: string | null;
  history: { action: string; employeeName: string | null; at: string }[];
};

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function when(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function money(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
}

const STATUS_CLASS: Record<RequestRow["status"], string> = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-700",
  Rejected: "bg-rose-100 text-rose-700",
  Cancelled: "bg-slate-100 text-slate-500",
};

const STATUS_LABEL: Record<RequestRow["status"], string> = {
  Pending: "Pending",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Deleted / Cancelled",
};

type Tab = "all" | "mine" | "pending";

export function ReturnRequestsWorkspace({
  rows,
  currentEmployeeId,
  canApprove,
  currencies,
}: {
  rows: RequestRow[];
  currentEmployeeId: string;
  canApprove: boolean;
  currencies: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [company, setCompany] = useState("");
  const [store, setStore] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<RequestRow | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const companies = useMemo(() => Array.from(new Set(rows.map((r) => r.company))).sort(), [rows]);
  const stores = useMemo(() => Array.from(new Set(rows.map((r) => r.store).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "mine" && !r.mine) return false;
      if (tab === "pending" && r.status !== "Pending") return false;
      if (status && r.status !== status) return false;
      if (company && r.company !== company) return false;
      if (store && r.store !== store) return false;
      if (from && r.requestedAt.slice(0, 10) < from) return false;
      if (to && r.requestedAt.slice(0, 10) > to) return false;
      if (!term) return true;
      return [r.refNo, r.buyer, r.reason, r.requestedByName, r.company, r.store, r.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [rows, tab, status, company, store, from, to, search]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      mine: rows.filter((r) => r.mine).length,
      pending: rows.filter((r) => r.status === "Pending").length,
    }),
    [rows]
  );

  function flash(message: string) {
    setNotice(message);
    setError(null);
    setTimeout(() => setNotice(null), 4000);
  }

  function remove(row: RequestRow) {
    if (row.kind !== "Return" || row.status !== "Pending") return;
    if (
      !window.confirm(
        `Are you sure you want to delete this return request? This action cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await cancelReturnRequest({ id: row.id, expectedUpdatedAt: row.updatedAt });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      flash("Return request deleted. The order and accounts were not changed.");
      router.refresh();
    });
  }

  function decide(row: RequestRow, decision: "Approved" | "Rejected") {
    const note = (document.getElementById(`decision-${row.id}`) as HTMLInputElement | null)?.value ?? "";
    setError(null);
    startTransition(async () => {
      const result = await decideReturnRequest({ id: row.id, decision, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReviewing(null);
      flash(decision === "Approved" ? `Return approved.${result.refundApplied ? " Refund released." : ""}` : "Return rejected.");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Return &amp; refund requests</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            One register for returns awaiting approval and refunds already posted. Pending returns can be corrected by the
            employee who raised them until MD/Admin decides.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ["all", `All Requests (${counts.all})`],
              ["mine", `My Requests (${counts.mine})`],
              ["pending", `Pending Approvals (${counts.pending})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      {notice ? <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-y border-slate-100 py-3">
        <div className="min-w-48 flex-1">
          <label className={labelClass} htmlFor="req-search">Order / buyer / employee</label>
          <input id="req-search" className={`${inputClass} w-full`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO no, buyer, employee..." />
        </div>
        <div>
          <label className={labelClass} htmlFor="req-status">Status</label>
          <select id="req-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Deleted / Cancelled</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="req-company">Company</label>
          <select id="req-company" className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">All companies</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="req-store">Store</label>
          <select id="req-store" className={inputClass} value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="req-from">From</label>
          <input id="req-from" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="req-to">To</label>
          <input id="req-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" onClick={() => { setSearch(""); setStatus(""); setCompany(""); setStore(""); setFrom(""); setTo(""); }} className="text-xs text-slate-400 underline">
          Clear
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1100px] w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2.5 py-2">Request</th>
              <th className="px-2.5 py-2">PO / Order</th>
              <th className="px-2.5 py-2">Buyer</th>
              <th className="px-2.5 py-2">Company / Store</th>
              <th className="px-2.5 py-2">Type</th>
              <th className="px-2.5 py-2 text-right">Refund</th>
              <th className="px-2.5 py-2">Reason</th>
              <th className="px-2.5 py-2">Created</th>
              <th className="px-2.5 py-2">Updated</th>
              <th className="px-2.5 py-2">Status</th>
              <th className="px-2.5 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((row) => {
              const canEdit = row.kind === "Return" && row.mine && row.status === "Pending";
              const canReview = row.kind === "Return" && row.status === "Pending" && row.requestedBy !== currentEmployeeId;
              return (
                <tr key={`${row.kind}-${row.id}`} className="align-top">
                  <td className="px-2.5 py-2 font-mono text-[11px] text-slate-500">
                    {row.id.slice(0, 8).toUpperCase()}
                    {row.history.length > 0 ? (
                      <details className="mt-1 font-sans text-[10px] font-normal text-slate-500">
                        <summary className="cursor-pointer text-teal-700">History ({row.history.length})</summary>
                        <ul className="mt-1 space-y-0.5">
                          {row.history.map((entry, index) => (
                            <li key={`${entry.at}-${index}`}>
                              <span className="font-medium text-slate-600">{entry.action.replace("return_request.", "")}</span>
                              {entry.employeeName ? ` · ${entry.employeeName}` : ""}
                              <span className="block text-slate-400">{when(entry.at)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  <td className="px-2.5 py-2 font-medium text-slate-800">{row.refNo}</td>
                  <td className="max-w-52 px-2.5 py-2 text-slate-600">{row.buyer ?? "—"}</td>
                  <td className="px-2.5 py-2 text-slate-600">
                    {row.company}
                    {row.store ? <span className="block text-[11px] text-slate-400">{row.store}</span> : null}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.kind === "Refund" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-800"}`}>
                      {row.kind}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-right font-medium text-slate-700">{money(row.amount, row.currency)}</td>
                  <td className="max-w-64 px-2.5 py-2 text-slate-600">
                    {row.reason}
                    {row.decisionNote ? <span className="mt-0.5 block text-[11px] text-slate-400">Decision: {row.decisionNote}</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-slate-500">{when(row.requestedAt)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-slate-500">{when(row.updatedAt)}</td>
                  <td className="px-2.5 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.kind === "Refund" && row.refundId ? (
                        <a href={`/dashboard/returns?q=${encodeURIComponent(row.refNo)}`} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                          View refund
                        </a>
                      ) : null}
                      {canEdit ? (
                        <>
                          <button type="button" onClick={() => { setEditing(row); setError(null); }} disabled={busy} className="rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-40">
                            Edit
                          </button>
                          <button type="button" onClick={() => remove(row)} disabled={busy} className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40">
                            Delete
                          </button>
                        </>
                      ) : null}
                      {canApprove && canReview ? (
                        <button type="button" onClick={() => setReviewing(reviewing === row.id ? null : row.id)} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100">
                          Review
                        </button>
                      ) : null}
                      {!canEdit && !canReview && row.kind === "Return" ? <span className="text-[11px] text-slate-400">Read only</span> : null}
                    </div>
                    {reviewing === row.id ? (
                      <div className="mt-2 w-56 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2">
                        <input id={`decision-${row.id}`} className={`${inputClass} w-full`} placeholder="Decision note (optional)" />
                        <div className="mt-1.5 flex gap-1">
                          <button type="button" onClick={() => decide(row, "Approved")} disabled={busy} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                            Approve
                          </button>
                          <button type="button" onClick={() => decide(row, "Rejected")} disabled={busy} className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-40">
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  No requests match this tab and filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditRequestDialog
          row={editing}
          currencies={currencies}
          busy={busy}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            flash("Request updated. Approval is still pending.");
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}
    </section>
  );
}

function EditRequestDialog({
  row,
  currencies,
  busy,
  onClose,
  onSaved,
  onError,
}: {
  row: RequestRow;
  currencies: string[];
  busy: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [reason, setReason] = useState(row.reason);
  const [note, setNote] = useState(row.note ?? "");
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const [currency, setCurrency] = useState(row.currency ?? currencies[0] ?? "INR");
  const [refundDate, setRefundDate] = useState(row.refundDate ?? new Date().toISOString().slice(0, 10));
  const [orderId, setOrderId] = useState(row.orderId);
  const [refNo, setRefNo] = useState(row.refNo);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderResults, setOrderResults] = useState<ReturnOrderOption[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [localBusy, localStart] = useTransition();
  const [searching, searchStart] = useTransition();

  function findOrder() {
    setSearchError(null);
    searchStart(async () => {
      const result = await searchOrdersForReturn(orderQuery);
      if (!result.ok) {
        setSearchError(result.error);
        return;
      }
      setOrderResults(result.orders);
      if (result.orders.length === 0) setSearchError("No order matched. Type the PO/RF/RG no, marketplace order no or buyer.");
    });
  }

  function save() {
    localStart(async () => {
      const result = await updateReturnRequest({
        id: row.id,
        expectedUpdatedAt: row.updatedAt,
        orderId,
        reason,
        note,
        refundAmount: amount.trim() ? Number(amount) : null,
        refundCurrency: amount.trim() ? currency : null,
        refundDate: amount.trim() ? refundDate : null,
      });
      if (!result.ok) {
        onError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-10 w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Edit pending return — {row.refNo}</h3>
            <p className="text-xs text-slate-500">The order and accounts stay unchanged until approval. Every save is audited.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 underline">Close</button>
        </div>
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
            <p className="text-xs text-slate-600">
              Order: <strong>{refNo}</strong>
              {orderId !== row.orderId ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Changed</span> : null}
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                className={`${inputClass} flex-1`}
                value={orderQuery}
                onChange={(e) => setOrderQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    findOrder();
                  }
                }}
                placeholder="Search correct PO / order / buyer"
                aria-label="Search corrected order"
              />
              <button type="button" onClick={findOrder} disabled={searching || orderQuery.trim().length < 2} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                {searching ? "…" : "Find"}
              </button>
            </div>
            {searchError ? <p className="mt-1 text-[11px] text-rose-600">{searchError}</p> : null}
            {orderResults.length > 0 ? (
              <div className="mt-1 max-h-36 space-y-1 overflow-y-auto">
                {orderResults.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setOrderId(o.id);
                      setRefNo(o.refNo);
                      setOrderResults([]);
                      setOrderQuery("");
                      setSearchError(null);
                    }}
                    className={`block w-full rounded border px-2 py-1 text-left text-[11px] ${o.id === orderId ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <span className="font-medium text-slate-800">{o.refNo}</span>
                    <span className="text-slate-500"> · {o.buyer ?? "—"} · {o.status ?? "—"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-reason">Reason *</label>
            <input id="edit-reason" className={`${inputClass} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-note">Note for approver</label>
            <textarea id="edit-note" rows={2} className={`${inputClass} w-full`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="edit-amount">Refund amount</label>
              <input id="edit-amount" inputMode="decimal" className={`${inputClass} w-full`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Blank = no refund" />
            </div>
            <div>
              <label className={labelClass} htmlFor="edit-currency">Currency</label>
              <select id="edit-currency" className={`${inputClass} w-full`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {(currencies.length ? currencies : ["INR"]).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="edit-date">Refund date</label>
              <input id="edit-date" type="date" className={`${inputClass} w-full`} value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600">Cancel</button>
          <button
            type="button"
            disabled={localBusy || busy || !reason.trim()}
            onClick={save}
            className="rounded-lg bg-teal-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {localBusy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
