// 2026-11-18 — Cost estimation for AI usage logs.
//
// Only models we have published per-million prices for get a number. An unknown
// model records usage tokens but a NULL cost — inventing a price would be worse
// than admitting we do not know it. Any family can be overridden per deployment
// with GEMINI_PRICE_INPUT_PER_M / GEMINI_PRICE_OUTPUT_PER_M and the matching
// OPENROUTER_* variables (USD per 1M tokens).

import { AiUsage } from "./types";

export type ModelPricing = { inputPerMillion: number; outputPerMillion: number };

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gemini-flash-latest": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-flash-lite-latest": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
};

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function pricingFor(model: string, provider: "gemini" | "openrouter"): ModelPricing | null {
  const key = (model ?? "").trim().toLowerCase();
  if (!key) return null;
  const normalized = key.replace(/^models\//, "");

  if (provider === "gemini") {
    const input = envNumber("GEMINI_PRICE_INPUT_PER_M");
    const output = envNumber("GEMINI_PRICE_OUTPUT_PER_M");
    if (input !== null && output !== null) return { inputPerMillion: input, outputPerMillion: output };
    if (DEFAULT_PRICING[normalized]) return DEFAULT_PRICING[normalized];
    // gemini-2.5-flash-001 etc. — match the family prefix.
    const family = Object.keys(DEFAULT_PRICING).find((m) => normalized.startsWith(m));
    return family ? DEFAULT_PRICING[family] : null;
  }

  const input = envNumber("OPENROUTER_PRICE_INPUT_PER_M");
  const output = envNumber("OPENROUTER_PRICE_OUTPUT_PER_M");
  if (input !== null && output !== null) return { inputPerMillion: input, outputPerMillion: output };
  return null;
}

/** USD cost, or null when tokens or pricing are unknown. */
export function estimateCostUsd(model: string, provider: "gemini" | "openrouter", usage: AiUsage | null): number | null {
  if (!usage) return null;
  const pricing = pricingFor(model, provider);
  if (!pricing) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const cost = (input / 1_000_000) * pricing.inputPerMillion + (output / 1_000_000) * pricing.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
