"use server";

// 2026-09-05, round 2 — "ISKA NAAM SABHI EMPLOYE APNEHISAB SE DECIDE KAR
// SAKTE HAI": every employee can pick their OWN name for their AI
// Companion. Self-service, no admin approval — exactly the same pattern
// (and the same reasoning) as saveThemePreference
// (src/app/dashboard/settings/theme/actions.ts): NOT requireCapability()-
// gated, getAuthedEmployee() alone verifies the session, and the write is
// hard-scoped `.eq("id", employee.id)` — the ID the SERVER read back from
// the session, never client-supplied — so this can never touch another
// employee's row.
//
// Called from the chat panel header (companion-chat-panel.tsx), not a
// settings page — renaming your own companion is a one-off, low-stakes
// action that belongs right next to the thing being renamed.
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SetCompanionNameResult = { error: string | null };

const MAX_NAME_LENGTH = 24;

export async function setCompanionName(name: string | null): Promise<SetCompanionNameResult> {
  const employee = await getAuthedEmployee();

  const trimmed = name?.trim() || null;
  if (trimmed && trimmed.length > MAX_NAME_LENGTH) {
    return { error: `Name is too long — keep it under ${MAX_NAME_LENGTH} characters.` };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("employees").update({ companion_name: trimmed }).eq("id", employee.id);
  if (error) return { error: error.message };

  // The companion's name is read once at layout load (dashboard/layout.tsx)
  // and handed down as a prop — same broad revalidation reasoning as
  // saveThemePreference, so the very next navigation/reload already shows
  // the new name everywhere it's used (dock aria-label, chat panel, and the
  // chatbot's own system prompt).
  revalidatePath("/dashboard", "layout");

  return { error: null };
}
