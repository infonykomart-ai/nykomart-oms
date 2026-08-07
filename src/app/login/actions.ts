"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type LoginState = { error: string | null };

/**
 * Signs in via Supabase Auth (email + password), matching the old system's
 * verifyLogin() gate — but the actual capability check happens per-page via
 * requireCapability(), not here. This just establishes "who is this".
 */
export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Both email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Login failed — incorrect email or password." };
  }

  redirect("/dashboard");
}
