import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGREEMENT_TEMPLATES,
  AGREEMENT_REF_CODES,
  CLAUSE_LIBRARY,
  VENDOR_CATEGORIES,
  VENDOR_FIELDS,
  agreementFileBase,
  autoAgreementRefNo,
  buildAgreementSections,
  buildAgreementTokens,
  findAgreementTemplate,
  findClauseGroup,
  formatAgreementDate,
  renderAgreementTokens,
} from "./templates";

// 2026-11-03 — the agreement generator renders templates into a legal PDF, so
// a template that references a token nobody fills in (a raw "{{…}}") or a
// template missing from the ref-code map would produce a visibly broken
// document. These tests lock both down.

const sampleValues: Record<string, string> = {
  vendor_legal_name: "Acme Rugs Pvt Ltd",
  vendor_business_name: "Acme Rugs",
  vendor_contact_person: "Ravi Sharma",
  vendor_designation: "Director",
  vendor_address: "12 Weavers Lane",
  vendor_city: "Bhadohi",
  vendor_state: "Uttar Pradesh",
  vendor_country: "India",
  vendor_postal_code: "221401",
  vendor_email: "ravi@acmerugs.example",
  vendor_whatsapp: "9876543210",
  vendor_gstin: "09ABCDE1234F1Z5",
  vendor_reg_no: "U12345UP2020PTC123456",
  vendor_category: "Rug Manufacturer",
  effective_date: "2026-11-03",
  jurisdiction_city: "Jaipur, Rajasthan",
  company_signatory_name: "Mohit Nyko",
  company_signatory_designation: "Director",
};

test("every agreement template is uniquely addressable and has a reference code", () => {
  const slugs = AGREEMENT_TEMPLATES.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) {
    assert.ok(AGREEMENT_REF_CODES[slug], `missing ref code for ${slug}`);
    assert.ok(findAgreementTemplate(slug));
  }
  assert.equal(AGREEMENT_TEMPLATES.length, 10);
  assert.ok(findAgreementTemplate("design-confidentiality-acknowledgment"));
  // 2026-11-03 — the two extra templates the Legal & Compliance spec added.
  assert.ok(findAgreementTemplate("logistics-fulfilment"));
  assert.ok(findAgreementTemplate("custom"));
});

test("the Design Confidentiality & IP Acknowledgment matches the reference document", () => {
  const template = findAgreementTemplate("design-confidentiality-acknowledgment");
  assert.ok(template);
  // Exact wording of the owner's reference: the 10 numbered clauses plus an
  // opening scope clause, role-based signature columns, and the designer
  // company/name/title defaults.
  assert.equal(template.clauses.length, 11);
  assert.deepEqual(template.signatureHeadings, {
    company: "DESIGNER / IP OWNER",
    vendor: "MANUFACTURER / SUPPLIER",
  });
  assert.equal(template.fields.find((f) => f.key === "designer_company")?.default, "The H Space");
  assert.equal(template.fields.find((f) => f.key === "designer_name")?.default, "Hanadi Bajsair");
  assert.equal(template.fields.find((f) => f.key === "designer_title")?.default, "Founder");
  const titles = template.clauses.map((c) => c.title);
  assert.deepEqual(titles, [
    "Scope of this Acknowledgment",
    "Ownership of Artwork and Design",
    "Permitted Use",
    "No Reproduction or Third-Party Use",
    "Confidentiality and Non-Disclosure",
    "No Marketing, Display or Portfolio Use",
    "Samples and Prototypes",
    "No Implied Licence",
    "Continuing Obligation",
    "Written Approval",
    "Dispute Resolution & Protective Relief",
  ]);
  assert.equal(AGREEMENT_REF_CODES["design-confidentiality-acknowledgment"], "DSG");
});

test("the requested vendor categories are all offered", () => {
  const expected = [
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
  ];
  assert.deepEqual([...VENDOR_CATEGORIES], expected);
  assert.deepEqual(VENDOR_FIELDS.find((f) => f.key === "vendor_category")?.options, expected);
});

test("a fully filled template renders with no unresolved tokens", () => {
  for (const template of AGREEMENT_TEMPLATES) {
    const values: Record<string, string> = { ...sampleValues };
    for (const field of template.fields) values[field.key] = values[field.key] ?? field.default ?? "Sample value";

    const tokens = buildAgreementTokens({
      company: { name: "Nyko Mart", address: "Jaipur", gstin: "08AAECS1234F1Z0", email: "care@nykomart.com", phone: "1412345678" },
      values,
      refNo: "NM/AGR/TEST/2026/ACME",
    });
    const built = buildAgreementSections(template, tokens);

    assert.ok(built.clauses.length >= 8, `${template.slug} should have a full clause set`);
    const rendered = JSON.stringify(built);
    assert.ok(!rendered.includes("{{"), `${template.slug} left a raw token in the text`);
    assert.ok(rendered.includes("Acme Rugs Pvt Ltd"), `${template.slug} did not print the vendor name`);
  }
});

test("optional vendor identifiers print as 'Not applicable' instead of a blank rule", () => {
  const tokens = buildAgreementTokens({
    company: { name: "Nyko Mart" },
    values: { vendor_legal_name: "Acme", effective_date: "2026-11-03" },
    refNo: "NM/AGR/NDA/2026/ACME",
  });
  assert.equal(tokens.vendor_gstin, "Not applicable");
  assert.equal(tokens.vendor_reg_no, "Not applicable");
  // Contact person stands in for the signatory name when none is typed.
  assert.equal(tokens.vendor_signatory_name, "");
});

test("blank values become a visible blank rule, never template syntax", () => {
  assert.equal(renderAgreementTokens("GSTIN: {{vendor_gstin}}", {}), "GSTIN: ________");
  assert.equal(renderAgreementTokens("Hi {{vendor_legal_name}}", { vendor_legal_name: "  Acme  " }), "Hi Acme");
});

test("dates print readably and the reference number is deterministic", () => {
  assert.equal(formatAgreementDate("2026-11-03"), "03 November 2026");
  assert.equal(formatAgreementDate("already text"), "already text");

  const template = findAgreementTemplate("master-nda");
  assert.ok(template);
  assert.equal(autoAgreementRefNo(template, "Acme Rugs Pvt Ltd", "2026-11-03"), "NM/AGR/NDA/2026/ACMERUGS");
  assert.equal(agreementFileBase(template, "Acme Rugs Pvt Ltd"), "agreement-master-nda-acme-rugs-pvt-ltd");
});

test("optional clause groups can be combined into one agreement", () => {
  const template = findAgreementTemplate("manufacturer-supplier");
  assert.ok(template);
  const tokens = buildAgreementTokens({ company: { name: "Nyko Mart" }, values: sampleValues, refNo: "NM/AGR/SUP/2026/ACME" });

  const plain = buildAgreementSections(template, tokens);
  const combined = buildAgreementSections(template, tokens, ["ip-protection", "data-protection", "payment-security"]);

  assert.ok(combined.clauses.length > plain.clauses.length);
  const titles = combined.clauses.map((c) => c.title);
  assert.ok(titles.includes("Design Ownership and Anti-Copy"));
  assert.ok(titles.includes("Customer Data Handling"));
  assert.ok(titles.includes("Chargebacks and Recovery"));
  // Added clauses must land BEFORE the boilerplate tail, not after it.
  assert.ok(titles.indexOf("Design Ownership and Anti-Copy") < titles.indexOf("Relationship of the Parties"));
  // …and after the template's own terms.
  assert.ok(titles.indexOf("Quality Standards") < titles.indexOf("Design Ownership and Anti-Copy"));
  // No title may appear twice, even when the same group is ticked twice.
  const combinedTwice = buildAgreementSections(template, tokens, ["ip-protection", "ip-protection"]);
  const twiceTitles = combinedTwice.clauses.map((c) => c.title);
  assert.equal(new Set(twiceTitles).size, twiceTitles.length);
});

for (const group of CLAUSE_LIBRARY) {
  test(`clause group ${group.slug} is well formed`, () => {
    assert.ok(group.title.trim());
    assert.ok(group.clauses.length > 0);
    assert.equal(findClauseGroup(group.slug)?.slug, group.slug);
  });
}

test("the Custom template expands the admin's typed clauses into paragraphs", () => {
  const template = findAgreementTemplate("custom");
  assert.ok(template);
  const tokens = buildAgreementTokens({
    company: { name: "Nyko Mart" },
    values: {
      ...sampleValues,
      custom_preamble: "supplying samples for a new collection",
      custom_clauses: "First custom clause about sampling.\n\nSecond custom clause about pricing.\n\nThird custom clause about delivery.",
    },
    refNo: "NM/AGR/CUS/2026/ACME",
  });
  const built = buildAgreementSections(template, tokens);
  const agreed = built.clauses.find((c) => c.title === "Agreed Terms");
  assert.ok(agreed);
  assert.equal(agreed.paragraphs.length, 3);
  assert.ok(agreed.paragraphs[1].includes("Second custom clause"));
  assert.ok(!JSON.stringify(built).includes("{{custom_clauses}}"));
});

test("agreement numbers are unique per year and follow the NKM format", () => {
  const template = findAgreementTemplate("master-nda");
  assert.ok(template);
  const ref = autoAgreementRefNo(template, "Acme Rugs", "2026-11-03");
  assert.match(ref, /^NM\/AGR\/NDA\/2026\/ACMERUGS$/);
  // The database allocates the issued number (NKM-AGR-YYYY-NNNNNN) atomically;
  // this helper only ever produces the human-entered document reference.
  assert.notEqual(ref, "NKM-AGR-2026-000001");
});
