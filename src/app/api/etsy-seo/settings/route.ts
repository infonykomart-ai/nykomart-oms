import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { loadCompanyAiContext, DEFAULT_SETTINGS } from "@/lib/etsy/ai/company-ai";
import { GeminiProvider } from "@/lib/etsy/ai/gemini.provider";
import { OpenRouterProvider } from "@/lib/etsy/ai/openrouter.provider";
import { diagnosticBody, explainProviderError } from "@/lib/etsy/ai/diagnostics";
import { RESEARCH_SOURCES } from "@/lib/etsy/research";
import { jsonError, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-18 — API Settings. GET never returns a key: only where each key came
// from and whether the provider answers. PUT stores an optional per-company key
// ENCRYPTED (AES-256-GCM via ENCRYPTION_KEY) and returns a masked status.
export const maxDuration = 30;

type Body = {
  primaryModel?: string | null;
  backupEnabled?: boolean;
  backupModel?: string | null;
  researchMode?: "ai" | "ai+live";
  monthlyBudgetUsd?: number;
  geminiApiKey?: string;
  openRouterApiKey?: string;
  test?: "gemini" | "openrouter";
};

export async function GET() {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const supabase = createServiceRoleClientUnchecked();
  const context = await loadCompanyAiContext(supabase, me.currentCompanyId);

  const { data: settingsRow } = await supabase.from("etsy_seo_settings").select("*").eq("company_id", me.currentCompanyId).maybeSingle();
  const { data: credentials } = await supabase
    .from("etsy_seo_credentials")
    .select("provider, status, last_checked_at, last_error")
    .eq("company_id", me.currentCompanyId);

  return NextResponse.json({
    ok: true,
    settings: settingsRow ?? DEFAULT_SETTINGS,
    providers: {
      gemini: {
        source: context.sources.gemini,
        model: context.credentials.geminiModels?.[0] ?? process.env.GEMINI_MODEL_ID ?? new GeminiProvider({ apiKey: null }).models()[0],
        fallbackModel: new GeminiProvider({ apiKey: null }).models()[1] ?? null,
        configured: !!context.credentials.geminiApiKey,
      },
      openrouter: {
        source: context.sources.openrouter,
        model: context.credentials.openRouterModels?.[0] ?? process.env.OPENROUTER_MODEL_ID ?? null,
        configured: new OpenRouterProvider({ apiKey: context.credentials.openRouterApiKey }).isConfigured(),
      },
    },
    companyCredentials: (credentials ?? []).map((c) => ({ provider: c.provider, status: c.status, lastCheckedAt: c.last_checked_at, lastError: c.last_error })),
    researchSources: RESEARCH_SOURCES,
    encryptionAvailable: context.encryptionAvailable,
    envVars: {
      required: ["GEMINI_API_KEY"],
      optional: ["GEMINI_MODEL_ID", "OPENROUTER_API_KEY", "OPENROUTER_MODEL_ID", "SEARCH_API_KEY", "RESEARCH_PROVIDER_API_KEY", "ENCRYPTION_KEY"],
    },
    note: "Keys are server-side only. A key entered here is encrypted before storage and is never returned by any API.",
  });
}

export async function PUT(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 16 * 1024)) return jsonError("Request body is too large.", 413);
  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const body = parsedBody.body;

  const supabase = createServiceRoleClientUnchecked();

  const update: Record<string, unknown> = {
    company_id: me.currentCompanyId,
    updated_by_employee_id: me.id,
    updated_at: new Date().toISOString(),
  };
  if (body.primaryModel !== undefined) update.primary_model = body.primaryModel?.trim() || null;
  if (body.backupEnabled !== undefined) update.backup_enabled = body.backupEnabled === true;
  if (body.backupModel !== undefined) update.backup_model = body.backupModel?.trim() || null;
  if (body.researchMode !== undefined) update.research_mode = body.researchMode === "ai+live" ? "ai+live" : "ai";
  if (body.monthlyBudgetUsd !== undefined) {
    const budget = Number(body.monthlyBudgetUsd);
    if (!Number.isFinite(budget) || budget < 0) return jsonError("Monthly budget must be a positive number.", 400);
    update.monthly_budget_usd = budget;
  }

  const { error } = await supabase.from("etsy_seo_settings").upsert(update, { onConflict: "company_id" });
  if (error) {
    return jsonError(
      /does not exist|schema cache/i.test(error.message)
        ? "Run db/2026-11-18-etsy-seo-generator.sql in Supabase first."
        : error.message,
      500
    );
  }

  // Optional encrypted key storage. Both keys are handled the same way; the
  // plaintext exists only in this request's memory.
  const storedKeys: string[] = [];
  const keyWrites: Array<["gemini" | "openrouter", string | undefined]> = [
    ["gemini", body.geminiApiKey],
    ["openrouter", body.openRouterApiKey],
  ];
  for (const [provider, key] of keyWrites) {
    const trimmed = (key ?? "").trim();
    if (!trimmed) continue;
    if (trimmed.length < 20) return jsonError(`${provider} key looks too short.`, 400);
    try {
      const encrypted = encryptSecret(trimmed);
      const { error: credentialError } = await supabase.from("etsy_seo_credentials").upsert(
        {
          company_id: me.currentCompanyId,
          provider,
          encrypted_api_key: `\\x${encrypted.toString("hex")}`,
          status: "active",
          last_error: null,
          created_by_employee_id: me.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider" }
      );
      if (credentialError) return jsonError(credentialError.message, 500);
      storedKeys.push(provider);
    } catch (error) {
      return jsonError(
        error instanceof Error && /ENCRYPTION_KEY/.test(error.message)
          ? "ENCRYPTION_KEY is not set on the server, so a stored key cannot be encrypted. Set it in the environment first."
          : "The key could not be encrypted.",
        503
      );
    }
  }

  return NextResponse.json({ ok: true, storedKeys, note: storedKeys.length ? "Key stored encrypted. It will never be returned." : undefined });
}

/** POST { test: "gemini" | "openrouter" } — a real call, not a key-length check. */
export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const provider = parsedBody.body.test;
  if (provider !== "gemini" && provider !== "openrouter") return jsonError("test must be gemini or openrouter.", 400);

  const supabase = createServiceRoleClientUnchecked();
  const context = await loadCompanyAiContext(supabase, me.currentCompanyId);

  const health =
    provider === "gemini"
      ? await new GeminiProvider({ apiKey: context.credentials.geminiApiKey, models: context.credentials.geminiModels }).checkHealth()
      : await new OpenRouterProvider({ apiKey: context.credentials.openRouterApiKey, models: context.credentials.openRouterModels }).checkHealth();

  await supabase
    .from("etsy_seo_credentials")
    .update({ status: health.ok ? "active" : "invalid", last_checked_at: new Date().toISOString(), last_error: health.error ?? null })
    .eq("company_id", me.currentCompanyId)
    .eq("provider", provider);

  // A failed health check is the most common place an operator sees a vendor
  // error, so map it to the same actionable diagnosis the generate route uses.
  const diagnostic = health.ok ? null : explainProviderError(health.error ?? `${provider} health check failed.`, provider);

  return NextResponse.json({
    ok: health.ok,
    provider,
    model: health.model,
    error: diagnostic ? diagnostic.message : null,
    ...(diagnostic ? diagnosticBody(diagnostic) : {}),
  });
}
