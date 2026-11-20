"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 2026-11-20 — order detail card for the "REF PHOTO <order no>" automation.
//
// Shows what the order actually has, what WhatsApp last did with it, and lets
// an authorized employee send again / retry a failed delivery. The manual
// action calls /api/order-reference-photos, which runs the EXACT same
// selection + dedupe + send logic as the automatic order-update hook.

export type ReferencePhotoLogView = {
  id: string;
  event_id: string;
  delivery_status: "pending" | "sent" | "partial" | "failed" | "skipped";
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  retry_count: number;
  attachment_photo_ids: string[];
  whatsapp_message_ids: string[];
};

const STATUS_STYLE: Record<ReferencePhotoLogView["delivery_status"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "border-green-200 bg-green-50 text-green-700" },
  partial: { label: "Partly sent", className: "border-amber-200 bg-amber-50 text-amber-800" },
  failed: { label: "Failed", className: "border-red-200 bg-red-50 text-red-700" },
  pending: { label: "Sending…", className: "border-slate-200 bg-slate-50 text-slate-600" },
  skipped: { label: "Nothing to send", className: "border-slate-200 bg-slate-50 text-slate-500" },
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function ReferencePhotoWhatsApp({
  orderId,
  closeUpPhotoCount,
  latest,
  canManage,
}: {
  orderId: string;
  closeUpPhotoCount: number;
  latest: ReferencePhotoLogView | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = latest ? STATUS_STYLE[latest.delivery_status] : null;
  const sentCount = latest ? latest.whatsapp_message_ids.filter(Boolean).length : 0;
  const retryable = !!latest && (latest.delivery_status === "failed" || latest.delivery_status === "partial");

  async function send(options: { retry: boolean }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/order-reference-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          options.retry && latest
            ? { orderId, eventId: latest.event_id, force: true }
            : { orderId }
        ),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; status?: string; sentCount?: number; totalPhotos?: number }
        | null;

      if (!res.ok || !json?.ok) {
        setError(json?.error || "Could not send the reference photos — please try again.");
        return;
      }
      setNotice(
        `Sent ${json.sentCount ?? 0} of ${json.totalPhotos ?? 0} reference photo(s) on WhatsApp.`
      );
      router.refresh();
    } catch {
      setError("Could not reach the server — check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-700">
            WhatsApp reference photos
            <span className="ml-1 font-normal text-slate-500">
              ({closeUpPhotoCount} close-up{closeUpPhotoCount === 1 ? "" : "s"} attached)
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Caption: <span className="font-medium text-slate-700">REF PHOTO {`<order no>`}</span> — the order&apos;s
            own reference number is used automatically.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {status && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
              {status.label}
              {latest?.delivery_status === "partial" || latest?.delivery_status === "sent"
                ? ` · ${sentCount}/${latest.attachment_photo_ids.length}`
                : ""}
            </span>
          )}
          {canManage && (
            <button
              type="button"
              disabled={busy || closeUpPhotoCount === 0}
              onClick={() => send({ retry: false })}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send Reference Photos on WhatsApp"}
            </button>
          )}
          {canManage && retryable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ retry: true })}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
            >
              {busy ? "Retrying…" : "Retry failed photos"}
            </button>
          )}
        </div>
      </div>

      {closeUpPhotoCount === 0 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          No close-up photos on this order, so nothing is attached automatically. The normal order-update message is
          unchanged.
        </p>
      )}

      {latest && (
        <div className="mt-2 grid gap-1 text-[11px] text-slate-600 sm:grid-cols-3">
          <div>
            <span className="font-semibold text-slate-500">Last attempt:</span> {formatWhen(latest.created_at)}
          </div>
          <div>
            <span className="font-semibold text-slate-500">Sent:</span>{" "}
            {latest.sent_at ? formatWhen(latest.sent_at) : "Not delivered"}
          </div>
          <div>
            <span className="font-semibold text-slate-500">Retries:</span> {latest.retry_count}
          </div>
        </div>
      )}

      {latest?.error_message && (
        <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] leading-relaxed text-red-700">
          {latest.error_message}
        </p>
      )}
      {error && (
        <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] leading-relaxed text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-1.5 rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-[11px] leading-relaxed text-green-700">
          {notice}
        </p>
      )}
    </div>
  );
}
