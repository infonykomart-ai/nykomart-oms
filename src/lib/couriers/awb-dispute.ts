// 2026-11-03 — AWB dispute (payment hold) form → row payload.
//
// One pure function so the freight and duty actions cannot drift: both write
// exactly these six columns (db/2026-11-03-awb-dispute-and-duty-cn-split.sql)
// and the date bookkeeping is the part worth getting right —
//
//   • raising a case stamps dispute_raised_on ONCE (re-saving an open dispute
//     must not move the age, otherwise "kitne din se khula hai" resets every
//     edit),
//   • resolving stamps dispute_resolved_on and keeps raised_on,
//   • clearing back to 'none' wipes the case's amount/reason/resolution but
//     not history on the bill (the AWB row itself is the only record).
//
// The hold amount is clamped at 0 — a negative hold would RAISE the payable,
// which is never what a dispute means; money going back to the courier is a
// debit note, not a dispute.

export const AWB_DISPUTE_STATUSES = ["none", "under_dispute", "resolved"] as const;
export type AwbDisputeStatus = (typeof AWB_DISPUTE_STATUSES)[number];

export type AwbDisputeFields = {
  dispute_status: string | null;
  dispute_amount: number | null;
  dispute_raised_on: string | null;
  dispute_resolved_on: string | null;
};

export type AwbDisputeUpdate = {
  dispute_status: AwbDisputeStatus;
  dispute_amount: number;
  dispute_reason: string | null;
  dispute_raised_on: string | null;
  dispute_resolved_on: string | null;
  dispute_resolution: string | null;
};

export function isAwbDisputeStatus(value: string): value is AwbDisputeStatus {
  return (AWB_DISPUTE_STATUSES as readonly string[]).includes(value);
}

/** True when this form submission actually carried the dispute block. */
export function hasAwbDisputeFields(formData: FormData): boolean {
  return formData.has("dispute_status");
}

export function buildAwbDisputeUpdate(
  formData: FormData,
  current: AwbDisputeFields | null,
  today: string
): AwbDisputeUpdate {
  const rawStatus = String(formData.get("dispute_status") ?? "").trim();
  const status: AwbDisputeStatus = isAwbDisputeStatus(rawStatus) ? rawStatus : "none";
  const rawAmount = Number(String(formData.get("dispute_amount") ?? "").trim() || "0");
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount * 100) / 100 : 0;
  const reason = String(formData.get("dispute_reason") ?? "").trim() || null;
  const resolution = String(formData.get("dispute_resolution") ?? "").trim() || null;

  const prevStatus = current?.dispute_status && isAwbDisputeStatus(current.dispute_status) ? current.dispute_status : "none";
  const prevRaised = current?.dispute_raised_on ?? null;
  const prevResolved = current?.dispute_resolved_on ?? null;

  if (status === "none") {
    return {
      dispute_status: "none",
      dispute_amount: 0,
      dispute_reason: null,
      dispute_raised_on: null,
      dispute_resolved_on: null,
      dispute_resolution: null,
    };
  }

  if (status === "under_dispute") {
    return {
      dispute_status: "under_dispute",
      dispute_amount: amount,
      dispute_reason: reason,
      // Keep the original raised date — the age must not reset on every edit.
      dispute_raised_on: prevStatus === "under_dispute" && prevRaised ? prevRaised : today,
      dispute_resolved_on: null,
      dispute_resolution: null,
    };
  }

  // resolved — keep what was held and when it was raised, stamp the close.
  return {
    dispute_status: "resolved",
    dispute_amount: current?.dispute_amount != null && amount === 0 ? Number(current.dispute_amount) : amount,
    dispute_reason: reason,
    dispute_raised_on: prevRaised ?? today,
    dispute_resolved_on: prevStatus === "resolved" && prevResolved ? prevResolved : today,
    dispute_resolution: resolution,
  };
}
