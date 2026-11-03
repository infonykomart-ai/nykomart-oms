"use client";

// 2026-11-03 — letterhead settings form with a live header/footer preview, so
// the admin sees the brand colour + typography choice before issuing anything.
import { useState } from "react";
import { AGREEMENT_FONT_OPTIONS, isHexColor } from "@/lib/agreements/letterhead";
import { inputClass, labelClass } from "../agreement-fields";
import { saveAgreementLetterheadSettings } from "../actions";

type Initial = {
  legalName: string;
  address: string;
  email: string;
  website: string;
  phone: string;
  gstin: string;
  footerText: string;
  logoUrl: string;
  signatureUrl: string;
  brandColor: string;
  accentColor: string;
  fontFamily: string;
};

export function LetterheadForm({
  companyId,
  companyName,
  initial,
  configured,
}: {
  companyId: string;
  companyName: string;
  initial: Initial;
  configured: boolean;
}) {
  const [form, setForm] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof Initial, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await saveAgreementLetterheadSettings({ companyId, ...form });
    setBusy(false);
    if (result.ok) setNotice("Letterhead saved. Newly generated PDFs use these settings.");
    else setError(result.error);
  }

  const colourWarning = !isHexColor(form.brandColor) || !isHexColor(form.accentColor);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{companyName} — letterhead</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                configured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
              }`}
            >
              {configured ? "Configured" : "Using company profile defaults"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="legalName">
                Company legal name *
              </label>
              <input id="legalName" className={inputClass} value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="address">
                Registered business address
              </label>
              <textarea id="address" rows={3} className={inputClass} value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="email">
                Official email
              </label>
              <input id="email" className={inputClass} value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="website">
                Official website
              </label>
              <input id="website" className={inputClass} value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className={labelClass} htmlFor="phone">
                Phone
              </label>
              <input id="phone" className={inputClass} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="gstin">
                GSTIN / registration details
              </label>
              <input id="gstin" className={inputClass} value={form.gstin} onChange={(e) => set("gstin", e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">Leave blank if not applicable — no GSTIN line is printed at all.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="footerText">
                Footer text
              </label>
              <input id="footerText" className={inputClass} value={form.footerText} onChange={(e) => set("footerText", e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="logoUrl">
                Logo image URL / path
              </label>
              <input id="logoUrl" className={inputClass} value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">Falls back to the company logo already stored in the OMS.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="signatureUrl">
                Authorised-signatory image (optional)
              </label>
              <input id="signatureUrl" className={inputClass} value={form.signatureUrl} onChange={(e) => set("signatureUrl", e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">Printed on the Nyko Mart signature block only if set.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="brandColor">
                Brand colour
              </label>
              <div className="flex gap-2">
                <input
                  id="brandColor"
                  type="color"
                  className="h-10 w-12 rounded border border-slate-300"
                  value={isHexColor(form.brandColor) ? form.brandColor : "#0f172a"}
                  onChange={(e) => set("brandColor", e.target.value)}
                />
                <input className={inputClass} value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="accentColor">
                Accent colour
              </label>
              <div className="flex gap-2">
                <input
                  id="accentColor"
                  type="color"
                  className="h-10 w-12 rounded border border-slate-300"
                  value={isHexColor(form.accentColor) ? form.accentColor : "#b45309"}
                  onChange={(e) => set("accentColor", e.target.value)}
                />
                <input className={inputClass} value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="fontFamily">
                Document typography
              </label>
              <select id="fontFamily" className={inputClass} value={form.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
                {AGREEMENT_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {colourWarning ? <p className="mt-3 text-xs text-rose-700">Colours must be hex values, e.g. #0f172a.</p> : null}
          {error ? <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
          {notice ? <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}

          <button
            type="button"
            onClick={submit}
            disabled={busy || colourWarning}
            className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save letterhead"}
          </button>
        </div>
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <div
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          style={{ fontFamily: form.fontFamily === "Times-Roman" ? "Georgia, serif" : form.fontFamily === "Courier" ? "monospace" : "system-ui, sans-serif" }}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Header preview</p>
          <div className="flex items-start justify-between gap-3 border-b-2 pb-2" style={{ borderColor: form.brandColor }}>
            <div>
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- settings preview of an arbitrary logo URL
                <img src={form.logoUrl} alt="Logo preview" className="mb-1 h-10 w-10 object-contain" />
              ) : null}
              <p className="text-base font-bold" style={{ color: form.brandColor }}>
                {form.legalName || "Company legal name"}
              </p>
              {form.address ? <p className="text-xs text-slate-500">{form.address}</p> : null}
              <p className="text-xs text-slate-500">
                {[form.email, form.website, form.phone].filter(Boolean).join("  ·  ") || "email · website · phone"}
              </p>
            </div>
            <div className="text-right text-[11px] text-slate-500">
              {form.gstin ? <p>GSTIN: {form.gstin}</p> : null}
              <p>Ref: NKM-AGR-2026-000001</p>
              <p>Version: v1</p>
            </div>
          </div>
          <p className="mt-2 text-xs" style={{ color: form.accentColor }}>
            Accent used for section headings
          </p>
          <p className="mt-3 text-xs text-slate-600">{form.footerText}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            NKM-AGR-2026-000001 · Version v1 · Page 1 of 3
          </p>
        </div>
      </div>
    </div>
  );
}
