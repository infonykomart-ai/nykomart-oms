import { requireCapability } from "@/lib/auth/require-capability";
import { getHelpArticles } from "@/lib/help-center/get-articles";
import { HelpCenterArticleForm } from "./help-center-article-form";
import { HelpCenterArticleList } from "./help-center-article-list";

// Help Center Admin (2026-08-14) — maintain the FAQ/guide content shown in
// the 🤖 Help Center chat bubble every employee sees. Admin/MD only; the
// Help Center itself needs no capability at all (see help-center-provider.tsx).
export default async function HelpCenterAdminPage() {
  await requireCapability("help_center_admin");
  const articles = await getHelpArticles();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🛠️ Help Center Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage the FAQ/guide articles shown in the 🤖 Help Center chat bubble every employee sees on every dashboard
          page. Rule-based search only — not an AI chat.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <HelpCenterArticleForm />
        </div>
        <div className="lg:col-span-2">
          <HelpCenterArticleList articles={articles} />
        </div>
      </div>
    </div>
  );
}
