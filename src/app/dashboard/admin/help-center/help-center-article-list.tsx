"use client";

import { useState, useTransition } from "react";
import { deleteHelpArticle } from "./actions";
import { HelpCenterArticleForm } from "./help-center-article-form";
import type { HelpArticle } from "@/lib/help-center/get-articles";

export function HelpCenterArticleList({ articles }: { articles: HelpArticle[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteHelpArticle(id);
      if (r.error) setError(r.error);
      setDeletingId(null);
    });
  }

  const grouped = new Map<string, HelpArticle[]>();
  for (const a of articles) {
    const list = grouped.get(a.category) ?? [];
    list.push(a);
    grouped.set(a.category, list);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">All Articles ({articles.length})</h2>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="divide-y divide-slate-100">
        {articles.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-400">No articles yet.</p>}
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category} className="px-5 py-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{category}</div>
            <div className="space-y-2">
              {items.map((a) =>
                editingId === a.id ? (
                  <HelpCenterArticleForm key={a.id} defaults={a} onSaved={() => setEditingId(null)} onCancel={() => setEditingId(null)} />
                ) : (
                  <div key={a.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{a.title}</div>
                        <p className="mt-0.5 text-xs text-slate-500">{a.answer}</p>
                        {a.action_href && (
                          <p className="mt-1 text-[11px] text-amber-600">
                            → {a.action_label ?? "Go to screen"} ({a.action_href})
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button type="button" onClick={() => setEditingId(a.id)} className="text-slate-500 hover:text-amber-600 hover:underline">
                          Edit
                        </button>
                        {deletingId === a.id ? (
                          <span className="inline-flex gap-2">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleDelete(a.id)}
                              className="font-semibold text-red-600 hover:underline"
                            >
                              Confirm
                            </button>
                            <button type="button" onClick={() => setDeletingId(null)} className="text-slate-400 hover:underline">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setDeletingId(a.id)} className="text-slate-400 hover:text-red-600 hover:underline">
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
