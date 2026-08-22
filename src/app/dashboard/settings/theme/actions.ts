"use server";

// 2026-08-22 — Dashboard theme system: save the signed-in employee's own
// theme + custom accent color preference.
//
// Deliberately NOT requireCapability()-gated — matches "My Profile"
// (src/app/dashboard/profile/actions.ts) and the Help Center/Messages
// precedent noted in capability-info.ts: every signed-in employee may set
// their OWN theme, no admin approval needed, per the build spec ("No new
// capability needed — every logged-in employee can set their own theme").
// getAuthedEmployee() still resolves + verifies the session; the write
// below is hard-scoped `.eq("id", employee.id)` — the ID the SERVER read
// back from the session, never client-supplied — so there is no way this
// action can ever touch another employee's row, same reasoning as
// updateMyProfile.
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { isThemeId, isValidHexColor, type ThemeId } from "@/lib/theme/themes";

export type SaveThemeInput = {
  themeId?: ThemeId;
  /** Pass null to clear the custom accent and fall back to the theme's own. */
  customAccentColor?: string | null;
};

export type SaveThemeResult = { error: string | null };

export async function saveThemePreference(input: SaveThemeInput): Promise<SaveThemeResult> {
  const employee = await getAuthedEmployee();

  const update: { theme_id?: string; custom_accent_color?: string | null } = {};

  if (input.themeId !== undefined) {
    if (!isThemeId(input.themeId)) return { error: "Unknown theme." };
    update.theme_id = input.themeId;
  }

  if (input.customAccentColor !== undefined) {
    if (input.customAccentColor !== null && !isValidHexColor(input.customAccentColor)) {
      return { error: "Custom accent color must be a valid hex color (e.g. #d9a441)." };
    }
    update.custom_accent_color = input.customAccentColor;
  }

  if (Object.keys(update).length === 0) return { error: null };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("employees").update(update).eq("id", employee.id);

  if (error) return { error: error.message };

  // Every dashboard page renders inside the themed shell (dashboard/
  // layout.tsx), so the whole subtree needs the fresh value on next
  // navigation/reload — same broad revalidation the company-switch action
  // uses, for the same reason (BRAIN.md §4 calls that one out as the one
  // deliberately broad revalidatePath in the app).
  revalidatePath("/dashboard", "layout");

  return { error: null };
}
