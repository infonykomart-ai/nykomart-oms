"use client";

// 2026-11-03 — create screen client form. Only activated (legally reviewed)
// templates are selectable; the server re-checks the same condition, so a
// tampered client cannot issue from an unreviewed wording.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AGREEMENT_META_FIELDS,
  AGREEMENT_TEMPLATES,
  VENDOR_FIELDS,
  type AgreementValues,
} from "@/lib/agreements/templates";
import { FieldInput, inputClass, labelClass } from "../agreement-fields";
import { createAgreement } from "../actions";

export type TemplateOption = {
  slug: string;
  title: string;
  icon: string;
  summary: string;
  version: number;
  reviewedVersion: number | null;
  status: string;
  usable: boolean;
  blockedReason: string | null;
};

export type VendorOption = {
  id: string;
  name: string;
  address: string | null;
  contactNo: string | null;
  email: string | null;
  gst: string | null;
};

export function NewAgreementForm({
  templates,
  vendors,
  companies,
  defaultCompanyId,
  defaultSignatoryName,
  defaultEffectiveDate,
  clauseGroups,
  defaultVendorId = "",
  defaultTemplateSlug = "",
}: {
  templates: TemplateOption[];
  vendors: VendorOption[];
  defaultVendorId?: string;
  defaultTemplateSlug?: string;
  companies: { id: string; name: string }[];
  defaultCompanyId: string;
  defaultSignatoryName: string;
  defaultEffectiveDate: string;
  clauseGroups: { slug: string; title: string; summary: string }[];
}) {
  const router = useRouter();
  const preferred =
    templates.find((template) => template.slug === defaultTemplateSlug && template.usable)?.slug ??
    templates.find((template) => template.usable)?.slug ??
    templates[0]?.slug ??
    "";
  const [templateSlug, setTemplateSlug] = useState(preferred);
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const preselectedVendor = vendors.find((vendor) => vendor.id === defaultVendorId) ?? null;
  const [vendorId, setVendorId] = useState(preselectedVendor?.id ?? "");
  const [groupSlugs, setGroupSlugs] = useState<string[]>([]);
  const [includeWitnesses, setIncludeWitnesses] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(
    () => AGREEMENT_TEMPLATES.find((entry) => entry.slug === templateSlug) ?? AGREEMENT_TEMPLATES[0],
    [templateSlug]
  );

  const [values, setValues] = useState<AgreementValues>(() => {
    const initial: AgreementValues = {};
    for (const field of VENDOR_FIELDS) initial[field.key] = field.default ?? "";
    for (const field of AGREEMENT_META_FIELDS) initial[field.key] = field.default ?? "";
    for (const field of AGREEMENT_TEMPLATES[0].fields) initial[field.key] = field.default ?? "";
    initial.effective_date = defaultEffectiveDate;
    initial.company_signatory_name = defaultSignatoryName;
    // Arriving from a vendor record ("Generate Agreement" on Party Master)
    // pre-fills the vendor block so the admin only has to pick the template.
    if (preselectedVendor) {
      initial.vendor_legal_name = preselectedVendor.name;
      initial.vendor_business_name = preselectedVendor.name;
      initial.vendor_address = preselectedVendor.address ?? "";
      initial.vendor_email = preselectedVendor.email ?? "";
      initial.vendor_whatsapp = preselectedVendor.contactNo ?? "";
      initial.vendor_gstin = preselectedVendor.gst ?? "";
    }
    return initial;
  });

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  function changeTemplate(slug: string) {
    setTemplateSlug(slug);
    const next = AGREEMENT_TEMPLATES.find((entry) => entry.slug === slug);
    if (!next) return;
    // Vendor/meta values are kept; only the template-specific fields reset.
    setValues((prev) => {
      const updated = { ...prev };
      for (const field of next.fields) updated[field.key] = field.default ?? prev[field.key] ?? "";
      return updated;
    });
  }

  function pickVendor(id: string) {
    setVendorId(id);
    const vendor = vendors.find((entry) => entry.id === id);
    if (!vendor) return;
    setValues((prev) => ({
      ...prev,
      vendor_legal_name: vendor.name,
      vendor_business_name: prev.vendor_business_name?.trim() ? prev.vendor_business_name : vendor.name,
      vendor_address: vendor.address ?? prev.vendor_address,
      vendor_email: vendor.email ?? prev.vendor_email,
      vendor_whatsapp: vendor.contactNo ?? prev.vendor_whatsapp,
      vendor_gstin: vendor.gst ?? prev.vendor_gstin,
    }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await createAgreement({
      templateSlug,
      companyId,
      vendorPartyId: vendorId || null,
      values,
      includeWitnesses,
      clauseGroupSlugs: groupSlugs,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/dashboard/agreements/${result.id}`);
  }

  const selectedTemplate = templates.find((entry) => entry.slug === templateSlug);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">1 · Select Agreement Template</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((option) => (
            <button
              key={option.slug}
              type="button"
              disabled={!option.usable}
              onClick={() => changeTemplate(option.slug)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                option.slug === templateSlug
                  ? "border-amber-500 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              } ${!option.usable ? "cursor-not-allowed opacity-50" : ""}`}
              title={option.blockedReason ?? option.summary}
            >
              <span className="mr-1">{option.icon}</span>
              <span className="font-medium">{option.title}</span>
              <span className="mt-1 block text-xs text-slate-500">
                v{option.version}
                {option.usable ? " · active" : ` · ${option.status.replace("_", " ")}`}
              </span>
              {!option.usable && option.blockedReason ? (
                <span className="mt-1 block text-[11px] text-rose-700">{option.blockedReason}</span>
              ) : null}
            </button>
          ))}
        </div>
        {templates.every((option) => !option.usable) ? (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No template is activated yet. Record the legal review and activate at least one template on{" "}
            <Link href="/dashboard/agreements/templates" className="font-semibold underline">
              Legal &amp; Compliance → Templates
            </Link>
            .
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">2 · Combine Additional Clause Groups (optional)</h2>
        <p className="mb-3 text-xs text-slate-500">
          Ticked groups are inserted before the standard boilerplate clauses. A clause the template already contains is never
          duplicated.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {clauseGroups.map((group) => (
            <label key={group.slug} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={groupSlugs.includes(group.slug)}
                onChange={(e) =>
                  setGroupSlugs((prev) => (e.target.checked ? [...prev, group.slug] : prev.filter((slug) => slug !== group.slug)))
                }
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{group.title}</span>
                <span className="block text-xs text-slate-500">{group.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">3 · Company &amp; Vendor</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="company">
              Company letterhead *
            </label>
            <select id="company" className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="vendor">
              Select Vendor (Party Master)
            </label>
            <select id="vendor" className={inputClass} value={vendorId} onChange={(e) => pickVendor(e.target.value)}>
              <option value="">Type the vendor details manually</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              New vendor?{" "}
              <Link href="/dashboard/parties" className="text-amber-600 hover:underline">
                Add it in Party Master
              </Link>{" "}
              first so orders, bills and agreements all point at the same record.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">4 · Enter / Verify Vendor Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {VENDOR_FIELDS.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => setValue(field.key, value)} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">5 · Agreement Terms{selectedTemplate ? ` — ${selectedTemplate.title}` : ""}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {template.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => setValue(field.key, value)} />
          ))}
          {AGREEMENT_META_FIELDS.map((field) => (
            <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => setValue(field.key, value)} />
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={includeWitnesses} onChange={(e) => setIncludeWitnesses(e.target.checked)} />
          Include witness signature blocks
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {error ? <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !selectedTemplate?.usable}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          {busy ? "Creating agreement…" : "Create Agreement & Assign Number"}
        </button>
        <p className="mt-2 text-xs text-slate-400">
          The agreement number (NKM-AGR-YYYY-NNNNNN) is allocated atomically by the database, so two agreements can never share one.
        </p>
      </div>
    </div>
  );
}
