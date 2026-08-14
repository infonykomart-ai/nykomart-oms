import { createServiceRoleClient } from "@/lib/supabase/server";

export type HelpArticle = {
  id: string;
  category: string;
  title: string;
  keywords: string[];
  answer: string;
  action_href: string | null;
  action_label: string | null;
  sort_order: number;
};

// Every signed-in employee can read every article (no capability gate,
// same reasoning as My Profile) — read via the service-role client for
// consistency with the rest of this project's newer reads, since this runs
// on every dashboard page load (inside the layout) and must never come back
// silently empty because of an RLS policy gap.
export async function getHelpArticles(): Promise<HelpArticle[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("help_articles")
    .select("id, category, title, keywords, answer, action_href, action_label, sort_order")
    .order("category")
    .order("sort_order");
  // keywords is a Postgres text[] column — the hand-rolled type generator
  // (scripts/gen-types.mjs) emits array columns as `unknown[]` since it
  // doesn't introspect element types, same as every other array column in
  // this codebase's generated Database type.
  return (data ?? []).map((a) => ({ ...a, keywords: (a.keywords ?? []) as string[] }));
}
