"use server";

// Server actions for the customs exchange rate dashboard.
//
// Every action starts with requireCapability("customs_rate_admin") — the same
// server-side guard the rest of the app uses (never trust a hidden button),
// then writes through the service-role client. Approving or rejecting a rate
// always leaves an audit row.
import { revalidatePath } from "next/cache";
import { requireAnyCapability, requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ingestOfficialDocument, recordRateDecision, runCustomsRateSync } from "@/lib/customs/ingest";
import { findCustomsRateInForce, isValidIsoDate, type RateInForce } from "@/lib/customs/lookup";
import { isSupportedCurrency } from "@/lib/customs/currencies";
import { normalizeDateInput } from "@/lib/customs/parse";

export type CustomsFormState = { error: string | null; success: boolean; message: string | null };

const PAGE = "/dashboard/customs-rates";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Administrator-triggered synchronization against the official sources. */
export async function syncCustomsRatesNow(): Promise<{ error: string | null; message: string | null }> {
  const employee = await requireCapability("customs_rate_admin");
  const supabase = createServiceRoleClient();

  const summary = await runCustomsRateSync({
    supabase,
    trigger: "manual",
    actor: { id: employee.id, name: employee.name },
  });

  revalidatePath(PAGE);

  if (summary.status === "source_unavailable") {
    return {
      error:
        "No machine-readable official source was available, so nothing was imported. " +
        "Upload the official notification (PDF) or its CSV below.",
      message: summary.message,
    };
  }
  if (summary.status === "failed" && summary.verified + summary.pending === 0) {
    return { error: summary.message || "The sync could not import any rates.", message: null };
  }
  return { error: null, message: summary.message };
}

async function readUpload(
  formData: FormData,
  field: string,
  allowed: Array<{ ext: string; kind: "csv" | "pdf" | "text" }>
): Promise<{ file: File; kind: "csv" | "pdf" | "text" } | { error: string }> {
  const value = formData.get(field);
  if (!(value instanceof File) || value.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (value.size > 10 * 1024 * 1024) {
    return { error: "The file is larger than 10 MB." };
  }
  const name = value.name.toLowerCase();
  const match = allowed.find((a) => name.endsWith(a.ext));
  if (!match) {
    return { error: `Unsupported file type. Allowed: ${allowed.map((a) => a.ext).join(", ")}.` };
  }
  return { file: value, kind: match.kind };
}

/**
 * Administrator upload of the official notification's CSV. Rows become
 * PENDING; they are never auto-verified, because the upload does not prove the
 * figures match the notification until someone checks them.
 */
export async function uploadCustomsRatesCsv(
  _prev: CustomsFormState,
  formData: FormData
): Promise<CustomsFormState> {
  const employee = await requireCapability("customs_rate_admin");
  const picked = await readUpload(formData, "file", [{ ext: ".csv", kind: "csv" }]);
  if ("error" in picked) return { error: picked.error, success: false, message: null };

  const effectiveDate = normalizeDateInput(str(formData, "effective_start_date"));
  if (effectiveDate && !isValidIsoDate(effectiveDate)) {
    return { error: "The fallback effective date is not a valid date.", success: false, message: null };
  }

  try {
    const bytes = Buffer.from(await picked.file.arrayBuffer());
    const summary = await ingestOfficialDocument({
      supabase: createServiceRoleClient(),
      bytes,
      filename: picked.file.name,
      kind: "csv",
      actor: { id: employee.id, name: employee.name },
      effectiveStartDate: effectiveDate || undefined,
    });

    revalidatePath(PAGE);
    if (summary.pending + summary.verified === 0) {
      return { error: summary.message || "No usable rate rows were found.", success: false, message: null };
    }
    return { error: null, success: true, message: summary.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The upload failed.", success: false, message: null };
  }
}

/**
 * Administrator upload of the official notification PDF (or a plain-text copy
 * of its table). Same rule: extraction produces PENDING rows only.
 */
export async function uploadCustomsRateDocument(
  _prev: CustomsFormState,
  formData: FormData
): Promise<CustomsFormState> {
  const employee = await requireCapability("customs_rate_admin");
  const picked = await readUpload(formData, "file", [
    { ext: ".pdf", kind: "pdf" },
    { ext: ".txt", kind: "text" },
  ]);
  if ("error" in picked) return { error: picked.error, success: false, message: null };

  const effectiveDate = normalizeDateInput(str(formData, "effective_start_date"));
  if (effectiveDate && !isValidIsoDate(effectiveDate)) {
    return { error: "The fallback effective date is not a valid date.", success: false, message: null };
  }

  try {
    const bytes = Buffer.from(await picked.file.arrayBuffer());
    const summary = await ingestOfficialDocument({
      supabase: createServiceRoleClient(),
      bytes,
      filename: picked.file.name,
      kind: picked.kind,
      actor: { id: employee.id, name: employee.name },
      effectiveStartDate: effectiveDate || undefined,
    });

    revalidatePath(PAGE);
    if (summary.pending + summary.verified === 0) {
      return { error: summary.message || "No usable rate rows were found.", success: false, message: null };
    }
    return { error: null, success: true, message: summary.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The upload failed.", success: false, message: null };
  }
}

/**
 * Approves a pending rate. If a verified rate already exists for the same
 * currency and effective date with different figures, that older row is
 * archived as 'superseded' first (its numbers are never edited) and the new
 * row records supersedes_id.
 */
export async function approveCustomsRate(rateId: string): Promise<{ error: string | null }> {
  const employee = await requireCapability("customs_rate_admin");
  if (!rateId) return { error: "Missing rate id." };

  const supabase = createServiceRoleClient();
  const { data: row, error: readError } = await supabase
    .from("customs_exchange_rates")
    .select("id, currency_code, effective_start_date, verification_status, import_rate, export_rate, currency_unit, notification_no")
    .eq("id", rateId)
    .single();

  if (readError || !row) return { error: readError?.message ?? "That rate no longer exists." };
  if (row.verification_status === "verified") {
    return { error: "This rate is already verified." };
  }
  if (row.verification_status === "superseded") {
    return { error: "This rate has been superseded and cannot be re-approved." };
  }

  const { data: existing } = await supabase
    .from("customs_exchange_rates")
    .select("id, import_rate, export_rate")
    .eq("currency_code", row.currency_code)
    .eq("effective_start_date", row.effective_start_date)
    .eq("verification_status", "verified")
    .maybeSingle();

  let supersedesId: string | null = null;
  if (existing) {
    const same =
      Number(existing.export_rate) === Number(row.export_rate) &&
      (existing.import_rate == null
        ? row.import_rate == null
        : row.import_rate != null && Number(existing.import_rate) === Number(row.import_rate));
    if (same) {
      // Identical figures are already live — just retire the duplicate claim.
      const { error } = await supabase
        .from("customs_exchange_rates")
        .update({ verification_status: "rejected", validation_notes: "Duplicate of an already verified rate." })
        .eq("id", rateId);
      if (error) return { error: error.message };
      await recordRateDecision({ supabase, rateId, action: "reject", actor: { id: employee.id, name: employee.name }, notes: "Duplicate" });
      revalidatePath(PAGE);
      return { error: null };
    }
    const { error: supersedeError } = await supabase
      .from("customs_exchange_rates")
      .update({ verification_status: "superseded" })
      .eq("id", existing.id);
    if (supersedeError) return { error: supersedeError.message };
    await recordRateDecision({
      supabase,
      rateId: existing.id,
      action: "reject",
      actor: { id: employee.id, name: employee.name },
      notes: `Superseded by corrected rate ${rateId}`,
    });
    supersedesId = existing.id;
  }

  const { error } = await supabase
    .from("customs_exchange_rates")
    .update({
      verification_status: "verified",
      verified_by: employee.id,
      verified_by_name: employee.name,
      verified_at: new Date().toISOString(),
      supersedes_id: supersedesId,
    })
    .eq("id", rateId);

  if (error) return { error: error.message };

  await recordRateDecision({
    supabase,
    rateId,
    action: "approve",
    actor: { id: employee.id, name: employee.name },
    notes: supersedesId ? `Supersedes ${supersedesId}` : null,
  });
  revalidatePath(PAGE);
  return { error: null };
}

/** Rejects a pending rate, keeping the row (and the reason) for the audit trail. */
export async function rejectCustomsRate(rateId: string, reason: string): Promise<{ error: string | null }> {
  const employee = await requireCapability("customs_rate_admin");
  if (!rateId) return { error: "Missing rate id." };
  const note = reason.trim();
  if (!note) return { error: "Enter a reason for rejecting this rate." };

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from("customs_exchange_rates")
    .select("id, verification_status, validation_notes")
    .eq("id", rateId)
    .single();
  if (!row) return { error: "That rate no longer exists." };
  if (row.verification_status === "verified") {
    return { error: "A verified rate cannot be rejected — upload a corrected rate instead." };
  }

  const { error } = await supabase
    .from("customs_exchange_rates")
    .update({
      verification_status: "rejected",
      validation_notes: [row.validation_notes, `Rejected: ${note}`].filter(Boolean).join(" "),
    })
    .eq("id", rateId);

  if (error) return { error: error.message };

  await recordRateDecision({
    supabase,
    rateId,
    action: "reject",
    actor: { id: employee.id, name: employee.name },
    notes: note,
  });
  revalidatePath(PAGE);
  return { error: null };
}

/** Rate lookup for the calculator, so it always uses the verified register. */
export async function lookupRateForCalculator(
  currency: string,
  date: string
): Promise<{ rate: RateInForce | null; error: string | null }> {
  await requireAnyCapability("customs_rate_view", "customs_rate_admin");
  const code = currency.toUpperCase();
  if (!isSupportedCurrency(code)) return { rate: null, error: "Unsupported currency." };
  if (!isValidIsoDate(date)) return { rate: null, error: "Enter a valid date." };

  try {
    const rate = await findCustomsRateInForce(createServiceRoleClient(), code, date);
    return { rate, error: null };
  } catch (e) {
    return { rate: null, error: e instanceof Error ? e.message : "Lookup failed." };
  }
}
