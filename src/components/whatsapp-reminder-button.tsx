"use client";

// 2026-10-24 — "overdue reminder": a one-click WhatsApp message to a vendor
// about what is still pending. Deliberately a plain wa.me link (same approach
// the bill statement already uses): no API key, no stored credentials, and the
// message opens in the user's own WhatsApp where they can read it before
// sending. The number/amounts come from the currently displayed row, so the
// text can never quote a different figure than the report.
export function WhatsappReminderButton({
  phone,
  message,
  label = "📱 Remind",
  className,
}: {
  /** Party contact_no; 10-digit numbers get the 91 country code. */
  phone: string | null | undefined;
  message: string;
  label?: string;
  className?: string;
}) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const wa = digits.length === 10 ? `91${digits}` : digits;
  return (
    <a
      href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-block rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
      }
      title="Open WhatsApp with this reminder pre-filled (nothing is sent until you press send)"
    >
      {label}
    </a>
  );
}
