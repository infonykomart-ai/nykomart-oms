"use client";

// 2026-11-03 — document workspace. Everything the Legal & Compliance spec asks
// for on the document screen lives here: preview, generate (new version),
// download, WhatsApp share, vendor link, signed-copy upload, countersign,
// activate, renew, terminate, and the version / signature / sharing history
// panels.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AGREEMENT_META_FIELDS,
  AGREEMENT_TEMPLATES,
  CLAUSE_LIBRARY,
  VENDOR_FIELDS,
  buildAgreementSections,
  buildAgreementTokens,
  type AgreementValues,
} from "@/lib/agreements/templates";
import { buildAgreementWhatsAppMessage } from "@/lib/agreements/message";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_STYLES, historyLabel } from "@/lib/agreements/status";
import { FieldInput, inputClass, labelClass } from "../agreement-fields";
import {
  activateAgreement,
  createVendorAccessLink,
  generateAgreementVersion,
  previewAgreementPdf,
  recordAgreementShareLog,
  renewAgreement,
  saveAgreementDraft,
  startEsignRequest,
  terminateAgreement,
  uploadAgreementSignature,
} from "../actions";

type WorkspaceDocument = {
  id: string;
  refNo: string;
  status: string;
  templateSlug: string;
  includedClauseSlugs: string[];
  effectiveDate: string;
  includeWitnesses: boolean;
  documentVersion: number;
  fieldValues: AgreementValues;
  vendorName: string;
  renewalOf: string | null;
  terminatedReason: string | null;
};

type VersionRow = { id: string; version: number; sha256: string; size: number | null; generatedAt: string; templateVersion: number };
type SignatureRow = {
  id: string;
  kind: "vendor" | "counter";
  method: string;
  signerName: string;
  signerDesignation: string | null;
  signedOn: string | null;
  sha256: string;
  createdAt: string;
};
type SharingRow = { id: string; channel: string; provider: string | null; status: string; phone: string | null; createdAt: string };
type HistoryRow = { id: string; action: string; actorName: string | null; note: string | null; createdAt: string };

const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const buttonClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";
const primaryButtonClass =
  "rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function AgreementWorkspace({
  agreement: doc,
  companyName,
  letterheadConfigured,
  defaultSignatoryName,
  versions,
  signatures,
  sharingLogs,
  history,
}: {
  agreement: WorkspaceDocument;
  companyName: string | null;
  letterheadConfigured: boolean;
  defaultSignatoryName: string;
  versions: VersionRow[];
  signatures: SignatureRow[];
  sharingLogs: SharingRow[];
  history: HistoryRow[];
}) {
  const template = useMemo(
    () => AGREEMENT_TEMPLATES.find((entry) => entry.slug === doc.templateSlug) ?? AGREEMENT_TEMPLATES[0],
    [doc.templateSlug]
  );

  const editable = !["countersigned", "active", "terminated", "renewed"].includes(doc.status);
  const [values, setValues] = useState<AgreementValues>({
    ...(() => {
      const initial: AgreementValues = {};
      for (const field of VENDOR_FIELDS) initial[field.key] = field.default ?? "";
      for (const field of AGREEMENT_META_FIELDS) initial[field.key] = field.default ?? "";
      for (const field of template.fields) initial[field.key] = field.default ?? "";
      return initial;
    })(),
    ...doc.fieldValues,
    company_signatory_name: doc.fieldValues.company_signatory_name || defaultSignatoryName,
  });
  const [includeWitnesses, setIncludeWitnesses] = useState(doc.includeWitnesses);
  const [groupSlugs, setGroupSlugs] = useState<string[]>(doc.includedClauseSlugs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [vendorLink, setVendorLink] = useState<string | null>(null);
  const [esignUrl, setEsignUrl] = useState<string | null>(null);
  const [terminationReason, setTerminationReason] = useState("");
  const [renewalDate, setRenewalDate] = useState(doc.effectiveDate);
  const router = useRouter();

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const latestVersion = versions[0] ?? null;
  const vendorSigned = signatures.find((row) => row.kind === "vendor");
  const countersigned = signatures.find((row) => row.kind === "counter");

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  async function run(label: string, work: () => Promise<{ ok: boolean; error?: string } | void>) {
    resetMessages();
    setBusy(label);
    try {
      const result = await work();
      if (result && "ok" in result && !result.ok && "error" in result) setError(result.error ?? "Something went wrong.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const handleSave = () =>
    run("save", async () => {
      const result = await saveAgreementDraft({
        id: doc.id,
        values,
        includeWitnesses,
        clauseGroupSlugs: groupSlugs,
      });
      if (result.ok) setNotice("Draft saved.");
      return result;
    });

  const handlePreview = () =>
    run("preview", async () => {
      const result = await previewAgreementPdf(doc.id);
      if (!result.ok) return result;
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      setNotice("Preview rendered from the current draft.");
      return { ok: true };
    });

  const handleGenerate = () =>
    run("generate", async () => {
      const result = await generateAgreementVersion(doc.id);
      if (!result.ok) return result;
      setNotice(`Stored PDF version v${result.version} (SHA-256 ${result.sha256.slice(0, 16)}…).`);
      return { ok: true };
    });

  const handleShareWhatsApp = () =>
    run("whatsapp", async () => {
      if (!latestVersion) return { ok: false, error: "Generate the PDF first — the share must send a stored version." };
      const response = await fetch(`/api/agreements/${doc.id}/pdf`, { cache: "no-store" });
      if (!response.ok) return { ok: false, error: "The stored PDF could not be read." };
      const blob = await response.blob();
      const fileName = `${doc.refNo}-v${latestVersion.version}.pdf`;
      const message = buildAgreementWhatsAppMessage({
        vendorName: doc.vendorName,
        agreementName: template.subject,
        companyName: companyName ?? "Nyko Mart",
        refNo: doc.refNo,
        effectiveDate: doc.effectiveDate,
        vendorLink: vendorLink ? `${window.location.origin}${vendorLink}` : null,
      });

      const digits = (values.vendor_whatsapp ?? "").replace(/\D/g, "");
      const phone = digits.length === 10 ? `91${digits}` : digits;
      let provider = "click_to_chat";
      let status: "sent" | "manual_attach_required" = "manual_attach_required";

      if (typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator) {
        const file = new File([blob], fileName, { type: "application/pdf" });
        const shareData = { files: [file], text: message, title: `${template.subject} — ${doc.vendorName}` };
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            provider = "web_share";
            status = "sent";
          } catch {
            // cancelled — fall through to download + click-to-chat
          }
        }
      }

      if (status !== "sent") {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.open(
          phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer"
        );
      }

      await recordAgreementShareLog({
        id: doc.id,
        channel: "whatsapp",
        provider,
        status,
        phone: values.vendor_whatsapp,
        message,
      });
      setNotice(
        status === "sent"
          ? "WhatsApp opened with the PDF attached (shared)."
          : "PDF downloaded and the WhatsApp chat opened — attach the downloaded PDF there."
      );
      return { ok: true };
    });

  const handleVendorLink = () =>
    run("vendor-link", async () => {
      const result = await createVendorAccessLink(doc.id, 7);
      if (!result.ok) return result;
      const absolute = `${window.location.origin}${result.url}`;
      setVendorLink(result.url);
      await navigator.clipboard?.writeText(absolute).catch(() => undefined);
      setNotice(`Vendor link created (expires ${result.expiresAt.slice(0, 10)}) and copied to the clipboard.`);
      return { ok: true };
    });

  const handleUploadSignature = (kind: "vendor" | "counter") =>
    run(kind, async () => {
      const form = document.getElementById(`signature-form-${kind}`) as HTMLFormElement | null;
      if (!form) return { ok: false, error: "Form not ready." };
      const formData = new FormData(form);
      formData.set("documentId", doc.id);
      formData.set("kind", kind);
      const result = await uploadAgreementSignature(formData);
      if (result.ok) {
        form.reset();
        setNotice(kind === "vendor" ? "Vendor signed copy recorded." : "Countersigned copy recorded.");
      }
      return result;
    });

  const handleActivate = () =>
    run("activate", async () => {
      const result = await activateAgreement(doc.id);
      if (result.ok) setNotice("Agreement activated.");
      return result;
    });

  const handleTerminate = () =>
    run("terminate", async () => {
      const result = await terminateAgreement(doc.id, terminationReason);
      if (result.ok) setNotice("Agreement terminated.");
      return result;
    });

  const handleRenew = () =>
    run("renew", async () => {
      const result = await renewAgreement(doc.id, { ...values, effective_date: renewalDate });
      if (!result.ok) return result;
      router.push(`/dashboard/agreements/${result.id}`);
      return { ok: true };
    });

  const handleEsign = () =>
    run("esign", async () => {
      const result = await startEsignRequest(doc.id);
      if (!result.ok) return result;
      setEsignUrl(result.signingUrl);
      setNotice("E-signature request created with the configured provider.");
      return { ok: true };
    });

  const previewClauses = useMemo(() => {
    const tokens = buildAgreementTokens({
      company: { name: companyName ?? "" },
      values,
      refNo: doc.refNo,
    });
    return buildAgreementSections(template, tokens, groupSlugs);
  }, [companyName, values, doc.refNo, template, groupSlugs]);

  return (
    <div className="space-y-5">
      {!letterheadConfigured ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This company&apos;s letterhead is not configured yet — the PDF will use the company name and profile details only.{" "}
          <Link href="/dashboard/agreements/letterhead" className="font-semibold underline">
            Configure letterhead
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Agreement</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${AGREEMENT_STATUS_STYLES[doc.status] ?? "bg-slate-100"}`}>
                {AGREEMENT_STATUS_LABELS[doc.status] ?? doc.status}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Reference</dt>
                <dd className="font-mono text-xs">{doc.refNo}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Template</dt>
                <dd>
                  {template.title} <span className="text-xs text-slate-400">(v{template.version})</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Vendor</dt>
                <dd>{doc.vendorName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Generated version</dt>
                <dd>{doc.documentVersion > 0 ? `v${doc.documentVersion}` : "not generated"}</dd>
              </div>
            </dl>
            {doc.terminatedReason ? <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-xs text-rose-800">Terminated: {doc.terminatedReason}</p> : null}
            {doc.renewalOf ? (
              <p className="mt-3 text-xs text-slate-500">
                Renewal of{" "}
                <Link href={`/dashboard/agreements/${doc.renewalOf}`} className="text-amber-600 hover:underline">
                  the previous agreement
                </Link>
              </p>
            ) : null}
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Issue &amp; deliver</h2>
            {error ? <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
            {notice ? <p className="mb-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" className={buttonClass} onClick={handlePreview} disabled={busy !== null}>
                {busy === "preview" ? "Rendering…" : "👁 Preview PDF"}
              </button>
              <button type="button" className={primaryButtonClass} onClick={handleGenerate} disabled={busy !== null || !editable}>
                {busy === "generate" ? "Generating…" : latestVersion ? "🔄 Regenerate PDF (new version)" : "🧾 Generate PDF"}
              </button>
              <a className={buttonClass} href={`/api/agreements/${doc.id}/pdf?download=1`}>
                ⬇️ Download PDF
              </a>
              <button type="button" className={buttonClass} onClick={handleShareWhatsApp} disabled={busy !== null}>
                {busy === "whatsapp" ? "Preparing…" : "📱 Share Agreement on WhatsApp"}
              </button>
              <button type="button" className={buttonClass} onClick={handleVendorLink} disabled={busy !== null}>
                🔗 Create vendor link (7 days)
              </button>
              <button type="button" className={buttonClass} onClick={handleEsign} disabled={busy !== null}>
                ✍️ Request e-signature
              </button>
            </div>
            {vendorLink ? (
              <p className="mt-3 break-all rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Vendor link: {window.location.origin}
                {vendorLink}
              </p>
            ) : null}
            {esignUrl ? (
              <p className="mt-3 break-all rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">E-sign link: {esignUrl}</p>
            ) : null}
            <p className="mt-3 text-xs text-slate-400">
              A WhatsApp click-to-chat link cannot attach a file. On mobile the PDF is shared through the OS share sheet; on desktop
              it downloads and the chat opens for manual attachment. Every attempt is recorded below.
            </p>
          </div>

          {editable ? (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Vendor details &amp; terms</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {VENDOR_FIELDS.map((field) => (
                  <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => setValue(field.key, value)} />
                ))}
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
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Combined clause groups</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {CLAUSE_LIBRARY.map((group) => (
                    <label key={group.slug} className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={groupSlugs.includes(group.slug)}
                        onChange={(e) =>
                          setGroupSlugs((prev) => (e.target.checked ? [...prev, group.slug] : prev.filter((slug) => slug !== group.slug)))
                        }
                      />
                      {group.title}
                    </label>
                  ))}
                </div>
              </div>
              <button type="button" className={`${primaryButtonClass} mt-4 w-full`} onClick={handleSave} disabled={busy !== null}>
                {busy === "save" ? "Saving…" : "Save details"}
              </button>
            </div>
          ) : null}

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Signature workflow</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <form id="signature-form-vendor" className="space-y-2" onSubmit={(e) => e.preventDefault()}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">A · Vendor signed copy</p>
                <input name="signerName" className={inputClass} placeholder="Vendor signatory name" defaultValue={values.vendor_contact_person} />
                <input name="signerDesignation" className={inputClass} placeholder="Designation" defaultValue={values.vendor_designation} />
                <input name="signedOn" type="date" className={inputClass} />
                <input name="file" type="file" accept="application/pdf" className="w-full text-xs" />
                <button
                  type="button"
                  className={`${buttonClass} w-full`}
                  onClick={() => handleUploadSignature("vendor")}
                  disabled={busy !== null}
                >
                  {vendorSigned ? "Replace vendor signed PDF" : "Upload vendor signed PDF"}
                </button>
              </form>
              <form id="signature-form-counter" className="space-y-2" onSubmit={(e) => e.preventDefault()}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">B · Nyko Mart countersignature</p>
                <input name="signerName" className={inputClass} placeholder="Authorised signatory" defaultValue={values.company_signatory_name} />
                <input name="signerDesignation" className={inputClass} placeholder="Designation" defaultValue="Director" />
                <input name="signedOn" type="date" className={inputClass} />
                <input name="file" type="file" accept="application/pdf" className="w-full text-xs" />
                <button
                  type="button"
                  className={`${buttonClass} w-full`}
                  onClick={() => handleUploadSignature("counter")}
                  disabled={busy !== null}
                >
                  {countersigned ? "Replace countersigned PDF" : "Upload countersigned PDF"}
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              A typed name or an unsigned WhatsApp message is never treated as a signature. Only an uploaded signed PDF (or a
              provider-verified signature) is recorded, with its SHA-256 hash.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={handleActivate}
                disabled={busy !== null || !["signed_received", "countersigned"].includes(doc.status)}
              >
                ✅ Activate agreement
              </button>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Lifecycle</h2>
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className={labelClass} htmlFor="renewal_date">
                    Renewal effective date
                  </label>
                  <input
                    id="renewal_date"
                    type="date"
                    className={inputClass}
                    value={renewalDate}
                    onChange={(e) => setRenewalDate(e.target.value)}
                  />
                </div>
                <button type="button" className={buttonClass} onClick={handleRenew} disabled={busy !== null}>
                  ♻️ Create renewal
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[16rem] flex-1">
                  <label className={labelClass} htmlFor="termination_reason">
                    Termination reason
                  </label>
                  <input
                    id="termination_reason"
                    className={inputClass}
                    value={terminationReason}
                    onChange={(e) => setTerminationReason(e.target.value)}
                    placeholder="e.g. engagement ended, replaced by new supplier"
                  />
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                  onClick={handleTerminate}
                  disabled={busy !== null || doc.status === "terminated"}
                >
                  Terminate
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">PDF preview</h2>
            {previewUrl ? (
              <div className="space-y-2">
                <iframe title="Agreement PDF preview" src={previewUrl} className="h-[640px] w-full rounded border border-slate-200" />
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-amber-600 hover:underline">
                  Open preview in a new tab (print from there)
                </a>
              </div>
            ) : (
              <div className="rounded border border-dashed border-slate-300 px-4 py-10 text-center text-xs text-slate-400">
                Click “Preview PDF” to render the current draft, or “Generate PDF” to store a numbered version.
              </div>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                Clause text preview ({previewClauses.clauses.length} clauses)
              </summary>
              <div className="mt-2 max-h-72 overflow-y-auto rounded bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
                {previewClauses.clauses.map((clause, index) => (
                  <div key={`${clause.title}-${index}`} className="mb-2">
                    <p className="font-semibold">
                      {index + 1}. {clause.title}
                    </p>
                    {clause.paragraphs.map((paragraph, pIndex) => (
                      <p key={pIndex} className="mb-1 text-justify">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">History</h2>
            <ol className="space-y-2">
              {history.length === 0 ? <li className="text-xs text-slate-400">No history yet.</li> : null}
              {history.map((row) => (
                <li key={row.id} className="border-l-2 border-amber-200 pl-3">
                  <p className="text-sm font-medium text-slate-800">{historyLabel(row.action)}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(row.createdAt)}
                    {row.actorName ? ` · ${row.actorName}` : ""}
                  </p>
                  {row.note ? <p className="text-xs text-slate-600">{row.note}</p> : null}
                </li>
              ))}
            </ol>
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Versions</h2>
            {versions.length === 0 ? (
              <p className="text-xs text-slate-400">No PDF generated yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {versions.map((row) => (
                  <li key={row.id} className="rounded bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">v{row.version}</span>
                      <a href={`/api/agreements/${doc.id}/pdf?v=${row.version}&download=1`} className="text-amber-600 hover:underline">
                        Download
                      </a>
                    </div>
                    <p className="text-slate-500">
                      {formatDateTime(row.generatedAt)} · template v{row.templateVersion} · {row.size ? `${(row.size / 1024).toFixed(1)} KB` : "—"}
                    </p>
                    <p className="break-all font-mono text-[10px] text-slate-400">SHA-256 {row.sha256}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Signatures</h2>
            {signatures.length === 0 ? (
              <p className="text-xs text-slate-400">No signed copy recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {signatures.map((row) => (
                  <li key={row.id} className="rounded bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-800">
                      {row.kind === "vendor" ? "Vendor" : "Nyko Mart"} — {row.signerName}
                      {row.signerDesignation ? ` (${row.signerDesignation})` : ""}
                    </p>
                    <p className="text-slate-500">
                      {row.method.replace("_", " ")} · signed {row.signedOn ?? "—"} · recorded {formatDateTime(row.createdAt)}
                    </p>
                    <p className="break-all font-mono text-[10px] text-slate-400">SHA-256 {row.sha256}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Sharing attempts</h2>
            {sharingLogs.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing shared yet.</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-600">
                {sharingLogs.map((row) => (
                  <li key={row.id}>
                    {formatDateTime(row.createdAt)} · {row.channel} · {row.status.replace(/_/g, " ")}
                    {row.provider ? ` · ${row.provider}` : ""}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
