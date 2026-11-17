// 2026-11-18 — Provider contract for the Etsy SEO Generator.
//
// The application never imports a provider SDK directly: routes and services go
// through AIProviderManager (./ai-provider.manager.ts), which owns the
// Gemini → OpenRouter fallback and records which provider actually answered.
// API keys are read server-side only (env var or the encrypted per-company
// credential row) — nothing here is ever sent to the browser.

export type AiProviderName = "gemini" | "openrouter";

export type AiImage = {
  /** e.g. image/jpeg */
  mimeType: string;
  /** Base64 (no data: prefix). */
  dataBase64: string;
};

export type StructuredRequest = {
  system: string;
  /** Optional explicit model id; providers otherwise use their first model. */
  model?: string;
  prompt: string;
  images?: AiImage[];
  temperature?: number;
  /** Max output tokens, when the provider supports it. */
  maxOutputTokens?: number;
  /** Abort the provider call after this many ms. */
  timeoutMs?: number;
};

export type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ProviderResponse = {
  provider: AiProviderName;
  model: string;
  text: string;
  usage: AiUsage | null;
  latencyMs: number;
};

export type ProviderHealth = {
  ok: boolean;
  provider: AiProviderName;
  model: string | null;
  error?: string;
};

export interface AIProvider {
  readonly name: AiProviderName;
  /** Configured = key present (env or encrypted row). Never means "working". */
  isConfigured(): boolean;
  /** Model ids this provider will try, in order. */
  models(): string[];
  /** Structured JSON request. Implementations must throw ProviderError. */
  generateStructured(request: StructuredRequest): Promise<ProviderResponse>;
  checkHealth(): Promise<ProviderHealth>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      provider: AiProviderName;
      model?: string;
      /** 429 / 5xx / network / timeout are retryable; 4xx are not. */
      retryable: boolean;
      status?: number;
      kind?: "timeout" | "rate_limit" | "unavailable" | "auth" | "http" | "network" | "empty";
    }
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.options.retryable;
  }
}

/** Classify an HTTP status into the retryable/terminal decision. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (!status) return true; // network/timeout — worth one more try
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function classifyStatus(status: number | undefined): "timeout" | "rate_limit" | "unavailable" | "auth" | "http" {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (!status || status === 408 || status >= 500) return "unavailable";
  return "http";
}
