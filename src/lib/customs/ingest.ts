// Customs rate ingestion service.
//
// One place that turns an official source (or an administrator's upload of the
// official document) into rows in customs_exchange_rates, with:
//   * strict validation before anything is stored (validate.ts);
//   * duplicate prevention (checksum + unique indexes);
//   * change detection against the last verified rate;
//   * an audit row for every insert / approval / rejection;
//   * a sync-log row for every attempt, including honest failures.
//
// Nothing here invents a rate. When no authorized source yields figures, the
// run is recorded as source_unavailable with the reason, and the dashboard
// tells the administrator to upload the notification.
import crypto from "crypto";
import { parseCsvRates, parseNotificationText } from "./parse";
import { validateBatch } from "./validate";
import { runSourceChecks, type SourceCheck } from "./providers";
import { PRIMARY_CURRENCY_CODES } from "./currencies";
import { isCustomsSyncDue, nextScheduledCheck } from "./schedule";

export { isCustomsSyncDue, nextScheduledCheck };
import type { Database, Json } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExtractionContext,
  ExtractedRate,
  IngestionSummary,
  RejectedCandidate,
  SyncStatus,
  SyncTrigger,
} from "./types";

type ServiceClient = SupabaseClient<Database>;
type RateInsert = Database["public"]["Tables"]["customs_exchange_rates"]["Insert"];
type AuditInsert = Database["public"]["Tables"]["customs_exchange_rate_audit"]["Insert"];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type Actor = { id: string; name: string } | null;

export function checksumOf(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * PostgREST accepts a decimal STRING for a numeric column and Postgres keeps
 * every published digit (numeric(18,8)); the generated types only describe the
 * column as `number`, so the cast is deliberate. Converting with Number()
 * first would be the one place a published rate could be rounded.
 */
function numeric(value: string | null): number | null {
  return value as unknown as number | null;
}

async function writeAudit(supabase: ServiceClient, row: AuditInsert): Promise<void> {
  try {
    await supabase.from("customs_exchange_rate_audit").insert(row);
  } catch {
    // An audit write must never undo a stored rate; the insert itself is the
    // primary record and the sync log still names the run.
  }
}

async function startSyncLog(
  supabase: ServiceClient,
  trigger: SyncTrigger,
  actor: Actor,
  provider: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("customs_rate_sync_log")
    .insert({
      trigger_source: trigger,
      status: "running",
      provider,
      actor_employee_id: actor?.id ?? null,
      actor_name: actor?.name ?? null,
    })
    .select("id")
    .single();
  if (error) return null;
  return data?.id ?? null;
}

async function finishSyncLog(
  supabase: ServiceClient,
  id: string | null,
  patch: Database["public"]["Tables"]["customs_rate_sync_log"]["Update"]
): Promise<void> {
  if (!id) return;
  await supabase
    .from("customs_rate_sync_log")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", id);
}

async function loadPreviousVerified(
  supabase: ServiceClient,
  codes: string[]
): Promise<ExtractionContext["previousByCurrency"]> {
  if (codes.length === 0) return {};
  const { data } = await supabase
    .from("customs_exchange_rates")
    .select("currency_code, import_rate, export_rate, effective_start_date")
    .eq("verification_status", "verified")
    .in("currency_code", codes)
    .order("effective_start_date", { ascending: false });

  const out: NonNullable<ExtractionContext["previousByCurrency"]> = {};
  for (const row of data ?? []) {
    if (out[row.currency_code]) continue; // already have the newest
    out[row.currency_code] = {
      currencyCode: row.currency_code,
      importRate: row.import_rate == null ? null : Number(row.import_rate),
      exportRate: Number(row.export_rate),
      effectiveStartDate: row.effective_start_date,
    };
  }
  return out;
}

type StoreResult = {
  verified: number;
  pending: number;
  duplicates: number;
  rejected: RejectedCandidate[];
  warnings: string[];
};

/**
 * Validates and stores extracted rows. Rows failing validation are returned as
 * `rejected` (with reasons) and are NOT written — a rate register must not
 * contain unusable figures.
 */
export async function storeCandidates(
  supabase: ServiceClient,
  candidates: ExtractedRate[],
  ctx: ExtractionContext,
  actor: Actor
): Promise<StoreResult> {
  const rejected: RejectedCandidate[] = [];
  const warnings: string[] = [];
  let verified = 0;
  let pending = 0;
  let duplicates = 0;

  const { data: currencyRows } = await supabase.from("currencies").select("code");
  const knownCurrencies = new Set((currencyRows ?? []).map((c) => c.code));

  const previous = await loadPreviousVerified(supabase, [
    ...new Set(candidates.map((c) => String(c.currencyCode ?? "").toUpperCase())),
  ]);

  const { outcomes } = validateBatch(candidates, { ...ctx, previousByCurrency: previous });

  for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex++) {
    const outcome = outcomes[outcomeIndex];
    if (!outcome.ok || !outcome.row) {
      rejected.push({
        currencyCode: outcome.row?.currencyCode ?? null,
        effectiveStartDate: outcome.row?.effectiveStartDate ?? null,
        reasons: outcome.errors,
      });
      continue;
    }
    const row = outcome.row;
    warnings.push(...outcome.warnings);

    if (!knownCurrencies.has(row.currencyCode)) {
      rejected.push({
        currencyCode: row.currencyCode,
        effectiveStartDate: row.effectiveStartDate,
        reasons: [`Currency ${row.currencyCode} is not in the currencies master.`],
      });
      continue;
    }

    let supersedesId: string | null = null;
    if (row.suggestedStatus === "verified") {
      const { data: existing } = await supabase
        .from("customs_exchange_rates")
        .select("id, import_rate, export_rate")
        .eq("currency_code", row.currencyCode)
        .eq("effective_start_date", row.effectiveStartDate)
        .eq("verification_status", "verified")
        .maybeSingle();

      if (existing) {
        const sameFigures =
          Number(existing.export_rate) === Number(row.exportRate) &&
          (existing.import_rate == null
            ? row.importRate == null
            : row.importRate != null && Number(existing.import_rate) === Number(row.importRate));
        if (sameFigures) {
          duplicates += 1;
          continue;
        }
        // A corrected figure for the same date: archive the old verified row
        // (its numbers stay untouched) and let the new one carry the history.
        await supabase
          .from("customs_exchange_rates")
          .update({ verification_status: "superseded" })
          .eq("id", existing.id);
        await writeAudit(supabase, {
          rate_id: existing.id,
          action: "supersede",
          actor_employee_id: actor?.id ?? null,
          actor_name: actor?.name ?? null,
          changes: { superseded_by_source: ctx.source, note: "Replaced by a corrected verified row." } as Json,
        });
        supersedesId = existing.id;
      }
    }

    const insert: RateInsert = {
      currency_code: row.currencyCode,
      currency_name: row.currencyName,
      currency_unit: row.currencyUnit,
      import_rate: numeric(row.importRate),
      export_rate: numeric(row.exportRate) as number,
      effective_start_date: row.effectiveStartDate,
      effective_end_date: row.effectiveEndDate,
      notification_no: row.notificationNo,
      notification_date: row.notificationDate,
      verification_status: row.suggestedStatus,
      source: ctx.source,
      source_url: row.sourceUrl,
      source_document_ref: row.sourceDocumentRef,
      source_checksum: ctx.documentChecksum ?? null,
      extraction_confidence: row.confidence,
      validation_notes: row.notes,
      raw_payload: (candidates[outcomeIndex] ?? null) as Json | null,
      created_by: actor?.id ?? null,
      supersedes_id: supersedesId,
    };

    const { data: inserted, error } = await supabase
      .from("customs_exchange_rates")
      .insert(insert)
      .select("id")
      .single();

    if (error || !inserted) {
      if (error?.code === "23505") {
        duplicates += 1;
      } else {
        rejected.push({
          currencyCode: row.currencyCode,
          effectiveStartDate: row.effectiveStartDate,
          reasons: [error?.message ?? "The database rejected the row."],
        });
      }
      continue;
    }

    if (row.suggestedStatus === "verified") verified += 1;
    else pending += 1;

    await writeAudit(supabase, {
      rate_id: inserted.id,
      action: "insert",
      actor_employee_id: actor?.id ?? null,
      actor_name: actor?.name ?? null,
      changes: {
        currency_code: row.currencyCode,
        import_rate: row.importRate,
        export_rate: row.exportRate,
        effective_start_date: row.effectiveStartDate,
        notification_no: row.notificationNo,
        status: row.suggestedStatus,
        confidence: row.confidence,
        source: ctx.source,
        checksum: ctx.documentChecksum ?? null,
      } as Json,
    });
  }

  // "Detect missing currencies": a notification normally carries all the
  // primary currencies. If some are absent from an otherwise-readable
  // document, say so so the administrator checks the source rather than
  // assuming those rates simply did not change.
  const present = new Set(outcomes.filter((o) => o.ok && o.row).map((o) => o.row!.currencyCode));
  const missing = PRIMARY_CURRENCY_CODES.filter((code) => !present.has(code));
  if (missing.length > 0 && present.size > 0) {
    warnings.push(`Currencies not found in this source: ${missing.join(", ")}.`);
  }

  return { verified, pending, duplicates, rejected, warnings: [...new Set(warnings)] };
}

function summarizeChecks(checks: SourceCheck[]): string {
  return checks.map((c) => `${c.label}: ${c.message}`).join(" | ");
}

function statusFor(verifiedCount: number, pendingCount: number, rejectedCount: number): SyncStatus {
  if (verifiedCount === 0 && pendingCount === 0) return "failed";
  if (pendingCount > 0 || rejectedCount > 0) return "partial";
  return "success";
}

function blankSummary(overrides: Partial<IngestionSummary>): IngestionSummary {
  return {
    syncLogId: null,
    status: "failed",
    provider: "—",
    sourceUrl: null,
    extracted: 0,
    verified: 0,
    pending: 0,
    duplicates: 0,
    rejected: [],
    message: "",
    warnings: [],
    ...overrides,
  };
}

/**
 * Manual / scheduled synchronization: checks the official sources, and stores
 * whatever real published figures they yield. When no source offers a
 * machine-readable feed (today's normal case), it records an honest
 * source_unavailable run and points the administrator at document upload.
 */
export async function runCustomsRateSync(params: {
  supabase: ServiceClient;
  trigger: SyncTrigger;
  actor?: Actor;
}): Promise<IngestionSummary> {
  const { supabase, trigger } = params;
  const actor = params.actor ?? null;
  const logId = await startSyncLog(supabase, trigger, actor, "official-source-check");

  let checks: SourceCheck[];
  try {
    const result = await runSourceChecks();
    checks = result.checks;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncLog(supabase, logId, { status: "failed", message });
    return blankSummary({ syncLogId: logId, status: "failed", message });
  }

  const usable = checks.find((c) => c.rows.length > 0) ?? null;
  const details = {
    checks: checks.map((c) => ({
      provider: c.provider,
      label: c.label,
      url: c.url,
      reachable: c.reachable,
      machineReadable: c.machineReadable,
      message: c.message,
    })),
  } as Json;

  if (!usable) {
    const message = summarizeChecks(checks);
    await finishSyncLog(supabase, logId, {
      status: "source_unavailable",
      provider: checks.map((c) => c.label).join(" → "),
      source_url: checks[0]?.url ?? null,
      message,
      details,
    });
    return blankSummary({
      syncLogId: logId,
      status: "source_unavailable",
      provider: checks.map((c) => c.label).join(" → "),
      message,
    });
  }

  const ctx: ExtractionContext = {
    source: usable.provider,
    fromDocument: /\.pdf(\?|#|$)/i.test(usable.url),
    documentChecksum: usable.checksum,
    documentRef: usable.documentRef,
    sourceUrl: usable.url,
  };

  const stored = await storeCandidates(supabase, usable.rows, ctx, actor);
  const status = statusFor(stored.verified, stored.pending, stored.rejected.length);
  const message =
    `${usable.message} Stored ${stored.verified} verified, ${stored.pending} pending, ` +
    `${stored.duplicates} duplicate(s), ${stored.rejected.length} rejected.` +
    (stored.warnings.length > 0 ? ` Notes: ${stored.warnings.join(" ")}` : "");

  await finishSyncLog(supabase, logId, {
    status,
    provider: usable.label,
    source_url: usable.url,
    rows_extracted: usable.rows.length,
    rows_verified: stored.verified,
    rows_pending: stored.pending,
    message,
    details,
  });
  await writeAudit(supabase, {
    action: "sync",
    actor_employee_id: actor?.id ?? null,
    actor_name: actor?.name ?? null,
    changes: { status, provider: usable.label, message } as Json,
  });

  return {
    syncLogId: logId,
    status,
    provider: usable.label,
    sourceUrl: usable.url,
    extracted: usable.rows.length,
    verified: stored.verified,
    pending: stored.pending,
    duplicates: stored.duplicates,
    rejected: stored.rejected,
    message,
    warnings: stored.warnings,
  };
}

/**
 * Administrator upload of an official notification (PDF) or its CSV. Every row
 * is stored as PENDING — an upload is a claim, not a verification — and an
 * administrator must approve it on the dashboard.
 */
export async function ingestOfficialDocument(params: {
  supabase: ServiceClient;
  bytes: Buffer;
  filename: string;
  kind: "csv" | "pdf" | "text";
  actor?: Actor;
  effectiveStartDate?: string;
}): Promise<IngestionSummary> {
  const { supabase, bytes, filename, kind } = params;
  const actor = params.actor ?? null;

  if (bytes.byteLength === 0) throw new Error("The uploaded file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("The uploaded file is larger than 10 MB.");
  if (kind === "pdf" && !bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
    throw new Error("That file is not a PDF.");
  }

  const checksum = checksumOf(bytes);
  const logId = await startSyncLog(supabase, "upload", actor, "admin upload");

  let parsed: { rows: ExtractedRate[]; errors: string[] };
  try {
    if (kind === "csv") {
      parsed = parseCsvRates(bytes.toString("utf8"), { effectiveStartDate: params.effectiveStartDate });
    } else if (kind === "text") {
      parsed = parseNotificationText(bytes.toString("utf8"), {
        effectiveStartDate: params.effectiveStartDate,
      });
    } else {
      const { extractLayoutText } = await import("@/lib/courier-bills/pdf-layout");
      const text = await extractLayoutText(bytes);
      parsed = parseNotificationText(text, { effectiveStartDate: params.effectiveStartDate });
    }
  } catch (e) {
    const message = `Could not read ${filename}: ${e instanceof Error ? e.message : String(e)}`;
    await finishSyncLog(supabase, logId, { status: "failed", message });
    return blankSummary({ syncLogId: logId, provider: "admin upload", status: "failed", message });
  }

  if (parsed.rows.length === 0) {
    const message = parsed.errors.join(" ") || "No rate rows were found in the upload.";
    await finishSyncLog(supabase, logId, {
      status: "failed",
      provider: "admin upload",
      source_url: null,
      message,
      details: { filename, checksum } as Json,
    });
    return blankSummary({ syncLogId: logId, provider: "admin upload", status: "failed", message });
  }

  const ctx: ExtractionContext = {
    source: kind === "csv" ? "admin_csv" : "admin_document",
    fromDocument: kind !== "csv",
    documentChecksum: checksum,
    documentRef: filename,
  };

  const stored = await storeCandidates(supabase, parsed.rows, ctx, actor);
  const storedCount = stored.verified + stored.pending;
  const status: SyncStatus = storedCount === 0 ? "failed" : stored.rejected.length > 0 ? "partial" : "success";

  const message =
    `${filename}: ${parsed.rows.length} row(s) read, ${stored.pending} pending approval, ` +
    `${stored.verified} verified, ${stored.duplicates} duplicate(s), ${stored.rejected.length} rejected. ` +
    (stored.warnings.length > 0 ? `${stored.warnings.join(" ")} ` : "") +
    (parsed.errors.length > 0 ? parsed.errors.join(" ") : "");

  await finishSyncLog(supabase, logId, {
    status,
    provider: "admin upload",
    rows_extracted: parsed.rows.length,
    rows_verified: stored.verified,
    rows_pending: stored.pending,
    message,
    details: { filename, checksum, parseErrors: parsed.errors, rejected: stored.rejected } as Json,
  });
  await writeAudit(supabase, {
    action: "upload",
    actor_employee_id: actor?.id ?? null,
    actor_name: actor?.name ?? null,
    changes: { filename, checksum, message } as Json,
  });

  return {
    syncLogId: logId,
    status,
    provider: "admin upload",
    sourceUrl: null,
    extracted: parsed.rows.length,
    verified: stored.verified,
    pending: stored.pending,
    duplicates: stored.duplicates,
    rejected: stored.rejected,
    message,
    warnings: stored.warnings,
  };
}

/** Audit helper used by the approve/reject actions. */
export async function recordRateDecision(params: {
  supabase: ServiceClient;
  rateId: string;
  action: "approve" | "reject";
  actor: Actor;
  notes?: string | null;
}): Promise<void> {
  await writeAudit(params.supabase, {
    rate_id: params.rateId,
    action: params.action,
    actor_employee_id: params.actor?.id ?? null,
    actor_name: params.actor?.name ?? null,
    changes: { notes: params.notes ?? null } as Json,
  });
}
