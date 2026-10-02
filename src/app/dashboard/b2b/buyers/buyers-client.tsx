"use client";

// 2026-10-02d — Buyer CRM client surface: profile table with the computed
// money columns, an add/edit modal covering the spec §3 field list, a
// buyer detail modal (spec §24's per-buyer dashboard: totals, AOV,
// outstanding/overdue, last order) and follow-up scheduling. Writes go
// through ../erp-actions.ts.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { BUYER_TYPES, fmtMoney, QUOTE_CURRENCIES } from "@/lib/b2b/erp";
import { createFollowup, saveBuyer, type BuyerInput } from "../erp-actions";

export type BuyerView = {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  website: string;
  buyerType: string;
  currency: string;
  paymentTerms: string;
  shippingTerms: string;
  salesperson: string;
  notes: string;
  active: boolean;
  totalOrders: number;
  lifetimeValue: number;
  cancelledValue: number;
  paid: number;
  outstanding: number;
  overdue: number;
  lastOrderDate: string | null;
  nextFollowUp: string | null;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const btnClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";

function emptyDraft(): BuyerInput {
  return { name: "", buyerType: "Wholesaler", currency: "USD", active: true };
}

export function BuyersClient({ buyers }: { buyers: BuyerView[] }) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<(BuyerInput & { buyerId?: string }) | null>(null);
  const [detail, setDetail] = useState<BuyerView | null>(null);
  const [fuDate, setFuDate] = useState("");
  const [fuNote, setFuNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buyers.filter(
      (b) => !q || b.name.toLowerCase().includes(q) || b.country.toLowerCase().includes(q) || b.salesperson.toLowerCase().includes(q)
    );
  }, [buyers, search]);

  const totals = useMemo(() => {
    const sum = (f: (b: BuyerView) => number) => buyers.reduce((s, b) => s + f(b), 0);
    return {
      lifetime: sum((b) => b.lifetimeValue),
      outstanding: sum((b) => b.outstanding),
      overdue: sum((b) => b.overdue),
    };
  }, [buyers]);

  function submitDraft() {
    if (!draft?.name?.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveBuyer(draft);
      if (!res.ok) setError(res.error);
      else setDraft(null);
    });
  }

  function scheduleFollowup() {
    if (!detail || !fuDate) return;
    setError(null);
    startTransition(async () => {
      const res = await createFollowup({
        entityType: "Buyer",
        entityId: detail.id,
        entityLabel: detail.name,
        dueDate: fuDate,
        note: fuNote,
      });
      if (!res.ok) setError(res.error);
      else {
        setFuDate("");
        setFuNote("");
        setDetail(null);
      }
    });
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Lifetime value (all buyers)" value={fmtMoney(totals.lifetime)} />
        <Stat label="Outstanding" value={fmtMoney(totals.outstanding)} tone={totals.outstanding > 0 ? "amber" : undefined} />
        <Stat label="Overdue" value={fmtMoney(totals.overdue)} tone={totals.overdue > 0 ? "red" : "green"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyer / country / salesperson…" className={`${inputClass} w-72`} />
        <span className="text-xs text-slate-500">{filtered.length} buyers</span>
        <button className={`${btnClass} ml-auto`} onClick={() => { setDraft(emptyDraft()); setError(null); }}>
          + New buyer
        </button>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pl-4 pr-3">Buyer</th>
              <th className="py-2.5 pr-3">Type</th>
              <th className="py-2.5 pr-3">Country</th>
              <th className="py-2.5 pr-3">Salesperson</th>
              <th className="py-2.5 pr-3 text-right">Orders</th>
              <th className="py-2.5 pr-3 text-right">Lifetime value</th>
              <th className="py-2.5 pr-3 text-right">Outstanding</th>
              <th className="py-2.5 pr-3 text-right">Overdue</th>
              <th className="py-2.5 pr-3">Last order</th>
              <th className="py-2.5 pr-3">Next follow-up</th>
              <th className="py-2.5 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-500">
                  No buyers yet — add your first importer/wholesaler.
                </td>
              </tr>
            )}
            {filtered.map((b) => (
              <tr key={b.id} className={`border-b border-slate-100 last:border-0 ${b.active ? "" : "opacity-50"}`}>
                <td className="py-2 pl-4 pr-3">
                  <div className="font-medium text-slate-900">{b.name}</div>
                  <div className="text-xs text-slate-500">{b.contactPerson || b.email || b.phone || "—"}</div>
                </td>
                <td className="py-2 pr-3 text-slate-600">{b.buyerType}</td>
                <td className="py-2 pr-3 text-slate-600">{b.country || "—"}</td>
                <td className="py-2 pr-3 text-slate-600">{b.salesperson || "—"}</td>
                <td className="py-2 pr-3 text-right">{b.totalOrders}</td>
                <td className="py-2 pr-3 text-right font-semibold text-slate-900">{fmtMoney(b.lifetimeValue)}</td>
                <td className={`py-2 pr-3 text-right ${b.outstanding > 0 ? "font-semibold text-amber-600" : "text-slate-400"}`}>
                  {fmtMoney(b.outstanding)}
                </td>
                <td className={`py-2 pr-3 text-right ${b.overdue > 0 ? "font-semibold text-red-600" : "text-slate-400"}`}>{fmtMoney(b.overdue)}</td>
                <td className="py-2 pr-3 text-slate-600">{b.lastOrderDate ?? "—"}</td>
                <td className="py-2 pr-3">
                  {b.nextFollowUp ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">{b.nextFollowUp}</span> : "—"}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex gap-1.5">
                    <button className={btnGhost} onClick={() => { setDetail(b); setError(null); }}>
                      Open
                    </button>
                    <button
                      className={btnGhost}
                      onClick={() => {
                        setDraft({
                          buyerId: b.id,
                          name: b.name,
                          contactPerson: b.contactPerson,
                          email: b.email,
                          phone: b.phone,
                          country: b.country,
                          city: b.city,
                          website: b.website,
                          buyerType: b.buyerType,
                          currency: b.currency,
                          paymentTerms: b.paymentTerms,
                          shippingTerms: b.shippingTerms,
                          salesperson: b.salesperson,
                          notes: b.notes,
                          active: b.active,
                        });
                        setError(null);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── add/edit buyer ────────────────────────────────────────────── */}
      {draft && (
        <Modal title={draft.buyerId ? "Edit buyer" : "New buyer"} onClose={() => setDraft(null)} wide>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Company name *">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Contact person">
              <input value={draft.contactPerson ?? ""} onChange={(e) => setDraft({ ...draft, contactPerson: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Email">
              <input type="email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Phone">
              <input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Country">
              <input value={draft.country ?? ""} onChange={(e) => setDraft({ ...draft, country: e.target.value })} className={inputClass} />
            </Field>
            <Field label="City">
              <input value={draft.city ?? ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Website">
              <input value={draft.website ?? ""} onChange={(e) => setDraft({ ...draft, website: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Buyer type">
              <select value={draft.buyerType ?? "Wholesaler"} onChange={(e) => setDraft({ ...draft, buyerType: e.target.value })} className={inputClass}>
                {BUYER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <select value={draft.currency ?? "USD"} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className={inputClass}>
                {QUOTE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment terms">
              <input value={draft.paymentTerms ?? ""} onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })} placeholder="50/50, Net 30…" className={inputClass} />
            </Field>
            <Field label="Shipping terms">
              <input value={draft.shippingTerms ?? ""} onChange={(e) => setDraft({ ...draft, shippingTerms: e.target.value })} placeholder="FOB Mundra" className={inputClass} />
            </Field>
            <Field label="Salesperson">
              <input value={draft.salesperson ?? ""} onChange={(e) => setDraft({ ...draft, salesperson: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Status">
              <select value={draft.active ? "1" : "0"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })} className={inputClass}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </Field>
            <div className="md:col-span-3">
              <Field label="Notes">
                <textarea rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputClass} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className={btnClass} disabled={pending || !draft.name.trim()} onClick={submitDraft}>
              {pending ? "Saving…" : "Save buyer"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── buyer detail (spec §24 buyer dashboard) ───────────────────── */}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total orders" value={String(detail.totalOrders)} />
            <Stat label="Total sales" value={fmtMoney(detail.lifetimeValue)} />
            <Stat label="Paid" value={fmtMoney(detail.paid)} tone="green" />
            <Stat label="Outstanding" value={fmtMoney(detail.outstanding)} tone={detail.outstanding > 0 ? "amber" : "green"} />
            <Stat label="Overdue" value={fmtMoney(detail.overdue)} tone={detail.overdue > 0 ? "red" : "green"} />
            <Stat label="Avg order value" value={fmtMoney(detail.totalOrders > 0 ? detail.lifetimeValue / detail.totalOrders : 0)} />
            <Stat label="Last order" value={detail.lastOrderDate ?? "—"} />
            <Stat label="Cancelled value" value={fmtMoney(detail.cancelledValue)} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <p><span className="font-semibold text-slate-600">Contact:</span> {detail.contactPerson || "—"}{detail.email ? ` · ${detail.email}` : ""}{detail.phone ? ` · ${detail.phone}` : ""}</p>
              <p><span className="font-semibold text-slate-600">Location:</span> {[detail.city, detail.country].filter(Boolean).join(", ") || "—"}</p>
              <p><span className="font-semibold text-slate-600">Terms:</span> {[detail.paymentTerms, detail.shippingTerms].filter(Boolean).join(" · ") || "—"}</p>
              <p><span className="font-semibold text-slate-600">Salesperson:</span> {detail.salesperson || "—"}</p>
            </div>
            {detail.notes && <p className="mt-2 text-slate-600">{detail.notes}</p>}
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">Schedule follow-up</h4>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className={labelClass}>Due date</label>
                <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} className={`${inputClass} w-40`} />
              </div>
              <div className="min-w-48 flex-1">
                <label className={labelClass}>Note</label>
                <input value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="Send revised FOB price…" className={inputClass} />
              </div>
              <button className={btnClass} disabled={pending || !fuDate} onClick={scheduleFollowup}>
                {pending ? "Saving…" : "Add"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "amber" | "red" | "green" }) {
  const tones: Record<string, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone ?? ""] ?? "border-slate-200 bg-white"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 truncate text-lg font-bold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className={`my-6 w-full rounded-2xl bg-white p-5 shadow-xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
