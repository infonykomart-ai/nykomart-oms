"use client";

// 2026-09-30 — the whole B2B module's client surface: register table +
// KPI/report strip + detail dialog with inquiry → quotation → payments
// lifecycle. Server actions (./actions.ts) do every write; this file only
// orchestrates UI state. Visual language follows the app's existing
// slate/amber admin pages (Employees / Documents).

import { useMemo, useState, useTransition } from "react";
import { downloadXLSX, type ExportColumn } from "@/lib/export/export-table";
import { todayIST } from "@/lib/attendance/ist-date";
import { formatDocMoney } from "@/lib/b2b/money-format";
import {
  buildQuotationMessage,
  computeItemDims,
  fmtDocMoney,
  formatDims,
  isAreaUnit,
  ITEM_UNITS,
  lineAmount,
  lineArea,
  dimsFromSizeSpec,
  SQFT_TO_SQM,
  QUOTE_CURRENCIES,
  parseSizeSpec,
  type ItemDims,
} from "@/lib/b2b/erp";
// 2026-10-13 round 2 — structured buyer address in the ORDER PAGE's own
// format (Address Line 1 paste-splits itself into line 2/city/state/postcode
// via the same two libs; postal code auto-fills city/state on blur).
import { looksLikeFullAddress, parseFullAddress } from "@/lib/parse-full-address";
import { lookupPostalCode } from "@/lib/postal-lookup";
import {
  addPayment,
  createInquiry,
  createQuotation,
  deleteDocument,
  deleteInquiry,
  deletePayment,
  deleteQuotation,
  issueDocument,
  linkConversion,
  markQuotationSent,
  // 2026-10-15 merge — BOTH seller-detail editors live on this page: the
  // companies-columns panel (updateCompanyExportProfile) and the
  // b2b_export_profiles panel (saveExportProfile).
  updateCompanyExportProfile,
  saveExportProfile,
  updateInquiry,
  updateQuotation,
  type B2BDocKind,
  type B2BPaymentMode,
  type B2BQuoteStatus,
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
  // 2026-10-13 — per-item product specifications printed on PI/CI.
  size: string | null;
  material: string | null;
  manufacturing: string | null;
  colour_design: string | null;
  packaging: string | null;
  // Round 2 — structured dims parsed from `size` (the SIZE × QTY formula's
  // stored inputs; sq ft / sq mtr / CBM always recomputed via computeItemDims).
  size_length: number | null;
  size_width: number | null;
  size_thickness: number | null;
  size_unit: string | null;
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
  // 2026-10-13 — the labeled PI/CI sections (nullable: older quotations
  // predate them and the print view falls back to "To be confirmed").
  buyer_address: string | null;
  product_specs: string | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  bank_details: string | null;
  incoterm: string | null;
  subtotal: number;
  tax_percent: number;
  tax_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  terms: string | null;
  notes: string | null;
  sent_at: string | null;
  status: B2BQuoteStatus;
  payment_instructions: string | null;
  // 2026-10-13 — export-document fields every PI/CI section needs
  // (buyer_address / product_specs / payment_terms / shipping_terms /
  // bank_details / incoterm are declared with the block above).
  buyer_attention: string | null;
  payment_condition: string | null;
  payment_method: string | null;
  payment_due_note: string | null;
  bank_charges: string | null;
  port_of_loading: string | null;
  port_of_destination: string | null;
  delivery_period: string | null;
  partial_shipment: string | null;
  transshipment: string | null;
  freight_insurance: string | null;
  country_of_origin: string | null;
  packing_details: string | null;
  tax_note: string | null;
  shipping_note: string | null;
  purpose: string | null;
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
  // 2026-10-17b — size spec on asked-for lines (area pricing). Optional so
  // a pre-migration load (or an older cached shape) still compiles.
  size?: string | null;
};

export type B2BInquiryRow = {
  id: string;
  inquiry_no: string;
  inquiry_date: string;
  buyer_name: string;
  buyer_company: string | null;
  buyer_address: string | null;
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

/** The company row's SELLER / EXPORTER DETAILS columns (2026-10-13). */
export type B2BCompanyProfile = {
  business_address: string | null;
  iec_no: string | null;
  pan_no: string | null;
  gstin: string | null;
  business_email: string | null;
  business_phone: string | null;
};

// 2026-10-13 — company-level export profile (seller + beneficiary bank
// block) printed on every PI/CI; one row per company, edited from the
// register header.
export type B2BExportProfileRow = {
  id: string;
  company_id: string;
  seller_address: string | null;
  iec: string | null;
  pan: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  bank_beneficiary: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  bank_swift: string | null;
  bank_intermediary: string | null;
};

export type B2BInquiryManagerProps = {
  inquiries: B2BInquiryView[];
  companyId: string;
  companyName: string;
  companyProfile: B2BCompanyProfile | null;
  canManage: boolean;
  /** Server-side load failure (usually "table does not exist" — migration not run yet). */
  loadError?: string | null;
  /** Company export profile (seller + bank block) — null until first saved. */
  exportProfile?: B2BExportProfileRow | null;
  /** Set when the b2b_export_profiles table itself is missing (migration not run). */
  exportProfileError?: string | null;
};

const STATUSES = ["Open", "In Discussion", "Quotation Sent", "Won", "Lost", "Converted"] as const;
const PRIORITIES = ["Hot", "Warm", "Cold"] as const;
const PAYMENT_MODES: B2BPaymentMode[] = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card", "Advance"];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

// 2026-10-16 — "QUOTATION VALE SECTION ME INQUIRY AGAR AAYEGI TO KESE
// HANDLE HOYEGI — BS PCS SE CALCULATION HORI, BAKI CM, MTR, FEET, INCH,
// SQ FT, SQ MTR, PER SQ FT, PER INCH VALE SECTION NAHI HAI": every item
// editor in this file (New Inquiry modal, both "Asked-for Items" blocks
// in the inquiry details form, and the quote form) now shares ONE unit
// dropdown — the ITEM_UNITS list (extended the same day with feet / inch
// / cm and the "per …" rate units) plus an "Other…" escape hatch for a
// one-off unit the list doesn't have. Before this, the inquiry rows were
// a free-text Unit box, so in practice only "pcs" ever got typed and the
// PI printed whatever text happened to be there. Calculation is
// untouched: subtotal = Σ qty × rate is unit-agnostic on the server too
// (see actions.ts), so any unit computes correctly.
function UnitSelect({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const known = (ITEM_UNITS as readonly string[]).includes(value);
  return (
    <>
      <select
        className={`${inputClass} ${known ? "col-span-2" : "col-span-1"}`}
        value={known ? value : "__other"}
        onChange={(e) => onChange(e.target.value === "__other" ? "" : e.target.value)}
      >
        {ITEM_UNITS.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {!known && (
        <input
          className={`${inputClass} col-span-1`}
          placeholder="Unit"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}

// 2026-10-17b — "SABHI KI CALCULATION SAHI JAGAH MATCH HONI CHAHIYE": ONE
// preview strip under every item row (New Inquiry, inquiry details, quote
// form) showing the size × qty area AND the line's amount under the SAME
// lineAmount() formula the server stores into subtotal / line_total. If the
// maths here and on the server ever disagreed, that would be a bug — both
// sides import the one function from @/lib/b2b/erp.
function ItemCalcLine({
  qty,
  unit,
  unitPrice,
  size,
  currency = "INR",
}: {
  qty: string;
  unit: string;
  unitPrice: string;
  size: string;
  currency?: string;
}) {
  const parsed = parseSizeSpec(size);
  const dims = parsed
    ? computeItemDims({
        qty: parseFloat(qty) || 0,
        length: parsed.length,
        width: parsed.width,
        thickness: parsed.thickness,
        unit: parsed.unit,
      })
    : null;
  const rate = parseFloat(unitPrice) || 0;
  const amount = lineAmount({ qty: parseFloat(qty) || 0, unit, unitPrice: rate, size });
  if (!dims && !rate) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
      {dims && <span>📐 Size × Qty: {formatDims(dims)}</span>}
      {rate > 0 && (
        <span>
          💰 Amount: {fmtDocMoney(amount, currency)}
          {isAreaUnit(unit) && <span className="opacity-70"> (area × {rate}/unit)</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Total sq ft across a set of lines — the "kitna sq ft maal hua" figure.
 * Sized lines: qty × L × W. Area-unit lines with no size: qty IS the area
 * ("5000 sq ft"). Lines sized but priced per piece still count (they are
 * physical goods), non-area unsized lines contribute nothing.
 */
function sumSqFt(lines: { qty: number | string; unit?: string | null; size?: string | null }[]): number {
  const total = lines.reduce((s, l) => {
    const qty = typeof l.qty === "string" ? parseFloat(l.qty) || 0 : l.qty || 0;
    const dims = dimsFromSizeSpec(qty, l.size);
    if (dims) return s + dims.sqFt;
    const area = lineArea({ qty, unit: l.unit });
    return s + (area ? area.sqFt : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

// Editable quotation line — kept as STRINGS in UI state so typing "1." or
// "" mid-edit never fights the number parser; the server action parses.
// 2026-10-13: each line also carries the product specifications the PI must
// print (Size / Material / Manufacturing / Colour-design / Packaging).
type QuoteItemDraft = {
  description: string;
  hsnCode: string;
  qty: string;
  unit: string;
  unitPrice: string;
  size: string;
  material: string;
  manufacturing: string;
  colourDesign: string;
  packaging: string;
};
function emptyQuoteItem(): QuoteItemDraft {
  return { description: "", hsnCode: "", qty: "1", unit: "pcs", unitPrice: "", size: "", material: "", manufacturing: "", colourDesign: "", packaging: "" };
}

function fmtMoney(n: number, currency = "INR"): string {
  // 2026-10-13 — export currencies print international format (USD
  // 2,800,000.00); INR keeps the domestic ₹28,00,000.00 convention.
  return formatDocMoney(n, currency);
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
function quoteStatusClass(status: B2BQuoteStatus): string {
  switch (status) {
    case "Draft":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "Sent":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "Approved":
      return "bg-green-50 text-green-700 border-green-200";
    case "Rejected":
      return "bg-red-50 text-red-700 border-red-200";
    case "Expired":
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

// ── root component ───────────────────────────────────────────────────────────
export function B2BInquiryManager({
  inquiries,
  companyId,
  companyName,
  companyProfile,
  canManage,
  loadError,
  exportProfile,
  exportProfileError,
}: B2BInquiryManagerProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [showForm, setShowForm] = useState(false);
  const [showSeller, setShowSeller] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 2026-10-13 — register-level delete ("enquiry edit, modify, delete
  // bhi honi chahiye"): the detail dialog keeps its own Delete, this adds
  // a visible one-click row action. Same server action + audit trail.
  function deleteInquiryRow(i: B2BInquiryRow) {
    if (!window.confirm(`Delete ${i.inquiry_no} (${i.buyer_name})? This also removes its quotation, documents and payment records.`)) return;
    startTransition(async () => {
      const res = await deleteInquiry(i.id);
      if (!res.ok) window.alert(res.error ?? "Delete failed.");
      else if (selectedId === i.id) setSelectedId(null);
    });
  }

  void companyId;

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
    // 2026-10-17b — total area asked for across the register (sized lines
    // + area-unit lines): "kitna sq ft ka maal hai" at a glance.
    const askedSqFt = Math.round(
      inquiries.reduce((sum, i) => sum + sumSqFt(i.items ?? []), 0) * 100
    ) / 100;
    return { open, won, lost, quoted, quotedValue, received, pending, byMode, followups, askedSqFt };
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
                onClick={() => setShowSeller(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
                title="Seller / Exporter details stored on the company row (fallback for the PI seller block)"
              >
                🏢 Seller Details
              </button>
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                title="Seller address, IEC/PAN/GSTIN and bank details printed on every PI/CI — fill once per company"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                🏦 Export Profile{exportProfile ? "" : " ⚠"}
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Open / Active" value={String(report.open)} tone="sky" />
          <Kpi label="Quoted" value={String(report.quoted)} tone="amber" />
          <Kpi label="Quoted Value" value={fmtMoney(report.quotedValue)} tone="slate" />
          <Kpi label="Received" value={fmtMoney(report.received)} tone="green" />
          <Kpi label="Payment Pending" value={fmtMoney(Math.max(0, report.pending))} tone={report.pending > 0 ? "red" : "slate"} />
          <Kpi label="Won / Lost" value={`${report.won} / ${report.lost}`} tone="slate" />
          <Kpi
            label="Asked Area"
            value={report.askedSqFt > 0 ? `${report.askedSqFt.toLocaleString("en-US", { maximumFractionDigits: 0 })} sq ft` : "—"}
            tone={report.askedSqFt > 0 ? "green" : "slate"}
          />
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
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            {i.quote.quote_no}
                            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${quoteStatusClass(i.quote.status)}`}>{i.quote.status}</span>
                          </div>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedId(i.id)}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                        >
                          Open
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedId(i.id)}
                              title="Edit inquiry"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteInquiryRow(i)}
                              disabled={isPending}
                              title="Delete inquiry"
                              className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-500 hover:bg-red-100 disabled:opacity-60"
                            >
                              🗑
                            </button>
                          </>
                        )}
                      </div>
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

      {/* ── Export profile (seller + bank) editor ──────────────────────────── */}
      {exportProfileError && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Export-profile setup pending — run <code className="font-mono">db/2026-10-13-b2b-pi-export-fields.sql</code> in Supabase, then refresh.
          <span className="opacity-70"> ({exportProfileError})</span>
        </p>
      )}
      {showProfile && <ExportProfileModal profile={exportProfile ?? null} onClose={() => setShowProfile(false)} />}

      {/* ── New-inquiry modal ──────────────────────────────────────────── */}
      {showForm && <NewInquiryModal onClose={() => setShowForm(false)} />}

      {/* ── Seller / Exporter details (printed on every PI / CI) ───────── */}
      {showSeller && (
        <SellerDetailsDialog companyId={companyId} profile={companyProfile} onClose={() => setShowSeller(false)} />
      )}

      {/* ── Inquiry detail dialog ──────────────────────────────────────── */}
      {selected && (
        <InquiryDetailDialog inquiry={selected} canManage={canManage} companyName={companyName} onClose={() => setSelectedId(null)} />
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
              Some B2B tables/columns don&apos;t exist in the database yet. Run these SQL files in Supabase
              (Dashboard → SQL Editor → New query → paste file contents → Run), in order:
            </p>
            <ol className="mt-3 space-y-1.5 text-sm">
              {/* 2026-10-15 — the 2026-10-13 PI export-fields migration added: the PI's payment terms / ports /
                  packing / item-spec columns and b2b_export_profiles all come from it, so before it runs those
                  blocks print "To be provided". Listed last (it is the newest of the three). */}
              {["db/2026-09-30-b2b-inquiries.sql", "db/2026-09-30b-b2b-documents.sql", "db/2026-10-13-b2b-pi-export-details.sql", "db/2026-10-13-b2b-pi-export-fields.sql"].map((f, i) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">{i + 1}</span>
                  <code className="rounded bg-white px-2 py-0.5 font-mono text-xs text-slate-800 ring-1 ring-amber-200">{f}</code>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-amber-700">
              Then refresh this page — the register, quotations (PI / Commercial Invoice / Packing List documents),
              seller details and payments all light up together. No data was lost.
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
  const [items, setItems] = useState([{ description: "", qty: "", unit: "pcs", unitPrice: "", remark: "", size: "" }]);
  // 2026-10-17b — live totals under the item grid: total area (only when
  // lines are sized) + total amount under the SAME lineAmount() formula the
  // server stores, so "confirm ho sake ki kitna sq ft maal hua" at entry.
  const totalAmount = items.reduce(
    (s, it) => s + lineAmount({ qty: parseFloat(it.qty) || 0, unit: it.unit, unitPrice: parseFloat(it.unitPrice) || 0, size: it.size }),
    0
  );

  function submit(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await createInquiry({
        inquiryDate: val("inquiry_date"),
        buyerName: val("buyer_name"),
        buyerCompany: val("buyer_company"),
        buyerAddress: val("buyer_address"),
        buyerContactNo: val("buyer_contact_no"),
        buyerEmail: val("buyer_email"),
        buyerCountry: val("buyer_country"),
        source: val("source"),
        priority: val("priority"),
        requirementNotes: val("requirement_notes"),
        remarks: val("remarks"),
        followUpDate: val("follow_up_date"),
        items: items.map((it) => ({ description: it.description, qty: it.qty, unit: it.unit, unitPrice: it.unitPrice, remark: it.remark, size: it.size })),
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
          <div className="sm:col-span-2">
            <Field label="Buyer Address">
              <textarea name="buyer_address" rows={2} className={inputClass} placeholder="Full address as per the buyer&apos;s purchase order (prints on the PI)…" />
            </Field>
          </div>
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
            <button type="button" onClick={() => setItems((v) => [...v, { description: "", qty: "", unit: "pcs", unitPrice: "", remark: "", size: "" }])} className="text-xs font-medium text-amber-600 hover:underline">
              + Add item
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="space-y-1">
                <div className="grid grid-cols-12 gap-2">
                  <input className={`${inputClass} col-span-5`} placeholder="Item description" value={it.description} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                  <input className={`${inputClass} col-span-2`} placeholder="Qty" inputMode="decimal" value={it.qty} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
                  <UnitSelect value={it.unit} onChange={(u) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unit: u } : x)))} />
                  <input className={`${inputClass} col-span-2`} placeholder="Rate" inputMode="decimal" value={it.unitPrice} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))} />
                  <button type="button" className="col-span-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50" onClick={() => setItems((v) => (v.length > 1 ? v.filter((_, i) => i !== idx) : v))} aria-label="Remove item">✕</button>
                </div>
                {/* 2026-10-17b — Size + the live area/amount preview: a
                    "5000 pcs @ 5 per sq ft" line is only meaningful once its
                    size (2.6 × 10 ft) is known. */}
                <div className="grid grid-cols-12 items-center gap-2">
                  <input
                    className={`${inputClass} col-span-5 !py-1.5`}
                    placeholder="Size (2.6 × 10 ft)"
                    value={it.size}
                    onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, size: e.target.value } : x)))}
                  />
                  <div className="col-span-7">
                    <ItemCalcLine qty={it.qty} unit={it.unit} unitPrice={it.unitPrice} size={it.size} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              {items.length} item(s)
              {items.some((it) => parseSizeSpec(it.size)) && " · sized lines price by area"}
            </span>
            <span className="font-semibold text-slate-900">Estimated total: {fmtDocMoney(totalAmount)}</span>
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
function InquiryDetailDialog({ inquiry, canManage, companyName, onClose }: { inquiry: B2BInquiryView; canManage: boolean; companyName: string; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"details" | "quote" | "documents" | "payments">("details");
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  // 2026-10-13 — the asked-for items are editable from the details form
  // ("enquiry edit, modify, delete bhi honi chahiye"). Kept as strings so
  // typing never fights the parser; the server action parses.
  // 2026-10-13 — "ENQUARY EDIT, MODIFY, DELETE BHI HONI CHAHIYE": the
  // details tab's Save replaces the asked-for item rows (draft state
  // mirrors the string-typed pattern the quote form uses).
  //
  // 2026-10-17b — ONE item grid only. This dialog used to render TWO
  // "Asked-for Items" blocks: the first one edited a dead `items` state
  // that saveDetails never sent, so entries typed there (unit/rate) simply
  // never reached the server — which is what "ye to kam hi nahi kar raha"
  // looked like. The surviving block below is the one that saves, and each
  // line now carries a Size too (area pricing: per sq ft / per sq mtr).
  const [inqItems, setInqItems] = useState(
    inquiry.items.length > 0
      ? inquiry.items.map((it) => ({
          description: it.description,
          qty: String(it.qty),
          unit: it.unit ?? "pcs",
          unitPrice: it.unit_price != null ? String(it.unit_price) : "",
          remark: it.remark ?? "",
          size: it.size ?? "",
        }))
      : [{ description: "", qty: "", unit: "pcs", unitPrice: "", remark: "", size: "" }]
  );
  const inqTotalAmount = inqItems.reduce(
    (s, it) => s + lineAmount({ qty: parseFloat(it.qty) || 0, unit: it.unit, unitPrice: parseFloat(it.unitPrice) || 0, size: it.size }),
    0
  );

  function saveDetails(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await updateInquiry({
        inquiryId: inquiry.id,
        inquiryDate: val("inquiry_date"),
        buyerName: val("buyer_name"),
        buyerCompany: val("buyer_company"),
        buyerAddress: val("buyer_address"),
        buyerContactNo: val("buyer_contact_no"),
        buyerEmail: val("buyer_email"),
        buyerCountry: val("buyer_country"),
        source: val("source"),
        priority: val("priority"),
        requirementNotes: val("requirement_notes"),
        remarks: val("remarks"),
        followUpDate: val("follow_up_date"),
        status: val("status"),
        items: inqItems.map((it) => ({ ...it })),
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
          {!canManage && inquiry.items.length > 0 && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Asked-for items</div>
              <ul className="list-inside list-disc space-y-0.5 text-slate-700">
                {inquiry.items.map((it, i) => {
                  const area = lineArea({ qty: it.qty, unit: it.unit, size: it.size });
                  const amount = lineAmount({ qty: it.qty, unit: it.unit, unitPrice: it.unit_price ?? 0, size: it.size });
                  return (
                    <li key={i}>
                      {it.description}
                      {it.size ? ` (${it.size})` : ""} — {it.qty} {it.unit ?? ""}{it.unit_price != null ? ` @ ${fmtMoney(it.unit_price, inquiry.quote?.currency)}` : ""}
                      {area && <span className="text-slate-500"> · 📐 {area.sqFt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft</span>}
                      {it.unit_price != null && <span className="text-slate-500"> · 💰 {fmtMoney(amount, inquiry.quote?.currency)}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {canManage ? (
            <form action={saveDetails} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Inquiry Date"><input name="inquiry_date" type="date" defaultValue={inquiry.inquiry_date} className={inputClass} /></Field>
                <Field label="Buyer Name"><input name="buyer_name" defaultValue={inquiry.buyer_name} className={inputClass} /></Field>
                <Field label="Company"><input name="buyer_company" defaultValue={inquiry.buyer_company ?? ""} className={inputClass} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Buyer Address">
                    <textarea name="buyer_address" rows={2} defaultValue={inquiry.buyer_address ?? ""} className={inputClass} placeholder="Full address as per the buyer&apos;s purchase order (prints on the PI)…" />
                  </Field>
                </div>
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

              {/* 2026-10-13 — asked-for items are now EDITABLE here (edit /
                  modify the enquiry itself, not just its header fields);
                  2026-10-17b — the ONLY item grid in this form (the dead
                  duplicate above it is gone), now with Size + live
                  area/amount per line and a running total. */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className={labelClass}>Asked-for Items</span>
                  <button
                    type="button"
                    onClick={() => setInqItems((v) => [...v, { description: "", qty: "", unit: "pcs", unitPrice: "", remark: "", size: "" }])}
                    className="text-xs font-medium text-amber-600 hover:underline"
                  >
                    + Add item
                  </button>
                </div>
                <div className="space-y-2">
                  {inqItems.map((it, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="grid grid-cols-12 gap-2">
                        <input className={`${inputClass} col-span-5`} placeholder="Item description" value={it.description} onChange={(e) => setInqItems((v) => v.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                        <input className={`${inputClass} col-span-2`} placeholder="Qty" inputMode="decimal" value={it.qty} onChange={(e) => setInqItems((v) => v.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
                        <UnitSelect value={it.unit} onChange={(u) => setInqItems((v) => v.map((x, i) => (i === idx ? { ...x, unit: u } : x)))} />
                        <input className={`${inputClass} col-span-2`} placeholder="Rate" inputMode="decimal" value={it.unitPrice} onChange={(e) => setInqItems((v) => v.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))} />
                        <button type="button" className="col-span-1 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50" onClick={() => setInqItems((v) => (v.length > 1 ? v.filter((_, i) => i !== idx) : v))} aria-label="Remove item">✕</button>
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <input
                          className={`${inputClass} col-span-5 !py-1.5`}
                          placeholder="Size (2.6 × 10 ft)"
                          value={it.size}
                          onChange={(e) => setInqItems((v) => v.map((x, i) => (i === idx ? { ...x, size: e.target.value } : x)))}
                        />
                        <div className="col-span-7">
                          <ItemCalcLine qty={it.qty} unit={it.unit} unitPrice={it.unitPrice} size={it.size} currency={inquiry.quote?.currency} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>
                    {inqItems.length} item(s)
                    {inqItems.some((it) => parseSizeSpec(it.size)) && " · sized lines price by area"}
                  </span>
                  <span className="font-semibold text-slate-900">Total: {fmtMoney(inqTotalAmount, inquiry.quote?.currency)}</span>
                </div>
              </div>

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

      {mode === "quote" && <QuotePanel inquiry={inquiry} canManage={canManage} companyName={companyName} showForm={showQuoteForm} setShowForm={setShowQuoteForm} setError={setError} />}

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
  companyName,
}: {
  inquiry: B2BInquiryView;
  canManage: boolean;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  setError: (s: string | null) => void;
  companyName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const q = inquiry.quote;
  // 2026-10-17b — total sq ft of the SAVED lines (the number the buyer's
  // documents and the register's reports read back).
  const savedTotalSqFt = q ? sumSqFt(q.items ?? []) : 0;

  // Line items drive the money (server computes subtotal from the SAME
  // lineAmount formula — area × rate for "per sq ft" lines with a Size);
  // used by BOTH the create form and the edit form below.
  const [items, setItems] = useState<QuoteItemDraft[]>([emptyQuoteItem()]);
  // 2026-10-13 round 2 — "CURRENCY SELECTION DROPDOWN, EK BAAR SELECT
  // KARTE HI PURI QUOTATION ME CHANGE HO JAYE": the form's currency is
  // controlled state, so every live figure (subtotal preview, item rates'
  // context) re-renders the moment the select changes.
  const [currencySel, setCurrencySel] = useState("INR");
  // Draft lifecycle — a new quote is saved as Draft unless explicitly
  // "Save & Sent"; a Draft can be edited/deleted outright.
  const [saveStatus, setSaveStatus] = useState<"Draft" | "Sent">("Draft");
  // Structured buyer address in the ORDER PAGE's format (line 1 / line 2 /
  // city / state / postal) — composed into the single buyer_address column
  // on save, so the print page and old data stay compatible.
  const [addr, setAddr] = useState({ a1: "", a2: "", city: "", state: "", postal: "", country: "" });

  const liveSubtotal = items.reduce(
    (s, it) =>
      s + lineAmount({ qty: parseFloat(it.qty) || 0, unit: it.unit, unitPrice: parseFloat(it.unitPrice) || 0, size: it.size }),
    0
  );
  const liveTotalSqFt = sumSqFt(items);

  function buildPayload(formData: FormData) {
    const val = (k: string) => String(formData.get(k) ?? "");
    // Compose the structured address into the one stored column, skipping
    // empty parts ("City, State PIN" becomes its own line — exactly how a
    // real export address block reads).
    const cityLine = [addr.city, addr.state, addr.postal].filter(Boolean).join(", ");
    const composedAddress = [addr.a1, addr.a2, cityLine].filter((s) => s && s.trim()).join("\n");
    return {
      inquiryId: inquiry.id,
      quotationId: q?.id,
      quoteDate: val("quote_date"),
      validUntil: val("valid_until"),
      buyerName: val("buyer_name"),
      buyerContactNo: val("buyer_contact_no"),
      buyerEmail: val("buyer_email"),
      buyerCountry: addr.country || val("buyer_country"),
      taxPercent: val("tax_percent"),
      shippingAmount: val("shipping_amount"),
      currency: currencySel,
      terms: val("terms"),
      notes: val("notes"),
      status: saveStatus,
      paymentInstructions: val("payment_instructions"),
      // 2026-10-13 — export-document fields (every PI/CI section, both
      // rounds' columns: the structured ones AND the free-text blocks).
      incoterm: val("incoterm"),
      // Structured address composition wins when filled; the plain
      // buyer_address textarea (2026-10-13 completeness round) is the
      // fallback so neither editor's text is ever dropped.
      buyerAddress: composedAddress || val("buyer_address"),
      productSpecs: val("product_specs"),
      paymentTerms: val("payment_terms"),
      shippingTerms: val("shipping_terms"),
      bankDetails: val("bank_details"),
      buyerAttention: val("buyer_attention"),
      paymentCondition: val("payment_condition"),
      paymentMethod: val("payment_method"),
      paymentDueNote: val("payment_due_note"),
      bankCharges: val("bank_charges"),
      portOfLoading: val("port_of_loading"),
      portOfDestination: val("port_of_destination"),
      deliveryPeriod: val("delivery_period"),
      partialShipment: val("partial_shipment"),
      transshipment: val("transshipment"),
      freightInsurance: val("freight_insurance"),
      countryOfOrigin: val("country_of_origin"),
      packingDetails: val("packing_details"),
      taxNote: val("tax_note"),
      shippingNote: val("shipping_note"),
      purpose: val("purpose"),
      items: items.map((it) => ({
        description: it.description,
        hsnCode: it.hsnCode,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice,
        size: it.size,
        material: it.material,
        manufacturing: it.manufacturing,
        colourDesign: it.colourDesign,
        packaging: it.packaging,
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
        size: it.size ?? "",
        material: it.material ?? "",
        manufacturing: it.manufacturing ?? "",
        colourDesign: it.colour_design ?? "",
        packaging: it.packaging ?? "",
      }))
    );
    setCurrencySel(q.currency);
    setSaveStatus(q.status === "Sent" ? "Sent" : "Draft");
    // Split the stored address string back into the structured fields —
    // the same parser the order page uses handles collapsed one-liners too.
    const parsed = parseFullAddress(q.buyer_address ?? "");
    setAddr({
      a1: parsed.address1,
      a2: parsed.address2,
      city: parsed.city,
      state: parsed.state,
      postal: parsed.postalCode,
      country: parsed.country || q.buyer_country || "",
    });
    setShowForm(true);
  }

  function openCreateForm() {
    setItems([emptyQuoteItem()]);
    setCurrencySel("INR");
    setSaveStatus("Draft");
    setAddr({ a1: "", a2: "", city: "", state: "", postal: "", country: inquiry.buyer_country ?? "" });
    setShowForm(true);
  }

  // Order-page paste behaviour: a full address pasted into Address Line 1
  // splits itself into line 2 / city / state / postcode / country before
  // the browser would collapse the newlines.
  function handleAddr1Paste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text/plain");
    if (!looksLikeFullAddress(pasted)) return;
    e.preventDefault();
    applyParsed(pasteeToAddr(pasted));
  }
  function pasteeToAddr(raw: string) {
    const p = parseFullAddress(raw);
    return { a1: p.address1, a2: p.address2, city: p.city, state: p.state, postal: p.postalCode, country: p.country };
  }
  function applyParsed(next: ReturnType<typeof pasteeToAddr>) {
    // "Only fill what's still empty" — same rule as the order form, so a
    // value already typed is never silently overwritten.
    setAddr((cur) => ({
      a1: cur.a1 || next.a1,
      a2: cur.a2 || next.a2,
      city: cur.city || next.city,
      state: cur.state || next.state,
      postal: cur.postal || next.postal,
      country: cur.country || next.country,
    }));
  }
  function splitAddressInBox() {
    if (!addr.a1.trim()) return;
    applyParsed(pasteeToAddr(addr.a1));
  }
  // Postal → city/state autofill on blur (same free lookups, same
  // "never blocks, never overwrites" rules as the order page).
  async function handlePostalBlur() {
    if (!addr.postal.trim()) return;
    const result = await lookupPostalCode(addr.postal, addr.country);
    if (!result) return;
    setAddr((cur) => ({ ...cur, city: cur.city || result.city, state: cur.state || result.state }));
  }

  // 2026-10-13 round 2 — "EK BADHIYA SE FORMATE ME JAYE USKE PASS": the
  // buyer receives the SAME structured message on WhatsApp and email —
  // bold headings, per-line size + qty × rate, totals with amount-in-words,
  // payment/delivery terms, validity and sign-off — built by the pure
  // buildQuotationMessage() so it always matches the A4 print page.
  const sharePayload = q
    ? buildQuotationMessage({
        docNo: (q.documents ?? []).at(-1)?.doc_no ?? q.quote_no,
        docDate: fmtDate((q.documents ?? []).at(-1)?.doc_date ?? q.quote_date),
        validUntil: q.valid_until ? fmtDate(q.valid_until) : null,
        companyName: companyName || "Nykomart",
        buyerName: q.buyer_name,
        buyerCompany: inquiry.buyer_company,
        currency: q.currency,
        subtotal: q.subtotal,
        taxLabel: q.tax_note ?? `Tax (${q.tax_percent}%)`,
        taxAmount: q.tax_amount ?? 0,
        taxIsNote: !!q.tax_note,
        shippingLabel: q.shipping_note ?? "Shipping & Freight",
        shippingAmount: q.shipping_amount,
        shippingIsNote: !!q.shipping_note,
        total: q.total_amount ?? 0,
        paymentCondition: q.payment_condition,
        paymentMethod: q.payment_method,
        deliveryPeriod: q.delivery_period,
        incoterm: q.incoterm,
        terms: q.terms,
        lines: (q.items ?? []).map((it) => ({
          description: it.description,
          hsnCode: it.hsn_code,
          qty: it.qty,
          unit: it.unit,
          unitPrice: it.unit_price,
          lineTotal: it.line_total ?? 0,
          sizeSpec: it.size,
        })),
      })
    : "";
  const waText = encodeURIComponent(sharePayload);

  // Sharing IS sending: a Draft flips to Sent (server-side, idempotent)
  // at the moment the buyer link opens, so the register never lies about
  // what the buyer has actually received.
  function shareVia(kind: "wa" | "email") {
    if (!q) return;
    const url =
      kind === "wa"
        ? `https://wa.me/${(q.buyer_contact_no ?? "").replace(/[^\d]/g, "")}?text=${waText}`
        : `mailto:${q.buyer_email}?subject=${encodeURIComponent(`Quotation ${q.quote_no} — ${companyName || "Nykomart"}`)}&body=${waText}`;
    startTransition(async () => {
      if (q.status === "Draft") await markQuotationSent(q.id);
      if (kind === "wa") window.open(url, "_blank", "noopener,noreferrer");
      else window.location.href = url;
    });
  }

  function removeQuote() {
    if (!q) return;
    if (!window.confirm(`Delete draft quotation ${q.quote_no}? Its item rows go too — this cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteQuotation(q.id);
      if (!res.ok) setLocalError(res.error ?? "Delete failed.");
    });
  }

  // LIVE size × qty formula preview — the exact same computeItemDims() the
  // server persists dimensions from, so what the user sees here is what
  // the PI prints and what any packing maths will use.
  function lineDims(it: QuoteItemDraft): { text: string; dims: ItemDims } | null {
    const parsed = parseSizeSpec(it.size);
    if (!parsed) return null;
    const dims = computeItemDims({
      qty: parseFloat(it.qty) || 0,
      length: parsed.length,
      width: parsed.width,
      thickness: parsed.thickness,
      unit: parsed.unit,
    });
    return { text: formatDims(dims), dims };
  }

  return (
    <div className="space-y-3">
      {localError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{localError}</p>}
      {!q && !showForm && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm text-slate-500">No quotation yet for this inquiry.</p>
          {canManage && (
            <button type="button" onClick={openCreateForm} className="mt-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
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
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  {q.quote_no}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${quoteStatusClass(q.status)}`}>{q.status}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {fmtDate(q.quote_date)}{q.valid_until ? ` · valid till ${fmtDate(q.valid_until)}` : ""}
                  {q.status === "Draft" ? " · draft — not shared with the buyer yet" : q.sent_at ? " · sent ✓" : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{fmtDocMoney(q.total_amount, q.currency)}</div>
                <div className="text-xs text-slate-500">
                  {fmtDocMoney(q.subtotal, q.currency)} + {q.tax_percent}% tax + {fmtDocMoney(q.shipping_amount, q.currency)} ship
                </div>
              </div>
            </div>
            {/* 2026-10-13 — export-document quick summary: payment + shipping
                terms the PI carries, so a missing field is visible BEFORE
                issuing the document. */}
            {[
              ["Payment", [q.payment_condition, q.payment_method, q.payment_due_note].filter(Boolean).join(" · ")],
              ["Shipping", [q.incoterm, q.port_of_loading && `Load: ${q.port_of_loading}`, q.port_of_destination && `Dest: ${q.port_of_destination}`, q.delivery_period].filter(Boolean).join(" · ")],
              ["Buyer", [q.buyer_attention && `Attn: ${q.buyer_attention}`, q.buyer_address].filter(Boolean).join(" · ")],
            ].map(([label, value]) =>
              value ? (
                <p key={label} className="mt-1 text-xs text-slate-500"><strong>{label}:</strong> {value}</p>
              ) : null
            )}
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
                    {(q.items ?? []).map((it) => {
                      // Same SIZE × QTY formula as the form preview & PI: recompute
                      // from the stored spec so every surface agrees.
                      const d = lineDims({ ...emptyQuoteItem(), qty: String(it.qty), size: it.size ?? "" });
                      return (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5 text-slate-800">
                          {it.description}
                          {(it.size || it.material || it.manufacturing || it.colour_design || it.packaging || d) && (
                            <div className="text-[11px] text-slate-400">
                              {[it.size, it.material, it.manufacturing, it.colour_design, it.packaging].filter(Boolean).join(" · ")}
                              {d && <span className="ml-1 font-medium text-emerald-700">→ {d.text}</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">{it.hsn_code ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right">{it.qty}</td>
                        <td className="px-3 py-1.5">{it.unit ?? "pcs"}</td>
                        <td className="px-3 py-1.5 text-right">{fmtDocMoney(it.unit_price, q.currency)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{fmtDocMoney(it.line_total, q.currency)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {savedTotalSqFt > 0 && (
                  <div className="border-t border-slate-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-800">
                    📐 Total: {savedTotalSqFt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft
                    <span className="opacity-70"> ({(savedTotalSqFt * SQFT_TO_SQM).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq mtr)</span>
                  </div>
                )}
              </div>
            )}
            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                {q.status === "Draft" && (
                  <span className="self-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    Draft — sharing below marks it Sent
                  </span>
                )}
                {q.status === "Draft" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete draft quotation ${q.quote_no}? This cannot be undone.`)) return;
                      removeQuote();
                    }}
                    disabled={isPending}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-60"
                  >
                    🗑 Delete Draft
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
                  <button type="button" onClick={() => shareVia("wa")} disabled={isPending} className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-60">
                    Share on WhatsApp
                  </button>
                )}
                {q.buyer_email && (
                  <button type="button" onClick={() => shareVia("email")} disabled={isPending} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                    Email
                  </button>
                )}
              </div>
            )}
          </div>
          {/* totals recap table (invoice-style) — international document format */}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-1.5 text-slate-500">Subtotal</td><td className="py-1.5 text-right font-medium">{fmtDocMoney(q.subtotal, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">{q.tax_note ?? `Tax (${q.tax_percent}%)`}</td><td className="py-1.5 text-right font-medium">{q.tax_note ? "—" : fmtDocMoney(q.tax_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">{q.shipping_note ?? "Shipping"}</td><td className="py-1.5 text-right font-medium">{q.shipping_note ? "—" : fmtDocMoney(q.shipping_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 font-semibold text-slate-900">Total</td><td className="py-1.5 text-right font-bold">{fmtDocMoney(q.total_amount, q.currency)}</td></tr>
              <tr><td className="py-1.5 text-slate-500">Received</td><td className="py-1.5 text-right font-medium text-green-700">{fmtDocMoney((q.payments ?? []).reduce((s, p) => s + p.amount, 0), q.currency)}</td></tr>
              <tr><td className="py-1.5 font-medium text-slate-700">Balance Due</td><td className={`py-1.5 text-right font-bold ${q.total_amount - (q.payments ?? []).reduce((s, p) => s + p.amount, 0) > 0 ? "text-red-600" : "text-green-700"}`}>
                {fmtDocMoney(q.total_amount - (q.payments ?? []).reduce((s, p) => s + p.amount, 0), q.currency)}
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
            <Field label={q && q.status !== "Draft" ? "Quote Date (locked after sending)" : "Quote Date"}>
              <input
                name="quote_date"
                type="date"
                required
                disabled={!!q && q.status !== "Draft"}
                defaultValue={q?.quote_date ?? ""}
                className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
              />
            </Field>
            <Field label="Valid Until"><input name="valid_until" type="date" defaultValue={q?.valid_until ?? ""} className={inputClass} /></Field>
            <Field label="Buyer Name"><input name="buyer_name" defaultValue={q?.buyer_name ?? inquiry.buyer_name} className={inputClass} /></Field>
            <Field label="Contact No"><input name="buyer_contact_no" defaultValue={q?.buyer_contact_no ?? inquiry.buyer_contact_no ?? ""} className={inputClass} /></Field>
            <Field label="Email"><input name="buyer_email" type="email" defaultValue={q?.buyer_email ?? inquiry.buyer_email ?? ""} className={inputClass} /></Field>
            <Field label="Country"><input name="buyer_country" defaultValue={q?.buyer_country ?? inquiry.buyer_country ?? ""} className={inputClass} /></Field>
            <Field label="Tax %"><input name="tax_percent" inputMode="decimal" defaultValue={q ? String(q.tax_percent) : "0"} className={inputClass} /></Field>
            <Field label="Shipping"><input name="shipping_amount" inputMode="decimal" defaultValue={q ? String(q.shipping_amount) : "0"} className={inputClass} placeholder="0 — prints &quot;To be confirmed&quot;" /></Field>
            {/* 2026-10-13 r2 — "CURRENCY SELECTION DROPDOWN, EK BAAR SELECT
                KARTE HI PURI QUOTATION ME CHANGE HO JAYE": a real select off
                the shared QUOTE_CURRENCIES list; controlled, so the whole
                form's live figures re-render the moment it changes. */}
            <Field label="Currency">
              <select name="currency" value={currencySel} onChange={(e) => setCurrencySel(e.target.value)} className={inputClass}>
                {QUOTE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            {/* Status: born Draft; "Sent" only when explicitly chosen (sharing
                a Draft later also flips it server-side). */}
            {(!q || q.status === "Draft") && (
              <Field label="Save As">
                <select value={saveStatus} onChange={(e) => setSaveStatus(e.target.value === "Sent" ? "Sent" : "Draft")} className={inputClass}>
                  <option value="Draft">Draft — edit / delete / send later</option>
                  <option value="Sent">Sent — already shared with the buyer</option>
                </select>
              </Field>
            )}
          </div>

          {/* 2026-10-13 — the labeled PI/CI sections. These print on the
              issued Proforma Invoice / Commercial Invoice; blank fields
              print "To be confirmed" / "To be provided". */}
          <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-800">
            📄 The fields below print as labeled sections on the PI / Commercial Invoice. Leave blank to print
            &quot;To be confirmed&quot; — trade terms are never guessed.
          </div>
          <Field label="Buyer Address">
            <textarea name="buyer_address" rows={2} defaultValue={q?.buyer_address ?? inquiry.buyer_address ?? ""} className={inputClass} placeholder="Full address as per the buyer&apos;s purchase order…" />
          </Field>
          <Field label="Product Specifications">
            <textarea name="product_specs" rows={3} defaultValue={q?.product_specs ?? ""} className={inputClass} placeholder={"Size: 2 × 6 feet\nMaterial: 100% jute, if accurate\nManufacturing: Handmade, handwoven\nColour / Design: As agreed\nPackaging: Individual / bulk, as agreed\nCountry of Origin: India, if accurate"} />
          </Field>
          <Field label="Payment Terms">
            <textarea name="payment_terms" rows={3} defaultValue={q?.payment_terms ?? ""} className={inputClass} placeholder={"100% advance payment before dispatch, if agreed\nPayment method: Bank transfer (T/T), if agreed\nPayment due date: …\nBank charges: Buyer / seller / shared, as agreed"} />
          </Field>
          <Field label="Shipping & Delivery Terms">
            <textarea name="shipping_terms" rows={4} defaultValue={q?.shipping_terms ?? ""} className={inputClass} placeholder={"Port of Loading: …\nPort of Destination: …\nDelivery Period: e.g. 90 days after advance payment\nPartial Shipment: Allowed / Not allowed\nTransshipment: Allowed / Not allowed, as agreed\nFreight & Insurance: …"} />
          </Field>
          <Field label="Seller Bank Details (prints on PI)">
            <textarea name="bank_details" rows={4} defaultValue={q?.bank_details ?? ""} className={inputClass} placeholder={"Beneficiary Name: …\nBank Name & Branch: …\nAccount Number: …\nSWIFT / BIC: …\nIntermediary Bank: If applicable"} />
          </Field>
          <Field label="Terms"><input name="terms" defaultValue={q?.terms ?? ""} className={inputClass} placeholder="50% advance, balance before dispatch…" /></Field>
          {/* 2026-10-13 r2 — "PAYMENT INSTRUCTION": the buyer-facing
              bank-remittance paragraph (what their bank actually needs —
              separate from the short condition line below). */}
          <Field label="Payment Instructions (buyer's bank remittance note)">
            <textarea
              name="payment_instructions"
              rows={2}
              defaultValue={q?.payment_instructions ?? ""}
              className={inputClass}
              placeholder="Remit 100% advance to the beneficiary bank quoted on the Proforma Invoice quoting invoice no. as reference…"
            />
          </Field>
          <Field label="Notes"><textarea name="notes" rows={2} defaultValue={q?.notes ?? ""} className={inputClass} /></Field>

          {/* ── 2026-10-13 — export-document fields (every PI/CI section) ── */}
          <details className="rounded-lg border border-slate-200 bg-white p-3" open>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
              Export document details (PI / CI sections)
            </summary>
            <div className="mt-3 space-y-3">
              {/* 2026-10-13 r2 — "ADDRESS FORMAT Kaise KAAM KARTA HAI APNE
                  ORDER PAGE SE USE KAR SAKTE HAIN": the order page's own
                  structured-address UX, reused verbatim — paste the full
                  address into Line 1 and it splits itself; postal code
                  auto-fills city/state on blur. Composed into the one
                  buyer_address column on save. */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className={labelClass}>Buyer Address (order-page format)</span>
                  <button
                    type="button"
                    onClick={splitAddressInBox}
                    className="text-xs font-medium text-amber-700 hover:underline"
                    title="If the full address got pasted into Line 1, click to split it into City/State/Postcode below"
                  >
                    ✂ Split Address
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">
                  Tip: paste the buyer&apos;s full address (street, city, state, zip, country) into Address Line 1 — it splits itself.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <span className={labelClass}>Address Line 1</span>
                    <input value={addr.a1} onPaste={handleAddr1Paste} onChange={(e) => setAddr((cur) => ({ ...cur, a1: e.target.value }))} className={inputClass} placeholder="Plot 128, Sultan Abubakar Road" />
                  </div>
                  <div className="sm:col-span-2">
                    <span className={labelClass}>Address Line 2</span>
                    <input value={addr.a2} onChange={(e) => setAddr((cur) => ({ ...cur, a2: e.target.value }))} className={inputClass} />
                  </div>
                  <div><span className={labelClass}>City</span><input value={addr.city} onChange={(e) => setAddr((cur) => ({ ...cur, city: e.target.value }))} className={inputClass} /></div>
                  <div><span className={labelClass}>State / Province</span><input value={addr.state} onChange={(e) => setAddr((cur) => ({ ...cur, state: e.target.value }))} className={inputClass} /></div>
                  <div><span className={labelClass}>Postal / Zip Code</span><input value={addr.postal} onChange={(e) => setAddr((cur) => ({ ...cur, postal: e.target.value }))} onBlur={() => void handlePostalBlur()} className={inputClass} /></div>
                  <div><span className={labelClass}>Country</span><input value={addr.country} onChange={(e) => setAddr((cur) => ({ ...cur, country: e.target.value }))} className={inputClass} placeholder="Nigeria" /></div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-3">
                  <Field label="Buyer Attention (contact person)"><input name="buyer_attention" defaultValue={q?.buyer_attention ?? ""} className={inputClass} placeholder="e.g. Najm Ahmad / Alhaji …" /></Field>
                  <Field label="Purpose of Invoice"><input name="purpose" defaultValue={q?.purpose ?? ""} className={inputClass} placeholder="Proforma invoice for advance payment and buyer-bank processing" /></Field>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Payment Condition"><input name="payment_condition" defaultValue={q?.payment_condition ?? ""} className={inputClass} placeholder="100% advance before dispatch" /></Field>
                <Field label="Payment Method"><input name="payment_method" defaultValue={q?.payment_method ?? ""} className={inputClass} placeholder="Bank Transfer (T/T)" /></Field>
                <Field label="Payment Due"><input name="payment_due_note" defaultValue={q?.payment_due_note ?? ""} className={inputClass} placeholder="Before dispatch / Net 30…" /></Field>
                <Field label="Bank Charges"><input name="bank_charges" defaultValue={q?.bank_charges ?? ""} className={inputClass} placeholder="To be mutually agreed / Buyer's account…" /></Field>
                <Field label="Tax Note (replaces tax % on PI)"><input name="tax_note" defaultValue={q?.tax_note ?? ""} className={inputClass} placeholder="To be confirmed — verify export GST treatment" /></Field>
                <Field label="Shipping Note (replaces shipping ₹ on PI)"><input name="shipping_note" defaultValue={q?.shipping_note ?? ""} className={inputClass} placeholder="To be confirmed / Free FOB…" /></Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Incoterm">
                  <select name="incoterm" defaultValue={q?.incoterm ?? ""} className={inputClass}>
                    <option value="">To be confirmed</option>
                    {["EXW", "FOB", "CFR", "CIF", "FCA", "DAP", "DDP"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Port of Loading"><input name="port_of_loading" defaultValue={q?.port_of_loading ?? ""} className={inputClass} placeholder="e.g. Mundra / Kolkata" /></Field>
                <Field label="Port of Destination"><input name="port_of_destination" defaultValue={q?.port_of_destination ?? ""} className={inputClass} placeholder="e.g. Lagos / Onne" /></Field>
                <Field label="Delivery Period"><input name="delivery_period" defaultValue={q?.delivery_period ?? ""} className={inputClass} placeholder="e.g. 90 days after advance payment" /></Field>
                <Field label="Partial Shipment">
                  <select name="partial_shipment" defaultValue={q?.partial_shipment ?? ""} className={inputClass}>
                    <option value="">To be agreed</option>
                    {['Allowed', 'Not allowed'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Transshipment">
                  <select name="transshipment" defaultValue={q?.transshipment ?? ""} className={inputClass}>
                    <option value="">To be agreed</option>
                    {['Allowed', 'Not allowed'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Freight &amp; Insurance Paid By"><input name="freight_insurance" defaultValue={q?.freight_insurance ?? ""} className={inputClass} placeholder="Buyer / Seller (as per Incoterm)" /></Field>
                <Field label="Country of Origin"><input name="country_of_origin" defaultValue={q?.country_of_origin ?? ""} className={inputClass} placeholder="India" /></Field>
                <Field label="Packing Details"><input name="packing_details" defaultValue={q?.packing_details ?? ""} className={inputClass} placeholder="Individual / bulk packaging, as agreed" /></Field>
              </div>
            </div>
          </details>

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
                <div key={idx} className="rounded-lg border border-slate-100 bg-white p-2">
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      className={`${inputClass} col-span-3`}
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
                    {/* 2026-10-13 r2 unit dropdown; 2026-10-16 se ye SAME UnitSelect
                        har item editor me common hai (inquiry create/edit bhi), aur
                        CM / FEET / INCH + "per …" rate units tak extended hai. */}
                    <UnitSelect value={it.unit} onChange={(u) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, unit: u } : x)))} />
                    <input
                      className={`${inputClass} ${!(ITEM_UNITS as readonly string[]).includes(it.unit) ? "col-span-1" : "col-span-2"}`}
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
                  {/* 2026-10-13 — per-item product specifications printed on the PI */}
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <input className={`${inputClass} !py-1.5`} placeholder="Size (2 × 6 feet)" value={it.size} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, size: e.target.value } : x)))} />
                    <input className={`${inputClass} !py-1.5`} placeholder="Material (100% Jute)" value={it.material} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, material: e.target.value } : x)))} />
                    <input className={`${inputClass} !py-1.5`} placeholder="Manufacturing (Handmade)" value={it.manufacturing} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, manufacturing: e.target.value } : x)))} />
                    <input className={`${inputClass} !py-1.5`} placeholder="Colour / design" value={it.colourDesign} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, colourDesign: e.target.value } : x)))} />
                    <input className={`${inputClass} !py-1.5`} placeholder="Packaging" value={it.packaging} onChange={(e) => setItems((v) => v.map((x, i) => (i === idx ? { ...x, packaging: e.target.value } : x)))} />
                  </div>
                  {/* 2026-10-13 r2 — SIZE × QTY preview (sq ft / sq mtr /
                      CBM); 2026-10-17b — now also the line's AMOUNT under
                      the same lineAmount() formula the server stores. */}
                  <ItemCalcLine qty={it.qty} unit={it.unit} unitPrice={it.unitPrice} size={it.size} currency={currencySel} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-500">
                {items.filter((it) => it.description.trim()).length} item(s)
                {liveTotalSqFt > 0 && (
                  <span className="ml-2 font-medium text-emerald-700">
                    📐 {liveTotalSqFt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq ft
                    <span className="text-emerald-600/70"> ({(liveTotalSqFt * SQFT_TO_SQM).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sq mtr)</span>
                  </span>
                )}
              </span>
              <span className="font-semibold text-slate-900">Subtotal ({currencySel}): {fmtDocMoney(liveSubtotal, currencySel)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
              {isPending
                ? "Saving…"
                : q
                  ? "Save Changes"
                  : saveStatus === "Sent"
                    ? "Create & Mark Sent"
                    : "Save as Draft"}
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

// ── Seller / Exporter details — the SELLER block printed on every PI/CI ────
// 2026-10-13 — "Seller ki complete details missing hain": full business
// address, IEC, PAN, GSTIN (where applicable), business email and phone,
// edited once per company (not per quotation) and printed from the
// companies row. Empty fields print "To be provided" on the document.
function SellerDetailsDialog({
  companyId,
  profile,
  onClose,
}: {
  companyId: string;
  profile: B2BCompanyProfile | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await updateCompanyExportProfile({
        companyId,
        businessAddress: val("business_address"),
        iecNo: val("iec_no"),
        panNo: val("pan_no"),
        gstin: val("gstin"),
        businessEmail: val("business_email"),
        businessPhone: val("business_phone"),
      });
      if (res.ok) onClose();
      else setError(res.error ?? "Save failed.");
    });
  }

  return (
    <SimpleDialog
      title="Seller / Exporter Details"
      subtitle="Printed in section 1 of every Proforma Invoice / Commercial Invoice"
      onClose={onClose}
      wide
    >
      <form action={save} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Registered / Business Address">
              <textarea name="business_address" rows={3} defaultValue={profile?.business_address ?? ""} className={inputClass} placeholder="Full business / registered address, India" />
            </Field>
          </div>
          <Field label="IEC (Importer Exporter Code)"><input name="iec_no" defaultValue={profile?.iec_no ?? ""} className={inputClass} placeholder="If available" /></Field>
          <Field label="PAN"><input name="pan_no" defaultValue={profile?.pan_no ?? ""} className={inputClass} /></Field>
          <Field label="GSTIN"><input name="gstin" defaultValue={profile?.gstin ?? ""} className={inputClass} placeholder="Where applicable" /></Field>
          <Field label="Business Email"><input name="business_email" type="email" defaultValue={profile?.business_email ?? ""} className={inputClass} /></Field>
          <Field label="Telephone"><input name="business_phone" defaultValue={profile?.business_phone ?? ""} className={inputClass} /></Field>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Verify IEC / PAN / GSTIN before issuing a document. Seller <strong>bank details</strong> are entered per
          quotation (Bank Details field in the quotation form) — verify them with the bank before printing.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
            {isPending ? "Saving…" : "Save Details"}
          </button>
        </div>
      </form>
    </SimpleDialog>
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

// ── Export profile editor (2026-10-13) ───────────────────────────────────────
// "Seller ki complete details missing hain" + "Bank details missing hain":
// ONE modal per company, saved once into b2b_export_profiles, printed on
// every PI/CI. Blanks print "To be provided" on the document — this form
// never invents IEC/PAN/GSTIN/bank numbers.
function ExportProfileModal({ profile, onClose }: { profile: B2BExportProfileRow | null; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const val = (k: string) => String(formData.get(k) ?? "");
    startTransition(async () => {
      const res = await saveExportProfile({
        sellerAddress: val("seller_address"),
        iec: val("iec"),
        pan: val("pan"),
        gstin: val("gstin"),
        email: val("email"),
        phone: val("phone"),
        bankBeneficiary: val("bank_beneficiary"),
        bankName: val("bank_name"),
        bankBranch: val("bank_branch"),
        bankAccount: val("bank_account"),
        bankSwift: val("bank_swift"),
        bankIntermediary: val("bank_intermediary"),
      });
      if (res.ok) onClose();
      else setError(res.error ?? "Save failed.");
    });
  }

  return (
    <SimpleDialog title="Company Export Profile" subtitle="Seller + bank details printed on every PI / CI — fill once per company" onClose={onClose} wide>
      <form action={submit} className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Seller / Exporter</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Registered / Business Address">
                <textarea name="seller_address" rows={3} defaultValue={profile?.seller_address ?? ""} className={inputClass} placeholder="Full address with city, state, PIN, India" />
              </Field>
            </div>
            <Field label="IEC (Importer Exporter Code)"><input name="iec" defaultValue={profile?.iec ?? ""} className={inputClass} /></Field>
            <Field label="PAN"><input name="pan" defaultValue={profile?.pan ?? ""} className={inputClass} /></Field>
            <Field label="GSTIN (if applicable)"><input name="gstin" defaultValue={profile?.gstin ?? ""} className={inputClass} /></Field>
            <Field label="Business Email"><input name="email" type="email" defaultValue={profile?.email ?? ""} className={inputClass} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={profile?.phone ?? ""} className={inputClass} /></Field>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Beneficiary Bank Details</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Beneficiary Name"><input name="bank_beneficiary" defaultValue={profile?.bank_beneficiary ?? ""} className={inputClass} /></Field>
            <Field label="Bank Name"><input name="bank_name" defaultValue={profile?.bank_name ?? ""} className={inputClass} /></Field>
            <Field label="Branch / Address"><input name="bank_branch" defaultValue={profile?.bank_branch ?? ""} className={inputClass} /></Field>
            <Field label="Account Number"><input name="bank_account" defaultValue={profile?.bank_account ?? ""} className={inputClass} /></Field>
            <Field label="SWIFT / BIC"><input name="bank_swift" defaultValue={profile?.bank_swift ?? ""} className={inputClass} /></Field>
            <Field label="Intermediary / Correspondent Bank (if any)"><input name="bank_intermediary" defaultValue={profile?.bank_intermediary ?? ""} className={inputClass} /></Field>
          </div>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Verify bank details with your bank before sharing a PI — buyers&apos; banks remit against exactly these numbers.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
            {isPending ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </form>
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
