// 2026-11-18 — Server-side loader for a company's AI configuration.
//
// Sources, in order of precedence for each key:
//   1. etsy_seo_credentials (encrypted with ENCRYPTION_KEY, never sent to the
//      browser),
//   2. the deployment environment (GEMINI_API_KEY / OPENROUTER_API_KEY).
// Settings (provider, backup on/off, model ids, budget) come from
// etsy_seo_settings, with documented defaults when the row does not exist yet.

import { decryptSecret } from "@/lib/crypto/secret-box";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIProviderManager, createProviders, type ManagerConfig, type ProviderCredentials } from "./ai-provider.manager";
import { GeminiProvider } from "./gemini.provider";
import { estimateCostUsd } from "./pricing";
import type { AttemptLog } from "./ai-provider.manager";

export type EtsySeoSettings = {
  primaryProvider: "gemini";
  primaryModel: string | null;
  backupEnabled: boolean;
  backupProvider: "openrouter";
  backupModel: string | null;
  researchMode: "ai" | "ai+live";
  outputMode: string;
  monthlyBudgetUsd: number;
};

export const DEFAULT_SETTINGS: EtsySeoSettings = {
  primaryProvider: "gemini",
  primaryModel: null,
  backupEnabled: true,
  backupProvider: "openrouter",
  backupModel: null,
  researchMode: "ai",
  outputMode: "all_languages",
  monthlyBudgetUsd: 0,
};

export type CompanyAiContext = {
  settings: EtsySeoSettings;
  manager: AIProviderManager;
  credentials: ProviderCredentials;
  /** Which keys came from where — for the Settings screen, never the values. */
  sources: { gemini: "company" | "environment" | "missing"; openrouter: "company" | "environment" | "missing" };
  /** True when the matching env var exists but the row does not. */
  encryptionAvailable: boolean;
};

type Row = Record<string, unknown>;

async function loadSettings(supabase: SupabaseClient, companyId: string): Promise<EtsySeoSettings> {
  const { data } = await supabase.from("etsy_seo_settings").select("*").eq("company_id", companyId).maybeSingle();
  const row = (data ?? {}) as Row;
  return {
    primaryProvider: "gemini",
    primaryModel: (row.primary_model as string) ?? null,
    backupEnabled: row.backup_enabled === undefined ? DEFAULT_SETTINGS.backupEnabled : row.backup_enabled !== false,
    backupProvider: "openrouter",
    backupModel: (row.backup_model as string) ?? null,
    researchMode: row.research_mode === "ai+live" ? "ai+live" : "ai",
    outputMode: (row.output_mode as string) ?? "all_languages",
    monthlyBudgetUsd: Number(row.monthly_budget_usd ?? 0) || 0,
  };
}

async function loadCredential(supabase: SupabaseClient, companyId: string, provider: "gemini" | "openrouter"): Promise<{ key: string | null; error?: string }> {
  const { data } = await supabase
    .from("etsy_seo_credentials")
    .select("encrypted_api_key, status")
    .eq("company_id", companyId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data?.encrypted_api_key) return { key: null };
  try {
    // Supabase returns bytea as a hex string ("\\x...") over PostgREST.
    const raw = data.encrypted_api_key as unknown;
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === "string"
        ? Buffer.from(raw.replace(/^\\x/, ""), "hex")
        : Buffer.from(raw as ArrayBuffer);
    return { key: decryptSecret(buffer) };
  } catch (error) {
    return { key: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadCompanyAiContext(supabase: SupabaseClient, companyId: string): Promise<CompanyAiContext> {
  const settings = await loadSettings(supabase, companyId);
  const [companyGemini, companyOpenRouter] = await Promise.all([
    loadCredential(supabase, companyId, "gemini"),
    loadCredential(supabase, companyId, "openrouter"),
  ]);

  const envGemini = (process.env.GEMINI_API_KEY ?? "").trim() || null;
  const envOpenRouter = (process.env.OPENROUTER_API_KEY ?? "").trim() || null;

  const credentials: ProviderCredentials = {
    geminiApiKey: companyGemini.key ?? envGemini,
    openRouterApiKey: companyOpenRouter.key ?? envOpenRouter,
    geminiModels: settings.primaryModel ? [settings.primaryModel] : undefined,
    openRouterModels: settings.backupModel ? [settings.backupModel] : undefined,
  };

  const providers = createProviders(credentials);
  return {
    settings,
    manager: new AIProviderManager(providers),
    credentials,
    sources: {
      gemini: companyGemini.key ? "company" : envGemini ? "environment" : "missing",
      openrouter: companyOpenRouter.key ? "company" : envOpenRouter ? "environment" : "missing",
    },
    encryptionAvailable: !!process.env.ENCRYPTION_KEY,
  };
}

export function managerConfig(settings: EtsySeoSettings): ManagerConfig {
  return { primaryModel: settings.primaryModel, backupEnabled: settings.backupEnabled, backupModel: settings.backupModel };
}

/** Monthly spend so far, used to enforce the optional soft budget. */
export async function monthlySpendUsd(supabase: SupabaseClient, companyId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("etsy_seo_usage_logs")
    .select("estimated_cost_usd")
    .eq("company_id", companyId)
    .gte("created_at", start.toISOString());
  return (data ?? []).reduce((sum, row) => sum + (Number(row.estimated_cost_usd) || 0), 0);
}

/** Write one attempt to etsy_seo_usage_logs (never throws into the request). */
export async function recordUsage(
  supabase: SupabaseClient,
  context: { companyId: string; projectId?: string | null; employeeId?: string | null },
  log: AttemptLog
): Promise<void> {
  try {
    const cost = estimateCostUsd(log.model, log.provider, log.usage);
    await supabase.from("etsy_seo_usage_logs").insert({
      company_id: context.companyId,
      project_id: context.projectId ?? null,
      employee_id: context.employeeId ?? null,
      provider: log.provider,
      model: log.model,
      operation: log.operation,
      status: log.status,
      input_tokens: log.usage?.inputTokens ?? null,
      output_tokens: log.usage?.outputTokens ?? null,
      estimated_cost_usd: cost,
      latency_ms: log.latencyMs,
      error_message: log.errorMessage,
    });
  } catch (error) {
    console.error("etsy seo usage log failed:", error);
  }
}

/** Provider health for the dashboard widgets (real calls, cached 5 min). */
export async function healthFor(context: CompanyAiContext) {
  const providers = createProviders(context.credentials);
  return {
    gemini: await providers.gemini.checkHealth(),
    openrouter: await providers.openrouter.checkHealth(),
    defaultGeminiModel: new GeminiProvider({ apiKey: null }).models()[0] ?? null,
  };
}
