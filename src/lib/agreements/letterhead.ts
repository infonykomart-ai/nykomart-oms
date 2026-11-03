// 2026-11-03 — the OFFICIAL LETTERHEAD the agreement PDFs are printed on.
//
// One resolver, three sources, in this order:
//   1. agreement_letterhead_settings (what an admin configured on
//      /dashboard/agreements/letterhead — logo, legal name, address, email,
//      website, phone, GSTIN, footer text, signature image, brand colours,
//      typography);
//   2. companies + company_profiles (the values this OMS already holds);
//   3. nothing — a field that is not configured anywhere is simply omitted
//      from the document. Registration/GSTIN details are NEVER derived or
//      invented; a missing GSTIN prints no GSTIN line at all.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type AgreementFontFamily = "Helvetica" | "Times-Roman" | "Courier";

export type AgreementLetterhead = {
  companyId: string;
  /** Company legal name (printed large in the header). */
  legalName: string;
  address: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  gstin: string | null;
  logoUrl: string | null;
  /** Authorised-signatory image; only printed when configured. */
  signatureUrl: string | null;
  footerText: string;
  brandColor: string;
  accentColor: string;
  fontFamily: AgreementFontFamily;
  /** True when a settings row exists (i.e. an admin has configured it). */
  configured: boolean;
};

export const DEFAULT_LETTERHEAD_FOOTER = "Confidential Document — for the named vendor only. Unauthorised circulation or reproduction is prohibited.";
export const DEFAULT_BRAND_COLOR = "#0f172a";
export const DEFAULT_ACCENT_COLOR = "#b45309";

/** Typography options offered in the settings screen (react-pdf's built-in
 *  fonts only, so no font file has to be shipped or embedded). */
export const AGREEMENT_FONT_OPTIONS: { value: AgreementFontFamily; label: string }[] = [
  { value: "Helvetica", label: "Helvetica — modern sans-serif (default)" },
  { value: "Times-Roman", label: "Times Roman — formal serif, legal-document look" },
  { value: "Courier", label: "Courier — typewriter monospace" },
];

export async function loadAgreementLetterhead(
  supabase: Client,
  companyId: string | null
): Promise<AgreementLetterhead | null> {
  if (!companyId) return null;

  const [{ data: company }, { data: profile }, { data: settings }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", companyId).maybeSingle(),
    supabase.from("company_profiles").select("address, phone, email, gstin").eq("company_id", companyId).maybeSingle(),
    supabase
      .from("agreement_letterhead_settings")
      .select(
        "company_id, logo_url, legal_name, address, email, website, phone, gstin, footer_text, signature_url, brand_color, accent_color, font_family"
      )
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (!company) return null;

  const pick = (...values: (string | null | undefined)[]): string | null => {
    for (const value of values) if (value && value.trim()) return value.trim();
    return null;
  };

  return {
    companyId,
    legalName: pick(settings?.legal_name, company.name) ?? company.name,
    address: pick(settings?.address, profile?.address),
    email: pick(settings?.email, profile?.email),
    website: pick(settings?.website),
    phone: pick(settings?.phone, profile?.phone),
    // Deliberately NO fallback beyond what the admin/company profile holds.
    gstin: pick(settings?.gstin, profile?.gstin),
    logoUrl: pick(settings?.logo_url, company.logo_url),
    signatureUrl: pick(settings?.signature_url),
    footerText: pick(settings?.footer_text, DEFAULT_LETTERHEAD_FOOTER) ?? DEFAULT_LETTERHEAD_FOOTER,
    brandColor: pick(settings?.brand_color, DEFAULT_BRAND_COLOR) ?? DEFAULT_BRAND_COLOR,
    accentColor: pick(settings?.accent_color, DEFAULT_ACCENT_COLOR) ?? DEFAULT_ACCENT_COLOR,
    fontFamily: (settings?.font_family as AgreementFontFamily | undefined) ?? "Helvetica",
    configured: Boolean(settings),
  };
}

/** `#0f172a` -> true. Guards the colour inputs before they reach the PDF. */
export function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
