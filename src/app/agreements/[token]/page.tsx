import { resolveVendorAccessToken } from "@/app/dashboard/agreements/actions";
import { findAgreementTemplate } from "@/lib/agreements/templates";
import { AGREEMENT_STATUS_LABELS } from "@/lib/agreements/status";
import { VendorUploadForm } from "./vendor-upload-form";

/**
 * 2026-11-03 — VENDOR-FACING page, reached only through the expiring, hashed
 * token link an admin generates in the document workspace. Public route, but
 * it discloses nothing without a valid token: no login, no OMS navigation, no
 * other document, no listing. Shows just this agreement's reference, vendor,
 * status and a download + signed-copy upload.
 */
export const dynamic = "force-dynamic";

export default async function VendorAgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveVendorAccessToken(token);

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <h1 className="text-lg font-semibold">Link not available</h1>
          <p className="mt-2 text-sm">{resolved.error}</p>
          <p className="mt-4 text-xs text-rose-700">Nyko Mart · Legal &amp; Compliance</p>
        </div>
      </main>
    );
  }

  const { document } = resolved;
  const template = findAgreementTemplate(document.template_slug);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-6 border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Nyko Mart · Legal &amp; Compliance</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{template?.title ?? "Vendor Agreement"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reference <span className="font-mono">{document.ref_no}</span> · {document.vendor_name_snapshot}
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd>{AGREEMENT_STATUS_LABELS[document.status] ?? document.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Document version</dt>
            <dd>{document.document_version > 0 ? `v${document.document_version}` : "—"}</dd>
          </div>
        </dl>
        <a
          href={`/agreements/${token}/pdf`}
          className="mt-4 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          ⬇️ Download the agreement PDF
        </a>
      </div>

      {resolved.purpose === "view_and_upload" ? (
        <VendorUploadForm token={token} />
      ) : (
        <p className="mt-4 text-xs text-slate-500">This link is view-only. Please contact Nyko Mart to return the signed copy.</p>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-400">
        This link is private and expires automatically. If you were not expecting it, please contact Nyko Mart.
      </footer>
    </main>
  );
}
