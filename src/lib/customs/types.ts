// Shared vocabulary for the Indian Customs exchange-rate module.
//
// The register itself is customs_exchange_rates (see
// db/2026-11-14-customs-exchange-rate-module.sql). Everything below is the
// shape the ingestion, API, dashboard and calculator agree on.

export type CustomsRateKind = "import" | "export";

export type CustomsVerificationStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "source_unavailable"
  | "extraction_failed"
  | "superseded";

export type CustomsRateSource =
  | "icegate"
  | "cbic"
  | "admin_csv"
  | "admin_document"
  | "manual"
  | "mirror";

/** A currency this module is allowed to store and serve. */
export type SupportedCurrency = {
  /** ISO 4217 alpha-3 code, e.g. "USD". */
  code: string;
  name: string;
  /**
   * Units the customs notification quotes the rate for. CBIC quotes most
   * currencies per 1 unit, but a few (JPY, KRW) per 100. Stored per row.
   */
  unit: 1 | 10 | 100 | 1000;
};

/**
 * One row as extracted from an official document / CSV / feed, BEFORE
 * validation. Rates stay strings on purpose: the official figure must reach
 * the database exactly as published (numeric(18,8)), never pre-rounded by
 * JavaScript float arithmetic.
 */
export type ExtractedRate = {
  currencyCode: string;
  currencyName?: string | null;
  currencyUnit?: number | null;
  importRate?: string | number | null;
  exportRate?: string | number | null;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  notificationNo?: string | null;
  notificationDate?: string | null;
  sourceUrl?: string | null;
  sourceDocumentRef?: string | null;
};

/** A validated, storage-ready row. */
export type NormalizedRate = {
  currencyCode: string;
  currencyName: string;
  currencyUnit: number;
  importRate: string | null;
  exportRate: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  notificationNo: string | null;
  notificationDate: string | null;
  sourceUrl: string | null;
  sourceDocumentRef: string | null;
  confidence: number;
  /** 'pending' always needs a human; only a clean official feed may verify. */
  suggestedStatus: "pending" | "verified";
  notes: string | null;
};

export type ValidationOutcome = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  row: NormalizedRate | null;
};

/** A previously stored verified rate, used for change detection. */
export type PreviousRate = {
  currencyCode: string;
  importRate: number | null;
  exportRate: number;
  effectiveStartDate: string;
};

/** Context the validator needs about where the row came from. */
export type ExtractionContext = {
  source: CustomsRateSource;
  /** True when the text was parsed out of a PDF rather than a CSV/JSON feed. */
  fromDocument?: boolean;
  /** Checksum of the source file, recorded on every row it produced. */
  documentChecksum?: string | null;
  documentRef?: string | null;
  sourceUrl?: string | null;
  /** Fallbacks when the document states them once, in its header. */
  effectiveStartDate?: string | null;
  notificationNo?: string | null;
  notificationDate?: string | null;
  /** Existing verified rates, for the "unexpected change" check. */
  previousByCurrency?: Record<string, PreviousRate>;
};

export type SyncTrigger = "cron" | "manual" | "upload";

export type SyncStatus = "running" | "success" | "partial" | "failed" | "source_unavailable";

export type RejectedCandidate = {
  currencyCode: string | null;
  effectiveStartDate: string | null;
  reasons: string[];
};

export type IngestionSummary = {
  syncLogId: string | null;
  status: SyncStatus;
  provider: string;
  sourceUrl: string | null;
  extracted: number;
  verified: number;
  pending: number;
  duplicates: number;
  rejected: RejectedCandidate[];
  message: string;
  warnings: string[];
};
