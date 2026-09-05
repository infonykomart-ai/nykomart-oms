"use client";

import { useState, useTransition } from "react";
import { setCompanionEnabled, generateCompanionCharacterImage } from "./actions";

type EmployeeRow = {
  id: string;
  name: string;
  roleName: string;
  active: boolean;
  photoUrl: string | null;
  companionEnabled: boolean;
};

function initialsOf(name: string): string {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function CompanionAccessClient({
  employees,
  initialImageUrl,
  initialPrompt,
  initialGeneratedAt,
}: {
  employees: EmployeeRow[];
  initialImageUrl: string | null;
  initialPrompt: string | null;
  initialGeneratedAt: string | null;
}) {
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(
    Object.fromEntries(employees.map((e) => [e.id, e.companionEnabled]))
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(id: string) {
    const next = !enabledMap[id];
    setError(null);
    setPendingId(id);
    // Optimistic — flip immediately, roll back only if the server refuses.
    setEnabledMap((prev) => ({ ...prev, [id]: next }));
    startTransition(async () => {
      const result = await setCompanionEnabled(id, next);
      if (result.error) {
        setEnabledMap((prev) => ({ ...prev, [id]: !next }));
        setError(result.error);
      }
      setPendingId(null);
    });
  }

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;

  return (
    <div>
      <CharacterImageSection initialImageUrl={initialImageUrl} initialPrompt={initialPrompt} initialGeneratedAt={initialGeneratedAt} />

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <p className="mb-3 text-xs font-medium text-slate-500">
        {enabledCount} of {employees.length} employees enabled
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-200 px-4 py-3 text-left">Employee</th>
              <th className="border-b border-slate-200 px-3 py-3 text-left">Role</th>
              <th className="border-b border-slate-200 px-3 py-3 text-center">AI Companion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((e) => {
              const enabled = !!enabledMap[e.id];
              const isPending = pendingId === e.id;
              return (
                <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {e.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.photoUrl} alt={e.name} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                          {initialsOf(e.name)}
                        </div>
                      )}
                      <span className="font-medium text-slate-900">
                        {e.name}
                        {!e.active && <span className="ml-1.5 text-xs font-normal text-slate-400">(inactive)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{e.roleName}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      disabled={isPending}
                      onClick={() => toggle(e.id)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
                        enabled ? "bg-amber-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 2026-09-05, round 2 — "REAL AI-GENERATED IMAGE BANWAO": one-time,
// admin-triggered generation via the already-configured GEMINI_API_KEY
// (generateCompanionCharacterImage(), actions.ts). Shows the current image
// (or says none exists yet — every employee keeps seeing the hand-drawn
// SVG mascot until this is run once), an optional prompt override, and a
// Generate button. A fresh generation always overwrites the same image in
// place (same public URL, cache-busted by generated_at) — there's only
// ever one shared character image, not one per generation.
function CharacterImageSection({
  initialImageUrl,
  initialPrompt,
  initialGeneratedAt,
}: {
  initialImageUrl: string | null;
  initialPrompt: string | null;
  initialGeneratedAt: string | null;
}) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt);
  const [promptDraft, setPromptDraft] = useState(initialPrompt ?? "");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setGenError(null);
    const result = await generateCompanionCharacterImage(promptDraft.trim() || undefined);
    if (result.error) {
      setGenError(result.error);
    } else if (result.imageUrl) {
      setImageUrl(result.imageUrl);
      setGeneratedAt(new Date().toISOString());
    }
    setGenerating(false);
  }

  const previewUrl = imageUrl && generatedAt ? `${imageUrl}?v=${encodeURIComponent(generatedAt)}` : imageUrl;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Character Image</h2>
      <p className="mt-1 text-xs text-slate-500">
        Generate a real AI image for the companion (Gemini, using the GEMINI_API_KEY already set up for the
        chatbot). Until this is run once, every employee sees the hand-drawn cartoon mascot instead —
        generating one here replaces it everywhere, for everyone, immediately.
      </p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Current AI Companion character" className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-[11px] text-slate-400">No image generated yet — SVG mascot is used</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="companion-image-prompt">
            Prompt (optional — leave blank to use the default, based on the reference photos)
          </label>
          <textarea
            id="companion-image-prompt"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            placeholder="e.g. glasses, wavy brown hair, cream top, flat vector style, plain white background..."
          />
          {genError && <p className="mt-1.5 text-xs text-red-600">{genError}</p>}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {generating ? "Generating…" : imageUrl ? "Regenerate" : "Generate with AI"}
          </button>
        </div>
      </div>
    </div>
  );
}
