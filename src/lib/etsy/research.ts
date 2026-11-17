// 2026-11-18 — Provider-independent keyword research adapters (spec §4).
//
// The important rule: a keyword is only `verified` when a real adapter returned
// a real metric. AI suggestions are stored with verified=false and the UI shows
// "AI Suggested – Search Volume Not Verified". No adapter invents numbers.
//
// To add a source later: implement ResearchAdapter and register it below. Every
// adapter declares whether it needs credentials, and the UI lists the ones that
// are not configured instead of pretending they ran.

import type { EtsyLanguage } from "./languages";

export type ResearchMode = "ai" | "ai+live";

export type ResearchSourceId = "ai" | "user_file" | "search_api" | "etsy_autocomplete" | "etsy_marketplace_insights" | "erank" | "everbee" | "google_trends";

export type KeywordType =
  | "primary"
  | "secondary"
  | "long_tail"
  | "buyer_intent"
  | "product"
  | "material"
  | "style"
  | "room"
  | "seasonal"
  | "competitor";

export type KeywordRecord = {
  keyword: string;
  languageCode: string;
  country: string;
  keywordType: KeywordType;
  source: ResearchSourceId;
  verified: boolean;
  searchVolume: number | null;
  competition: number | null;
  trend: Record<string, unknown> | null;
  confidence: "high" | "medium" | "low" | "unknown";
  sourceUrl: string | null;
  researchedAt: string;
};

/** Shown next to unverified keywords in the UI and in the export. */
export const UNVERIFIED_LABEL = "AI Suggested – Search Volume Not Verified";

export type ResearchAdapterInfo = {
  id: ResearchSourceId;
  label: string;
  /** What it can actually provide, in plain words. */
  provides: string;
  requiresCredentials: boolean;
  /** Env vars an operator must set for this adapter to run. */
  envVars: string[];
  note: string;
};

export const RESEARCH_SOURCES: ResearchAdapterInfo[] = [
  {
    id: "ai",
    label: "AI keyword suggestions",
    provides: "Native-language keyword phrases by type — no metrics",
    requiresCredentials: false,
    envVars: [],
    note: "Always available with the configured AI provider. Never counted as verified data.",
  },
  {
    id: "user_file",
    label: "Uploaded keyword file",
    provides: "Keywords, optionally with real search volume / competition values you already own",
    requiresCredentials: false,
    envVars: [],
    note: "CSV or TSV: keyword[,search_volume[,competition]]. Anything with a number is marked verified and attributed to the file.",
  },
  {
    id: "search_api",
    label: "Search API (SERP / keyword data)",
    provides: "Live search results, related queries and (if the provider returns them) volumes",
    requiresCredentials: true,
    envVars: ["SEARCH_API_KEY", "RESEARCH_PROVIDER_API_KEY"],
    note: "Not configured in this deployment unless the key is set. The integration is wired but no vendor-specific parsing is enabled, so it reports 'not configured' rather than guessing.",
  },
  {
    id: "etsy_autocomplete",
    label: "Etsy search autocomplete",
    provides: "Real buyer query completions",
    requiresCredentials: true,
    envVars: ["ETSY_AUTOCOMPLETE_ENDPOINT"],
    note: "Etsy does not publish an autocomplete API; using it requires written permission. Leave disabled unless you have that permission.",
  },
  {
    id: "etsy_marketplace_insights",
    label: "Etsy Marketplace Insights",
    provides: "Search/trend data for Etsy sellers",
    requiresCredentials: true,
    envVars: ["ETSY_API_KEY"],
    note: "Requires an approved Etsy API app. Not enabled here.",
  },
  { id: "erank", label: "eRank", provides: "Keyword volumes and competition", requiresCredentials: true, envVars: ["ERANK_API_KEY"], note: "Requires an eRank API/authorized export." },
  { id: "everbee", label: "EverBee", provides: "Etsy product/keyword estimates", requiresCredentials: true, envVars: ["EVERBEE_API_KEY"], note: "Requires EverBee API access." },
  { id: "google_trends", label: "Google Trends", provides: "Relative interest over time (not absolute volume)", requiresCredentials: false, envVars: ["TRENDS_ENDPOINT"], note: "No official API; needs a self-hosted proxy. Not enabled by default." },
];

export class ResearchNotConfiguredError extends Error {
  constructor(readonly source: ResearchSourceId, message: string) {
    super(message);
    this.name = "ResearchNotConfiguredError";
  }
}

export type ResearchInput = {
  language: EtsyLanguage;
  keywords: string[];
  /** Raw uploaded file text (user_file adapter). */
  fileText?: string;
};

export interface ResearchAdapter {
  readonly id: ResearchSourceId;
  isConfigured(): boolean;
  research(input: ResearchInput): Promise<KeywordRecord[]>;
}

/** The always-available adapter: turn AI keyword groups into records. */
export function recordsFromAiGroups(
  groups: Record<string, string[]>,
  language: EtsyLanguage,
  now = new Date().toISOString()
): KeywordRecord[] {
  const mapping: Array<[string, KeywordType]> = [
    ["primary", "primary"],
    ["secondary", "secondary"],
    ["longTail", "long_tail"],
    ["buyerIntent", "buyer_intent"],
    ["product", "product"],
    ["material", "material"],
    ["style", "style"],
    ["room", "room"],
    ["seasonal", "seasonal"],
    ["competitor", "competitor"],
  ];
  const out: KeywordRecord[] = [];
  for (const [key, type] of mapping) {
    for (const keyword of groups[key] ?? []) {
      const clean = keyword.trim();
      if (!clean) continue;
      out.push({
        keyword: clean,
        languageCode: language.code,
        country: language.country,
        keywordType: type,
        source: "ai",
        verified: false,
        searchVolume: null,
        competition: null,
        trend: null,
        confidence: "unknown",
        sourceUrl: null,
        researchedAt: now,
      });
    }
  }
  return out;
}

/**
 * Parse an uploaded keyword file. Supported rows:
 *   keyword
 *   keyword,1200
 *   keyword,1200,0.45
 * A row that carries a volume is verified (it came from real data the user
 * owns); a bare keyword is stored unverified so it is labeled honestly.
 */
export function parseKeywordFile(text: string, language: EtsyLanguage, now = new Date().toISOString()): KeywordRecord[] {
  const rows = (text ?? "").split(/\r?\n/);
  const out: KeywordRecord[] = [];
  for (const row of rows) {
    const cells = row.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const keyword = cells[0] ?? "";
    if (!keyword || /^keyword$/i.test(keyword)) continue; // header
    const volumeRaw = cells[1]?.replace(/[^\d.]/g, "") ?? "";
    const competitionRaw = cells[2]?.replace(/[^\d.]/g, "") ?? "";
    const searchVolume = volumeRaw && Number.isFinite(Number(volumeRaw)) ? Math.round(Number(volumeRaw)) : null;
    const competition = competitionRaw && Number.isFinite(Number(competitionRaw)) ? Number(competitionRaw) : null;
    out.push({
      keyword,
      languageCode: language.code,
      country: language.country,
      keywordType: "secondary",
      source: "user_file",
      verified: searchVolume !== null || competition !== null,
      searchVolume,
      competition,
      trend: null,
      confidence: searchVolume !== null ? "medium" : "unknown",
      sourceUrl: null,
      researchedAt: now,
    });
  }
  return out;
}

export class UserFileResearchAdapter implements ResearchAdapter {
  readonly id = "user_file" as const;
  isConfigured(): boolean {
    return true;
  }
  async research(input: ResearchInput): Promise<KeywordRecord[]> {
    if (!input.fileText?.trim()) throw new ResearchNotConfiguredError("user_file", "No keyword file was supplied.");
    return parseKeywordFile(input.fileText, input.language);
  }
}

/** A thin, honest shell for a real search/keyword API. */
export class SearchApiResearchAdapter implements ResearchAdapter {
  readonly id = "search_api" as const;
  isConfigured(): boolean {
    return !!(process.env.SEARCH_API_KEY || process.env.RESEARCH_PROVIDER_API_KEY);
  }
  async research(): Promise<KeywordRecord[]> {
    if (!this.isConfigured()) {
      throw new ResearchNotConfiguredError("search_api", "No search/keyword API key is configured (SEARCH_API_KEY / RESEARCH_PROVIDER_API_KEY).");
    }
    // Deliberately not implemented against a guessed vendor: each provider has
    // its own response shape and terms. Until one is chosen, return nothing
    // rather than fabricate metrics.
    throw new ResearchNotConfiguredError(
      "search_api",
      "A search API key is set but no vendor integration is enabled — add the vendor's response mapping in src/lib/etsy/research.ts."
    );
  }
}

export const RESEARCH_ADAPTERS: ResearchAdapter[] = [new UserFileResearchAdapter(), new SearchApiResearchAdapter()];

/** Dedupe keywords case-insensitively, preferring a verified record. */
export function mergeKeywordRecords(records: KeywordRecord[]): KeywordRecord[] {
  const map = new Map<string, KeywordRecord>();
  for (const record of records) {
    const key = `${record.languageCode}:${record.keyword.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
      continue;
    }
    if (!existing.verified && record.verified) map.set(key, { ...record, keywordType: existing.keywordType });
  }
  return [...map.values()];
}

/** Rows for the Keyword Research screen / export sheet. */
export function keywordDisplayRows(records: KeywordRecord[]): Array<Record<string, string | number | null>> {
  return records.map((r) => ({
    keyword: r.keyword,
    language: r.languageCode,
    country: r.country,
    type: r.keywordType,
    source: r.source,
    verified: r.verified ? "Verified" : UNVERIFIED_LABEL,
    search_volume: r.searchVolume,
    competition: r.competition,
    confidence: r.confidence,
    source_url: r.sourceUrl,
    researched_at: r.researchedAt,
  }));
}
