"use server";

// 2FA login challenge, 2026-08-24 — the second step after a correct
// password sign-in when the account has a verified TOTP factor enrolled.
// dashboard/layout.tsx redirects here (via MfaRequiredError, see
// src/lib/auth/require-capability.ts) instead of letting the session
// through, so this page/action is the only way past that redirect.
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type VerifyTwoFactorState = { error: string | null };

export async function verifyTwoFactorLogin(
  _prevState: VerifyTwoFactorState,
  formData: FormData
): Promise<VerifyTwoFactorState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return { error: "Enter the 6-digit code from your authenticator app." };
  }

  const supabase = await createClient();

  // Re-check there's actually a signed-in user — someone landing on this
  // page with no session at all (bookmarked link, expired session) should
  // go back to the plain login form, not see a confusing code-entry error.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError || !factors) {
    return { error: "Could not load your 2FA setup. Please try again." };
  }
  const factor = factors.all.find((f) => f.factor_type === "totp" && f.status === "verified");
  if (!factor) {
    // No verified factor on this account after all — nothing to challenge
    // against, so there's no reason to keep them stuck on this page.
    redirect("/dashboard");
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return { error: "That code didn't match. Check your authenticator app and try again." };
  }

  redirect("/dashboard");
}
