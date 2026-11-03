// 2026-11-03 — the WhatsApp covering message.
//
// IMPORTANT, and the reason this file has a comment block at all: a wa.me /
// click-to-chat link CANNOT attach a file. Two delivery paths therefore exist
// and the app is honest about which one ran:
//
//   • Web Share (mobile): navigator.share({ files: [pdf] }) hands the REAL PDF
//     to the OS share sheet, so WhatsApp receives it as an attachment. This is
//     recorded as provider 'web_share'.
//   • Click-to-chat (desktop, or a browser without file sharing): the PDF is
//     downloaded for the admin to attach manually, and wa.me opens with this
//     exact message. Recorded as 'manual_attach_required' — never as "sent".
//
// Automated attachment without any manual step requires an approved WhatsApp
// Business Cloud API integration (WABA template message). If such credentials
// are configured the server action can log provider 'whatsapp_cloud_api'; the
// message text below is what that integration would send.
import type { AgreementValues } from "./templates";

export const WHATSAPP_CHAR_LIMIT = 4000;

export function buildAgreementWhatsAppMessage(args: {
  vendorName: string;
  agreementName: string;
  companyName: string;
  refNo: string;
  effectiveDate: string;
  /** Optional secure vendor link (tokenised) to include in the chat. */
  vendorLink?: string | null;
}): string {
  const vendor = args.vendorName?.trim() || "Sir/Madam";
  const agreement = args.agreementName?.trim() || "Vendor Agreement";

  const lines = [
    `Dear ${vendor},`,
    "",
    `Greetings from ${args.companyName}.`,
    "",
    `Please find attached our official ${agreement}.`,
    "",
    "Kindly review the document carefully, complete the required details, sign it and return the signed copy to us.",
    "",
    "This agreement is intended to protect Nyko Mart's business information, customer data, rug designs, intellectual property and confidential commercial information.",
    "",
    "Please confirm once the signed agreement has been shared.",
    "",
    `Agreement Reference: ${args.refNo}`,
    `Effective Date: ${args.effectiveDate}`,
  ];

  if (args.vendorLink) {
    lines.push("", `Secure document link (private, expires): ${args.vendorLink}`);
  }

  lines.push("", `Regards,`, args.companyName);

  const message = lines.join("\n");
  return message.length > WHATSAPP_CHAR_LIMIT ? message.slice(0, WHATSAPP_CHAR_LIMIT) : message;
}

/** Vendor phone -> wa.me digits. A bare 10-digit Indian number gets +91. */
export function whatsAppDigits(raw: string | null | undefined, defaultCountryCode = "91"): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  // 0XXXXXXXXXX is the domestic trunk form; drop the leading zero.
  if (digits.length === 11 && digits.startsWith("0")) return `${defaultCountryCode}${digits.slice(1)}`;
  return digits;
}

/** True when a number is good enough to open a WhatsApp chat with. */
export function isUsableWhatsAppNumber(raw: string | null | undefined): boolean {
  const digits = whatsAppDigits(raw);
  return digits.length >= 10 && digits.length <= 15;
}

/** Vendor-facing summary of what was issued — used in the history log note. */
export function describeAgreementForLog(args: {
  templateTitle: string;
  vendorName: string;
  refNo: string;
  version: number;
  values: AgreementValues;
}): string {
  const parts = [`${args.templateTitle}`, `for ${args.vendorName}`, `(${args.refNo}, v${args.version})`];
  if (args.values.effective_date) parts.push(`effective ${args.values.effective_date}`);
  return parts.join(" ");
}
