// 2026-11-18 — OpenRouter provider (optional backup, spec §1 + §18).
//
// Only used when the company enabled backup AND an OpenRouter key is configured.
// Both the key and the model are configuration, never constants: a hardcoded
// model would silently start failing whenever the vendor retires it.

import {
  AIProvider,
  ProviderError,
  ProviderHealth,
  ProviderResponse,
  StructuredRequest,
  classifyStatus,
  isRetryableStatus,
} from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterProviderOptions = {
  apiKey: string | null;
  models?: string[];
  timeoutMs?: number;
  appUrl?: string;
};

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter" as const;
  private readonly apiKey: string | null;
  private readonly configuredModels: string[];
  private readonly timeoutMs: number;
  private readonly appUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey?.trim() || null;
    const envModel = (process.env.OPENROUTER_MODEL_ID ?? "").trim();
    this.configuredModels = Array.from(new Set([...(options.models ?? []), envModel].map((m) => (m ?? "").trim()).filter(Boolean)));
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.appUrl = options.appUrl ?? process.env.APP_BASE_URL ?? "https://localhost";
  }

  isConfigured(): boolean {
    // A key without a model id is not usable — say so instead of guessing one.
    return !!this.apiKey && this.configuredModels.length > 0;
  }

  models(): string[] {
    return this.configuredModels;
  }

  async generateStructured(request: StructuredRequest): Promise<ProviderResponse> {
    if (!this.apiKey) {
      throw new ProviderError("OPENROUTER_API_KEY is not configured.", { provider: "openrouter", retryable: false, kind: "auth" });
    }
    if (this.configuredModels.length === 0) {
      throw new ProviderError("OPENROUTER_MODEL_ID is not configured.", { provider: "openrouter", retryable: false, kind: "auth" });
    }
    const model = request.model?.trim() || this.configuredModels[0];
    const startedAt = Date.now();

    const content: Array<Record<string, unknown>> = [{ type: "text", text: request.prompt }];
    for (const image of request.images ?? []) {
      content.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } });
    }

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.appUrl,
          "X-Title": "Etsy International SEO Generator",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content },
          ],
          response_format: { type: "json_object" },
          temperature: request.temperature ?? 0.6,
          max_tokens: request.maxOutputTokens ?? 8192,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(`OpenRouter responded ${response.status}: ${body.slice(0, 300)}`, {
          provider: "openrouter",
          model,
          retryable: isRetryableStatus(response.status),
          status: response.status,
          kind: classifyStatus(response.status),
        });
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = (payload.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        throw new ProviderError("OpenRouter returned an empty response.", { provider: "openrouter", model, retryable: true, kind: "empty" });
      }
      return {
        provider: "openrouter",
        model,
        text,
        usage: payload.usage
          ? { inputTokens: payload.usage.prompt_tokens ?? null, outputTokens: payload.usage.completion_tokens ?? null }
          : null,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new ProviderError(`OpenRouter (${model}) failed: ${text}`, {
        provider: "openrouter",
        model,
        retryable: true,
        kind: /abort|timeout/i.test(text) ? "timeout" : "network",
      });
    }
  }

  async checkHealth(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        provider: "openrouter",
        model: this.configuredModels[0] ?? null,
        error: !this.apiKey ? "OPENROUTER_API_KEY is not set." : "OPENROUTER_MODEL_ID is not set.",
      };
    }
    try {
      const result = await this.generateStructured({
        system: "Return JSON only.",
        prompt: 'Reply with {"ok":true}.',
        temperature: 0,
        maxOutputTokens: 32,
      });
      return { ok: !!result.text, provider: "openrouter", model: result.model };
    } catch (error) {
      return { ok: false, provider: "openrouter", model: this.configuredModels[0] ?? null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
