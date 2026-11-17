// 2026-11-18 — Export builders for the Etsy SEO Generator (spec §20).
//
// UTF-8 everywhere. CSV gets a BOM so Excel opens Japanese/Russian/Polish
// correctly instead of mojibake — that is the whole point of the BOM here.

import * as XLSX from "xlsx";

export type ExportListing = {
  country: string;
  language: string;
  languageCode: string;
  locale: string;
  title: string;
  description: string;
  tags: string[];
  altTexts: Array<{ image: number; text: string }>;
  seoScore: number | null;
  validationStatus: string;
  validationReport?: { errors?: string[]; warnings?: string[] } | null;
  provider?: string | null;
  model?: string | null;
  backupUsed?: boolean;
};

export type ExportProject = {
  id: string;
  projectName: string;
  sku: string | null;
  category?: string | null;
  originalTitle: string;
  originalDescription: string;
  originalTags: string;
  product?: Record<string, unknown>;
  images?: Array<{ url?: string; order?: number; description?: string }>;
  createdAt?: string;
  updatedAt?: string;
};

export type ExportKeyword = {
  keyword: string;
  languageCode: string;
  country: string;
  keywordType: string;
  source: string;
  verified: boolean;
  searchVolume: number | null;
  competition: number | null;
  confidence: string;
  sourceUrl: string | null;
  researchedAt: string;
};

export type ExportCompetitor = {
  competitorUrl: string | null;
  competitorTitle: string | null;
  analysis: unknown;
  researchedAt: string;
};

const VERIFIED_LABEL = "Verified";
const UNVERIFIED_LABEL = "AI Suggested – Search Volume Not Verified";

export function buildProjectJson(input: {
  project: ExportProject;
  listings: ExportListing[];
  keywords: ExportKeyword[];
  competitors: ExportCompetitor[];
}): Record<string, unknown> {
  return {
    project_id: input.project.id,
    product: {
      product_name: input.project.projectName,
      sku: input.project.sku,
      category: input.project.category ?? null,
      original_title: input.project.originalTitle,
      original_description: input.project.originalDescription,
      original_tags: input.project.originalTags,
      specifications: input.project.product ?? {},
      images: input.project.images ?? [],
    },
    research: {
      research_status: input.keywords.length > 0 ? "completed" : "not_started",
      // A keyword is only "verified" when a real source returned a metric.
      verified_keywords: input.keywords.filter((k) => k.verified).length,
      ai_suggested_keywords: input.keywords.filter((k) => !k.verified).length,
      keywords: input.keywords,
      competitors: input.competitors,
    },
    localizations: input.listings.map((listing) => ({
      country: listing.country,
      language: listing.language,
      locale: listing.locale,
      title: { text: listing.title, character_count: [...listing.title].length, validation_status: listing.validationStatus },
      tags: listing.tags.map((tag) => ({ text: tag, character_count: [...tag].length })),
      description: { text: listing.description, validation_status: listing.validationStatus },
      image_alt_text: listing.altTexts.map((a) => ({ image: a.image, text: a.text })),
      seo_score: listing.seoScore,
      validation: {
        status: listing.validationStatus,
        errors: listing.validationReport?.errors ?? [],
        warnings: listing.validationReport?.warnings ?? [],
      },
      ai_metadata: { provider: listing.provider ?? null, model: listing.model ?? null, fallback_used: !!listing.backupUsed },
    })),
    ai_metadata: {
      primary_provider: "gemini",
      fallback_used: input.listings.some((l) => l.backupUsed),
      models: [...new Set(input.listings.map((l) => l.model).filter(Boolean))],
      generated_at: new Date().toISOString(),
    },
    schema_version: 1,
  };
}

/** RFC-4180 quoting. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const LISTING_HEADERS = [
  "Language",
  "Language Code",
  "Locale",
  "Country",
  "SEO Title",
  "Title Characters",
  "Tags (13, comma separated)",
  "Tag Count",
  "Longest Tag",
  "Description",
  "Alt Text",
  "SEO Score",
  "Validation Status",
  "Errors",
  "Warnings",
  "Provider",
  "Model",
  "Backup Used",
];

function listingRow(listing: ExportListing): unknown[] {
  return [
    listing.language,
    listing.languageCode,
    listing.locale,
    listing.country,
    listing.title,
    [...listing.title].length,
    listing.tags.join(", "),
    listing.tags.length,
    Math.max(0, ...listing.tags.map((t) => [...t].length)),
    listing.description,
    listing.altTexts.map((a) => `Image ${a.image}: ${a.text}`).join("\n"),
    listing.seoScore,
    listing.validationStatus,
    (listing.validationReport?.errors ?? []).join(" | "),
    (listing.validationReport?.warnings ?? []).join(" | "),
    listing.provider ?? "",
    listing.model ?? "",
    listing.backupUsed ? "yes" : "no",
  ];
}

/** All ten languages in one CSV, UTF-8 BOM for Excel. */
export function buildListingsCsv(listings: ExportListing[]): string {
  const rows = [LISTING_HEADERS, ...listings.map(listingRow)];
  const csv = toCsv(rows);
  return "\ufeff" + csv;
}

export function buildKeywordsCsv(keywords: ExportKeyword[]): string {
  const rows: unknown[][] = [
    ["Keyword", "Language", "Country", "Type", "Source", "Data Status", "Search Volume", "Competition", "Confidence", "Source URL", "Researched At"],
    ...keywords.map((k) => [
      k.keyword,
      k.languageCode,
      k.country,
      k.keywordType,
      k.source,
      k.verified ? VERIFIED_LABEL : UNVERIFIED_LABEL,
      k.searchVolume,
      k.competition,
      k.confidence,
      k.sourceUrl,
      k.researchedAt,
    ]),
  ];
  return "\ufeff" + toCsv(rows);
}

/**
 * One workbook: Summary, Keyword Research, Validation, then one sheet per
 * language. Sheet names are capped at Excel's 31 characters.
 */
export function buildWorkbook(input: {
  project: ExportProject;
  listings: ExportListing[];
  keywords: ExportKeyword[];
  competitors: ExportCompetitor[];
}): Buffer {
  const workbook = XLSX.utils.book_new();

  const summary = [
    ["Etsy International SEO Generator — export"],
    ["Project", input.project.projectName],
    ["SKU", input.project.sku ?? ""],
    ["Category", input.project.category ?? ""],
    ["English title", input.project.originalTitle],
    ["Languages", input.listings.length],
    ["Validated (pass)", input.listings.filter((l) => l.validationStatus === "pass").length],
    ["Warnings", input.listings.filter((l) => l.validationStatus === "warning").length],
    ["Failed", input.listings.filter((l) => l.validationStatus === "fail").length],
    ["Average SEO score", input.listings.length ? Math.round(input.listings.reduce((s, l) => s + (l.seoScore ?? 0), 0) / input.listings.length) : 0],
    ["Backup provider used", input.listings.some((l) => l.backupUsed) ? "yes" : "no"],
    ["Exported at", new Date().toISOString()],
    [],
    ["SEO score is a quality checklist, not Etsy's ranking score."],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const keywordRows = [
    ["Keyword", "Language", "Country", "Type", "Source", "Data Status", "Volume", "Competition", "Confidence"],
    ...input.keywords.map((k) => [
      k.keyword,
      k.languageCode,
      k.country,
      k.keywordType,
      k.source,
      k.verified ? VERIFIED_LABEL : UNVERIFIED_LABEL,
      k.searchVolume,
      k.competition,
      k.confidence,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(keywordRows), "Keyword Research");

  const validationRows = [
    ["Language", "Locale", "Status", "SEO Score", "Errors", "Warnings"],
    ...input.listings.map((l) => [
      l.language,
      l.locale,
      l.validationStatus,
      l.seoScore,
      (l.validationReport?.errors ?? []).join(" | "),
      (l.validationReport?.warnings ?? []).join(" | "),
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(validationRows), "Validation");

  for (const listing of input.listings) {
    const sheet = [
      ["Field", "Value"],
      ["Language", listing.language],
      ["Locale", listing.locale],
      ["Country", listing.country],
      ["SEO title", listing.title],
      ["Title characters", [...listing.title].length],
      ["Tags", listing.tags.join(", ")],
      ["Tag count", listing.tags.length],
      ["Longest tag", Math.max(0, ...listing.tags.map((t) => [...t].length))],
      ["Description", listing.description],
      ...listing.altTexts.map((a, i) => [`Alt text ${i + 1}`, a.text] as [string, string]),
      ["SEO score", listing.seoScore ?? ""],
      ["Validation", listing.validationStatus],
      ["Errors", (listing.validationReport?.errors ?? []).join(" | ")],
      ["Warnings", (listing.validationReport?.warnings ?? []).join(" | ")],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet), listing.language.slice(0, 31));
  }

  if (input.competitors.length > 0) {
    const rows = [
      ["Competitor URL", "Title", "Analysis", "Researched at"],
      ...input.competitors.map((c) => [c.competitorUrl ?? "", c.competitorTitle ?? "", JSON.stringify(c.analysis ?? {}), c.researchedAt]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Competitors");
  }

  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return output;
}

/** Copy-paste block for one language (spec §13 "copy complete listing"). */
export function completeListingText(listing: ExportListing): string {
  return [
    `TITLE (${[...listing.title].length}/140)`,
    listing.title,
    "",
    `TAGS (${listing.tags.length}/13)`,
    listing.tags.join(", "),
    "",
    "DESCRIPTION",
    listing.description,
    ...(listing.altTexts.length
      ? ["", "IMAGE ALT TEXT", ...listing.altTexts.map((a) => `Image ${a.image}: ${a.text}`)]
      : []),
  ].join("\n");
}
