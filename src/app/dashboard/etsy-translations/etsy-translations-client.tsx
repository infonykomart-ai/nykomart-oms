"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEtsyProduct, saveEtsyTranslation } from "./actions";
import type { EtsyLanguage } from "@/lib/etsy/languages";
import {
  charCount,
  clampTitle,
  formatTags,
  normalizeTags,
  parseTags,
  REQUIRED_TAG_COUNT,
  TAG_MAX_CHARS,
  TITLE_MAX_CHARS,
  validateTags,
  validateTitle,
} from "@/lib/etsy/validation";

// 2026-11-17 — the module's client surface: English source editor + 10
// independent language tabs. Drafts live in ONE state object keyed by language
// code, so switching tabs never loses unsaved work; only the active language is
// rendered. Generation is one HTTP call per language (sequentially for
// "Generate All") so a single failure cannot lose the other nine.

export type EtsyTranslationRecord = {
  id: string;
  product_id: string;
  sku: string;
  language_code: string;
  language_name: string;
  translated_title: string;
  translated_description: string;
  translated_tags: string;
  title_character_count: number;
  tag_count: number;
  max_tag_length: number;
  tag_validation_status: string;
  translation_status: string;
  ai_model: string | null;
  edited_manually: boolean;
  updated_at: string;
};

export type EtsyProductWithTranslations = {
  id: string;
  sku: string;
  product_name: string | null;
  original_title: string;
  original_description: string;
  original_tags: string;
  category: string | null;
  material: string | null;
  size: string | null;
  colour: string | null;
  technique: string | null;
  features: string | null;
  updated_at: string;
  translations: EtsyTranslationRecord[];
};

type SourceDraft = {
  sku: string;
  productName: string;
  originalTitle: string;
  originalDescription: string;
  originalTags: string;
  category: string;
  material: string;
  size: string;
  colour: string;
  technique: string;
  features: string;
};

type LangDraft = {
  title: string;
  description: string;
  tags: string;
  aiModel: string | null;
  /** Saved title/description/tags snapshot — for the unsaved-changes badge. */
  saved: { title: string; description: string; tags: string };
  status: "empty" | "generated" | "saved" | "dirty";
};

const EMPTY_SOURCE: SourceDraft = {
  sku: "",
  productName: "",
  originalTitle: "",
  originalDescription: "",
  originalTags: "",
  category: "",
  material: "",
  size: "",
  colour: "",
  technique: "",
  features: "",
};

function draftFromProduct(p: EtsyProductWithTranslations): SourceDraft {
  return {
    sku: p.sku,
    productName: p.product_name ?? "",
    originalTitle: p.original_title,
    originalDescription: p.original_description,
    originalTags: p.original_tags ?? "",
    category: p.category ?? "",
    material: p.material ?? "",
    size: p.size ?? "",
    colour: p.colour ?? "",
    technique: p.technique ?? "",
    features: p.features ?? "",
  };
}

function draftsFromTranslations(languages: EtsyLanguage[], records: EtsyTranslationRecord[]): Record<string, LangDraft> {
  const out: Record<string, LangDraft> = {};
  for (const l of languages) {
    const t = records.find((r) => r.language_code === l.code);
    out[l.code] = {
      title: t?.translated_title ?? "",
      description: t?.translated_description ?? "",
      tags: t?.translated_tags ?? "",
      aiModel: t?.ai_model ?? null,
      saved: {
        title: t?.translated_title ?? "",
        description: t?.translated_description ?? "",
        tags: t?.translated_tags ?? "",
      },
      status: t ? "saved" : "empty",
    };
  }
  return out;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function EtsyTranslationsClient({
  products,
  languages,
}: {
  products: EtsyProductWithTranslations[];
  languages: EtsyLanguage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(products[0]?.id ?? null);
  const selected = products.find((p) => p.id === selectedId) ?? null;

  const [source, setSource] = useState<SourceDraft>(selected ? draftFromProduct(selected) : EMPTY_SOURCE);
  const [drafts, setDrafts] = useState<Record<string, LangDraft>>(() =>
    draftsFromTranslations(languages, selected?.translations ?? [])
  );
  const [active, setActive] = useState(languages[0]?.code ?? "nl");
  const [generating, setGenerating] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState(false);
  const [savingLang, setSavingLang] = useState<string | null>(null);

  const activeLanguage = languages.find((l) => l.code === active) ?? languages[0];
  const draft = drafts[active];
  const titleCheck = validateTitle(draft?.title ?? "");
  const tagCheck = useMemo(() => validateTags(draft?.tags ?? ""), [draft?.tags]);
  const tagList = useMemo(() => parseTags(draft?.tags ?? ""), [draft?.tags]);
  const canSaveLang = !!selected && titleCheck.valid && tagCheck.pass && (draft?.description ?? "").trim().length > 0;
  const unsavedSource = selected
    ? JSON.stringify(source) !== JSON.stringify(draftFromProduct(selected))
    : Object.values(source).some((v) => v.trim() !== "");

  function selectProduct(id: string) {
    const p = products.find((x) => x.id === id) ?? null;
    setSelectedId(id);
    setSource(p ? draftFromProduct(p) : EMPTY_SOURCE);
    setDrafts(draftsFromTranslations(languages, p?.translations ?? []));
    setNotice(null);
    setError(null);
  }

  function patchDraft(code: string, patch: Partial<LangDraft>) {
    setDrafts((prev) => {
      const current = prev[code];
      if (!current) return prev;
      const next = { ...current, ...patch };
      next.status =
        next.title === next.saved.title && next.description === next.saved.description && next.tags === next.saved.tags
          ? next.saved.title
            ? "saved"
            : "empty"
          : "dirty";
      return { ...prev, [code]: next };
    });
  }

  async function copyText(text: string, label: string) {
    if (!text.trim()) {
      setError(`Nothing to copy for ${label} yet.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied.`);
      setError(null);
    } catch {
      setError("Clipboard blocked by the browser — select the text and copy manually.");
    }
  }

  async function generate(code: string, field: "all" | "title" | "description" | "tags"): Promise<boolean> {
    if (!source.originalTitle.trim()) {
      setError("Add the English title first — it is the source for every translation.");
      return false;
    }
    setGenerating((g) => [...g, code]);
    setError(null);
    try {
      const res = await fetch("/api/etsy-translations/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languageCode: code,
          field,
          source: {
            sku: source.sku,
            productName: source.productName,
            title: source.originalTitle,
            description: source.originalDescription,
            tags: source.originalTags,
            category: source.category,
            material: source.material,
            size: source.size,
            colour: source.colour,
            technique: source.technique,
            features: source.features,
          },
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        title?: string;
        description?: string;
        tags?: string[];
        model?: string;
        validation?: { pass?: boolean; issues?: string[] };
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Generation failed.");
        return false;
      }
      setDrafts((prev) => {
        const current = prev[code];
        if (!current) return prev;
        const next: LangDraft = {
          ...current,
          title: field === "title" || field === "all" ? (json.title ?? current.title) : current.title,
          description: field === "description" || field === "all" ? (json.description ?? current.description) : current.description,
          tags: field === "tags" || field === "all" ? formatTags(json.tags ?? parseTags(current.tags)) : current.tags,
          aiModel: json.model ?? current.aiModel,
        };
        next.status =
          next.title === next.saved.title && next.description === next.saved.description && next.tags === next.saved.tags
            ? next.saved.title
              ? "saved"
              : "empty"
            : "generated";
        return { ...prev, [code]: next };
      });
      if (json.validation && json.validation.pass === false) {
        setError(
          `Generated ${code.toUpperCase()} but it still breaks an Etsy rule: ${(json.validation.issues ?? []).join(" ")} Edit it before saving.`
        );
      } else {
        setNotice(`${code.toUpperCase()} generated.`);
      }
      return true;
    } catch {
      setError("Network error while generating — try again.");
      return false;
    } finally {
      setGenerating((g) => g.filter((c) => c !== code));
    }
  }

  async function generateAll() {
    if (!source.originalTitle.trim()) {
      setError("Add the English title first — it is the source for every translation.");
      return;
    }
    setNotice("Generating all languages…");
    let failures = 0;
    for (const l of languages) {
      const ok = await generate(l.code, "all");
      if (!ok) failures += 1;
    }
    setNotice(failures === 0 ? "All 10 languages generated." : `${languages.length - failures}/10 generated — see the error above.`);
  }

  function saveSource() {
    setError(null);
    setSavingSource(true);
    startTransition(async () => {
      const res = await saveEtsyProduct({
        productId: selected?.id,
        sku: source.sku,
        productName: source.productName,
        originalTitle: source.originalTitle,
        originalDescription: source.originalDescription,
        originalTags: source.originalTags,
        category: source.category,
        material: source.material,
        size: source.size,
        colour: source.colour,
        technique: source.technique,
        features: source.features,
      });
      setSavingSource(false);
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      setNotice("English source saved.");
      if (res.id) setSelectedId(res.id);
      router.refresh();
    });
  }

  function saveLanguage() {
    if (!selected || !activeLanguage || !draft) {
      setError("Save the English source first — translations are linked to a product SKU.");
      return;
    }
    setError(null);
    setSavingLang(activeLanguage.code);
    startTransition(async () => {
      const res = await saveEtsyTranslation({
        productId: selected.id,
        languageCode: activeLanguage.code,
        title: draft.title,
        description: draft.description,
        tags: draft.tags,
        aiModel: draft.aiModel ?? undefined,
        editedManually: true,
      });
      setSavingLang(null);
      if (!res.ok) {
        setError(res.error ?? "Save failed.");
        return;
      }
      patchDraft(activeLanguage.code, { saved: { title: draft.title, description: draft.description, tags: draft.tags }, status: "saved" });
      setNotice(`${activeLanguage.name} saved.`);
      router.refresh();
    });
  }

  const savedCount = languages.filter((l) => drafts[l.code]?.saved.title).length;
  const busy = generating.length > 0 || isPending;

  return (
    <div className="space-y-5">
      {(notice || error) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setError(null);
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── product selector + generate all ─────────────────────────────── */}
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Product (SKU)</span>
            <select
              value={selectedId ?? ""}
              onChange={(e) => selectProduct(e.target.value)}
              className={`${inputClass} min-w-[260px]`}
            >
              <option value="">+ New English listing…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.product_name || p.original_title.slice(0, 40)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => selectProduct("")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            New listing
          </button>
          <div className="text-xs text-slate-500">
            Saved languages: <strong>{savedCount}/10</strong>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={generateAll}
            disabled={busy || !source.originalTitle.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {generating.length > 0 ? `Generating… ${generating.length} running` : "⚡ Generate All Languages"}
          </button>
          <button
            type="button"
            onClick={saveSource}
            disabled={busy || savingSource || !source.sku.trim() || !source.originalTitle.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {savingSource ? "Saving…" : unsavedSource ? "Save English Source *" : "Save English Source"}
          </button>
        </div>
      </section>

      {/* ── English source ──────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">English source (protected)</h2>
          <p className="text-[11px] text-slate-400">Saved with the product; no translation ever overwrites these fields.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product SKU *">
            <input className={inputClass} value={source.sku} onChange={(e) => setSource({ ...source, sku: e.target.value })} placeholder="JUTE-RUG-001" />
          </Field>
          <Field label="Product name">
            <input className={inputClass} value={source.productName} onChange={(e) => setSource({ ...source, productName: e.target.value })} />
          </Field>
          <Field label="Category">
            <input className={inputClass} value={source.category} onChange={(e) => setSource({ ...source, category: e.target.value })} placeholder="Rugs / Home decor" />
          </Field>
          <Field label="Material">
            <input className={inputClass} value={source.material} onChange={(e) => setSource({ ...source, material: e.target.value })} placeholder="100% jute" />
          </Field>
          <Field label="Size">
            <input className={inputClass} value={source.size} onChange={(e) => setSource({ ...source, size: e.target.value })} placeholder="2 × 6 ft" />
          </Field>
          <Field label="Colour">
            <input className={inputClass} value={source.colour} onChange={(e) => setSource({ ...source, colour: e.target.value })} />
          </Field>
          <Field label="Manufacturing technique">
            <input className={inputClass} value={source.technique} onChange={(e) => setSource({ ...source, technique: e.target.value })} placeholder="Handwoven" />
          </Field>
          <Field label="Features">
            <input className={inputClass} value={source.features} onChange={(e) => setSource({ ...source, features: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="English title *">
            <input className={inputClass} value={source.originalTitle} onChange={(e) => setSource({ ...source, originalTitle: e.target.value })} />
          </Field>
          <Field label="English tags (optional)">
            <input className={inputClass} value={source.originalTags} onChange={(e) => setSource({ ...source, originalTags: e.target.value })} placeholder="jute rug, handmade rug, …" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="English description">
            <textarea
              rows={5}
              className={inputClass}
              value={source.originalDescription}
              onChange={(e) => setSource({ ...source, originalDescription: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* ── language tabs ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {languages.map((l) => {
            const d = drafts[l.code];
            const isActive = l.code === active;
            const saved = !!d?.saved.title;
            const dirty = !!d && (d.title !== d.saved.title || d.description !== d.saved.description || d.tags !== d.saved.tags);
            const running = generating.includes(l.code);
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => setActive(l.code)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  isActive
                    ? "border-amber-400 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title={`${l.name} — ${l.native}`}
              >
                <span>{l.flag}</span>
                {l.name}
                {running ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                ) : dirty ? (
                  <span className="h-2 w-2 rounded-full bg-red-500" title="Unsaved changes" />
                ) : saved ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" title="Saved" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-300" title="Not translated" />
                )}
              </button>
            );
          })}
        </div>

        {!activeLanguage || !draft ? null : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {activeLanguage.flag} {activeLanguage.name}{" "}
                  <span className="font-normal text-slate-400">({activeLanguage.native})</span>
                </h2>
                <p className="text-[11px] text-slate-500">
                  Target marketplace: {activeLanguage.market} ·{" "}
                  {draft.saved.title ? `Saved ${new Date().toLocaleString("en-IN")}` : "Not generated yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => generate(activeLanguage.code, "all")}
                  disabled={busy || !source.originalTitle.trim()}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {generating.includes(activeLanguage.code) ? "Regenerating…" : `↻ Regenerate ${activeLanguage.name}`}
                </button>
                <button
                  type="button"
                  onClick={() => generate(activeLanguage.code, "title")}
                  disabled={busy || !source.originalTitle.trim()}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  ↻ Title
                </button>
                <button
                  type="button"
                  onClick={() => generate(activeLanguage.code, "description")}
                  disabled={busy || !source.originalTitle.trim()}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  ↻ Description
                </button>
                <button
                  type="button"
                  onClick={() => generate(activeLanguage.code, "tags")}
                  disabled={busy || !source.originalTitle.trim()}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  ↻ Tags
                </button>
                <button
                  type="button"
                  onClick={saveLanguage}
                  disabled={busy || !!savingLang || !canSaveLang}
                  title={canSaveLang ? undefined : "All fields must pass Etsy validation before saving"}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {savingLang === activeLanguage.code ? "Saving…" : `Save ${activeLanguage.name}`}
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* title */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Title</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${titleCheck.valid ? "text-emerald-600" : "text-red-600"}`}>
                      {titleCheck.length}/{TITLE_MAX_CHARS}
                    </span>
                    <button type="button" onClick={() => patchDraft(activeLanguage.code, { title: clampTitle(draft.title) })} className="text-[11px] text-slate-500 hover:underline">
                      Trim
                    </button>
                    <button type="button" onClick={() => copyText(draft.title, "Title")} className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                      Copy
                    </button>
                  </div>
                </div>
                <textarea
                  rows={3}
                  value={draft.title}
                  onChange={(e) => patchDraft(activeLanguage.code, { title: e.target.value })}
                  className={`${inputClass} ${titleCheck.valid ? "" : "border-red-400 ring-1 ring-red-300"}`}
                />
                {titleCheck.message && <p className="mt-1 text-[11px] text-red-600">{titleCheck.message}</p>}
              </div>

              {/* tags */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">13 SEO tags (one line)</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${tagCheck.pass ? "text-emerald-600" : "text-red-600"}`}>
                      {tagCheck.total}/{REQUIRED_TAG_COUNT} tags
                    </span>
                    <button type="button" onClick={() => copyText(formatTags(parseTags(draft.tags)), "Tags")} className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                      Copy
                    </button>
                  </div>
                </div>
                <textarea
                  rows={3}
                  value={draft.tags}
                  onChange={(e) => patchDraft(activeLanguage.code, { tags: e.target.value })}
                  placeholder="tag one, tag two, …"
                  className={`${inputClass} ${tagCheck.pass ? "" : "border-red-400 ring-1 ring-red-300"}`}
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {tagList.map((t, i) => {
                    const len = charCount(t);
                    const bad = len > TAG_MAX_CHARS;
                    const dup = tagList.findIndex((x) => x.toLowerCase() === t.toLowerCase()) !== i;
                    return (
                      <span
                        key={`${t}-${i}`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          bad ? "bg-red-100 text-red-700" : dup ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                        }`}
                        title={`${len}/${TAG_MAX_CHARS}${bad ? " — too long" : ""}${dup ? " — duplicate" : ""}`}
                      >
                        {t} · {len}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
                  <span className={tagCheck.pass ? "text-emerald-600" : "text-red-600"}>
                    Valid {tagCheck.valid}/{REQUIRED_TAG_COUNT} · Invalid {tagCheck.invalid} · Max {tagCheck.maxTagLength}/{TAG_MAX_CHARS}
                  </span>
                  <span className={`font-semibold ${tagCheck.pass ? "text-emerald-600" : "text-red-600"}`}>
                    Status: {tagCheck.pass ? "PASS" : "FAIL"}
                  </span>
                  <button
                    type="button"
                    onClick={() => patchDraft(activeLanguage.code, { tags: formatTags(normalizeTags(draft.tags).tags) })}
                    className="text-[11px] text-slate-500 hover:underline"
                    title="Remove duplicates, drop over-length tags and put everything on one line"
                  >
                    Clean tags
                  </button>
                </div>
              </div>
            </div>

            {/* description */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{draft.description.length} characters</span>
                  <button type="button" onClick={() => copyText(draft.description, "Description")} className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                rows={14}
                value={draft.description}
                onChange={(e) => patchDraft(activeLanguage.code, { description: e.target.value })}
                placeholder="Generate or write the localized description…"
                className={inputClass}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="text-[11px] text-slate-500">
                Title {titleCheck.length}/{TITLE_MAX_CHARS} · Tags {tagCheck.total}/{REQUIRED_TAG_COUNT} · Max tag{" "}
                {tagCheck.maxTagLength}/{TAG_MAX_CHARS} ·{" "}
                <span className={canSaveLang ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                  Validation: {canSaveLang ? "PASS" : "FAIL"}
                </span>
                {draft.aiModel && <span className="ml-2 text-slate-400">via {draft.aiModel}</span>}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `${draft.title}\n\n${draft.description}\n\n${formatTags(parseTags(draft.tags))}`,
                      `${activeLanguage.name} listing`
                    )
                  }
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Copy All
                </button>
                <button
                  type="button"
                  onClick={saveLanguage}
                  disabled={busy || !!savingLang || !canSaveLang}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {savingLang === activeLanguage.code ? "Saving…" : `Save ${activeLanguage.name}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
