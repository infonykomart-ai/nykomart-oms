// Validation rules for extracted customs rates — pure, unit tested.
//
// Design rules this enforces (from the module brief):
//   * only supported currency codes;
//   * rates positive, kept at the published precision (never rounded);
//   * import and export extracted independently — a single figure is never
//     copied into the other column;
//   * currency unit explicit or derived from the currency's published
//     convention, never silently assumed;
//   * effective dates valid, and the end date not before the start;
//   * missing currencies / notification details reduce confidence;
//   * an unexpected jump against the last verified rate forces human review;
//   * a row is never "verified" merely because it parsed — parsed documents
//     and admin uploads always land as pending.
import { resolveCurrency } from "./currencies";
import { isValidIsoDate } from "./lookup";
import type {
  ExtractionContext,
  ExtractedRate,
  NormalizedRate,
  ValidationOutcome,
} from "./types";

/** Below this, a row always needs an administrator. */
export const AUTO_VERIFY_MIN_CONFIDENCE = 90;
/** A rate moving more than this against the last verified one is suspicious. */
export const UNEXPECTED_CHANGE_PCT = 20;
const MAX_DECIMALS = 8;
const VALID_UNITS = [1, 10, 100, 1000];

function cleanNumeric(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === "number" ? String(raw) : raw;
  const cleaned = text.replace(/[,\s₹]/g, "").trim();
  if (!cleaned) return null;
  return cleaned;
}

/** Keeps the published figure exactly — no Number() round-trip. */
function normalizeRate(
  raw: string | number | null | undefined,
  label: string,
  errors: string[]
): string | null {
  const cleaned = cleanNumeric(raw);
  if (cleaned === null) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    errors.push(`${label} "${String(raw)}" is not a plain positive decimal.`);
    return null;
  }
  const decimals = cleaned.includes(".") ? cleaned.split(".")[1].length : 0;
  if (decimals > MAX_DECIMALS) {
    errors.push(`${label} has ${decimals} decimal places; the register stores at most ${MAX_DECIMALS}.`);
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be a positive number.`);
    return null;
  }
  return cleaned;
}

function percentChange(previous: number, next: number): number {
  if (previous === 0) return next === 0 ? 0 : 100;
  return ((next - previous) / previous) * 100;
}

/**
 * Validates one extracted row. `ok: false` means the row must not be stored
 * as a rate at all (the caller logs the reason); `ok: true` always returns a
 * normalized row, either suggested-pending or suggested-verified.
 */
export function validateExtractedRate(raw: ExtractedRate, ctx: ExtractionContext): ValidationOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];

  const resolved = resolveCurrency(raw.currencyCode || raw.currencyName || "");
  if (!resolved) {
    errors.push(
      `Currency "${raw.currencyCode || raw.currencyName || ""}" is not a supported customs currency.`
    );
  }

  const currencyCode = resolved?.currency.code ?? String(raw.currencyCode ?? "").toUpperCase();

  // ---- rates ---------------------------------------------------------------
  const importRate = normalizeRate(raw.importRate, "Import rate", errors);
  const exportRate = normalizeRate(raw.exportRate, "Export rate", errors);
  if (exportRate === null) errors.push("Export rate is required.");
  if (importRate === null) warnings.push("Import rate is missing — it will be shown as not published.");

  // ---- unit ----------------------------------------------------------------
  let unit: number | null = null;
  let unitInferred = false;
  if (raw.currencyUnit != null && String(raw.currencyUnit).trim() !== "") {
    const explicit = Number(raw.currencyUnit);
    if (!VALID_UNITS.includes(explicit)) {
      errors.push(`Currency unit ${raw.currencyUnit} is not one of 1, 10, 100 or 1000.`);
    } else {
      unit = explicit;
    }
  } else if (
    (resolved?.unitFromName ?? resolveCurrency(raw.currencyName ?? "")?.unitFromName) &&
    VALID_UNITS.includes((resolved?.unitFromName ?? resolveCurrency(raw.currencyName ?? "")?.unitFromName) as number)
  ) {
    // The row's currency may be given as a code while the published NAME
    // still carries the quote unit ("Japanese Yen (100)").
    unit = (resolved?.unitFromName ?? resolveCurrency(raw.currencyName ?? "")?.unitFromName) as number;
  } else if (resolved) {
    unit = resolved.currency.unit;
    unitInferred = true;
  }

  // ---- dates ---------------------------------------------------------------
  const startDate = raw.effectiveStartDate || ctx.effectiveStartDate || "";
  if (!startDate) {
    errors.push("Effective start date is required.");
  } else if (!isValidIsoDate(startDate)) {
    errors.push(`Effective start date "${startDate}" is not a valid YYYY-MM-DD date.`);
  }

  const endDate = raw.effectiveEndDate ?? null;
  if (endDate) {
    if (!isValidIsoDate(endDate)) {
      errors.push(`Effective end date "${endDate}" is not a valid YYYY-MM-DD date.`);
    } else if (isValidIsoDate(startDate) && endDate < startDate) {
      errors.push("Effective end date is before the effective start date.");
    }
  }

  const notificationNo = (raw.notificationNo ?? ctx.notificationNo ?? "").trim() || null;
  const notificationDate = (raw.notificationDate ?? ctx.notificationDate ?? "") || null;
  if (notificationDate && !isValidIsoDate(notificationDate)) {
    errors.push(`Notification date "${notificationDate}" is not a valid YYYY-MM-DD date.`);
  }

  // ---- confidence ----------------------------------------------------------
  let confidence = 100;
  if (importRate === null) confidence -= 35;
  if (!notificationNo) {
    confidence -= 20;
    warnings.push("Notification number is missing.");
  }
  if (!notificationDate) {
    confidence -= 10;
    warnings.push("Notification publication date is missing.");
  }
  if (ctx.fromDocument) {
    confidence -= 10;
    warnings.push("Values were read from a document by the PDF parser — verify against the notification.");
  }
  if (unitInferred && resolved && resolved.currency.unit !== 1) {
    confidence -= 15;
    warnings.push(`Currency unit for ${resolved.currency.code} was inferred (${resolved.currency.unit}); confirm it.`);
  }

  // ---- unexpected change against the last verified rate --------------------
  let forcedPending = false;
  const previous = ctx.previousByCurrency?.[currencyCode];
  if (previous && exportRate !== null) {
    const exportDelta = percentChange(previous.exportRate, Number(exportRate));
    const importDelta =
      previous.importRate != null && importRate !== null
        ? percentChange(previous.importRate, Number(importRate))
        : 0;
    if (Math.abs(exportDelta) > UNEXPECTED_CHANGE_PCT || Math.abs(importDelta) > UNEXPECTED_CHANGE_PCT) {
      forcedPending = true;
      confidence -= 30;
      warnings.push(
        `Rate moved more than ${UNEXPECTED_CHANGE_PCT}% against the last verified rate ` +
          `(${previous.effectiveStartDate}) — needs review.`
      );
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));

  // A row is only ever auto-verified when it came from an official structured
  // source, every field is present and nothing looks off. Documents, CSVs and
  // mirrors always wait for an administrator.
  const officialStructured = ctx.source === "icegate" || ctx.source === "cbic";
  const suggestedStatus: "pending" | "verified" =
    officialStructured && !forcedPending && confidence >= AUTO_VERIFY_MIN_CONFIDENCE
      ? "verified"
      : "pending";

  if (!officialStructured) {
    warnings.push("Uploaded/admin data is stored as pending until an administrator approves it.");
  }

  if (errors.length > 0) return { ok: false, errors, warnings, row: null };

  const row: NormalizedRate = {
    currencyCode,
    currencyName: resolved?.currency.name ?? (raw.currencyName ?? currencyCode),
    currencyUnit: unit ?? 1,
    importRate,
    exportRate: exportRate as string,
    effectiveStartDate: startDate,
    effectiveEndDate: endDate,
    notificationNo,
    notificationDate,
    sourceUrl: raw.sourceUrl ?? ctx.sourceUrl ?? null,
    sourceDocumentRef: raw.sourceDocumentRef ?? ctx.documentRef ?? null,
    confidence,
    suggestedStatus,
    notes: warnings.length > 0 ? warnings.join(" ") : null,
  };

  return { ok: true, errors: [], warnings, row };
}

/**
 * Validates a batch and flags duplicates inside it (same currency + effective
 * date), which is how a double-imported document is caught before it reaches
 * the table.
 */
export function validateBatch(
  rows: ExtractedRate[],
  ctx: ExtractionContext
): { outcomes: ValidationOutcome[]; duplicateCount: number } {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const resolved = resolveCurrency(row.currencyCode || row.currencyName || "");
    const code = resolved?.currency.code ?? String(row.currencyCode ?? "").toUpperCase();
    const date = row.effectiveStartDate || ctx.effectiveStartDate || "";
    if (!code || !date) continue;
    const key = `${code}|${date}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  let duplicateCount = 0;
  const outcomes = rows.map((row) => {
    const outcome = validateExtractedRate(row, ctx);
    const resolved = resolveCurrency(row.currencyCode || row.currencyName || "");
    const code = resolved?.currency.code ?? String(row.currencyCode ?? "").toUpperCase();
    const date = row.effectiveStartDate || ctx.effectiveStartDate || "";
    const key = `${code}|${date}`;
    if ((seen.get(key) ?? 0) > 1) {
      duplicateCount += 1;
      return {
        ok: false,
        errors: [...outcome.errors, "Duplicate currency + effective date inside the same upload."],
        warnings: outcome.warnings,
        row: null,
      } satisfies ValidationOutcome;
    }
    return outcome;
  });

  return { outcomes, duplicateCount };
}
