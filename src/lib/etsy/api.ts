// 2026-11-18 — Shared helpers for the Etsy SEO Generator's route handlers:
// authentication + capability, consistent error bodies, body parsing and a
// per-process rate limiter.
//
// The rate limiter is in-memory on purpose: it is a cheap guard for one
// serverless instance, not a distributed quota. The monthly AI budget
// (etsy_seo_settings.monthly_budget_usd) is the durable cost control.

import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError, requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";

export type ApiError = {
  error: string;
  code?: string;
  issues?: string[];
  /** Short headline for provider failures (see lib/etsy/ai/diagnostics.ts). */
  title?: string;
  /** Actionable instruction naming the env var(s) to fix. */
  fix?: string;
  envVars?: string[];
  provider?: string | null;
  retryable?: boolean;
  detail?: string | null;
};

export function jsonError(message: string, status: number, extra: Omit<ApiError, "error"> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Authenticate + require the module capability. Returns a response on failure. */
export async function requireEtsySeoEmployee(): Promise<{ employee: AuthedEmployee } | { response: NextResponse }> {
  try {
    const employee = await requireCapability("etsy_seo_generator");
    return { employee };
  } catch (error) {
    if (error instanceof UnauthorizedError) return { response: jsonError("Not signed in.", 401) };
    if (error instanceof ForbiddenError) return { response: jsonError(error.message, 403) };
    throw error;
  }
}

export async function readJsonBody<T>(request: Request): Promise<{ body: T } | { response: NextResponse }> {
  try {
    const body = (await request.json()) as T;
    if (!body || typeof body !== "object") return { response: jsonError("Invalid request body.", 400) };
    return { body };
  } catch {
    return { response: jsonError("Invalid JSON body.", 400) };
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Allow `limit` calls per `windowMs` for one key (employee + bucket). */
export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

export function rateLimited(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: `Too many requests — try again in ${retryAfterSeconds}s.`, code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/** Reject oversized bodies before parsing (spec §21 request size limits). */
export function tooLarge(request: Request, maxBytes: number): boolean {
  const length = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(length) && length > maxBytes;
}
