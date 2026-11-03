// 2026-11-03 — Vendor Agreement Generator (Agreement Generator & WhatsApp
// Sharing module).
//
// Same shape as src/lib/hr-letters/templates.ts — one plain-JSON template
// object per document type, every variable bit written as a {{token}}, and a
// single generic form/preview/PDF flow (agreement-generator.tsx) instead of
// one bespoke screen per agreement. That is deliberate: HR Letters already
// proved this pattern in this codebase, and it keeps templates editable
// without touching any UI code.
//
// Everything here is PLAIN DATA on purpose (no functions attached to a
// template object): templates are passed from a Server Component into the
// client form, and React cannot serialize functions across that boundary
// (this exact mistake crashed hr-letters/[slug]/page.tsx in October — see
// the comment on TEMPLATE_DERIVED_VALUES in lib/hr-letters/templates.ts).
// Derived/computed tokens therefore live in buildAgreementTokens() at the
// bottom of this file, which both the form and the PDF builder call directly.
//
// The clauses are written to be usable as-is for a real Nyko Mart vendor
// engagement. They are a business template, not a substitute for a lawyer's
// review — the generator deliberately exposes a "Special Terms / Additional
// Clauses" box so the admin can add case-specific wording before issuing.

export type AgreementFieldType = "text" | "textarea" | "date" | "select" | "number";

export type AgreementField = {
  key: string;
  label: string;
  type: AgreementFieldType;
  default?: string;
  /** Only for type "select" — the exact strings substituted into the clauses. */
  options?: string[];
  placeholder?: string;
  /** Shown under the input as small helper text. */
  help?: string;
};

/** The vendor categories requested for the module (dropdown on every agreement). */
export const VENDOR_CATEGORIES = [
  "Rug Manufacturer",
  "Cotton Dhurrie Supplier",
  "Jute Rug Manufacturer",
  "Hand Braided Rug Manufacturer",
  "Tufted Rug Manufacturer",
  "Designer / Artisan",
  "Photographer",
  "E-commerce Marketplace Manager",
  "Software Developer",
  "Logistics / Fulfilment Partner",
  "Marketing Agency",
  "General Supplier",
  "Other",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/**
 * The vendor-details block every agreement starts with. Rendered once by the
 * shared form (and picked up by buildAgreementTokens below), so adding a
 * vendor field is a one-line change here rather than an edit in 7 templates.
 */
export const VENDOR_FIELDS: AgreementField[] = [
  { key: "vendor_legal_name", label: "Vendor Legal Name", type: "text", placeholder: "As per GST / registration certificate" },
  { key: "vendor_business_name", label: "Company / Business Name", type: "text", placeholder: "Trading / brand name" },
  { key: "vendor_contact_person", label: "Contact Person", type: "text" },
  { key: "vendor_designation", label: "Designation", type: "text", placeholder: "Proprietor / Director / Manager" },
  { key: "vendor_address", label: "Registered Address", type: "textarea" },
  { key: "vendor_city", label: "City", type: "text" },
  { key: "vendor_state", label: "State / Province", type: "text" },
  { key: "vendor_country", label: "Country", type: "text", default: "India" },
  { key: "vendor_postal_code", label: "Postal Code", type: "text" },
  { key: "vendor_email", label: "Email Address", type: "text" },
  { key: "vendor_whatsapp", label: "WhatsApp Mobile Number", type: "text", help: "Used for the WhatsApp sharing button and printed on the agreement." },
  { key: "vendor_gstin", label: "GSTIN / Tax Registration Number", type: "text", help: "Optional." },
  { key: "vendor_reg_no", label: "Business Registration Number", type: "text", help: "Optional — CIN / Udyam / LLC number, as applicable." },
  {
    key: "vendor_category",
    label: "Vendor Category",
    type: "select",
    options: [...VENDOR_CATEGORIES],
    default: "Rug Manufacturer",
  },
];

export type AgreementClause = {
  title: string;
  /** One entry per paragraph; {{tokens}} are substituted at build time. */
  paragraphs: string[];
};

export type AgreementTemplate = {
  slug: string;
  /**
   * Wording version of this template. Bumped whenever the clauses change, and
   * must match agreement_templates.version in the database before a document
   * can be generated — an unreviewed wording change can never go out silently.
   */
  version: number;
  title: string;
  /** Short label used on the hub tile / PDF header. */
  shortTitle: string;
  icon: string;
  /** One-line explanation shown on the hub. */
  summary: string;
  /** Subject line printed on the agreement and used in email/WhatsApp text. */
  subject: string;
  /** Template-specific inputs, in addition to VENDOR_FIELDS + the shared meta fields. */
  fields: AgreementField[];
  clauses: AgreementClause[];
  /** Optional schedule printed after the clauses (e.g. deliverable list). */
  annexureTitle?: string;
  annexure?: string[];
  /**
   * Replaces the two signature-column headings (default: "For and on behalf of
   * <party>"). Used where the parties have role names instead of company names,
   * e.g. DESIGNER / IP OWNER vs MANUFACTURER / SUPPLIER.
   */
  signatureHeadings?: { company: string; vendor: string };
  /** Replaces "This agreement is made between" in the opening block. */
  partyHeading?: string;
  /** Replaces the closing acceptance declaration when the template needs its own. */
  declaration?: string;
  /**
   * Printed in the company signature column when neither the form nor the
   * letterhead names a signatory. Used by role-based templates where the
   * signing party is the designer, not a Nyko Mart director.
   */
  companySignatoryDefaults?: { name?: string; designation?: string };
  /**
   * Field key whose value names the first party when it is NOT the company on
   * the letterhead (the Design & IP Acknowledgment is issued by the designer,
   * e.g. "The H Space", not by the OMS operator). When this names a different
   * entity, the letterhead's address/GSTIN lines are not printed under it.
   */
  companyPartyNameField?: string;
};

/**
 * Meta fields shared by every agreement (dates, term, signatories, governing
 * city). Kept separate from VENDOR_FIELDS because these are about the deal,
 * not about who the vendor is.
 */
export const AGREEMENT_META_FIELDS: AgreementField[] = [
  { key: "effective_date", label: "Effective Date", type: "date" },
  {
    key: "agreement_term",
    label: "Agreement Term",
    type: "select",
    options: ["1 year", "2 years", "3 years", "5 years", "Project / engagement duration", "Until terminated by either Party"],
    default: "1 year",
  },
  { key: "jurisdiction_city", label: "Governing Law / Jurisdiction City", type: "text", default: "Jaipur, Rajasthan" },
  { key: "company_signatory_name", label: "Nyko Mart Signatory (Name)", type: "text" },
  { key: "company_signatory_designation", label: "Nyko Mart Signatory (Designation)", type: "text", default: "Director" },
  { key: "vendor_signatory_name", label: "Vendor Signatory (Name)", type: "text", help: "Defaults to the contact person." },
  { key: "vendor_signatory_designation", label: "Vendor Signatory (Designation)", type: "text", default: "Authorised Signatory" },
  { key: "additional_clauses", label: "Special Terms / Additional Clauses (optional)", type: "textarea", help: "Printed as a separate 'Special Terms' section before the signatures." },
];

const PARTIES = [
  "“Nyko Mart” means {{company_name}}, having its registered office at {{company_address}} (GSTIN: {{company_gstin}}), and",
  "“Vendor” means {{vendor_legal_name}} (business name: {{vendor_business_name}}), a {{vendor_category}} having its registered office at {{vendor_address}}, {{vendor_city}}, {{vendor_state}} {{vendor_postal_code}}, {{vendor_country}} (GSTIN / Tax Reg.: {{vendor_gstin}}; Registration No.: {{vendor_reg_no}}), represented by {{vendor_contact_person}}, {{vendor_designation}}.",
];

const STANDARD_TAIL: AgreementClause[] = [
  {
    title: "Relationship of the Parties",
    paragraphs: [
      "The Vendor is an independent contractor. Nothing in this Agreement creates a partnership, joint venture, agency or employment relationship between the Parties, and neither Party may bind the other or hold itself out as entitled to do so.",
    ],
  },
  {
    title: "Governing Law and Jurisdiction",
    paragraphs: [
      "This Agreement is governed by and construed in accordance with the laws of India. The courts at {{jurisdiction_city}} shall have exclusive jurisdiction over any dispute arising out of or in connection with this Agreement, subject to the dispute-resolution clause above (where applicable).",
    ],
  },
  {
    title: "Entire Agreement and Amendment",
    paragraphs: [
      "This Agreement, together with its annexures and any purchase order or statement of work issued under it, constitutes the entire understanding between the Parties on its subject matter and supersedes all prior discussions and representations.",
      "No amendment is effective unless made in writing and signed by an authorised representative of each Party. A waiver of any breach is not a waiver of any later breach.",
    ],
  },
  {
    title: "Notices",
    paragraphs: [
      "Notices under this Agreement may be delivered by email or WhatsApp to the addresses and numbers recorded in this Agreement, and are deemed received on the next working day. The Vendor shall keep Nyko Mart informed of any change to its contact details.",
    ],
  },
  {
    title: "Execution",
    paragraphs: [
      "The Parties have read and understood this Agreement and execute it as of {{effective_date}}. This Agreement may be signed and exchanged electronically, and an electronic or scanned copy is as valid as the original.",
    ],
  },
];

export const AGREEMENT_TEMPLATES: AgreementTemplate[] = [
  {
    slug: "master-nda",
    version: 1,
    title: "Master Confidentiality & NDA Agreement",
    shortTitle: "Master NDA",
    icon: "🔒",
    summary: "Baseline confidentiality cover for every vendor, partner and agency that sees Nyko Mart's designs, pricing or buyer data.",
    subject: "Master Confidentiality and Non-Disclosure Agreement",
    fields: [
      { key: "nda_purpose", label: "Purpose of Disclosure", type: "textarea", default: "evaluating and performing the commercial engagement between the Parties" },
      { key: "nda_term", label: "Confidentiality Period After Termination", type: "select", options: ["2 years", "3 years", "5 years", "7 years", "Indefinite (trade secrets)"], default: "3 years" },
      { key: "nda_return_days", label: "Return / Destroy Materials Within (days)", type: "text", default: "15" },
    ],
    clauses: [
      {
        title: "Parties and Purpose",
        paragraphs: [
          ...PARTIES,
          "The Parties wish to exchange information for the purpose of {{nda_purpose}}. This Agreement applies to every disclosure made between them, whether before or after the Effective Date, and to every engagement, purchase order or statement of work issued under it.",
        ],
      },
      {
        title: "Confidential Information",
        paragraphs: [
          "“Confidential Information” means all information disclosed by one Party (the “Disclosing Party”) to the other (the “Receiving Party”), in any form, that is marked confidential or that a reasonable person would understand to be confidential — including rug designs, sketches, colourways, weave and knotting specifications, supplier and cost sheets, pricing and margin structures, buyer and customer lists, marketplace account data, order, return and refund data, business plans, software, and the terms of this Agreement.",
        ],
      },
      {
        title: "Obligations of the Receiving Party",
        paragraphs: [
          "The Receiving Party shall: (a) use Confidential Information solely for the Purpose; (b) protect it with at least the same care it uses for its own confidential information, and never less than reasonable care; (c) disclose it only to those of its personnel, professional advisers or sub-contractors who need it for the Purpose and who are bound by confidentiality obligations at least as protective as this Agreement; and (d) not copy, photograph, reverse-engineer or commercially exploit it.",
        ],
      },
      {
        title: "Exclusions",
        paragraphs: [
          "Confidential Information does not include information that the Receiving Party can demonstrate: (a) was lawfully in its possession before disclosure without a duty of confidence; (b) is or becomes public through no breach of this Agreement; (c) was lawfully received from a third party without restriction; or (d) was independently developed without use of the Confidential Information.",
        ],
      },
      {
        title: "Compelled Disclosure",
        paragraphs: [
          "If the Receiving Party is required by law, regulation or a competent authority to disclose Confidential Information, it shall — where lawfully permitted — give the Disclosing Party prompt written notice so that protective measures can be sought, and disclose only the minimum required.",
        ],
      },
      {
        title: "Return or Destruction",
        paragraphs: [
          "On written request or on termination of the engagement, the Receiving Party shall return or securely destroy all Confidential Information, including copies, samples, design files and photographs, within {{nda_return_days}} days and confirm in writing that it has done so. One archival copy may be retained solely to evidence compliance with this Agreement or a legal obligation.",
        ],
      },
      {
        title: "Intellectual Property",
        paragraphs: [
          "All Confidential Information, and all intellectual property rights in it, remain the sole property of the Disclosing Party. No licence, assignment or other right is granted except the limited right to use the information for the Purpose.",
        ],
      },
      {
        title: "Non-Solicitation",
        paragraphs: [
          "During the engagement and for twelve (12) months after it ends, neither Party shall directly solicit for employment any employee or key individual of the other Party who was involved in the engagement, except through a general public advertisement.",
        ],
      },
      {
        title: "Term and Survival",
        paragraphs: [
          "This Agreement takes effect on {{effective_date}} and continues for the duration of the engagement, and thereafter for {{nda_term}} in respect of information disclosed during it. Obligations in respect of trade secrets survive for as long as the information remains a trade secret.",
        ],
      },
      {
        title: "Remedies",
        paragraphs: [
          "The Parties agree that a breach of this Agreement may cause harm that cannot be adequately compensated in money. The Disclosing Party is therefore entitled to seek injunctive relief in addition to damages and any other remedy available in law or equity.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    slug: "manufacturer-supplier",
    version: 1,
    title: "Manufacturer & Rug Supplier Agreement",
    shortTitle: "Manufacturer / Supplier",
    icon: "🧵",
    summary: "Supply terms for rug, dhurrie, jute, braided and tufted manufacturers — quality, lead time, rejection and payment.",
    subject: "Manufacturer and Rug Supply Agreement",
    fields: [
      { key: "supply_scope", label: "Products / Range Supplied", type: "textarea", default: "hand-knotted, hand-tufted, hand-braided and flat-weave rugs as per the approved design and specification sheets shared by Nyko Mart" },
      { key: "lead_time", label: "Standard Lead Time", type: "text", default: "30 days from purchase order" },
      { key: "payment_terms", label: "Payment Terms", type: "text", default: "50% advance with the purchase order, balance within 15 days of receipt and inspection at Nyko Mart's warehouse" },
      { key: "defect_window", label: "Defect / Rejection Claim Window", type: "text", default: "7 days from delivery" },
      { key: "wastage_limit", label: "Permitted Wastage / Shortage", type: "text", default: "2% of ordered quantity" },
      { key: "exclusivity", label: "Exclusivity", type: "select", options: ["Non-exclusive", "Exclusive for Nyko Mart designs", "Exclusive for the agreed product range"], default: "Exclusive for Nyko Mart designs" },
    ],
    clauses: [
      {
        title: "Parties and Appointment",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart appoints the Vendor as a manufacturer and supplier of {{supply_scope}}, and the Vendor accepts the appointment on the terms of this Agreement. The appointment is {{exclusivity}}.",
        ],
      },
      {
        title: "Purchase Orders and Scope",
        paragraphs: [
          "Each order is placed by a written purchase order stating design, size, colourway, pile/weave, quantity, rate and delivery date. A purchase order is binding once acknowledged by the Vendor in writing. Any deviation in specification requires Nyko Mart's prior written approval.",
        ],
      },
      {
        title: "Quality Standards",
        paragraphs: [
          "All goods shall conform to the approved sample and specification sheet, be free from weaving, tufting, dyeing, backing and finishing defects, and match the approved colour within normal commercial tolerance. The Vendor shall maintain the same quality for repeat orders as for the approved first sample.",
        ],
      },
      {
        title: "Samples and Approval",
        paragraphs: [
          "The Vendor shall submit a production sample or strike-off for each new design before bulk production. Bulk production may begin only after Nyko Mart's written approval. Approved samples are the reference standard for the entire order and for any repeat order.",
        ],
      },
      {
        title: "Delivery and Lead Time",
        paragraphs: [
          "The standard lead time is {{lead_time}}. Time is of the essence for marketplace-bound orders. The Vendor shall notify Nyko Mart in writing as soon as any delay becomes apparent, together with a revised delivery plan; repeated or unapproved delay entitles Nyko Mart to cancel the affected order or source it elsewhere at the Vendor's cost difference.",
        ],
      },
      {
        title: "Pricing, Invoicing and Payment",
        paragraphs: [
          "Rates are as agreed per purchase order and are inclusive of packing and inland delivery to the location stated on the order, unless stated otherwise. Payment terms: {{payment_terms}}. Invoices must quote the purchase order number, GSTIN and HSN code; invoices without a valid purchase order reference may be returned unpaid.",
        ],
      },
      {
        title: "Inspection, Rejection and Replacement",
        paragraphs: [
          "Nyko Mart may inspect goods on receipt or during production. Goods that are short-supplied, damaged, or not in conformity with the approved sample may be rejected within {{defect_window}} of delivery. The Vendor shall replace rejected goods or issue a credit note at Nyko Mart's option, and shall bear the freight cost for both the rejected and the replacement consignment.",
          "Permitted wastage or shortage is {{wastage_limit}}; any excess is deducted from the invoice value at the order rate.",
        ],
      },
      {
        title: "Packaging, Labelling and Documents",
        paragraphs: [
          "Goods shall be packed to survive transit and export handling, roll-packed unless a fold is agreed in writing, labelled with design code, size and quantity, and accompanied by the packing list, invoice and any certificate of origin or material composition certificate required for export.",
        ],
      },
      {
        title: "Compliance and Labour Standards",
        paragraphs: [
          "The Vendor shall comply with all applicable labour, environmental and tax laws, shall not employ child labour or forced labour at any stage of production, and shall maintain safe working conditions. Nyko Mart may request reasonable evidence of compliance and may suspend orders pending it.",
        ],
      },
      {
        title: "Design Rights",
        paragraphs: [
          "Designs, artwork and specifications supplied by Nyko Mart remain Nyko Mart's property. The Vendor shall not produce, sell or offer for sale goods bearing those designs to any other person, and shall not use them in its own catalogue or online listings, without prior written consent.",
        ],
      },
      {
        title: "Liability and Insurance",
        paragraphs: [
          "The Vendor is liable for loss or damage arising from defective goods, late delivery or breach of this Agreement, including recall, return, replacement and freight costs reasonably incurred. Each Party shall maintain insurance customary for its business.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}} and renews by written agreement. Either Party may terminate for convenience on thirty (30) days' written notice, or immediately for a material breach that is not cured within fifteen (15) days of notice. Purchase orders already acknowledged shall be completed unless Nyko Mart cancels them under the delivery clause.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    slug: "design-ip",
    version: 1,
    title: "Rug Design & Intellectual Property Protection Agreement",
    shortTitle: "Design & IP",
    icon: "🎨",
    summary: "Protects original rug designs, artwork and colourways — ownership, originality warranty and anti-copy obligations.",
    subject: "Rug Design and Intellectual Property Protection Agreement",
    fields: [
      { key: "design_scope", label: "Designs / Artwork Covered", type: "textarea", default: "all rug designs, motifs, colourways, layouts and artwork created for or shared with Nyko Mart, whether by the Vendor or by Nyko Mart" },
      { key: "consideration", label: "Consideration / Royalty", type: "text", default: "included in the agreed supply or service rate, with no separate royalty" },
      { key: "monitoring_duty", label: "Anti-Copy Monitoring", type: "select", options: ["Vendor to monitor and report copies", "Vendor to monitor and report copies, and assist in enforcement at Nyko Mart's cost", "No monitoring obligation"], default: "Vendor to monitor and report copies, and assist in enforcement at Nyko Mart's cost" },
      { key: "credit_line", label: "Credit / Attribution Line (if any)", type: "text", default: "Design: Nyko Mart" },
    ],
    clauses: [
      {
        title: "Parties and Subject Matter",
        paragraphs: [
          ...PARTIES,
          "This Agreement governs {{design_scope}}. It applies to designs already shared with the Vendor on the Effective Date as well as to designs created or shared later.",
        ],
      },
      {
        title: "Ownership",
        paragraphs: [
          "All designs, sketches, technical drawings, colourways, samples, photographs and derivative works created for Nyko Mart, or created by the Vendor in the course of the engagement, are the sole and exclusive property of Nyko Mart from the moment of creation, including all copyright, design-registration rights and goodwill in them.",
        ],
      },
      {
        title: "Assignment of Rights",
        paragraphs: [
          "To the extent any right does not vest automatically, the Vendor assigns to Nyko Mart all right, title and interest worldwide in such works, and shall sign any document reasonably required to record, register or enforce that assignment. Consideration for this assignment is {{consideration}}.",
        ],
      },
      {
        title: "Originality Warranty",
        paragraphs: [
          "The Vendor warrants that every design supplied by it is original, does not infringe the rights of any third party, and has not been copied from another manufacturer, catalogue or marketplace listing. The Vendor shall indemnify Nyko Mart against any claim, loss or expense arising from a breach of this warranty.",
        ],
      },
      {
        title: "Permitted Use and Restrictions",
        paragraphs: [
          "The Vendor may use Nyko Mart designs only to manufacture, pack and deliver Nyko Mart's own orders. The Vendor shall not: (a) reproduce, adapt or recolour them for any other buyer; (b) display them in catalogues, exhibitions, social media or online marketplaces; (c) sell seconds, rejects or overruns bearing them unless Nyko Mart agrees in writing and the goods are defaced or clearly marked; or (d) share design files with any third party.",
        ],
      },
      {
        title: "Anti-Copy and Market Monitoring",
        paragraphs: [
          "Anti-copy obligation: {{monitoring_duty}}. The Vendor shall report any known or suspected copy, look-alike or unauthorised production to Nyko Mart promptly, and shall preserve samples and records that could support enforcement.",
        ],
      },
      {
        title: "Moral Rights and Credit",
        paragraphs: [
          "Where the Vendor or an individual artisan has moral rights in a work, those rights are waived to the extent permitted by law so that Nyko Mart may commercialise the design without attribution. Any agreed credit line is: {{credit_line}}.",
        ],
      },
      {
        title: "Registration and Enforcement",
        paragraphs: [
          "Nyko Mart may register designs, copyright or trade dress in its own name in any territory. The Vendor shall provide information and samples reasonably required for registration and enforcement, at Nyko Mart's cost. Any recovery from enforcement proceedings belongs to Nyko Mart.",
        ],
      },
      {
        title: "Confidentiality of Designs",
        paragraphs: [
          "Unreleased designs are Confidential Information. The Vendor shall restrict access to those personnel who need it for production, keep physical samples in a secure area, and not photograph or video the production floor in a way that discloses unreleased designs.",
        ],
      },
      {
        title: "Term and Survival",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}}. The assignment, originality warranty and restrictions on use survive termination indefinitely, since ownership of the designs does not revert.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    slug: "international-ecommerce",
    version: 1,
    title: "International E-commerce Vendor Agreement",
    shortTitle: "International E-commerce",
    icon: "🌍",
    summary: "For marketplace vendor / manager engagements — listings, SLA, returns, settlement and cross-border compliance.",
    subject: "International E-commerce Vendor Agreement",
    fields: [
      { key: "marketplaces", label: "Marketplace(s) Covered", type: "text", default: "Amazon, eBay, Etsy and such other marketplaces as the Parties agree in writing" },
      { key: "fulfilment_model", label: "Fulfilment Model", type: "select", options: ["Vendor dispatches (FBM / seller-fulfilled)", "Nyko Mart warehouse dispatch", "Marketplace fulfilment (FBA / 3PL)", "Hybrid"], default: "Vendor dispatches (FBM / seller-fulfilled)" },
      { key: "platform_fee", label: "Platform / Management Fee", type: "text", default: "as per the commercial schedule agreed for each marketplace" },
      { key: "settlement_cycle", label: "Settlement Cycle", type: "text", default: "within 7 working days of each marketplace payout" },
      { key: "dispatch_sla", label: "Dispatch SLA", type: "text", default: "within 2 business days of order confirmation" },
      { key: "currency_of_account", label: "Currency of Account", type: "select", options: ["INR", "USD", "GBP", "EUR", "AUD", "CAD"], default: "USD" },
    ],
    clauses: [
      {
        title: "Parties and Appointment",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart engages the Vendor to list, sell, manage and support its products on {{marketplaces}}, on the terms of this Agreement. The fulfilment model is {{fulfilment_model}}.",
        ],
      },
      {
        title: "Listings and Content",
        paragraphs: [
          "Listings shall use Nyko Mart-approved titles, images, dimensions (including the applicable length unit), material composition and origin. The Vendor shall not alter price, image, brand name or product claims without written approval, and shall keep listings compliant with each marketplace's policies.",
        ],
      },
      {
        title: "Pricing, Fees and Currency",
        paragraphs: [
          "Selling prices, discounts and promotions require Nyko Mart's approval. The platform / management fee is {{platform_fee}}. Amounts under this Agreement are stated and settled in {{currency_of_account}}, save where a marketplace settles in another currency, in which case the marketplace's own conversion applies and is shown in the settlement statement.",
        ],
      },
      {
        title: "Orders and Dispatch",
        paragraphs: [
          "Orders shall be confirmed and dispatched within {{dispatch_sla}}. Late dispatch, invalid tracking or unfulfilled orders that damage account health are the Vendor's responsibility, and the Vendor shall bear the resulting marketplace penalties, refunds and shipping charges.",
        ],
      },
      {
        title: "Returns, Refunds and Claims",
        paragraphs: [
          "The Vendor shall process returns and refunds within the marketplace's stated window, inspect returned goods, and report damaged, used or missing-item returns with photographs within 5 days of receipt. Refund or replacement liability follows the reason for return: defect or wrong item — Vendor; buyer's remorse — Nyko Mart, unless the Parties agree otherwise in writing.",
        ],
      },
      {
        title: "Shipping, Customs and Export Compliance",
        paragraphs: [
          "The Vendor shall use approved carriers and service levels, provide valid tracking, and ensure every international consignment carries correct commercial invoice, HS code, declared value, country of origin and any certificate required by the destination country. The Vendor shall not undervalue shipments or misdeclare contents. Duties and taxes are borne as stated on the order or as required by the destination marketplace.",
        ],
      },
      {
        title: "Settlement and Reserves",
        paragraphs: [
          "Marketplace payouts shall be reconciled against orders, fees, refunds and chargebacks, and remitted {{settlement_cycle}}. Nyko Mart may retain a reasonable reserve against pending returns or chargebacks, to be released once the marketplace's claim window closes. A shortfall identified in reconciliation may be set off against the next settlement.",
        ],
      },
      {
        title: "Account Health and Suspension",
        paragraphs: [
          "The Vendor shall maintain the marketplace metrics required for good standing. Nyko Mart may suspend listings or withhold new orders if account health, authenticity complaints or policy violations put the account at risk, without prejudice to accrued rights.",
        ],
      },
      {
        title: "Brand and Intellectual Property",
        paragraphs: [
          "The Vendor shall sell only authentic Nyko Mart goods, shall not use Nyko Mart's brand, images or designs for any other seller or account, and shall not create duplicate or competing listings for the same products. All goodwill in the brand accrues to Nyko Mart.",
        ],
      },
      {
        title: "Customer Data",
        paragraphs: [
          "Buyer names, addresses, phone numbers, emails and order data accessed through a marketplace are processed only to fulfil orders, and are subject to the Customer & Marketplace Data Protection Agreement where the Parties have executed it.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}}. Either Party may terminate on thirty (30) days' written notice. On termination the Vendor shall transfer account access, listings, assets and pending order information to Nyko Mart, complete open orders unless directed otherwise, and settle all amounts due within 30 days.",
        ],
      },
      {
        title: "Governing Law",
        paragraphs: [
          "This Agreement is governed by the laws of India, and the courts at {{jurisdiction_city}} have exclusive jurisdiction, irrespective of the marketplace's own governing law for transactions concluded on its platform.",
        ],
      },
      ...STANDARD_TAIL.filter((c) => c.title !== "Governing Law and Jurisdiction"),
    ],
  },
  {
    slug: "data-protection",
    version: 1,
    title: "Customer & Marketplace Data Protection Agreement",
    shortTitle: "Data Protection",
    icon: "🛡️",
    summary: "Buyer data handling rules for anyone with access to marketplace orders, addresses, phone numbers or CRM records.",
    subject: "Customer and Marketplace Data Protection Agreement",
    fields: [
      { key: "data_scope", label: "Data Covered", type: "textarea", default: "buyer names, shipping and billing addresses, email addresses, phone numbers, order and return records, marketplace messages and review data" },
      { key: "processing_purpose", label: "Permitted Purpose", type: "textarea", default: "fulfilling orders, handling customer service, returns and refunds, and reporting to Nyko Mart on the engagement" },
      { key: "retention_period", label: "Retention Period", type: "text", default: "24 months after the end of the engagement, or as required by law" },
      { key: "breach_hours", label: "Breach Notification Window (hours)", type: "text", default: "24" },
      { key: "sub_processors", label: "Sub-processors", type: "select", options: ["Not permitted without written approval", "Permitted with prior written approval", "Permitted for carriers and accounting tools only"], default: "Permitted with prior written approval" },
    ],
    clauses: [
      {
        title: "Parties and Roles",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart determines why and how customer and marketplace data is processed. The Vendor processes that data only on Nyko Mart's documented instructions, as a processor, and is responsible for its own personnel and systems.",
        ],
      },
      {
        title: "Scope of Data and Purpose",
        paragraphs: [
          "This Agreement covers {{data_scope}}, accessed through Nyko Mart's systems or through any marketplace seller account operated for Nyko Mart. The Vendor shall process that data only for {{processing_purpose}}.",
        ],
      },
      {
        title: "Lawful and Limited Processing",
        paragraphs: [
          "The Vendor shall process personal data only as instructed, shall not sell, rent, publish or use it for its own marketing, profiling or model training, and shall not combine it with data from other clients. Access shall be limited to the minimum personnel necessary, each bound by confidentiality obligations.",
        ],
      },
      {
        title: "Security Measures",
        paragraphs: [
          "The Vendor shall implement appropriate technical and organisational measures, including unique user accounts (no shared logins), two-factor authentication on marketplace and email accounts, encryption of data in transit and at rest where feasible, timely patching, and secure storage of any exported file. Credentials shall never be shared over unsecured channels or stored in plain text.",
        ],
      },
      {
        title: "Data Minimisation and Retention",
        paragraphs: [
          "The Vendor shall not download or retain more data than the task requires, shall delete working copies once the task is complete, and shall retain data no longer than {{retention_period}}. Aggregated, de-identified statistics may be retained for reporting.",
        ],
      },
      {
        title: "Sub-processors and Transfers",
        paragraphs: [
          "Sub-processors: {{sub_processors}}. The Vendor remains responsible for its sub-processors' compliance. Cross-border transfers shall rely on an appropriate safeguard and shall be notified to Nyko Mart in advance.",
        ],
      },
      {
        title: "Data Subject Requests",
        paragraphs: [
          "The Vendor shall forward any buyer request for access, correction, deletion or objection to Nyko Mart within 3 working days and shall assist Nyko Mart in responding, including by locating and exporting or deleting the relevant records.",
        ],
      },
      {
        title: "Breach Notification",
        paragraphs: [
          "The Vendor shall notify Nyko Mart within {{breach_hours}} hours of becoming aware of any unauthorised access, loss, disclosure or alteration of data, with the facts known at the time, the data affected and the containment steps taken. The Vendor shall cooperate fully with Nyko Mart's investigation, notification and remediation, and shall not notify affected individuals or regulators without Nyko Mart's approval unless legally required.",
        ],
      },
      {
        title: "Audit and Assistance",
        paragraphs: [
          "Nyko Mart may, on reasonable notice and no more than once a year (or after any breach), review the Vendor's compliance with this Agreement, including by questionnaire or remote review. The Vendor shall provide the information reasonably needed to demonstrate compliance.",
        ],
      },
      {
        title: "Return and Deletion on Termination",
        paragraphs: [
          "On termination the Vendor shall return all data to Nyko Mart and delete every remaining copy, including backups within a reasonable period, and confirm deletion in writing. Where deletion is impossible, the obligations of this Agreement continue to apply to the retained data.",
        ],
      },
      {
        title: "Liability",
        paragraphs: [
          "The Vendor shall indemnify Nyko Mart against fines, claims, losses and remediation costs arising from the Vendor's breach of this Agreement, including any breach caused by its personnel or sub-processors.",
        ],
      },
      {
        title: "Term and Survival",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}} and survives termination for as long as the Vendor holds any data covered by it.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    slug: "software-developer",
    version: 1,
    title: "Software Developer & IT Vendor Agreement",
    shortTitle: "Software / IT Vendor",
    icon: "💻",
    summary: "Scope, milestones, IP ownership, security and support terms for development and IT engagements.",
    subject: "Software Development and IT Vendor Agreement",
    fields: [
      { key: "project_scope", label: "Scope of Work / Deliverables", type: "textarea", default: "design, development, deployment and maintenance of the software described in the attached statement of work" },
      { key: "milestone_terms", label: "Milestones & Acceptance", type: "textarea", default: "work is delivered in agreed milestones; each milestone is accepted within 7 days of demonstration unless defects are reported in writing" },
      { key: "payment_terms", label: "Fees & Payment Terms", type: "text", default: "as per the milestone schedule; invoices payable within 15 days of milestone acceptance" },
      { key: "ip_ownership", label: "IP Ownership", type: "select", options: ["All work product assigned to Nyko Mart", "Nyko Mart owns custom work; Vendor retains pre-existing tools", "Licence to Nyko Mart, ownership with Vendor"], default: "Nyko Mart owns custom work; Vendor retains pre-existing tools" },
      { key: "support_window", label: "Support & Maintenance", type: "text", default: "bug fixes within 2 business days; critical outage response within 4 hours, for 90 days after go-live" },
      { key: "hosting", label: "Hosting / Infrastructure", type: "text", default: "Nyko Mart-owned accounts and repositories" },
    ],
    clauses: [
      {
        title: "Parties and Engagement",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart engages the Vendor to provide the following scope of work: {{project_scope}}. The Vendor shall perform the work with the skill, care and diligence expected of a professional software provider.",
        ],
      },
      {
        title: "Deliverables and Milestones",
        paragraphs: [
          "Milestones and acceptance: {{milestone_terms}}. A milestone is accepted when it meets the written acceptance criteria for that milestone. Acceptance shall not be unreasonably withheld, and a milestone is deemed accepted if no written defects are raised within the review window.",
        ],
      },
      {
        title: "Fees and Payment",
        paragraphs: [
          "Fees and payment terms: {{payment_terms}}. Expenses require prior written approval. Invoices must reference the milestone or statement of work, and taxes shall be charged as applicable.",
        ],
      },
      {
        title: "Intellectual Property",
        paragraphs: [
          "IP ownership: {{ip_ownership}}. Where Nyko Mart owns the work product, the Vendor assigns it on payment of the relevant milestone fee and shall sign any confirmation reasonably required. The Vendor grants Nyko Mart a perpetual, irrevocable, royalty-free licence to use any pre-existing tools, libraries or components embedded in the deliverables, to the extent needed to use and maintain them.",
        ],
      },
      {
        title: "Third-Party and Open-source Components",
        paragraphs: [
          "The Vendor shall list all third-party and open-source components used, together with their licences, and shall not introduce any component whose licence imposes copyleft or disclosure obligations on Nyko Mart's proprietary code without written approval.",
        ],
      },
      {
        title: "Source Code and Access",
        paragraphs: [
          "Source code shall be committed to {{hosting}}, with Nyko Mart holding owner-level access. The Vendor shall maintain readable documentation, environment setup notes and deployment instructions, and shall not hold any production credential, repository or account in its sole control.",
        ],
      },
      {
        title: "Security and Data",
        paragraphs: [
          "The Vendor shall follow secure development practice, avoid embedding secrets in code, remediate critical vulnerabilities promptly, and process any production or customer data strictly under the Customer & Marketplace Data Protection Agreement. Test data shall be used wherever possible.",
        ],
      },
      {
        title: "Support and Maintenance",
        paragraphs: [
          "Support and maintenance: {{support_window}}. Support excludes new features and issues caused by third-party changes or misuse, which are handled as change requests.",
        ],
      },
      {
        title: "Change Requests",
        paragraphs: [
          "Changes outside the agreed scope shall be documented in a written change request stating effort, cost and impact on timelines, and require Nyko Mart's approval before work begins.",
        ],
      },
      {
        title: "Warranties and Indemnity",
        paragraphs: [
          "The Vendor warrants that the deliverables will materially conform to the statement of work for 90 days after acceptance, that it has the right to provide them, and that they do not infringe third-party rights. The Vendor shall indemnify Nyko Mart against claims arising from a breach of these warranties.",
        ],
      },
      {
        title: "Confidentiality and Non-Solicitation",
        paragraphs: [
          "The Vendor shall treat Nyko Mart's code, architecture, credentials and business data as Confidential Information, and shall not solicit Nyko Mart's employees or contractors during the engagement and for twelve (12) months afterwards.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}}. Either Party may terminate for material breach not cured within 15 days of notice, or for convenience on 30 days' notice. On termination the Vendor shall hand over all work in progress, source code, documentation and credentials, and refund any fee paid for work not delivered.",
        ],
      },
      ...STANDARD_TAIL,
    ],
    annexureTitle: "Annexure A — Deliverables Checklist",
    annexure: [
      "Source code repository with commit history and a tagged release for each accepted milestone",
      "Deployment and environment setup documentation, including required environment variables (names only, no secrets)",
      "Database schema and any migration scripts",
      "Test coverage summary and known-issues list",
      "Handover session recording or notes for the Nyko Mart team",
    ],
  },
  {
    slug: "photographer-creative",
    version: 1,
    title: "Photographer & Creative Agency Agreement",
    shortTitle: "Photographer / Creative",
    icon: "📸",
    summary: "Shoot scope, deliverables, usage rights and payment terms for photographers and creative agencies.",
    subject: "Photographer and Creative Agency Agreement",
    fields: [
      { key: "shoot_scope", label: "Shoot / Creative Scope", type: "textarea", default: "product photography of rugs and home-textile ranges, including flat-lay, styled room sets and detail shots" },
      { key: "deliverables", label: "Deliverables", type: "text", default: "25 edited high-resolution images per shoot day, delivered in web and print resolution" },
      { key: "delivery_days", label: "Delivery Timeline", type: "text", default: "7 working days after the shoot" },
      { key: "usage_rights", label: "Usage Rights Granted", type: "select", options: ["Unlimited, worldwide, perpetual", "Marketplace and website use only", "Digital use for 2 years", "As stated in the brief"], default: "Unlimited, worldwide, perpetual" },
      { key: "fees", label: "Fees & Payment Terms", type: "text", default: "50% on booking, balance on delivery of edited images" },
      { key: "credit", label: "Credit Line", type: "text", default: "No credit required" },
    ],
    clauses: [
      {
        title: "Parties and Engagement",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart engages the Vendor to provide the following creative services: {{shoot_scope}}. The Vendor shall perform the services personally or through its own team, in a professional manner and to the agreed brief.",
        ],
      },
      {
        title: "Deliverables and Timeline",
        paragraphs: [
          "Deliverables: {{deliverables}}, to be delivered within {{delivery_days}}. Files shall be supplied in the agreed formats and naming convention, colour-corrected for e-commerce use, and free from watermarks. Additional retouching or reshoots outside the brief are chargeable as agreed in writing.",
        ],
      },
      {
        title: "Fees and Expenses",
        paragraphs: [
          "Fees and payment terms: {{fees}}. Travel, studio, prop and model costs are included unless expressly listed as reimbursable and approved in advance. Invoices must carry the Vendor's GSTIN and PAN where applicable.",
        ],
      },
      {
        title: "Usage Rights",
        paragraphs: [
          "On full payment the Vendor grants Nyko Mart {{usage_rights}} rights to use the delivered images, including on marketplaces, its own website, advertising and social media. The Vendor retains copyright in the images but shall not license, sell or display them for any other client or in its portfolio without Nyko Mart's written consent, which shall not be unreasonably withheld for images that show no unreleased design.",
        ],
      },
      {
        title: "Releases and Clearances",
        paragraphs: [
          "The Vendor is responsible for obtaining model, property and location releases for anything it stages, and for ensuring that no third-party artwork, brand or trademark appears in a delivered image. Copies of releases shall be provided on request.",
        ],
      },
      {
        title: "Image Integrity",
        paragraphs: [
          "Images shall not be altered to misrepresent the product — including colour, texture, pile height, size or composition. Nyko Mart may request corrections where an image does not fairly represent the product, and the Vendor shall correct it at no extra cost.",
        ],
      },
      {
        title: "Credit and Portfolio",
        paragraphs: [
          "Credit line: {{credit}}. Where credit is required, Nyko Mart shall use reasonable efforts to display it alongside the image. The Vendor may show accepted, published images in its portfolio after the product has launched, subject to the confidentiality clause for unreleased designs.",
        ],
      },
      {
        title: "Raw Files and Archive",
        paragraphs: [
          "Raw and unedited files remain the Vendor's working material; the Vendor shall retain them for 12 months and provide copies on request at a reasonable handling charge. Nyko Mart shall retain the delivered edited files as its own records.",
        ],
      },
      {
        title: "Confidentiality",
        paragraphs: [
          "Unreleased designs, upcoming collections and campaign plans are Confidential Information. No image of an unreleased design may be published, posted or shared before Nyko Mart announces the product.",
        ],
      },
      {
        title: "Cancellation and Rescheduling",
        paragraphs: [
          "Either Party may reschedule a shoot with at least 48 hours' notice at no charge; later cancellation forfeits the booking advance, except where the shoot cannot proceed for reasons beyond the Vendor's control (weather, venue, illness), in which case the shoot is rescheduled without penalty.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}} or until the deliverables are accepted, whichever is later. Either Party may terminate for material breach not cured within 10 days of notice. Usage rights already granted on payment survive termination.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    slug: "logistics-fulfilment",
    version: 1,
    title: "Logistics & Fulfilment Agreement",
    shortTitle: "Logistics / Fulfilment",
    icon: "🚚",
    summary: "Courier, warehouse and 3PL engagements — pickups, SLA, loss/damage liability, COD and proof of delivery.",
    subject: "Logistics and Fulfilment Services Agreement",
    fields: [
      { key: "logistics_scope", label: "Services Covered", type: "textarea", default: "pickup from Nyko Mart's warehouse, first-mile and last-mile delivery, warehousing and order fulfilment, returns pickup and proof-of-delivery capture" },
      { key: "pickup_sla", label: "Pickup / Handover SLA", type: "text", default: "same business day for orders confirmed before 4:00 PM IST" },
      { key: "delivery_sla", label: "Delivery SLA", type: "text", default: "as per the service matrix agreed for each destination zone" },
      { key: "rates", label: "Rates & Invoicing", type: "text", default: "per the attached rate card, invoiced monthly with shipment-wise weight, zone and AWB references" },
      { key: "liability_cap", label: "Loss / Damage Liability", type: "text", default: "the higher of the declared value of the consignment or INR 5,000 per shipment, unless a higher value is declared and the surcharge paid" },
      { key: "cod_terms", label: "COD / Remittance", type: "text", default: "collected COD amounts remitted within 3 working days with a shipment-wise reconciliation report" },
      { key: "penalty", label: "SLA Penalty", type: "text", default: "a service credit of 10% of the freight for that shipment for every 24 hours of delay beyond the agreed SLA, capped at the freight value" },
    ],
    clauses: [
      {
        title: "Parties and Appointment",
        paragraphs: [
          ...PARTIES,
          "Nyko Mart appoints the Vendor as its logistics and fulfilment service provider for the following services: {{logistics_scope}}, and the Vendor accepts the appointment on the terms of this Agreement.",
        ],
      },
      {
        title: "Pickup and Handover",
        paragraphs: [
          "Pickup SLA: {{pickup_sla}}. The Vendor shall collect sealed consignments against a signed manifest or a digital handover record, and shall not refuse a scheduled pickup without prior written intimation. Any shortage at pickup shall be recorded on the manifest at that time.",
        ],
      },
      {
        title: "Delivery, Tracking and Proof of Delivery",
        paragraphs: [
          "Delivery SLA: {{delivery_sla}}. Every shipment shall carry a live tracking reference, and proof of delivery (signature, OTP or geo-stamped photo, as applicable) shall be retained for at least 12 months and made available to Nyko Mart on request within 24 hours.",
          "The Vendor shall not mark a shipment delivered without proof of delivery, and shall not deliver to a person other than the consignee or their representative at the address on the shipment.",
        ],
      },
      {
        title: "Warehousing and Fulfilment",
        paragraphs: [
          "Where stock is held by the Vendor, it shall be stored in a dry, pest-free and secure area suitable for textiles, counted on inward and outward movement, reconciled monthly, and insured against fire, theft and water damage. Packaging shall be suitable for the product and the marketplace's requirements.",
        ],
      },
      {
        title: "Rates, Weight and Invoicing",
        paragraphs: [
          "Rates and invoicing: {{rates}}. Chargeable weight shall be evidenced by the carrier's own weight slip. Invoices must quote AWB numbers; disputes must be raised within 15 days of the invoice date.",
        ],
      },
      {
        title: "Service Levels and Penalties",
        paragraphs: [
          "The Vendor shall meet the agreed pickup, delivery and status-update service levels. SLA penalty: {{penalty}}. Repeated failure may be treated as a material breach.",
        ],
      },
      {
        title: "Loss, Damage and Claims",
        paragraphs: [
          "Liability for loss or damage: {{liability_cap}}. Claims must be raised with photographs, the AWB and the declared value within 15 days of the incident or delivery. The Vendor shall pay or credit an admitted claim within 30 days.",
        ],
      },
      {
        title: "Cash on Delivery and Remittance",
        paragraphs: [
          "COD terms: {{cod_terms}}. The Vendor shall keep COD collections separate from its own funds and provide a shipment-wise reconciliation with each remittance. Shortfall or delayed remittance may be recovered from subsequent invoices.",
        ],
      },
      {
        title: "Returns and Reverse Logistics",
        paragraphs: [
          "The Vendor shall support returns pickup and reverse movement at the agreed rates, inspect returned parcels for tampering where the buyer reports a discrepancy, and hand them over to Nyko Mart with the return manifest.",
        ],
      },
      {
        title: "Compliance, Safety and Insurance",
        paragraphs: [
          "The Vendor shall hold all licences and permits required for its operations, comply with transport, e-way bill and GST requirements, and maintain goods-in-transit and public-liability insurance customary for its business. Vehicles and personnel shall be fit and verified.",
        ],
      },
      {
        title: "Sub-contracting",
        paragraphs: [
          "The Vendor may sub-contract carriage only with Nyko Mart's prior written approval and remains fully responsible for the acts and omissions of its sub-contractors, including for loss, damage and data protection.",
        ],
      },
      {
        title: "Customer Data",
        paragraphs: [
          "Buyer names, addresses, phone numbers and order data accessed for fulfilment shall be used only for that purpose, shared only with the delivery personnel who need it, and protected under the Customer & Marketplace Data Protection Agreement where executed.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}}. Either Party may terminate on 30 days' written notice, or immediately for a material breach not cured within 7 days of notice or for loss of a required licence. On termination the Vendor shall complete in-transit shipments, remit all COD collections and return all stock and records.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
  {
    // Added on owner request, from their own reference document: an
    // acknowledgment (not a full negotiated contract) that the designer/IP
    // owner hands to a factory BEFORE sharing artwork, so sampling and
    // quotations cannot turn into unlicensed production. Deliberately
    // short — no term, no fees, no boilerplate tail — because the reference
    // works by being signable in one page.
    slug: "design-confidentiality-acknowledgment",
    version: 1,
    title: "Design Confidentiality & Intellectual Property Acknowledgment",
    shortTitle: "Design & IP Acknowledgment",
    icon: "✍️",
    summary: "One-page acknowledgment signed by a factory before design files are shared — ownership, restricted use, no portfolio use, continuing obligation.",
    subject: "Design Confidentiality and Intellectual Property Acknowledgment",
    fields: [
      { key: "designer_company", label: "Designer / IP Owner (Company)", type: "text", default: "The H Space" },
      { key: "designer_name", label: "Designer / IP Owner (Name)", type: "text", default: "Hanadi Bajsair" },
      { key: "designer_title", label: "Designer / IP Owner (Title)", type: "text", default: "Founder" },
      {
        key: "designs_scope",
        label: "Designs Covered",
        type: "textarea",
        default:
          "all designs, artwork, concepts, specifications and related materials shared by the Designer/IP Owner with the Manufacturer/Supplier, whether before, on or after the signature date, for development, sampling, quotation or potential manufacture (the \"Designs\"), including current and future Designs without a separate acknowledgment for each",
      },
    ],
    signatureHeadings: { company: "DESIGNER / IP OWNER", vendor: "MANUFACTURER / SUPPLIER" },
    companySignatoryDefaults: { name: "Hanadi Bajsair", designation: "Founder" },
    companyPartyNameField: "designer_company",
    partyHeading: "This acknowledgment is made between",
    declaration:
      "By signing below, the Manufacturer/Supplier confirms that it understands and agrees to the ownership, confidentiality and restricted-use terms above for all Designs covered by this acknowledgment. A typed name, an email acknowledgement or an instant message is not a signature; this acknowledgment is executed only by signatures recorded against this reference number.",
    clauses: [
      {
        title: "Scope of this Acknowledgment",
        paragraphs: [
          "This acknowledgment is made between {{designer_company}}, represented by {{designer_name}} (\"Designer/IP Owner\"), and {{vendor_legal_name}} (business name: {{vendor_business_name}}) of {{vendor_city}}, {{vendor_country}} (\"Manufacturer/Supplier\"), and is confirmed in the signature section below.",
          "It applies to {{designs_scope}}.",
        ],
      },
      {
        title: "Ownership of Artwork and Design",
        paragraphs: [
          "All original artwork, drawings, product configurations, individual cut-line geometry, shapes, patterns, colour specifications, visual concepts, product layouts, technical design files, specifications and branding supplied by the Designer/IP Owner remain the intellectual property of the Designer/IP Owner. Providing files to the Manufacturer/Supplier does not transfer ownership or grant any rights except the limited manufacturing use stated below.",
        ],
      },
      {
        title: "Permitted Use",
        paragraphs: [
          "The Manufacturer/Supplier may use the supplied materials only to assess feasibility, quote, develop approved samples/prototypes and manufacture quantities specifically authorised by the Designer/IP Owner.",
        ],
      },
      {
        title: "No Reproduction or Third-Party Use",
        paragraphs: [
          "The Manufacturer/Supplier shall not reproduce, manufacture, adapt for resale, sell, offer or supply the Designs or any substantially similar design for another customer or for its own commercial use without prior written permission.",
        ],
      },
      {
        title: "Confidentiality and Non-Disclosure",
        paragraphs: [
          "Artwork, editable files, specifications, prototypes and other non-public design materials must remain confidential. They may be shared only with personnel or subcontractors strictly required for authorised production and subject to equivalent confidentiality and restricted-use obligations.",
        ],
      },
      {
        title: "No Marketing, Display or Portfolio Use",
        paragraphs: [
          "The Designs, artwork, prototypes or production images may not be photographed, published, posted, exhibited or used in catalogues, websites, social media, online marketplaces, trade fairs, sample libraries or factory portfolios without prior written permission.",
        ],
      },
      {
        title: "Samples and Prototypes",
        paragraphs: [
          "Samples and prototypes are for evaluation and authorised production only and may not be sold, gifted, commercially displayed or reused as samples for other customers without written permission.",
        ],
      },
      {
        title: "No Implied Licence",
        paragraphs: [
          "Discussions, quotations, sampling, payment or manufacture do not create any licence, assignment or transfer of intellectual property rights beyond the limited permission needed to fulfil an authorised order.",
        ],
      },
      {
        title: "Continuing Obligation",
        paragraphs: [
          "These confidentiality, ownership and restricted-use obligations continue even if no bulk order is placed, the parties stop working together, or the Designs are not commercially launched.",
        ],
      },
      {
        title: "Written Approval",
        paragraphs: [
          "Any exception must be agreed in writing by the Designer/IP Owner. Receipt of files, silence or informal discussion does not constitute permission for additional use.",
        ],
      },
      {
        title: "Dispute Resolution & Protective Relief",
        paragraphs: [
          "In the event of any dispute arising from or relating to this acknowledgment, the parties shall first attempt to resolve the matter in good faith through written communication. If the dispute cannot be resolved amicably, either party may seek remedies before a court of competent jurisdiction under applicable law.",
          "Nothing in this clause prevents the Designer/IP Owner from seeking urgent injunctive or other protective relief to prevent or stop unauthorized reproduction, disclosure, sale, distribution or use of its artwork, designs or intellectual property.",
        ],
      },
    ],
  },
  {
    slug: "custom",
    version: 1,
    title: "Custom Agreement",
    shortTitle: "Custom Agreement",
    icon: "🧾",
    summary: "Any other engagement — write your own clauses, or start from a template and combine additional clause groups.",
    subject: "Vendor Agreement",
    fields: [
      { key: "custom_title", label: "Agreement Title (printed as the document heading)", type: "text", default: "Vendor Services Agreement" },
      { key: "custom_preamble", label: "Purpose / Recitals", type: "textarea", default: "the Parties wish to record the terms on which the Vendor will provide services to Nyko Mart" },
      { key: "custom_clauses", label: "Agreed Clauses (one clause per line, blank line between clauses)", type: "textarea" },
    ],
    clauses: [
      {
        title: "Parties and Purpose",
        paragraphs: [
          ...PARTIES,
          "The Parties agree as follows, for the purpose of {{custom_preamble}}.",
        ],
      },
      {
        title: "Agreed Terms",
        paragraphs: ["{{custom_clauses}}"],
      },
      {
        title: "Confidentiality",
        paragraphs: [
          "Each Party shall keep the other's confidential information confidential, use it only for this engagement, and return or destroy it on request. This obligation continues after the engagement ends.",
        ],
      },
      {
        title: "Term and Termination",
        paragraphs: [
          "This Agreement runs for {{agreement_term}} from {{effective_date}}, unless terminated earlier by either Party on 30 days' written notice or for a material breach not cured within 15 days of notice.",
        ],
      },
      ...STANDARD_TAIL,
    ],
  },
];

/**
 * OPTIONAL CLAUSE GROUPS an admin can fold into ANY agreement on the create
 * screen ("support combining multiple applicable clauses into one
 * agreement"). Each group is a self-contained set of clauses with a stable
 * slug; buildAgreementSections() inserts the selected groups after the
 * template's own clauses and before the standard tail, dropping any clause
 * whose title already exists so a combined document never repeats itself.
 */
export type AgreementClauseGroup = {
  slug: string;
  title: string;
  summary: string;
  clauses: AgreementClause[];
};

export const CLAUSE_LIBRARY: AgreementClauseGroup[] = [
  {
    slug: "ip-protection",
    title: "Intellectual Property & Design Protection",
    summary: "Design ownership, anti-copy undertakings and originality warranty.",
    clauses: [
      {
        title: "Design Ownership and Anti-Copy",
        paragraphs: [
          "All designs, motifs, colourways, artwork and specifications supplied by Nyko Mart remain Nyko Mart's exclusive property. The Vendor shall not reproduce, adapt or recolour them for any other buyer, and shall not display them in catalogues, exhibitions, social media or online marketplaces without written consent.",
        ],
      },
      {
        title: "Originality Warranty",
        paragraphs: [
          "The Vendor warrants that anything it supplies is original and does not infringe any third party's intellectual property, and shall indemnify Nyko Mart against any claim arising from a breach of this warranty.",
        ],
      },
    ],
  },
  {
    slug: "data-protection",
    title: "Customer & Marketplace Data Protection",
    summary: "Buyer-data handling, credentials hygiene and breach notification.",
    clauses: [
      {
        title: "Customer Data Handling",
        paragraphs: [
          "Buyer names, addresses, phone numbers, emails, order and return records accessed in the course of this engagement shall be used only to perform it, shall not be sold or used for the Vendor's own marketing, and shall be deleted or returned when the engagement ends.",
        ],
      },
      {
        title: "Credentials and Breach Notification",
        paragraphs: [
          "Marketplace, email and system credentials shall be unique to the individual user, never shared or stored in plain text, and two-factor authentication shall be enabled where available. Any suspected unauthorised access or data loss shall be reported to Nyko Mart within 24 hours, with containment steps taken immediately.",
        ],
      },
    ],
  },
  {
    slug: "service-levels",
    title: "Service Levels & Penalties",
    summary: "Measurable service levels with service credits for repeated failure.",
    clauses: [
      {
        title: "Service Levels",
        paragraphs: [
          "The Vendor shall meet the service levels agreed for this engagement, measured monthly. Where a service level is missed, the Vendor shall provide a written root-cause and recovery plan within 5 working days.",
        ],
      },
      {
        title: "Service Credits",
        paragraphs: [
          "For each missed service level, Nyko Mart may claim a service credit of 5% of that month's fee, capped at 20% in aggregate, without prejudice to termination for repeated failure.",
        ],
      },
    ],
  },
  {
    slug: "restrictive-covenants",
    title: "Non-Solicitation & Conflict of Interest",
    summary: 
      "Protects staff and prevents undisclosed competing interests.",
    clauses: [
      {
        title: "Non-Solicitation",
        paragraphs: [
          "During the engagement and for twelve (12) months afterwards, the Vendor shall not solicit for employment any employee or key individual of Nyko Mart involved in the engagement, except through a general public advertisement.",
        ],
      },
      {
        title: "Conflict of Interest",
        paragraphs: [
          "The Vendor shall disclose in writing any interest that conflicts, or could reasonably be seen to conflict, with Nyko Mart's interests, including any relationship with a competitor, marketplace account or supplier of the same products.",
        ],
      },
    ],
  },
  {
    slug: "payment-security",
    title: "Payment Security & Chargebacks",
    summary: "Advance/security deposit, set-off and chargeback responsibility.",
    clauses: [
      {
        title: "Security Deposit and Set-Off",
        paragraphs: [
          "Nyko Mart may retain a security deposit or reserve as stated in the commercial terms, and may set off any amount owed by the Vendor (including claims, penalties and chargebacks) against any sum payable to the Vendor.",
        ],
      },
      {
        title: "Chargebacks and Recovery",
        paragraphs: [
          "The Vendor shall bear chargebacks, refunds and marketplace penalties arising from its own acts, omissions, late dispatch, wrong or defective goods, or misdescription of a listing, and shall reimburse Nyko Mart within 15 days of a reconciliation statement.",
        ],
      },
    ],
  },
];

export function findAgreementTemplate(slug: string): AgreementTemplate | undefined {
  return AGREEMENT_TEMPLATES.find((t) => t.slug === slug);
}

export function findClauseGroup(slug: string): AgreementClauseGroup | undefined {
  return CLAUSE_LIBRARY.find((group) => group.slug === slug);
}

/** Two-letter document code used in the auto reference number. */
export const AGREEMENT_REF_CODES: Record<string, string> = {
  "master-nda": "NDA",
  "manufacturer-supplier": "SUP",
  "design-ip": "IPR",
  "international-ecommerce": "ECOM",
  "data-protection": "DPA",
  "software-developer": "SFT",
  "photographer-creative": "PHO",
  "logistics-fulfilment": "LOG",
  "design-confidentiality-acknowledgment": "DSG",
  custom: "CUS",
};

export type AgreementValues = Record<string, string>;

/**
 * Substitutes {{tokens}}. An unknown/empty token is printed as a visible
 * blank rule rather than left as raw "{{...}}" text, so a half-filled
 * agreement never leaks template syntax into a document that goes to a
 * vendor.
 */
export function renderAgreementTokens(text: string, values: AgreementValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    return value && value.trim() ? value.trim() : "________";
  });
}

/** "2026-11-03" -> "03 November 2026"; anything unparseable is returned as typed. */
export function formatAgreementDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export type AgreementCompanyInfo = {
  name: string;
  address?: string | null;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type AgreementBuildInput = {
  company: AgreementCompanyInfo;
  /** Vendor + meta + template-specific field values, exactly as typed in the form. */
  values: AgreementValues;
  refNo: string;
};

/**
 * The single place tokens are computed. Both the on-screen A4 preview and the
 * server-side PDF call this, so the printed and the downloaded document can
 * never drift apart.
 */
export function buildAgreementTokens({ company, values, refNo }: AgreementBuildInput): AgreementValues {
  const get = (key: string, fallback = "") => {
    const value = values[key];
    return value && value.trim() ? value.trim() : fallback;
  };

  const tokens: AgreementValues = { ...values };

  tokens.ref_no = refNo;
  tokens.company_name = company.name;
  tokens.company_address = get("company_address", company.address ?? "");
  tokens.company_gstin = company.gstin ?? "";
  tokens.company_email = company.email ?? "";
  tokens.company_phone = company.phone ?? "";

  // Optional vendor identifiers read badly as a blank rule; spell out that
  // they do not apply instead.
  tokens.vendor_gstin = get("vendor_gstin", "Not applicable");
  tokens.vendor_reg_no = get("vendor_reg_no", "Not applicable");
  tokens.vendor_business_name = get("vendor_business_name", get("vendor_legal_name"));
  tokens.vendor_address = get("vendor_address");
  tokens.vendor_signatory_name = get("vendor_signatory_name", get("vendor_contact_person"));
  tokens.vendor_signatory_designation = get("vendor_signatory_designation", get("vendor_designation", "Authorised Signatory"));

  // Dates are printed readably; the form holds ISO strings from <input type="date">.
  tokens.effective_date = formatAgreementDate(get("effective_date")) || formatAgreementDate(new Date().toISOString().slice(0, 10));

  return tokens;
}

export type BuiltAgreementSection = { title: string; paragraphs: string[] };

/**
 * The document body: numbered clauses with tokens resolved, then the optional
 * "Special Terms" section the admin typed, then the template's annexure.
 */
export function buildAgreementSections(
  template: AgreementTemplate,
  tokens: AgreementValues,
  /** Slugs from CLAUSE_LIBRARY the admin ticked on the create screen. */
  clauseGroupSlugs: string[] = []
): { clauses: BuiltAgreementSection[]; specialTerms: string[]; annexureTitle?: string; annexure: string[] } {
  // 2026-11-03 — combined agreements: the selected clause groups are spliced
  // in BEFORE the standard tail ("Relationship of the Parties" onwards), so a
  // combined document always reads template terms → added terms → boilerplate
  // → execution. A clause whose title the template already has is dropped, so
  // ticking "IP Protection" on the Design & IP template can't print it twice.
  const baseClauses = template.clauses;
  const knownTitles = new Set(baseClauses.map((clause) => clause.title.toLowerCase()));
  const extraClauses: AgreementClause[] = [];
  for (const slug of clauseGroupSlugs) {
    for (const clause of findClauseGroup(slug)?.clauses ?? []) {
      const key = clause.title.toLowerCase();
      if (knownTitles.has(key)) continue;
      knownTitles.add(key);
      extraClauses.push(clause);
    }
  }
  const tailIndex = baseClauses.findIndex((clause) => clause.title === "Relationship of the Parties");
  const mergedClauses =
    extraClauses.length === 0
      ? baseClauses
      : tailIndex < 0
        ? [...baseClauses, ...extraClauses]
        : [...baseClauses.slice(0, tailIndex), ...extraClauses, ...baseClauses.slice(tailIndex)];

  const clauses = mergedClauses.map((clause) => ({
    title: renderAgreementTokens(clause.title, tokens),
    paragraphs: clause.paragraphs.flatMap((paragraph) => {
      // The Custom template holds the admin's own clause text in one token; a
      // paragraph that is nothing but {{custom_clauses}} expands into one
      // paragraph per entered line-group so long custom text paginates
      // properly instead of arriving as a single unbroken block.
      if (paragraph.trim() === "{{custom_clauses}}") {
        const typed = (tokens.custom_clauses ?? "")
          .split(/\n{2,}/)
          .map((part) => renderAgreementTokens(part.trim(), tokens))
          .filter((part) => part.trim().length > 0);
        return typed.length > 0 ? typed : ["________"];
      }
      return [renderAgreementTokens(paragraph, tokens)];
    }),
  }));

  const specialTerms = (tokens.additional_clauses ?? "")
    .split(/\n{2,}/)
    .map((p) => renderAgreementTokens(p, tokens).trim())
    .filter(Boolean);

  const annexure = (template.annexure ?? []).map((line) => renderAgreementTokens(line, tokens));

  return { clauses, specialTerms, annexureTitle: template.annexureTitle, annexure };
}

/**
 * Document reference, e.g. "NM/AGR/NDA/2026/ACME". Deterministic and
 * DB-free (this module deliberately stores nothing) — the admin can still
 * overwrite it in the form, since Nyko Mart's own numbering may already
 * exist in a register outside the OMS.
 */
export function autoAgreementRefNo(template: AgreementTemplate, vendorName: string, isoDate: string): string {
  const code = AGREEMENT_REF_CODES[template.slug] ?? "AGR";
  const year = (isoDate || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const vendorKey = (vendorName || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.slice(0, 4).toUpperCase())
    .join("");
  return ["NM", "AGR", code, year, vendorKey || "VENDOR"].join("/");
}

/** Safe download filename, e.g. "agreement-master-nda-acme-rugs.pdf". */
export function agreementFileBase(template: { slug: string }, vendorName: string): string {
  const vendor = (vendorName || "vendor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `agreement-${template.slug}-${vendor || "vendor"}`;
}
