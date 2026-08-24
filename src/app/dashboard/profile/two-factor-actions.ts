"use server";

// 2FA (TOTP), 2026-08-24 — self-service enroll/unenroll from My Profile.
// Uses Supabase Auth's built-in MFA (auth.mfa.*) rather than a hand-rolled
// implementation — same primitives whether called from the browser or,
// as here, server-side via the SSR session-bound client (createClient()),
// since these are just signed calls against the session's access token.
// See src/lib/auth/require-capability.ts for how a verified factor is then
// ENFORCED (requires AAL2 to reach any /dashboard page) and
// src/app/login/verify-2fa/ for the login-time challenge step.
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SimpleResult = { error: string | null };

export type TwoFactorStatus = { enrolled: boolean; factorId: string | null };

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return { enrolled: false, factorId: null };
  const verified = data.all.find((f) => f.factor_type === "totp" && f.status === "verified");
  return { enrolled: !!verified, factorId: verified?.id ?? null };
}

export type EnrollResult = { error: string | null; qrCode: string | null; secret: string | null; factorId: string | null };

export async function enrollTwoFactor(): Promise<EnrollResult> {
  const supabase = await createClient();

  // A stale unverified factor from an abandoned enroll attempt blocks a
  // fresh one (Supabase allows only one in-progress unverified TOTP factor
  // at a time) — clean those up first so "start over" always works.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  const stale = existing?.all.find((f) => f.factor_type === "totp" && f.status === "unverified");
  if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) return { error: error?.message ?? "Could not start 2FA setup.", qrCode: null, secret: null, factorId: null };
  return { error: null, qrCode: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
}

export async function confirmTwoFactorEnrollment(factorId: string, code: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/profile");
  return { error: null };
}

export async function unenrollTwoFactor(factorId: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/profile");
  return { error: null };
}
