"use server";

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type HelpArticleFormState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function keywordsOf(formData: FormData): string[] {
  return str(formData, "keywords")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function saveHelpArticle(_prev: HelpArticleFormState, formData: FormData): Promise<HelpArticleFormState> {
  await requireCapability("help_center_admin");
  const supabase = createServiceRoleClient();

  const id = strOrNull(formData, "id");
  const category = str(formData, "category");
  const title = str(formData, "title");
  const answer = str(formData, "answer");
  if (!category || !title || !answer) {
    return { error: "Category, Title, and Answer are required.", success: false };
  }

  const row = {
    category,
    title,
    answer,
    keywords: keywordsOf(formData),
    action_href: strOrNull(formData, "action_href"),
    action_label: strOrNull(formData, "action_label"),
    sort_order: Number(str(formData, "sort_order")) || 0,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("help_articles").update(row).eq("id", id)
    : await supabase.from("help_articles").insert(row);

  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/admin/help-center");
  revalidatePath("/dashboard");
  return { error: null, success: true };
}

export async function deleteHelpArticle(id: string): Promise<{ error: string | null }> {
  await requireCapability("help_center_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("help_articles").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin/help-center");
  revalidatePath("/dashboard");
  return { error: null };
}
