"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveHelpArticle, type HelpArticleFormState } from "./actions";
import type { HelpArticle } from "@/lib/help-center/get-articles";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const initialState: HelpArticleFormState = { error: null, success: false };

export function HelpCenterArticleForm({
  defaults,
  onSaved,
  onCancel,
}: {
  defaults?: HelpArticle;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveHelpArticle, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      if (!defaults) formRef.current?.reset();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">{defaults ? "Edit Article" : "Add Article"}</h2>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && !defaults && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Article added.</p>}

      {defaults && <input type="hidden" name="id" value={defaults.id} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="category">Category *</label>
          <input id="category" name="category" required defaultValue={defaults?.category} className={inputClass} placeholder="e.g. Orders & Documents" />
        </div>
        <div>
          <label className={labelClass} htmlFor="sort_order">Sort Order</label>
          <input id="sort_order" name="sort_order" type="number" defaultValue={defaults?.sort_order ?? 0} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="title">Title / Question *</label>
        <input id="title" name="title" required defaultValue={defaults?.title} className={inputClass} placeholder="How do I ...?" />
      </div>

      <div>
        <label className={labelClass} htmlFor="keywords">Keywords (comma-separated)</label>
        <input id="keywords" name="keywords" defaultValue={defaults?.keywords.join(", ")} className={inputClass} placeholder="order, entry, po number" />
      </div>

      <div>
        <label className={labelClass} htmlFor="answer">Answer *</label>
        <textarea id="answer" name="answer" required rows={4} defaultValue={defaults?.answer} className={inputClass} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="action_href">&ldquo;Go to screen&rdquo; link (optional)</label>
          <input id="action_href" name="action_href" defaultValue={defaults?.action_href ?? ""} className={inputClass} placeholder="/dashboard/orders" />
        </div>
        <div>
          <label className={labelClass} htmlFor="action_label">Button label (optional)</label>
          <input id="action_label" name="action_label" defaultValue={defaults?.action_label ?? ""} className={inputClass} placeholder="Go to Order Entry" />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : defaults ? "Save Changes" : "Add Article"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
