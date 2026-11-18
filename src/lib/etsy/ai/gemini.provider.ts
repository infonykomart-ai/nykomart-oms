// 2026-11-18 — Google Gemini provider (primary).
//
// Uses the official @google/genai SDK, the same dependency the OMS AI companion
// already ships with. Model ids are NEVER hardcoded in call sites: they come
// from settings (per company) or GEMINI_MODEL_ID, with a documented default
// only as a last resort. Keys come from the encrypted per-company credential
// row or GEMINI_API_KEY — this module never touches the browser.

import { GoogleGenAI } from "@google/genai";
import {
  AIProvider,
  AiImage,
  ProviderError,
  ProviderHealth,
  ProviderResponse,
  StructuredRequest,
  classifyStatus,
  isRetryableStatus,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/** Extra model tried when the configured one is unavailable (spec §1.4). */
export const ALTERNATE_GEMINI_MODEL = "gemini-flash-lite-latest";

export type GeminiProviderOptions = {
  apiKey: string | null;
  /** Configured models, in the order they should be tried. */
  models?: string[];
  timeoutMs?: number;
};

const healthCache = new Map<string, { at: number; result: ProviderHealth }>();
const HEALTH_TTL_MS = 5 * 60 * 1000;

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  private readonly apiKey: string | null;
  private readonly configuredModels: string[];
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey?.trim() || null;
    const fromEnv = (process.env.GEMINI_MODEL_ID ?? "").trim();
    this.configuredModels = Array.from(
      new Set([...(options.models ?? []), fromEnv, DEFAULT_GEMINI_MODEL, ALTERNATE_GEMINI_MODEL].map((m) => (m ?? "").trim()).filter(Boolean))
    );
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  models(): string[] {
    return this.configuredModels;
  }

  private client(model?: string): GoogleGenAI {
    if (!this.apiKey) {
      throw new ProviderError("GEMINI_API_KEY is not configured.", {
        provider: "gemini",
        model,
        retryable: false,
        kind: "auth",
      });
    }
    return new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { timeout: this.timeoutMs } });
  }

  async generateStructured(request: StructuredRequest): Promise<ProviderResponse> {
    const models = this.models();
    if (models.length === 0) {
      throw new ProviderError("No Gemini model configured.", { provider: "gemini", retryable: false, kind: "auth" });
    }
    const model = request.model?.trim() || models[0];
    const startedAt = Date.now();

    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    for (const image of request.images ?? []) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
    }

    try {
      const ai = this.client(model);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: parts as never }],
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          temperature: request.temperature ?? 0.6,
          maxOutputTokens: request.maxOutputTokens ?? 8192,
        },
      });
      const text = (response.text ?? "").trim();
      if (!text) {
        throw new ProviderError("Gemini returned an empty response.", {
          provider: "gemini",
          model,
          retryable: true,
          kind: "empty",
        });
      }
      const usage = response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount ?? null,
            outputTokens: response.usageMetadata.candidatesTokenCount ?? null,
          }
        : null;
      // MAX_TOKENS means the listing JSON was cut off mid-object; the manager
      // then retries with a compact request instead of a schema repair.
      const finishReason = String(response.candidates?.[0]?.finishReason ?? "");
      return { provider: "gemini", model, text, usage, latencyMs: Date.now() - startedAt, truncated: finishReason === "MAX_TOKENS" };
    } catch (error) {
      throw toProviderError(error, model);
    }
  }

  /** Real call against the configured model (not just "key present"). Cached 5 min. */
  async checkHealth(): Promise<ProviderHealth> {
    const model = this.models()[0] ?? null;
    if (!this.apiKey || !model) {
      return { ok: false, provider: "gemini", model, error: this.apiKey ? "No model configured." : "GEMINI_API_KEY is not set." };
    }
    const cacheKey = `${model}:${this.apiKey.slice(-6)}`;
    const cached = healthCache.get(cacheKey);
    if (cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.result;

    let result: ProviderHealth;
    try {
      const ai = this.client(model);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: "Reply with the JSON {\"ok\":true} and nothing else." }] }],
        config: { responseMimeType: "application/json", maxOutputTokens: 32, temperature: 0 },
      });
      result = response.text?.trim()
        ? { ok: true, provider: "gemini", model }
        : { ok: false, provider: "gemini", model, error: "Empty response from the model." };
    } catch (error) {
      result = { ok: false, provider: "gemini", model, error: error instanceof Error ? error.message : String(error) };
    }
    healthCache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  /** Model list from the API, used to confirm a configured id really exists. */
  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const ai = this.client();
      const pager = await ai.models.list({ config: { pageSize: 50 } });
      const ids: string[] = [];
      for await (const model of pager) {
        const id = (model.name ?? "").replace(/^models\//, "");
        if (id) ids.push(id);
      }
      return ids;
    } catch {
      return [];
    }
  }
}

function toProviderError(error: unknown, model: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const status =
    error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || undefined : undefined;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const aborted = /abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(text);
  const kind = aborted ? "timeout" : classifyStatus(status);
  const retryable = aborted || isRetryableStatus(status) || /rate.?limit|RESOURCE_EXHAUSTED|quota|overloaded|UNAVAILABLE/i.test(text);
  return new ProviderError(`Gemini (${model}) failed: ${text}`, { provider: "gemini", model, retryable, status, kind });
}

/** Used by the alt-text route: fetch a stored image and inline it for vision. */
export async function fetchImageForVision(url: string): Promise<AiImage> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Image could not be loaded (HTTP ${response.status}).`);
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  // Browsers and CDNs send "image/jpeg; charset=binary" — the parameter is not
  // part of the media type, so compare without it.
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) {
    throw new Error(`Unsupported image type "${contentType}" — use JPEG, PNG, WEBP or GIF.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("Image is larger than 8 MB after download.");
  return { mimeType, dataBase64: buffer.toString("base64") };
}
