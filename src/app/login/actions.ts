"use server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { recordPunchIn } from "@/lib/attendance/punch";

export type LoginState = { error: string | null };

/**
 * Signs in via Supabase Auth (email + password), matching the old system's
 * verifyLogin() gate — but the actual capability check happens per-page via
 * requireCapability(), not here. This just establishes "who is this".
 *
 * 2026-08-11: "EMPLOYEE KI SYSTEM KO LOGIN KARTE HI PERSENT LAG JAYE" —
 * auto-punch-in right after a successful login, best-effort (never blocks
 * or fails the login itself if this write has a problem — attendance is
 * important but must never be the reason someone can't get into the app).
 * Idempotent: if today's row already has a punch_in (e.g. a second login
 * the same day), recordPunchIn() leaves it untouched.
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Both email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Login failed — incorrect email or password." };
  }

  try {
    if (data.user) {
      const service = createServiceRoleClient();
      const { data: employee } = await service
        .from("employees")
        .select("id, company_id")
        .eq("auth_user_id", data.user.id)
        .eq("active", true)
        .maybeSingle();
      if (employee) {
        await recordPunchIn(service, employee.id, employee.company_id, "Web Punch");
      }
    }
  } catch {
    // Never let an attendance hiccup block a successful login.
  }

  redirect("/dashboard");
}
