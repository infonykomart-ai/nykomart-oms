"use client";

// 2026-08-14: "sabhi employe ko agar system ke bare me kuch puchna ho to
// chat boat khul jaye" — a chat-style Help Center. Per the user's explicit
// choice this round (and the same 2026-08-01 decision already made once
// for the old system), this is a RULE-BASED searchable FAQ/guide system —
// NOT a real AI chat — so there's no per-message cost and no API key to
// manage. It just *looks and opens* like a chat window: a floating bubble
// button on every dashboard page, opening a slide-over panel with a search
// box over a fixed set of articles (see help_articles table / Help Center
// Admin screen), each optionally jumping straight to the real screen.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HelpArticle } from "@/lib/help-center/get-articles";

function matches(article: HelpArticle, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (article.title.toLowerCase().includes(q)) return true;
  if (article.category.toLowerCase().includes(q)) return true;
  if (article.answer.toLowerCase().includes(q)) return true;
  return article.keywords.some((k) => k.toLowerCase().includes(q));
}

export function HelpCenterProvider({ articles, children }: { articles: HelpArticle[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const router = useRouter();

  const filtered = useMemo(() => articles.filter((a) => matches(a, query)), [articles, query]);
  const grouped = useMemo(() => {
    const map = new Map<string, HelpArticle[]>();
    for (const a of filtered) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <>
      {children}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Help"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-2xl text-white shadow-lg shadow-amber-500/30 transition hover:scale-105 hover:bg-amber-600"
      >
        {open ? "✕" : "🤖"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Help Center</div>
              <div className="text-xs text-slate-400">Ask a question — I&apos;ll point you to the right screen.</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>

          <div className="border-b border-slate-100 px-3 py-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your question... e.g. how do I punch in"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {grouped.length === 0 && (
              <p className="mt-6 text-center text-sm text-slate-400">
                No matching help articles. Try different words, or ask an Admin/MD directly via Messages.
              </p>
            )}
            {grouped.map(([category, items]) => (
              <div key={category} className="mb-3">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{category}</div>
                <div className="space-y-1.5">
                  {items.map((a) => {
                    const isOpen = expandedId === a.id;
                    return (
                      <div key={a.id} className="rounded-lg border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : a.id)}
                          className="w-full px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-100"
                        >
                          {a.title}
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3">
                            <p className="whitespace-pre-line text-xs leading-relaxed text-slate-600">{a.answer}</p>
                            {a.action_href && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpen(false);
                                  router.push(a.action_href!);
                                }}
                                className="mt-2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                              >
                                {a.action_label ?? "Go to this screen"} →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
