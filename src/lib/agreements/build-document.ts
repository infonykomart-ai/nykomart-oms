// 2026-11-03 — assembles the printable agreement from stored form values.
//
// ONE builder, used by BOTH the on-screen preview and the stored PDF version,
// so what the admin approves cannot differ from what the vendor receives. The
// stored version additionally freezes `snapshot` (values + resolved clauses +
// letterhead) in agreement_document_versions.content_snapshot, which is what
// makes a later template or letterhead change unable to rewrite history.
import {
  CLAUSE_LIBRARY,
  buildAgreementSections,
  buildAgreementTokens,
  findAgreementTemplate,
  formatAgreementDate,
  type AgreementTemplate,
  type AgreementValues,
} from "./templates";
import type { AgreementLetterhead } from "./letterhead";
import type { AgreementPdfData } from "./agreement-pdf";

export const VENDOR_ACCEPTANCE_DECLARATION =
  "Vendor acceptance: the Vendor confirms that it has read and understood this Agreement, has had the opportunity to take independent legal advice, accepts and agrees to be bound by its terms, and confirms that the signatory is duly authorised to execute it for and on behalf of the Vendor. A typed name, an email acknowledgement or an unsigned WhatsApp message is NOT a signature; this Agreement is executed only by signatures — wet-ink scanned copies or an approved electronic signature — recorded against this reference number in the Nyko Mart OMS.";

export type AgreementDocumentRow = {
  id: string;
  ref_no: string;
  company_id: string;
  template_slug: string;
  template_version: number;
  included_clause_slugs: string[] | null;
  effective_date: string;
  field_values: AgreementValues | null;
  include_witnesses: boolean;
};

export type BuiltAgreement = {
  data: AgreementPdfData;
  template: AgreementTemplate;
  tokens: AgreementValues;
  /** Names of the combined clause groups, for the "Combined with" line. */
  combinedGroupTitles: string[];
  /** Everything that must be frozen with a generated version. */
  snapshot: {
    tokens: AgreementValues;
    clauses: { title: string; paragraphs: string[] }[];
    specialTerms: string[];
    letterhead: AgreementLetterhead;
    includeWitnesses: boolean;
    templateSlug: string;
    templateVersion: number;
    includedClauseSlugs: string[];
  };
};

const filled = (value: string | null | undefined): string => (value && value.trim() ? value.trim() : "");

export function buildAgreementDocument(args: {
  document: AgreementDocumentRow;
  vendorName: string;
  letterhead: AgreementLetterhead;
  version: number;
  signatoryName: string;
  signatoryDesignation: string;
}): BuiltAgreement {
  const template = findAgreementTemplate(args.document.template_slug);
  if (!template) throw new Error(`Unknown agreement template: ${args.document.template_slug}`);

  const values: AgreementValues = { ...(args.document.field_values ?? {}) };
  const refNo = args.document.ref_no;
  const clauseSlugs = (args.document.included_clause_slugs ?? []).filter(Boolean);

  const tokens = buildAgreementTokens({
    company: {
      name: args.letterhead.legalName,
      address: args.letterhead.address,
      gstin: args.letterhead.gstin,
      email: args.letterhead.email,
      phone: args.letterhead.phone,
    },
    values,
    refNo,
  });

  const built = buildAgreementSections(template, tokens, clauseSlugs);
  const combinedGroupTitles = clauseSlugs
    .map((slug) => CLAUSE_LIBRARY.find((group) => group.slug === slug)?.title)
    .filter((title): title is string => Boolean(title));

  const vendorLines = [
    filled(tokens.vendor_address),
    [filled(tokens.vendor_city), filled(tokens.vendor_state), filled(tokens.vendor_postal_code), filled(tokens.vendor_country)]
      .filter(Boolean)
      .join(", "),
    filled(tokens.vendor_category) ? `Vendor category: ${filled(tokens.vendor_category)}` : "",
    filled(tokens.vendor_gstin) && tokens.vendor_gstin !== "Not applicable" ? `GSTIN / Tax Reg.: ${tokens.vendor_gstin}` : "",
    filled(tokens.vendor_reg_no) && tokens.vendor_reg_no !== "Not applicable" ? `Registration No.: ${tokens.vendor_reg_no}` : "",
    filled(tokens.vendor_email) ? `Email: ${filled(tokens.vendor_email)}` : "",
    filled(tokens.vendor_whatsapp) ? `WhatsApp: ${filled(tokens.vendor_whatsapp)}` : "",
    filled(tokens.vendor_contact_person)
      ? `Represented by: ${filled(tokens.vendor_contact_person)}${filled(tokens.vendor_designation) ? `, ${filled(tokens.vendor_designation)}` : ""}`
      : "",
  ].filter(Boolean);

  // Role-based templates (Design & IP Acknowledgment) are issued by the
  // designer, who may not be the company on the letterhead. In that case the
  // letterhead's address/GSTIN must NOT be printed under the designer's name —
  // only who represents it.
  const companyPartyName = (template.companyPartyNameField && filled(values[template.companyPartyNameField])) || args.letterhead.legalName;
  const otherEntity = companyPartyName !== args.letterhead.legalName;
  const companyLines = otherEntity
    ? [
        filled(tokens.designer_name)
          ? `Represented by: ${filled(tokens.designer_name)}${filled(tokens.designer_title) ? `, ${filled(tokens.designer_title)}` : ""}`
          : "",
      ].filter(Boolean)
    : [
        filled(args.letterhead.address),
        [filled(args.letterhead.email), filled(args.letterhead.website), filled(args.letterhead.phone)].filter(Boolean).join("  ·  "),
        filled(args.letterhead.gstin) ? `GSTIN: ${args.letterhead.gstin}` : "",
      ].filter(Boolean);

  const data: AgreementPdfData = {
    title: filled(tokens.custom_title) || template.subject,
    subject: template.subject,
    refNo,
    effectiveDate: formatAgreementDate(tokens.effective_date) || tokens.effective_date,
    version: args.version,
    letterhead: args.letterhead,
    parties: {
      company: { name: companyPartyName, lines: companyLines },
      vendor: { name: args.vendorName, lines: vendorLines },
    },
    clauses: built.clauses,
    specialTerms: built.specialTerms,
    annexureTitle: built.annexureTitle,
    annexure: built.annexure,
    signatories: {
      company: {
        // Role-based templates (Design & IP Acknowledgment) carry the designer's
        // own name/title, so the company column must not fall back to a Nyko
        // Mart signatory that would print the wrong person.
        name:
          filled(tokens.company_signatory_name) ||
          filled(tokens.designer_name) ||
          filled(template.companySignatoryDefaults?.name) ||
          args.signatoryName,
        designation:
          filled(tokens.company_signatory_designation) ||
          filled(tokens.designer_title) ||
          filled(template.companySignatoryDefaults?.designation) ||
          args.signatoryDesignation,
      },
      vendor: {
        name: filled(tokens.vendor_signatory_name) || filled(tokens.vendor_contact_person),
        designation: filled(tokens.vendor_signatory_designation) || "Authorised Signatory",
      },
    },
    includeWitnesses: args.document.include_witnesses,
    declaration: filled(template.declaration) || VENDOR_ACCEPTANCE_DECLARATION,
    signatureHeadings: template.signatureHeadings,
    partyHeading: template.partyHeading,
    combinationNote: combinedGroupTitles.length
      ? `This Agreement includes the following additional clause groups: ${combinedGroupTitles.join(", ")}.`
      : undefined,
  };

  return {
    data,
    template,
    tokens,
    combinedGroupTitles,
    snapshot: {
      tokens,
      clauses: built.clauses,
      specialTerms: built.specialTerms,
      letterhead: args.letterhead,
      includeWitnesses: args.document.include_witnesses,
      templateSlug: template.slug,
      templateVersion: template.version,
      includedClauseSlugs: clauseSlugs,
    },
  };
}
