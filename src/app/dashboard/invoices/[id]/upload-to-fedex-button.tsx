"use client";

// 2026-09-13 — the "Upload to FedEx" button on the invoice page (edit panel
// footer, under Save/Delete). The invoice is editable long after booking —
// this re-sends the CURRENT document (every saved edit + company logo) to
// FedEx against the same AWB, replacing whatever was uploaded at booking
// time. "vaha par mujhe system vala invoice hi chahiye."

import { useState, useTransition } from "react";
import { uploadInvoiceToFedex } from "./upload-to-fedex-actions";

export function UploadToFedexButton({ invoiceId }: { invoiceId: string }) {
  const [isPending, startUpload] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleUpload() {
    if (!window.confirm("Upload this invoice's current version to FedEx? It replaces the document uploaded at booking time (same AWB).")) return;
    setResult(null);
    startUpload(async () => {
      const res = await uploadInvoiceToFedex(invoiceId);
      setResult(res.error ? `Upload failed: ${res.error}` : "Uploaded to FedEx successfully.");
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleUpload}
        disabled={isPending}
        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {isPending ? "Uploading to FedEx..." : "⬆️ Upload to FedEx"}
      </button>
      {result && <p className={`mt-1 text-xs ${result.startsWith("Upload failed") ? "text-red-600" : "text-emerald-600"}`}>{result}</p>}
      <p className="mt-1 text-[11px] text-slate-400">
        Sends this invoice&apos;s current saved version (with logo) to FedEx against its AWB — use after editing so customs always has the latest document.
      </p>
    </div>
  );
}
