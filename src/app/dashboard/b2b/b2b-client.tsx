"use client";

// 2026-09-30 — the whole B2B module's client surface: register table +
// KPI/report strip + detail dialog with inquiry → quotation → payments
// lifecycle. Server actions (./actions.ts) do every write; this file only
// orchestrates UI state. Visual language follows the app's existing
// slate/amber admin pages (Employees / Documents).

import { useMemo, useState, useTransition } from "react";
import { downloadXLSX, type ExportColumn } from "@/lib/export/export-table";
import { todayIST } from "@/lib/attendance/ist-date";
import {
  addPayment,
  createInquiry,
  createQuotation,
  deleteDocument,
  deleteInquiry,
  deletePayment,
  issueDocument,
  linkConversion,
  markQuotationSent,
  updateInquiry,
  updateQuotation,
  type B2BDocKind,
  type B2BPaymentMode,
} from "./actions";

// ── shared types (mirrors the DB rows the page loads) ───────────────────────
export type B2BPaymentRow = {
  id: string;
  quotation_id: string;
  payment_date: string;
  amount: number;
  payment_mode: B2BPaymentMode;
  reference_no: string | null;
  reference_date: string | null;
  realized: boolean;
  remark: string | null;
};

export type B2BQuoteItemRow = {
  id: string;
  description: string;
  hsn_code: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
};

export type B2BDocRow = {
  id: string;
  doc_kind: "PI" | "CI" | "PL";
  doc_no: string;
  doc_date: string;
  copy_no: number;
  printed_count: number;
};

export type B2BQuoteRow = {
  id: string;
  inquiry_id: string;
  quote_no: string;
  quote_date: string;
  valid_until: string | null;
  buyer_name: string;
  buyer_contact_no: string | null;
  buyer_email: string | null;
  buyer_country: string | null;
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  terms: string | null;
  notes: string | null;
  sent_at: string | null;
  payments: B2BPaymentRow[];
  items: B2BQuoteItemRow[];
  documents: B2BDocRow[];
};

export type B2BItemRow = {
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number | null;
  remark: string | null;
};

export type B2BInquiryRow = {
  id: string;
  inquiry_no: string;
  inquiry_date: string;
  buyer_name: string;
  buyer_company: string | null;
  buyer_contact_no: string | null;
  buyer_email: string | null;
  buyer_country: string | null;
  source: string | null;
  priority: "Hot" | "Warm" | "Cold";
  requirement_notes: string | null;
  remarks: string | null;
  follow_up_date: string | null;
  status: "Open" | "In Discussion" | "Quotation Sent" | "Won" | "Lost" | "Converted";
  converted_order_ref: string | null;
  created_at: string;
};

export type B2BInquiryView = B2BInquiryRow & {
  items: B2BItemRow[];
  quote: B2BQuoteRow | null;
};

export type B2BInquiryManagerProps = {
  inquiries: B2BInquiryView[];
  companyId: string;
  companyName: string;
  canManage: boolean;
  /** Server-side load failure (usually "table does not exist" — migration not run yet). */
  loadError?: string | null;
};

const STATUSES = ["Open", "In Discussion", "Quotation Sent", "Won", "Lost", "Converted"] as const;
const PRIORITIES = ["Hot", "Warm", "Cold"] as const;
const PAYMENT_MODES: B2BPaymentMode[] = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card", "Advance"];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

// Editable quotation line — kept as STRINGS in UI state so typing "1." or
// "" mid-edit never fights the number parser; the server action parses.
type QuoteItemDraft = { description: string; hsnCode: string; qty: string; unit: string; unitPrice: string };
function emptyQuoteItem(): QuoteItemDraft {
  return { description: "", hsnCode: "", qty: "1", unit: "pcs", unitPrice: "" };
}

function fmtMoney(n: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function statusBadgeClass(status: B2BInquiryRow["status"]): string {
  switch (status) {
    case "Open":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "In Discussion":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "Quotation Sent":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "Won":
      return "bg-green-50 text-green-700 border-green-200";
    case "Lost":
      return "bg-red-50 text-red-700 border-red-200";
    case "Converted":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
}
function priorityDot(priority: B2BInquiryRow["priority"]): string {
  return priority === "Hot" ? "🔥" : priority === "Warm" ? "☀️" : "❄️";
}

// ── root component ───────────────────────────────────────────────────────────
export function B2BInquiryManager({ inquiries, companyId, companyName, canManage, loadError }: B2BInquiryManagerProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  void companyId;
  void companyName; // (kept for future per-company theming)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inquiries.filter((i) => {
      if (statusFilter !== "All" && i.status !== statusFilter) return false;
      if (!q) return true;
      return [i.inquiry_no, i.buyer_name, i.buyer_company, i.buyer_contact_no, i.buyer_email, i.source]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [inquiries, query, statusFilter]);

  // Setup notice: the B2B tables are created by one-time SQL migrations;
  // before they run, the page's queries fail with "relation ... does not
  // exist", which used to crash into the error boundary and offer a
  // Sign-in button — read as "logout ho raha baar baar". The page no
  // longer throws; instead a clear setup card explains the one missing
  // step. (This is the visible half of the fix — page.tsx holds the other.)
  const setupProblem = Boolean(loadError);

  // ── report numbers (KPI strip + mode breakdown) ──────────────────────────
  const report = useMemo(() => {
    const open = inquiries.filter((i) => !["Won", "Lost", "Converted"].includes(i.status)).length;
    const won = inquiries.filter((i) => ["Won", "Converted"].includes(i.status)).length;
    const lost = inquiries.filter((i) => i.status === "Lost").length;
    const quoted = inquiries.filter((i) => i.quote).length;
    const quotedValue = inquiries.reduce((sum, i) => sum + (i.quote?.total_amount ?? 0), 0);
    const received = inquiries.reduce(
      (sum, i) => sum + (i.quote?.payments ?? []).reduce((s, p) => s + (p.realized ? p.amount : 0), 0),
      0
    );
    const pending = quotedValue - inquiries.reduce((sum, i) => sum + (i.quote?.payments ?? []).reduce((s, p) => s + p.amount, 0), 0);
    const byMode = new Map<B2BPaymentMode, number>();
    for (const i of inquiries) {
      for (const p of i.quote?.payments ?? []) {
        byMode.set(p.payment_mode, (byMode.get(p.payment_mode) ?? 0) + p.amount);
      }
    }
    const followups = inquiries
      .filter((i) => i.follow_up_date && !["Won", "Lost", "Converted"].includes(i.status))
      .sort((a, b) => (a.follow_up_date! < b.follow_up_date! ? -1 : 1))
      .slice(0, 5);
    return { open, won, lost, quoted, quotedValue, received, pending, byMode, followups };
  }, [inquiries]);

  const selected = inquiries.find((i) => i.id === selectedId) ?? null;

  // Early, calm return while the one-time migrations haven't run yet —
  // this is what replaces the old crash → "logout" loop.
  if (setupProblem) {
    return <SetupNotice error={loadError!} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="pb-6">
      {/* ── Header + KPI report strip ──────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">B2B Inquiries</h1>
            <p className="text-sm text-slate-500">
              Trade-buyer pipeline — inquiries, quotations, payments received
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void downloadXLSX(
                    `b2b-report-${new Date().toISOString().slice(0, 10)}`,
                    "B2B Inquiries",
                    B2B_EXPORT_COLUMNS,
                    filtered.map((i) => ({
                      inquiryNo: i.inquiry_no,
                      inquiryDate: fmtDate(i.inquiry_date),
                      buyer: i.buyer_name,
                      company: i.buyer_company ?? "",
                      contact: i.buyer_contact_no ?? "",
                      country: i.buyer_country ?? "",
                      source: i.source ?? "",
                      priority: i.priority,
                      status: i.status,
                      followUp: fmtDate(i.follow_up_date),
                      quoteNo: i.quote?.quote_no ?? "",
                      quoteTotal: i.quote ? String(i.quote.total_amount) : "",
                      received: String((i.quote?.payments ?? []).reduce((s, p) => s + p.amount, 0)),
                      balance: i.quote ? String(i.quote.total_amount - (i.quote.payments ?? []).reduce((s, p) => s + p.amount, 0)) : "",
                      convertedOrder: i.converted_order_ref ?? "",
                    }))
                  )
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                ⬇ Report (Excel)
              </button>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
              >
                + New Inquiry
              </button>
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Open / Active" value={String(report.open)} tone="sky" />
          <Kpi label="Quoted" value={String(report.quoted)} tone="amber" />
          <Kpi label="Quoted Value" value={fmtMoney(report.quotedValue)} tone="slate" />
          <Kpi label="Received" value={fmtMoney(report.received)} tone="green" />
          <Kpi label="Payment Pending" value={fmtMoney(Math.max(0, report.pending))} tone={report.pending > 0 ? "red" : "slate"} />
          <Kpi label="Won / Lost" value={`${report.won} / ${report.lost}`} tone="slate" />
        </div>
      </div>

      {/* ── Follow-ups + payment-mode breakdown (the "report") ─────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Upcoming Follow-ups</h2>
          {report.followups.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Nothing scheduled.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {report.followups.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <button type="button" className="truncate text-left text-slate-700 hover:underline" onClick={() => setSelectedId(i.id)}>
                    {priorityDot(i.priority)} {i.buyer_name} · <span className="text-slate-400">{i.inquiry_no}</span>
                  </button>
                  <span className="shrink-0 text-xs font-medium text-amber-700">{fmtDate(i.follow_up_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Payments by Mode</h2>
          {report.byMode.size === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No payments recorded yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {[...report.byMode.entries()].sort((a, b) => b[1] - a[1]).map(([mode, amt]) => (
                <li key={mode} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">{mode}</span>
                  <span className="font-medium text-slate-900">{fmtMoney(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Filters + register table ───────────────────────────────────── */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buyer, company, inquiry no…"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-amber-500"
          />
          <div className="flex flex-wrap gap-1">
            {["All", ...STATUSES].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  statusFilter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Inquiry</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Quote / Total</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((i) => {
                const paid = (i.quote?.payments ?? []).reduce((s, p) => s + p.amount, 0);
                return (
                  <tr key={i.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{i.inquiry_no}</div>
                      <div className="text-xs text-slate-400">{fmtDate(i.inquiry_date)}{i.source ? ` · ${i.source}` : ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{priorityDot(i.priority)} {i.buyer_name}</div>
                      <div className="text-xs text-slate-400">{[i.buyer_company, i.buyer_country].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{i.items.length || "—"}</td>
                    <td className="px-4 py-3">
                      {i.quote ? (
                        <>
                          <div className="font-medium text-slate-800">{i.quote.quote_no}</div>
                          <div className="text-xs text-slate-500">{fmtMoney(i.quote.total_amount, i.quote.currency)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {paid > 0 ? (
                        <span className="font-medium text-green-700">{fmtMoney(paid)}</span>
                      ) : i.quote ? (
                        <span className="text-xs text-red-500">due</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(i.follow_up_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(i.status)}`}>{i.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedId(i.id)}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    {inquiries.length === 0 ? "No inquiries yet — create the first one." : "No matches for the current filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New-inquiry modal ──────────────────────────────────────────── */}
      {showForm && <NewInquiryModal onClose={() => setShowForm(false)} />}

      {/* ── Inquiry detail dialog ──────────────────────────────────────── */}
      {selected && (
        <InquiryDetailDialog inquiry={selected} canManage={canManage} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

// ── Excel export (the REPORT deliverable) — same SheetJS helper as the
// Employees page's Export All, client-side so no blob round-trip.
type ExportRow = {
  inquiryNo: string;
  inquiryDate: string;
  buyer: string;
  company: string;
  contact: string;
  country: string;
  source: string;
  priority: string;
  status: string;
  followUp: string;
  quoteNo: string;
  quoteTotal: string;
  received: string;
  balance: string;
  convertedOrder: string;
};

const B2B_EXPORT_COLUMNS: ExportColumn<ExportRow>[] = [
  { key: "inquiryNo", label: "Inquiry No", value: (r) => r.inquiryNo },
  { key: "inquiryDate", label: "Date", value: (r) => r.inquiryDate },
  { key: "buyer", label: "Buyer", value: (r) => r.buyer },
  { key: "company", label: "Company", value: (r) => r.company },
  { key: "contact", label: "Contact", value: (r) => r.contact },
  { key: "country", label: "Country", value: (r) => r.country },
  { key: "source", label: "Source", value: (r) => r.source },
  { key: "priority", label: "Priority", value: (r) => r.priority },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "followUp", label: "Follow-up", value: (r) => r.followUp },
  { key: "quoteNo", label: "Quote / Invoice No", value: (r) => r.quoteNo },
  { key: "quoteTotal", label: "Quote Total", value: (r) => r.quoteTotal },
  { key: "received", label: "Received", value: (r) => r.received },
  { key: "balance", label: "Balance Due", value: (r) => r.balance },
  { key: "convertedOrder", label: "Converted Order", value: (r) => r.convertedOrder },
];

// One-time setup gate: the B2B tables live behind two dated SQL migrations.
// Shown INSTEAD of the register until they're run, so the page can never
// crash-loop into the error boundary (the "logout ho raha baar baar" bug).
function SetupNotice({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="pb-6">
      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="text-2xl">🛠️</div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-amber-900">B2B module — one-time database setup pending</h1>
            <p className="mt-1 text-sm text-amber-800">
              The B2B tables don&apos;t exist in the database yet. Run these two SQL files in Supabase
              (Dashboard → SQL Editor → New query → paste file contents → Run):
            </p>
            <ol className="mt-3 space-y-1.5 text-sm">
              {["db/2026-09-30-b2b-inquiries.sql", "db/2026-09-30b-b2b-documents.sql"].map((f, i) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">{i + 1}</span>
                  <code className="rounded bg-white px-2 py-0.5 font-mono text-xs text-slate-800 ring-1 ring-amber-200">{f}</code>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-amber-700">
              Then refresh this page — the register, quotations (PI / Commercial Invoice / Packing List documents)
              and payments all light up together. No data was lost.
            </p>
            <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-slate-600 break-words ring-1 ring-amber-100">
              {error}
            </p>
            <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
              🔄 Retry now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "sky" | "amber" | "green" | "red" | "slate" }) {
  const toneClass =
    tone === "sky" ? "bg-sky-50 text-sky-700" :
    tone === "amber" ? "bg-amber-50 text-amber-700" :
    tone === "green" ? "bg-green-50 text-green-700" :
    tone === "red" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-lg px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 truncate text-base font-bold">{value}</div>
    </div>
  );
}

// ── New inquiry modal ────────────────────────────────────────────────────────
function NewInquiryModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState([{ description: "", qty: "", unit: "pcs", unitPrice: "", remark: "" }]);

  function submit(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await createInquiry({
        inquiryDate: val("inquiry_date"),
        buyerName: val("buyer_name"),
        buyerCompany: val("buyer_company"),
        buyerContactNo: val("buyer_contact_no"),
        buyerEmail: val("buyer_email"),
        buyerCountry: val("buyer_country"),
        source: val("source"),
        priority: val("priority"),
        requirementNotes: val("requirement_notes"),
        remarks: val("remarks"),
        followUpDate: val("follow_up_date"),
        items: items.map((it) => ({ description: it.description, qty: it.qty, unit: it.unit, unitPrice: it.unitPrice, remark: it.remark })),
      });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <SimpleDialog title="New B2B Inquiry" onClose={onClose} wide>
      <form action={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Inquiry Date"><input name="inquiry_date" type="date" required className={inputClass} /></Field>
          <Field label="Priority">
            <select name="priority" defaultValue="Warm" className={inputClass}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Buyer Name *"><input name="buyer_name" required className={inputClass} /></Field>
          <Field label="Buyer Company"><input name="buyer_company" className={inputClass} /></Field>
          <Field label="Contact No"><input name="buyer_contact_no" className={inputClass} placeholder="+91…" /></Field>
          <Field label="Email"><input name="buyer_email" type="email" className={inputClass} /></Field>
          <Field label="Country"><input name="buyer_country" className={inputClass} /></Field>
          <Field label="Source"><input name="source" className={inputClass} placeholder="WhatsApp / Email / Walk-in / Referral…" /></Field>
          <Field label="Follow-up Date"><input name="follow_up_date" type="date" className={inputClass} /></Field>
        </div>
        <Field label="Requirement Notes">
          <textarea name="requirement_notes" rows={2} className={inputClass} placeholder="What are they asking for?" />
        </Field>
        <Field label="Remarks"><textarea name="remarks" rows={2} className={inputClass} /></Field>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={labelClass}>Asked-for Items</span>
            <button type="button" onClick={() => setItems((v) => [...v, { description: "", qty: "", unit: "pcs", unitPrice: "", remark: "" }])} className="text-xs font-medium text-amber-600 hover:underline">
              + Add item
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <input className={`${inputClass} col-span-5`} placeholder="Item description" value={it.description} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                <input className={`${inputClass} col-span-2`} placeholder="Qty" inputMode="decimal" value={it.qty} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
                <input className={`${inputClass} col-span-2`} placeholder="Unit" value={it.unit} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} />
                <input className={`${inputClass} col-span-2`} placeholder="Rate" inputMode="decimal" value={it.unitPrice} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))} />
                <button type="button" className="col-span-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50" onClick={() => setItems((v) => (v.length > 1 ? v.filter((_, i) => i !== idx) : v))} aria-label="Remove item">✕</button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
            {isPending ? "Saving…" : "Create Inquiry"}
          </button>
        </div>
      </form>
    </SimpleDialog>
  );
}

// ── Inquiry detail: edit + quotation + payments + conversion ────────────────
function InquiryDetailDialog({ inquiry, canManage, onClose }: { inquiry: B2BInquiryView; canManage: boolean; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"details" | "quote" | "documents" | "payments">("details");
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  function saveDetails(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await updateInquiry({
        inquiryId: inquiry.id,
        buyerName: val("buyer_name"),
        buyerCompany: val("buyer_company"),
        buyerContactNo: val("buyer_contact_no"),
        buyerEmail: val("buyer_email"),
        buyerCountry: val("buyer_country"),
        source: val("source"),
        priority: val("priority"),
        requirementNotes: val("requirement_notes"),
        remarks: val("remarks"),
        followUpDate: val("follow_up_date"),
        status: val("status"),
      });
      if (res.ok) setNotice("Saved.");
      else setError(res.error ?? "Save failed.");
    });
  }

  function removeInquiry() {
    if (!window.confirm(`Delete ${inquiry.inquiry_no} (${inquiry.buyer_name})? This also removes its quotation and payment records.`)) return;
    startTransition(async () => {
      const res = await deleteInquiry(inquiry.id);
      if (res.ok) onClose();
      else setError(res.error ?? "Delete failed.");
    });
  }

  return (
    <SimpleDialog title={`${inquiry.inquiry_no} — ${inquiry.buyer_name}`} subtitle={inquiry.buyer_company ?? undefined} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["details", "quote", "documents", "payments"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${mode === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {m === "quote" ? "Quotation / Invoice" : m === "documents" ? "📄 Documents (PI / CI / PL)" : m}
          </button>
        ))}
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(inquiry.status)}`}>{inquiry.status}</span>
      </div>

      {mode === "details" && (
        <div className="space-y-3">
          {inquiry.items.length > 0 && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Asked-for items</div>
              <ul className="list-inside list-disc space-y-0.5 text-slate-700">
                {inquiry.items.map((it, i) => (
                  <li key={i}>
                    {it.description} — {it.qty} {it.unit ?? ""}{it.unit_price != null ? ` @ ${fmtMoney(it.unit_price)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canManage ? (
            <form action={saveDetails} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Buyer Name"><input name="buyer_name" defaultValue={inquiry.buyer_name} className={inputClass} /></Field>
                <Field label="Company"><input name="buyer_company" defaultValue={inquiry.buyer_company ?? ""} className={inputClass} /></Field>
                <Field label="Contact No"><input name="buyer_contact_no" defaultValue={inquiry.buyer_contact_no ?? ""} className={inputClass} /></Field>
                <Field label="Email"><input name="buyer_email" defaultValue={inquiry.buyer_email ?? ""} className={inputClass} /></Field>
                <Field label="Country"><input name="buyer_country" defaultValue={inquiry.buyer_country ?? ""} className={inputClass} /></Field>
                <Field label="Source"><input name="source" defaultValue={inquiry.source ?? ""} className={inputClass} /></Field>
                <Field label="Priority">
                  <select name="priority" defaultValue={inquiry.priority} className={inputClass}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select name="status" defaultValue={inquiry.status} className={inputClass}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Follow-up Date"><input name="follow_up_date" type="date" defaultValue={inquiry.follow_up_date ?? ""} className={inputClass} /></Field>
              </div>
              <Field label="Requirement Notes"><textarea name="requirement_notes" rows={2} defaultValue={inquiry.requirement_notes ?? ""} className={inputClass} /></Field>
              <Field label="Remarks"><textarea name="remarks" rows={2} defaultValue={inquiry.remarks ?? ""} className={inputClass} /></Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {notice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <button type="button" onClick={removeInquiry} disabled={isPending} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-60">Delete</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">{isPending ? "Saving…" : "Save"}</button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-500">View-only.</p>
          )}
        </div>
      )}

      {mode === "quote" && <QuotePanel inquiry={inquiry} canManage={canManage} showForm={showQuoteForm} setShowForm={setShowQuoteForm} setError={setError} />}

      {mode === "documents" && (
        <DocumentsPanel
          inquiry={inquiry}
          canManage={canManage}
          setError={setError}
        />
      )}

      {mode === "payments" && (
        <PaymentsPanel
          inquiry={inquiry}
          canManage={canManage}
          showForm={showPaymentForm}
          setShowForm={setShowPaymentForm}
          setError={setError}
          onConvertClick={() => setShowConvert(true)}
        />
      )}

      {showConvert && (
        <ConvertModal
          inquiry={inquiry}
          onClose={() => setShowConvert(false)}
          onDone={() => {
            setShowConvert(false);
            setNotice("Converted.");
          }}
        />
      )}
    </SimpleDialog>
  );
}

function QuotePanel({
  inquiry,
  canManage,
  showForm,
  setShowForm,
  setError,
}: {
  inquiry: B2BInquiryView;
  canManage: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const q = inquiry.quote;

  // Line items drive the money (server computes subtotal = Σ qty×rate);
  // used by BOTH the create form and the edit form below.
  const [items, setItems] = useState<QuoteItemDraft[]>([emptyQuoteItem()]);
  const liveSubtotal = items.reduce(
    (s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0),
    0
  );

  function buildPayload(formData: FormData) {
    const val = (k: string) => String(formData.get(k) ?? "");
    return {
      inquiryId: inquiry.id,
      quotationId: q?.id,
      quoteDate: val("quote_date"),
      validUntil: val("valid_until"),
      buyerName: val("buyer_name"),
      buyerContactNo: val("buyer_contact_no"),
      buyerEmail: val("buyer_email"),
      buyerCountry: val("buyer_country"),
      taxPercent: val("tax_percent"),
      shippingAmount: val("shipping_amount"),
      currency: val("currency"),
      terms: val("terms"),
      notes: val("notes"),
      items: items.map((it) => ({
        description: it.description,
        hsnCode: it.hsnCode,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice,
      })),
    };
  }

  function saveQuote(formData: FormData) {
    setLocalError(null);
    setError(null);
    if (!items.some((it) => it.description.trim())) {
      setLocalError("Add at least one item with a description.");
      return;
    }
    startTransition(async () => {
      const payload = buildPayload(formData);
      const res = q ? await updateQuotation({ ...payload, quotationId: q.id }) : await createQuotation(payload);
      if (res.ok) {
        setShowForm(false);
        setItems([emptyQuoteItem()]);
      } else {
        setLocalError(res.error ?? "Failed to save quotation.");
      }
    });
  }

  function openEditForm() {
    if (!q) return;
    setItems(
      (q.items ?? []).map((it) => ({
        description: it.description,
        hsnCode: it.hsn_code ?? "",
        qty: String(it.qty),
        unit: it.unit ?? "pcs",
        unitPrice: String(it.unit_price),
      }))
    );
    setShowForm(true);
  }

  function send() {
    if (!q) return;
    startTransition(async () => {
      const res = await markQuotationSent(q.id);
      if (!res.ok) setLocalError(res.error ?? "Failed.");
    });
  }

  const waText = q
    ? encodeURIComponent(
        `Quotation ${q.quote_no}\nBuyer: ${q.buyer_name}\n` +
          (q.items ?? [])
            .map((it, i) => `${i + 1}. ${it.description} — ${it.qty} ${it.unit ?? ""} @ ${fmtMoney(it.unit_price, q.currency)}`)
            .join("\n") +
          `\nSubtotal: ${fmtMoney(q.subtotal, q.currency)}\nTax (${q.tax_percent}%): ${fmtMoney(q.tax_amount, q.currency)}\nShipping: ${fmtMoney(q.shipping_amount, q.currency)}\nTOTAL: ${fmtMoney(q.total_amount, q.currency)}${q.valid_until ? `\nValid until: ${fmtDate(q.valid_until)}` : ""}\n\n— Nykomart`
      )
    : "";

  return (
    <div className="space-y-3">
      {localError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{localError}</p>}
      {!q && !showForm && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm text-slate-500">No quotation yet for this inquiry.</p>
          {canManage && (
            <button type="button" onClick={() => setShowForm(true)} className="mt-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
              + Create Quotation
            </button>
          )}
        </div>
      )}
      {q && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">{q.quote_no}</div>
                <div className="text-xs text-slate-500">
                  {fmtDate(q.quote_date)}{q.valid_until ? ` · valid till ${fmtDate(q.valid_until)}` : ""}
                  {q.sent_at ? " · sent ✓" : " · not sent"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{fmtMoney(q.total_amount, q.currency)}</div>
                <div className="text-xs text-slate-500">
                  {fmtMoney(q.subtotal, q.currency)} + {q.tax_percent}% tax + {fmtMoney(q.shipping_amount, q.currency)} ship
                </div>
              </div>
            </div>
            {q.terms && <p className="mt-2 text-xs text-slate-500"><strong>Terms:</strong> {q.terms}</p>}
            {q.notes && <p className="mt-1 text-xs text-slate-500"><strong>Notes:</strong> {q.notes}</p>}
            {/* Itemized lines — the same rows PI/CI/PL print */}
            {(q.items ?? []).length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5">Description</th>
                      <th className="px-3 py-1.5">HSN</th>
                      <th className="px-3 py-1.5 text-right">Qty</th>
                      <th className="px-3 py-1.5">Unit</th>
                      <th className="px-3 py-1.5 text-right">Rate</th>
                      <th className="px-3 py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(q.items ?? []).map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5 text-slate-800">{it.description}</td>
                        <td className="px-3 py-1.5 text-slate-500">{it.hsn_code ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right">{it.qty}</td>
                        <td className="px-3 py-1.5">{it.unit ?? "pcs"}</td>
                        <td className="px-3 py-1.5 text-right">{fmtMoney(it.unit_price, q.currency)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{fmtMoney(it.line_total, q.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!q.sent_at && (
                  <button type="button" onClick={send} disabled={isPending} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
                    Mark as Sent
                  </button>
                )}
                <button
                  type="button"
                  onClick={openEditForm}
                  disabled={isPending}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  ✎ Edit Quote &amp; Items
                </button>
                {q.buyer_contact_no && (
                  <a href={`https://wa.me/${q.buyer_contact_no.replace(/[^\d]/g, "")}?text=${waText}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100">
                    Share on WhatsApp
                  </a>
                )}
                {q.buyer_email && (
                  <a href={`mailto:${q.buyer_email}?subject=${encodeURIComponent(`Quotation ${q.quote_no}`)}&body=${waText}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                    Email
                  </a>
                )}
              </div>
            )}
          </div>
          {/* totals recap table (invoice-style) */}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-1.5 text-slate-500">Subtotal</td><td className="py-1.5 text-right font-medium">{fmtMoney(q.subtotal, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">Tax ({q.tax_percent}%)</td><td className="py-1.5 text-right font-medium">{fmtMoney(q.tax_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">Shipping</td><td className="py-1.5 text-right font-medium">{fmtMoney(q.shipping_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 font-semibold text-slate-900">Total</td><td className="py-1.5 text-right font-bold">{fmtMoney(q.total_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">Received</td><td className="py-1.5 text-right font-medium text-green-700">{fmtMoney((q.payments ?? []).reduce((s, p) => s + p.amount, 0), q.currency)}</td></tr>
              <tr><td className="py-1.5 font-medium text-slate-700">Balance Due</td><td className={`py-1.5 text-right font-bold ${q.total_amount - (q.payments ?? []).reduce((s, p) => s + p.amount, 0) > 0 ? "text-red-600" : "text-green-700"}`}>
                {fmtMoney(q.total_amount - (q.payments ?? []).reduce((s, p) => s + p.amount, 0), q.currency)}
              </td></tr>
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <form action={saveQuote} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {q ? "Edit quotation — items replace the saved set on save" : "New quotation — subtotal is the sum of item rows"}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!q && (
              <>
                <Field label="Quote Date"><input name="quote_date" type="date" required className={inputClass} /></Field>
                <Field label="Valid Until"><input name="valid_until" type="date" className={inputClass} /></Field>
              </>
            )}
            <Field label="Buyer Name"><input name="buyer_name" defaultValue={q?.buyer_name ?? inquiry.buyer_name} className={inputClass} /></Field>
            <Field label="Contact No"><input name="buyer_contact_no" defaultValue={q?.buyer_contact_no ?? inquiry.buyer_contact_no ?? ""} className={inputClass} /></Field>
            <Field label="Email"><input name="buyer_email" defaultValue={q?.buyer_email ?? inquiry.buyer_email ?? ""} className={inputClass} /></Field>
            <Field label="Country"><input name="buyer_country" defaultValue={q?.buyer_country ?? inquiry.buyer_country ?? ""} className={inputClass} /></Field>
            <Field label="Tax %"><input name="tax_percent" inputMode="decimal" defaultValue={q ? String(q.tax_percent) : "0"} className={inputClass} /></Field>
            <Field label="Shipping"><input name="shipping_amount" inputMode="decimal" defaultValue={q ? String(q.shipping_amount) : "0"} className={inputClass} /></Field>
            <Field label="Currency"><input name="currency" defaultValue={q?.currency ?? "INR"} maxLength={3} className={inputClass} /></Field>
          </div>
          <Field label="Terms"><input name="terms" defaultValue={q?.terms ?? ""} className={inputClass} placeholder="50% advance, balance before dispatch…" /></Field>
          <Field label="Notes"><textarea name="notes" rows={2} defaultValue={q?.notes ?? ""} className={inputClass} /></Field>

          {/* ── the items grid (rate × qty lines drive the money) ── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={labelClass}>Quotation Items * (HSN / qty / unit / rate)</span>
              <button type="button" onClick={() => setItems((v) => [...v, emptyQuoteItem()])} className="text-xs font-medium text-amber-600 hover:underline">
                + Add item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input
                    className={`${inputClass} col-span-4`}
                    placeholder="Item description"
                    value={it.description}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                  />
                  <input
                    className={`${inputClass} col-span-2`}
                    placeholder="HSN code"
                    value={it.hsnCode}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, hsnCode: e.target.value } : x)))}
                  />
                  <input
                    className={`${inputClass} col-span-2`}
                    placeholder="Qty"
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                  />
                  <input
                    className={`${inputClass} col-span-1`}
                    placeholder="Unit"
                    value={it.unit}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                  />
                  <input
                    className={`${inputClass} col-span-2`}
                    placeholder="Rate"
                    inputMode="decimal"
                    value={it.unitPrice}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="col-span-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50"
                    onClick={() => setItems((v) => (v.length > 1 ? v.filter((_, i) => i !== idx) : v))}
                    aria-label="Remove item"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-500">{items.filter((it) => it.description.trim()).length} item(s)</span>
              <span className="font-semibold text-slate-900">Subtotal: {fmtMoney(liveSubtotal)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
              {isPending ? "Saving…" : q ? "Save Changes" : "Create Quotation"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Commercial documents: PI / Commercial Invoice / Packing List ────────────
// 2026-09-30b — "PI / commercial invoice / or commercial document — jo jo
// chahiye ye section bhi to chahiye na". Issue → register row + A4 print
// view open. The quotation's item rows print on every kind (PL without
// prices, per the document's real purpose); each issued copy gets its own
// numbered register row (PI/Q-26-27-0001/01, copy 01 = ORIGINAL).
function DocumentsPanel({
  inquiry,
  canManage,
  setError,
}: {
  inquiry: B2BInquiryView;
  canManage: boolean;
  setError: (s: string | null) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [docDate, setDocDate] = useState(todayIST());
  const q = inquiry.quote;

  function issue(kind: B2BDocKind) {
    if (!q) return;
    setLocalError(null);
    setError(null);
    startTransition(async () => {
      // Server assigns the next copy no (count + 1) and builds the doc no.
      const res = await issueDocument(q.id, kind, docDate);
      if (res.ok) {
        // The server re-render brings the new register row; this opens the
        // fresh A4 print view (which also counts as the first "print").
        window.open(`/dashboard/b2b/documents/${res.documentId}`, "_blank");
      } else {
        setLocalError(res.error);
        setError(res.error);
        window.alert(res.error);
      }
    });
  }

  function remove(docId: string) {
    if (!window.confirm("Delete this document? Its number is released (the next issue reuses the copy no).")) return;
    startTransition(async () => {
      const res = await deleteDocument(docId);
      if (!res.ok) {
        setLocalError(res.error ?? "Delete failed.");
        setError(res.error ?? "Delete failed.");
      }
    });
  }

  if (!q) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
        Create the quotation first — PI / Commercial Invoice / Packing List are all issued against it.
      </p>
    );
  }

  const DOC_META: { kind: B2BDocKind; label: string; desc: string; btnClass: string }[] = [
    { kind: "PI", label: "Proforma Invoice", desc: "Advance / buyer-bank use — priced, before the sale", btnClass: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100" },
    { kind: "CI", label: "Commercial Invoice", desc: "Final bill of sale — the money document", btnClass: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
    { kind: "PL", label: "Packing List", desc: "Package-wise contents — quantities only, no prices", btnClass: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100" },
  ];

  return (
    <div className="space-y-3">
      {localError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{localError}</p>}

      {canManage && (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">Issue Commercial Document</div>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Doc date
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {DOC_META.map((m) => (
              <button
                key={m.kind}
                type="button"
                disabled={isPending}
                onClick={() => issue(m.kind)}
                className={`rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-60 ${m.btnClass}`}
              >
                <div className="text-sm font-bold">+ {m.label} <span className="opacity-60">({m.kind})</span></div>
                <div className="mt-0.5 text-xs opacity-80">{m.desc}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Each issue creates a numbered copy — e.g. PI/{q.quote_no}/01 (ORIGINAL), /02 (DUPLICATE) — and opens its A4 print view.
          </p>
        </div>
      )}

      {/* The register: every issued copy of every kind for this quotation */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Doc No</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Copy</th>
              <th className="px-3 py-2 text-right">Printed</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(q.documents ?? []).map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2 font-medium text-slate-800">{d.doc_no}</td>
                <td className="px-3 py-2">{d.doc_kind}</td>
                <td className="px-3 py-2">{fmtDate(d.doc_date)}</td>
                <td className="px-3 py-2 text-slate-500">{d.copy_no}</td>
                <td className="px-3 py-2 text-right text-slate-500">{d.printed_count}×</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <a
                      href={`/dashboard/b2b/documents/${d.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      🖨 Open / Print
                    </a>
                    {canManage && (
                      <button type="button" onClick={() => remove(d.id)} disabled={isPending} className="text-xs text-red-500 hover:underline disabled:opacity-60">
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(q.documents ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-400">
                  No documents issued yet — use the buttons above to issue a PI, Commercial Invoice or Packing List.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentsPanel({
  inquiry,
  canManage,
  showForm,
  setShowForm,
  setError,
  onConvertClick,
}: {
  inquiry: B2BInquiryView;
  canManage: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  setError: (s: string | null) => void;
  onConvertClick: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const q = inquiry.quote;

  function add(formData: FormData) {
    if (!q) return;
    const val = (k: string) => String(formData.get(k) ?? "");
    setLocalError(null);
    setError(null);
    startTransition(async () => {
      const res = await addPayment({
        quotationId: q.id,
        paymentDate: val("payment_date"),
        amount: val("amount"),
        paymentMode: val("payment_mode"),
        referenceNo: val("reference_no"),
        referenceDate: val("reference_date"),
        realized: formData.get("realized") === "on",
        remark: val("remark"),
      });
      if (res.ok) setShowForm(false);
      else setLocalError(res.error ?? "Failed to record payment.");
    });
  }

  function remove(paymentId: string) {
    if (!window.confirm("Delete this payment entry?")) return;
    startTransition(async () => {
      const res = await deletePayment(paymentId);
      if (!res.ok) setLocalError(res.error ?? "Delete failed.");
    });
  }

  return (
    <div className="space-y-3">
      {localError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{localError}</p>}
      {!q ? (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">Create the quotation first — payments are tracked against it.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Realized</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(q.payments ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{fmtDate(p.payment_date)}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{p.payment_mode}</td>
                    <td className="px-3 py-2 text-slate-500">{[p.reference_no, p.reference_date ? fmtDate(p.reference_date) : null].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMoney(p.amount, q.currency)}</td>
                    <td className="px-3 py-2">
                      {p.realized ? <span className="text-xs font-medium text-green-700">✓</span> : <span className="text-xs text-amber-600">pending</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage && (
                        <button type="button" onClick={() => remove(p.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
                {(q.payments ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-400">No payments recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowForm(!showForm)} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
                + Record Payment
              </button>
              {inquiry.status !== "Converted" && (
                <button type="button" onClick={onConvertClick} className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                  🔄 Mark Converted (link order)
                </button>
              )}
              {inquiry.converted_order_ref && (
                <span className="self-center text-xs font-medium text-emerald-700">→ Order {inquiry.converted_order_ref}</span>
              )}
            </div>
          )}
          {showForm && (
            <form action={add} className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Payment Date"><input name="payment_date" type="date" required className={inputClass} /></Field>
                <Field label="Payment Mode *">
                  <select name="payment_mode" required className={inputClass}>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Amount *"><input name="amount" inputMode="decimal" required className={inputClass} placeholder="0.00" /></Field>
                <Field label="Reference No"><input name="reference_no" className={inputClass} placeholder="UTR / Cheque no / Txn id" /></Field>
                <Field label="Reference Date"><input name="reference_date" type="date" className={inputClass} /></Field>
                <label className="mt-5 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="realized" defaultChecked className="rounded border-slate-300" /> Realized (money in account)
                </label>
              </div>
              <Field label="Remark"><input name="remark" className={inputClass} /></Field>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60">{isPending ? "Saving…" : "Save Payment"}</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function ConvertModal({ inquiry, onClose, onDone }: { inquiry: B2BInquiryView; onClose: () => void; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState(inquiry.converted_order_ref ?? "");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await linkConversion(inquiry.id, ref);
      if (res.ok) onDone();
      else setError(res.error ?? "Failed.");
    });
  }

  return (
    <SimpleDialog title="Link Converted Order" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Enter the real order&apos;s PO/RF/RG ref no. once you&apos;ve entered it through Order Entry — this inquiry is then marked <strong>Converted</strong> and stays linked to that order.
        </p>
        <Field label="Order Ref No"><input value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass} placeholder="PO-0123" /></Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={submit} disabled={isPending || !ref.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{isPending ? "Linking…" : "Link Order"}</button>
        </div>
      </div>
    </SimpleDialog>
  );
}

// ── tiny local primitives ────────────────────────────────────────────────────
function SimpleDialog({ title, subtitle, children, onClose, wide }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-4 w-full rounded-2xl bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}
