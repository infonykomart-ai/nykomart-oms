// 2026-11-18 — AIProviderManager: the ONLY place that decides which provider
// answers (spec §1 / §18).
//
// Order:
//   1. Gemini, configured model(s) — each with transient-error retries, then a
//      JSON/schema repair attempt.
//   2. If every Gemini model failed and backup is enabled AND OpenRouter is
//      configured → the same structured request goes to OpenRouter.
//   3. If backup is enabled but OpenRouter is NOT configured → the alternate
//      Gemini model (already part of step 1's model list).
//   4. If everything failed → throw. A failure is NEVER returned as success.
//
// Every provider call — including the failed ones — is reported through
// `onAttempt`, which the route writes to etsy_seo_usage_logs (provider, model,
// tokens, cost, latency, status, error). The provider that actually produced
// the saved text is stored on the listing, so a backup run is never silent.

import { GeminiProvider } from "./gemini.provider";
import { OpenRouterProvider } from "./openrouter.provider";
import { withRetry } from "./retry-manager";
import {
  AIProvider,
  AiImage,
  AiProviderName,
  AiUsage,
  ProviderError,
  ProviderHealth,
  ProviderResponse,
} from "./types";

export type AttemptStatus = "success" | "error";

export type AttemptLog = {
  provider: AiProviderName;
  model: string;
  operation: string;
  status: AttemptStatus;
  backupUsed: boolean;
  latencyMs: number;
  usage: AiUsage | null;
  errorMessage: string | null;
};

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: string[] };

export type ManagerConfig = {
  primaryModel?: string | null;
  backupEnabled: boolean;
  backupModel?: string | null;
};

export type GenerateStructuredOptions<T> = {
  operation: string;
  system: string;
  prompt: string;
  images?: AiImage[];
  temperature?: number;
  maxOutputTokens?: number;
  parse: (text: string) => ParseResult<T>;
  config: ManagerConfig;
  onAttempt?: (log: AttemptLog) => void | Promise<void>;
  /** Injectable for tests. */
  gemini?: AIProvider;
  openrouter?: AIProvider;
  attemptsPerModel?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type ManagerResult<T> = {
  data: T;
  provider: AiProviderName;
  model: string;
  backupUsed: boolean;
  latencyMs: number;
  usage: AiUsage | null;
};

export type ProviderCredentials = {
  geminiApiKey: string | null;
  openRouterApiKey: string | null;
  geminiModels?: string[];
  openRouterModels?: string[];
};

/** Build both providers from env / decrypted per-company credentials. */
export function createProviders(credentials: ProviderCredentials): { gemini: AIProvider; openrouter: AIProvider } {
  return {
    gemini: new GeminiProvider({ apiKey: credentials.geminiApiKey, models: credentials.geminiModels }),
    openrouter: new OpenRouterProvider({ apiKey: credentials.openRouterApiKey, models: credentials.openRouterModels }),
  };
}

export async function checkProviderHealth(gemini: AIProvider, openrouter: AIProvider): Promise<ProviderHealth[]> {
  return Promise.all([gemini.checkHealth(), openrouter.checkHealth()]);
}

const REPAIR_SUFFIX = (issues: string[]) =>
  `\n\nYour previous reply failed validation:\n- ${issues.join("\n- ")}\nReturn ONLY corrected JSON that satisfies every rule above.`;

/**
 * Ask one provider (one model) for JSON. Two passes: the first is the normal
 * request; if the reply is not valid JSON or fails the schema, the second pass
 * is the same prompt plus the exact issues, as a repair request.
 */
async function requestJson<T>(
  provider: AIProvider,
  model: string,
  options: GenerateStructuredOptions<T>,
  onAttempt: (log: AttemptLog) => void | Promise<void>,
  backupUsed: boolean
): Promise<{ data: T; response: ProviderResponse }> {
  let issues: string[] = [];
  let lastError: unknown = null;

  for (let pass = 0; pass < 2; pass++) {
    const prompt = pass === 0 ? options.prompt : options.prompt + REPAIR_SUFFIX(issues);
    const startedAt = Date.now();
    try {
      const response = await provider.generateStructured({
        model,
        system: options.system,
        prompt,
        images: options.images,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      const parsed = options.parse(response.text);
      if (parsed.ok) {
        await onAttempt({
          provider: provider.name,
          model: response.model,
          operation: options.operation,
          status: "success",
          backupUsed,
          latencyMs: response.latencyMs,
          usage: response.usage,
          errorMessage: null,
        });
        return { data: parsed.data, response };
      }
      issues = parsed.issues;
      await onAttempt({
        provider: provider.name,
        model: response.model,
        operation: options.operation,
        status: "error",
        backupUsed,
        latencyMs: Date.now() - startedAt,
        usage: response.usage,
        errorMessage: `Schema validation failed: ${parsed.issues.join("; ")}`,
      });
    } catch (error) {
      lastError = error;
      await onAttempt({
        provider: provider.name,
        model,
        operation: options.operation,
        status: "error",
        backupUsed,
        latencyMs: Date.now() - startedAt,
        usage: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // A transient provider error is worth retrying inside withRetry; a
      // schema failure is not (the second pass is the repair attempt).
      throw error;
    }
  }

  if (lastError) throw lastError;
  throw new ProviderError(`The model's JSON did not pass validation: ${issues.join("; ")}`, {
    provider: provider.name,
    model,
    retryable: false,
    kind: "empty",
  });
}

export class AIProviderManager {
  constructor(private readonly providers: { gemini: AIProvider; openrouter: AIProvider }) {}

  /**
   * Generate validated structured JSON with automatic fallback.
   * Throws ProviderError when no provider produced a valid answer.
   */
  async generateStructured<T>(options: GenerateStructuredOptions<T>): Promise<ManagerResult<T>> {
    const { gemini, openrouter } = options.gemini && options.openrouter ? { gemini: options.gemini, openrouter: options.openrouter } : this.providers;
    const onAttempt = options.onAttempt ?? (() => {});
    const attemptsPerModel = options.attemptsPerModel ?? 2;
    const failures: string[] = [];
    const startedAt = Date.now();

    // ---- 1. Primary: Gemini ------------------------------------------------
    if (!gemini.isConfigured()) {
      failures.push("Gemini is not configured (no API key).");
    } else {
      const configured = gemini.models();
      const preferred = options.config.primaryModel?.trim();
      const models = preferred && !configured.includes(preferred) ? [preferred, ...configured] : preferred ? [preferred, ...configured.filter((m) => m !== preferred)] : configured;

      for (const model of models) {
        try {
          const { data, response } = await withRetry(
            () => requestJson(gemini, model, options, onAttempt, false),
            {
              attempts: attemptsPerModel,
              baseDelayMs: options.baseDelayMs ?? 700,
              sleep: options.sleep,
              onRetry: () => {},
            }
          );
          return { data, provider: "gemini", model: response.model, backupUsed: false, latencyMs: Date.now() - startedAt, usage: response.usage };
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
          const nonRetryableAuth = error instanceof ProviderError && error.options.kind === "auth";
          if (nonRetryableAuth) break; // a bad key will fail on every model
        }
      }
    }

    // ---- 2. Backup: OpenRouter --------------------------------------------
    if (!options.config.backupEnabled) {
      failures.push("Automatic backup is disabled in Settings.");
    } else if (!openrouter.isConfigured()) {
      failures.push("Backup provider is not configured (set OPENROUTER_API_KEY and OPENROUTER_MODEL_ID).");
    } else {
      const models = options.config.backupModel?.trim()
        ? [options.config.backupModel.trim(), ...openrouter.models().filter((m) => m !== options.config.backupModel?.trim())]
        : openrouter.models();
      for (const model of models) {
        try {
          const { data, response } = await withRetry(
            () => requestJson(openrouter, model, options, onAttempt, true),
            { attempts: attemptsPerModel, baseDelayMs: options.baseDelayMs ?? 700, sleep: options.sleep, onRetry: () => {} }
          );
          return { data, provider: "openrouter", model: response.model, backupUsed: true, latencyMs: Date.now() - startedAt, usage: response.usage };
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    throw new ProviderError(`Every AI provider failed. ${failures.slice(-4).join(" | ")}`, {
      provider: openrouter.isConfigured() ? "openrouter" : "gemini",
      retryable: false,
      kind: "unavailable",
    });
  }
}

/** Health summary for the dashboard + settings screen. */
export async function providerStatus(providers: { gemini: AIProvider; openrouter: AIProvider }): Promise<{
  gemini: ProviderHealth;
  openrouter: ProviderHealth;
}> {
  const [gemini, openrouter] = await checkProviderHealth(providers.gemini, providers.openrouter);
  return { gemini, openrouter };
}
