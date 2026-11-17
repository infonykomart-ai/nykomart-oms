// 2026-11-18 — Retry helper for AI calls.
//
// Only transient failures are retried (429, 5xx, timeouts, network). An auth
// error or a 400 is returned immediately: retrying a wrong API key just burns
// quota and delays the fallback provider.

import { ProviderError } from "./types";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function shouldRetry(error: unknown): boolean {
  if (error instanceof ProviderError) return error.retryable;
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: number }).status;
    return status === undefined || status === 429 || status >= 500 || status === 408;
  }
  // Unknown errors (fetch network failures, aborts) are treated as transient.
  return true;
}

/** Exponential backoff with a small deterministic-free jitter window. */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.min(250, Math.round(exp * 0.1));
  return Math.min(maxDelayMs, exp + Math.round(Math.random() * jitter));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 700;
  const maxDelayMs = options.maxDelayMs ?? 6000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
