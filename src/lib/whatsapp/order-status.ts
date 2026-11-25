// 2026-11-25 — Order-status WhatsApp messages, the honest parts.
//
// Pure functions only: which status change triggers which message, the exact
// text (so a template can never ship a placeholder), the idempotency key, and
// the phone-number rules. No network, no database — the tests below this file
// pin the behaviour that the queue, the retry job and the admin page share.
//
// The three triggers are the ONLY status changes that message a customer.
// "Process" is the user's word for the working status OMS actually has:
// 'In Production' (confirmed 2026-11-25 — OMS has no 'Process' status and
// adding one would create the duplicate status the spec warns against).

export type StatusTrigger = "hold" | "cancel" | "process";

/** OMS status → message event. Anything absent here never messages. */
export const STATUS_TRIGGERS: Record<string, StatusTrigger> = {
  Hold: "hold",
  Cancelled: "cancel",
  "In Production": "process",
};

export const TRIGGER_TEMPLATE_FIELD: Record<StatusTrigger, "hold_template" | "cancel_template" | "process_template"> = {
  hold: "hold_template",
  cancel: "cancel_template",
  process: "process_template",
};

export const TRIGGER_ENABLED_FIELD: Record<StatusTrigger, "hold_enabled" | "cancel_enabled" | "process_enabled"> = {
  hold: "hold_enabled",
  cancel: "cancel_enabled",
  process: "process_enabled",
};

export const DEFAULT_TEMPLATES: Record<StatusTrigger, string> = {
  hold: "Hold this order {po}",
  cancel: "Cancel This Order {po}",
  process: "Process This Order {po}",
};

/** The trigger for a status, or null when that status never messages. */
export function triggerForStatus(status: string | null | undefined): StatusTrigger | null {
  if (!status) return null;
  return STATUS_TRIGGERS[status] ?? null;
}

/**
 * A save that does not actually change the status must never message: the
 * order edit form submits `status` on every save, so this check is what stops
 * "employee pressed Save twice" from sending twice.
 */
export function isStatusTransition(fromStatus: string | null | undefined, toStatus: string | null | undefined): boolean {
  if (!toStatus) return false;
  return (fromStatus ?? "") !== toStatus;
}

/**
 * Fill the template. `{po}` is the order's own reference (`PO-A1154`), which is
 * the number every bill and report in this app prints as "PO No.".
 *
 * Returns null when there is nothing honest to send — no reference, or a
 * template that does not end up containing it — so the caller records a
 * skipped message instead of sending "Hold this order " or "…PO-".
 */
export function buildStatusMessage(template: string | null | undefined, orderReference: string | null | undefined): string | null {
  const ref = (orderReference ?? "").trim();
  if (!ref) return null;
  const raw = (template ?? "").trim() || "{po}";
  const text = raw.includes("{po}") ? raw.split("{po}").join(ref) : `${raw} ${ref}`;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed || !collapsed.includes(ref)) return null;
  // A leftover placeholder means the template is broken — never send it.
  if (/\{[a-z_]+\}/i.test(collapsed)) return null;
  return collapsed;
}

/**
 * Idempotency key for one transition event. The (order, message_type,
 * event_id) unique key in order_whatsapp_messages is what actually blocks a
 * double insert; the timestamp keeps two genuinely separate transitions
 * (Hold → Process → Hold → Process) from colliding.
 */
export function statusEventId(orderId: string, fromStatus: string, toStatus: string, at: number = Date.now()): string {
  return `status:${orderId}:${fromStatus || "-"}->${toStatus}:${at}`;
}

export type PhoneCheck = { ok: true; digits: string } | { ok: false; reason: string };

/**
 * Turn whatever is stored in `orders.contact_no` into the digits-only
 * international number WhatsApp needs, or say why it cannot be used.
 *
 * Deliberately strict about the shapes that would send to the wrong person:
 * a short/local number without a country code is refused rather than guessed,
 * because guessing a country is how a customer in Germany gets a message
 * meant for India.
 */
export function checkPhone(raw: string | null | undefined): PhoneCheck {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, reason: "The order has no customer phone number." };
  let digits = input.replace(/[^\d+]/g, "");
  // 00-prefixed international form → plain digits.
  if (digits.startsWith("00")) digits = digits.slice(2);
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\D/g, "");
  if (digits.length < 8) return { ok: false, reason: "The customer phone number is too short to be an international number." };
  if (digits.length > 15) return { ok: false, reason: "The customer phone number is longer than WhatsApp allows (15 digits)." };
  // A local Indian mobile (10 digits, starts 6–9) is the one safe assumption:
  // it is unambiguous, and it is what this business's customers mostly type.
  if (!hadPlus && digits.length === 10) {
    if (!/^[6-9]/.test(digits)) {
      // A 10-digit number starting 0–5 is not an Indian mobile, and without a
      // country code there is no honest way to know whose it is.
      return { ok: false, reason: "The customer phone number is not an Indian mobile and has no country code — enter it in international format (e.g. 919876543210)." };
    }
    digits = `91${digits}`;
  }
  if (digits.length < 10) {
    return { ok: false, reason: "The customer phone number has no country code — enter it in international format (e.g. 919876543210)." };
  }
  return { ok: true, digits };
}

/** Retry backoff: 5 min, 10, 20, 40, 80 … capped at 6 hours. */
export function retryDelayMinutes(retryCount: number): number {
  const n = Math.max(0, Math.floor(retryCount));
  return Math.min(360, 5 * 2 ** n);
}

export function nextAttemptAt(retryCount: number, now: Date = new Date()): string {
  return new Date(now.getTime() + retryDelayMinutes(retryCount) * 60_000).toISOString();
}

export const MAX_STATUS_RETRIES = 5;
