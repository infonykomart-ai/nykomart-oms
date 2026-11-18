// 2026-11-18 — Turn a provider failure into something an operator can act on.
//
// Raw vendor text ("Gemini (gemini-flash-latest) failed: Error: 403 PERMISSION
// DENIED") is useful in the usage log but useless in a toast. This module maps
// the failure to ONE actionable diagnosis: a short title, the exact env var(s)
// to fix on the deployment and what to do after changing them.
//
// Nothing here calls a provider or invents a cause: the diagnosis is chosen from
// the structured failures the manager already recorded (status + kind + message),
// and falls back to pattern matching for health-check strings.

import { ProviderError, type AiProviderName, type ProviderFailure } from "./types";

export type ProviderDiagnosticCode =
  | "provider_not_configured"
  | "model_not_configured"
  | "invalid_api_key"
  | "model_not_found"
  | "quota_exceeded"
  | "output_truncated"
  | "provider_unavailable"
  | "timeout"
  | "invalid_output"
  | "provider_failed";

export type ProviderDiagnostic = {
  code: ProviderDiagnosticCode;
  /** Short, factual headline — safe to show in the UI. */
  title: string;
  /** Same as title plus the affected provider, used as the API `error` string. */
  message: string;
  /** What the operator should change, with the exact env var names. */
  fix: string;
  envVars: string[];
  provider: AiProviderName | null;
  /** HTTP status the route should return for this diagnosis. */
  status: number;
  retryable: boolean;
  /** Raw vendor text (trimmed) for debugging / API consumers. */
  detail: string | null;
};

type Rule = { code: ProviderDiagnosticCode; test: RegExp };

// Ordered by actionability: the first match wins, so a message that mentions
// both an invalid key and a 403 is reported as an invalid key, not as an
// outage. Each pattern is deliberately narrow — a false positive sends the
// operator to the wrong setting.
const RULES: Rule[] = [
  {
    code: "provider_not_configured",
    test: /(gemini|openrouter)[_ ]api[_ ]key is not (configured|set)|no (gemini|openrouter) api key|api key is not set/i,
  },
  {
    code: "model_not_configured",
    test: /(openrouter|gemini)[_ ]model_id is not (configured|set)|no gemini model configured|model id is not configured/i,
  },
  {
    code: "invalid_api_key",
    test: /api[_ ]key not valid|api key not valid|incorrect api key|invalid api key|api_key_invalid|unauthenticated|permission_denied|permission denied|\b401\b|\b403\b/i,
  },
  {
    code: "model_not_found",
    test: /\b404\b|not found|does not exist|no endpoints found|unknown model|not supported for|unsupported model/i,
  },
  {
    code: "quota_exceeded",
    test: /resource_exhausted|\b429\b|quota|rate.?limit|too many requests|insufficient credits|payment required|\b402\b/i,
  },
  {
    code: "output_truncated",
    test: /ran out of output tokens|truncated at the model's limit|output-token limit|finish.?reason[=_ ]?(length|max_tokens)|\bmax_tokens\b/i,
  },
  {
    code: "timeout",
    test: /timeout|timed out|aborted|abort|etimedout|econnreset|fetch failed|network error/i,
  },
  {
    code: "invalid_output",
    test: /did not pass validation|schema validation failed|invalid json|empty response|return only corrected json|failed validation:/i,
  },
  {
    code: "provider_unavailable",
    test: /\b50[0234]\b|unavailable|overloaded|internal error|bad gateway|service unavailable|try again later/i,
  },
];

const PRIORITY: ProviderDiagnosticCode[] = [
  "invalid_api_key",
  "provider_not_configured",
  "model_not_configured",
  "model_not_found",
  "quota_exceeded",
  "output_truncated",
  "provider_unavailable",
  "timeout",
  "invalid_output",
  "provider_failed",
];

function detectProvider(text: string, hint?: AiProviderName | null): AiProviderName | null {
  if (hint) return hint;
  if (/openrouter/i.test(text)) return "openrouter";
  if (/gemini/i.test(text)) return "gemini";
  return null;
}

function detectCode(text: string): ProviderDiagnosticCode {
  for (const rule of RULES) if (rule.test.test(text)) return rule.code;
  return "provider_failed";
}

function providerLabel(provider: AiProviderName | null): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "openrouter") return "OpenRouter";
  return "The AI provider";
}

function keyVar(provider: AiProviderName | null): string {
  return provider === "openrouter" ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
}

function modelVar(provider: AiProviderName | null): string {
  return provider === "openrouter" ? "OPENROUTER_MODEL_ID" : "GEMINI_MODEL_ID";
}

const REDEPLOY_NOTE = "Env changes only apply after a new build, so redeploy from Vercel → Deployments → Redeploy.";

/** The one diagnosis to show for this failure. */
export function explainProviderError(error: unknown, fallbackProvider?: AiProviderName | null): ProviderDiagnostic {
  const failures: ProviderFailure[] = error instanceof ProviderError ? (error.options.failures ?? []) : [];
  const primaryMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : error ? String(error) : "";

  const candidates: Array<{ provider: AiProviderName | null; model?: string; text: string; status?: number }> =
    failures.length > 0
      ? failures.map((failure) => ({
          provider: failure.provider ?? null,
          model: failure.model,
          text: failure.message,
          status: failure.status,
        }))
      : [{ provider: fallbackProvider ?? null, model: undefined, text: primaryMessage, status: undefined }];

  // Score every candidate, then pick the most actionable diagnosis. Within the
  // same code the earliest failure wins (that is the primary provider).
  let chosen: { code: ProviderDiagnosticCode; provider: AiProviderName | null; model?: string; text: string } | null = null;
  let chosenRank = PRIORITY.length;
  for (const candidate of candidates) {
    const code = detectCode(candidate.text);
    const rank = PRIORITY.indexOf(code);
    if (rank < chosenRank) {
      chosen = { code, provider: detectProvider(candidate.text, candidate.provider), model: candidate.model, text: candidate.text };
      chosenRank = rank;
    }
  }

  const code = chosen?.code ?? "provider_failed";
  const provider = chosen?.provider ?? detectProvider(primaryMessage, fallbackProvider) ?? null;
  const label = providerLabel(provider);
  const detail = (chosen?.text ?? primaryMessage).trim().slice(0, 400) || null;
  // Providers put the model in the structured failure; health-check strings and
  // older messages only have it inside "Provider (model) failed: …".
  const modelHint = chosen?.model ?? /[(\[]([^)\]]+)[)\]]/.exec(chosen?.text ?? "")?.[1] ?? null;

  switch (code) {
    case "provider_not_configured": {
      const envVars = provider === "openrouter" ? ["OPENROUTER_API_KEY", "OPENROUTER_MODEL_ID"] : ["GEMINI_API_KEY"];
      return {
        code,
        title: `${label} API key is missing.`,
        message: `${label} API key is missing — nothing was generated.`,
        fix:
          provider === "openrouter"
            ? `Add OPENROUTER_API_KEY and OPENROUTER_MODEL_ID under Vercel → Settings → Environment Variables (tick Production and Preview), then redeploy. A key alone is not enough: the model id must be set too.`
            : `Add GEMINI_API_KEY under Vercel → Settings → Environment Variables (tick Production and Preview), then redeploy. ${REDEPLOY_NOTE}`,
        envVars,
        provider,
        status: 503,
        retryable: false,
        detail,
      };
    }
    case "model_not_configured":
      return {
        code,
        title: `${label} model id is missing.`,
        message: `${label} model id is missing — a key without a model cannot be used.`,
        fix: `Set ${modelVar(provider)} in Vercel to the exact model slug (OpenRouter: from openrouter.ai/models, Gemini: from Google AI Studio), or set the model in Settings → AI providers. ${REDEPLOY_NOTE}`,
        envVars: [modelVar(provider)],
        provider,
        status: 503,
        retryable: false,
        detail,
      };
    case "invalid_api_key":
      return {
        code,
        title: `${label} rejected the API key.`,
        message: `${label} rejected the API key (401/403) — check the key on Vercel.`,
        fix: `Replace ${keyVar(provider)} in Vercel with a fresh key (no surrounding quotes or spaces) from ${
          provider === "openrouter" ? "openrouter.ai/keys" : "Google AI Studio → API keys"
        }, then redeploy. If Settings → AI providers stores a company key, that encrypted key overrides the env var — test it there too.`,
        envVars: [keyVar(provider)],
        provider,
        status: 503,
        retryable: false,
        detail,
      };
    case "model_not_found":
      return {
        code,
        title: `${label} model not found${modelHint ? ` (${modelHint})` : ""}.`,
        message: `${label} does not recognise the configured model — the key may be valid but the model id is wrong or retired.`,
        fix: `Correct ${modelVar(provider)} in Vercel to a model this key can access (${
          provider === "openrouter"
            ? "e.g. google/gemini-2.5-flash — copy the exact slug from openrouter.ai/models"
            : "e.g. gemini-flash-latest — check the id in Google AI Studio"
        }), or clear it to fall back to the default, then redeploy.`,
        envVars: [modelVar(provider)],
        provider,
        status: 502,
        retryable: false,
        detail,
      };
    case "quota_exceeded":
      return {
        code,
        title: `${label} quota or credits exhausted.`,
        message: `${label} refused the request because the quota or credit balance is used up (429).`,
        fix:
          provider === "openrouter"
            ? "Top up the OpenRouter credit balance (openrouter.ai/credits) or switch to Gemini as primary; the monthly AI budget in Settings is a separate app-side limit."
            : "Wait for the quota window to reset, or raise the quota/enable billing for this key's Google Cloud project. If the monthly AI budget in Settings is the limit, raise it there.",
        envVars: [],
        provider,
        status: 429,
        retryable: true,
        detail,
      };
    case "output_truncated":
      return {
        code,
        title: `${label} ran out of output tokens.`,
        message: `${label} stopped at the model's output-token limit before the listing JSON was complete — nothing was saved.`,
        fix: `Retry once: the app already retried with a compact description. If it repeats, the configured model's output limit is too small for a full listing — set ${modelVar(provider)} to a model with a larger output limit (${
          provider === "openrouter"
            ? "openrouter/free routes to a random free model per request and several of them cap output; pin a fixed slug such as google/gemini-2.5-flash"
            : "or leave it blank to use the default"
        }) and redeploy. ${REDEPLOY_NOTE}`,
        envVars: [modelVar(provider)],
        provider,
        status: 502,
        retryable: true,
        detail,
      };
    case "timeout":
      return {
        code,
        title: `${label} timed out.`,
        message: `${label} did not answer in time — the request was aborted.`,
        fix: "Retry once. If it keeps timing out, choose a faster model id in Settings → AI providers (Flash/Lite class) and check the deployment region's outbound network.",
        envVars: [],
        provider,
        status: 504,
        retryable: true,
        detail,
      };
    case "invalid_output":
      return {
        code,
        title: `${label} returned unusable content.`,
        message: `${label} answered, but the reply failed the JSON contract twice (first try + one repair pass).`,
        fix: "Retry the generation. If it repeats for one market, set a stronger primary model in Settings → AI providers (or check a backup model that actually supports JSON mode); the usage log keeps the raw reply per attempt.",
        envVars: [],
        provider,
        status: 502,
        retryable: true,
        detail,
      };
    case "provider_unavailable":
      return {
        code,
        title: `${label} is temporarily unavailable.`,
        message: `${label} returned a 5xx/overload error — this is vendor-side, not your configuration.`,
        fix: "Retry in a minute. With backup enabled and OPENROUTER_API_KEY + OPENROUTER_MODEL_ID set, the request fails over automatically; otherwise enable backup in Settings.",
        envVars: [],
        provider,
        status: 502,
        retryable: true,
        detail,
      };
    default:
      return {
        code: "provider_failed",
        title: `${label} failed.`,
        message: `${label} failed and no output was saved.`,
        fix: `Open Settings → AI providers and run Test Gemini / Test OpenRouter for the exact vendor response, then check Vercel → Logs for the same request id.`,
        envVars: [],
        provider,
        status: 502,
        retryable: false,
        detail,
      };
  }
}

/** Response body fields the routes add next to `error` (never includes a key). */
export function diagnosticBody(diagnostic: ProviderDiagnostic) {
  return {
    code: diagnostic.code,
    title: diagnostic.title,
    fix: diagnostic.fix,
    envVars: diagnostic.envVars,
    provider: diagnostic.provider,
    retryable: diagnostic.retryable,
    detail: diagnostic.detail,
  };
}
