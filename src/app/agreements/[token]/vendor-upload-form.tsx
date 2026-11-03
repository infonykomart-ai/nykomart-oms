"use client";

// 2026-11-03 — vendor's signed-copy upload form (public page, token in a
// hidden field; the server re-verifies it).
import { useState } from "react";
import { uploadVendorSignedCopy } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function VendorUploadForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("token", token);
    const result = await uploadVendorSignedCopy(formData);
    setBusy(false);
    if (result.ok) {
      setMessage(result.message);
      form.reset();
    } else {
      setError(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Return the signed copy</h2>
      <p className="mt-1 text-xs text-slate-500">
        Print the PDF, sign it, scan or photograph it and upload the PDF here. Only PDF files up to 20 MB are accepted.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="signerName">
            Name of the person signing *
          </label>
          <input id="signerName" name="signerName" className={inputClass} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="signerDesignation">
            Designation
          </label>
          <input id="signerDesignation" name="signerDesignation" className={inputClass} placeholder="Proprietor / Director" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="signedOn">
            Date of signing
          </label>
          <input id="signedOn" name="signedOn" type="date" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="file">
            Signed PDF *
          </label>
          <input id="file" name="file" type="file" accept="application/pdf" required className="w-full text-sm" />
        </div>
      </div>

      {error ? <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      {message ? <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Upload signed copy"}
      </button>
    </form>
  );
}
