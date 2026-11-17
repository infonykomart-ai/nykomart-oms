"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSeoCategory, deleteSeoProject, saveListingEdits, saveSeoProject, uploadSeoImage } from "./actions";
import type { EtsyLanguage } from "@/lib/etsy/languages";
import { PRODUCT_FIELDS } from "@/lib/etsy/product";
import { charCount, formatTags, parseTags, REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS, validateTags, validateTitle } from "@/lib/etsy/validation";
import type { ValidationReport } from "@/lib/etsy/seo-validation";
import type { ResearchAdapterInfo } from "@/lib/etsy/research";

// 2026-11-18 — Client surface of the Etsy International SEO Generator.
//
// Drafts live in one object keyed by listing id so switching language tabs never
// loses unsaved work. Generation is one HTTP call per language (the "Generate
// all 10" button loops them) so one failing market never discards the others.
// Every save/gen/revalidate response replaces local state with the server's
// row, so what the user sees is what was stored — including the validator's
// real verdict, which the browser never computes itself.

export type SeoListingRecord = {
  id: string;
  project_id: string;
  country: string;
  language_code: string;
  language_name: string;
  locale: string;
  title: string;
  description: string;
  tags: string[];
  alt_texts: Array<{ image: number; text: string }>;
  seo_score: number | null;
  validation_status: string;
  validation_report: ValidationReport | null;
  primary_keyword: string | null;
  secondary_keywords: string[];
  provider: string | null;
  model: string | null;
  backup_used: boolean;
  version: number;
  edited_manually: boolean;
  updated_at: string;
};

export type SeoProjectRecord = {
  id: string;
  sku: string | null;
  project_name: string;
  category: string | null;
  original_title: string;
  original_description: string;
  original_tags: string;
  product: Record<string, string>;
  images: Array<{ url: string; storage_path?: string; order?: number; description?: string }>;
  status: string;
  generation_status: string;
  updated_at: string;
};

export type SeoUsageSummary = {
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unknownCost: number;
};

type KeywordRow = {
  id: string;
  project_id: string;
  language_code: string;
  keyword: string;
  keyword_type: string;
  source: string;
  verified: boolean;
  search_volume: number | null;
  competition: number | null;
  confidence: string;
};

type CompetitorRow = {
  id: string;
  project_id: string;
  competitor_url: string | null;
  competitor_title: string | null;
  analysis: Record<string, unknown> | null;
  researched_at: string;
};

type Draft = { title: string; description: string; tags: string; altTexts: Array<{ image: number; text: string }>; dirty: boolean };

type Step = "product" | "images" | "keywords" | "generate" | "review" | "validate" | "export" | "settings";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "product", label: "1 · Product" },
  { id: "images", label: "2 · Images" },
  { id: "keywords", label: "3 · Keyword research" },
  { id: "generate", label: "4 · Generate 10 languages" },
  { id: "review", label: "5 · Review & edit" },
  { id: "validate", label: "6 · Validate" },
  { id: "export", label: "7 · Export" },
  { id: "settings", label: "AI usage & settings" },
];

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20";
const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const cardClass = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

function emptyProject(): SeoProjectRecord {
  return {
    id: "",
    sku: null,
    project_name: "",
    category: null,
    original_title: "",
    original_description: "",
    original_tags: "",
    product: {},
    images: [],
    status: "draft",
    generation_status: "idle",
    updated_at: new Date().toISOString(),
  };
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    fail: "bg-rose-50 text-rose-700 border-rose-200",
    pending: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${map[status] ?? map.pending}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; issues?: string[] };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

export function EtsySeoClient({
  languages,
  projects,
  initialListings,
  initialKeywords,
  initialCompetitors,
  categories,
  usage,
  researchSources,
  providers,
  settings,
}: {
  languages: EtsyLanguage[];
  projects: SeoProjectRecord[];
  initialListings: SeoListingRecord[];
  initialKeywords: KeywordRow[];
  initialCompetitors: CompetitorRow[];
  categories: string[];
  usage: SeoUsageSummary;
  researchSources: ResearchAdapterInfo[];
  providers: {
    gemini: { configured: boolean; source: string; model: string | null };
    openrouter: { configured: boolean; source: string; model: string | null };
  };
  settings: { backupEnabled: boolean; primaryModel: string | null; backupModel: string | null; researchMode: string; monthlyBudgetUsd: number };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("product");
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [creating, setCreating] = useState(projects.length === 0);
  const [form, setForm] = useState<SeoProjectRecord>(projects[0] ?? emptyProject());
  const [listings, setListings] = useState<SeoListingRecord[]>(initialListings);
  // Research/competitor rows are read-only here: they are written by the API
  // routes and re-read through router.refresh(), so no local setter is needed.
  const [keywords] = useState<KeywordRow[]>(initialKeywords);
  const [competitors] = useState<CompetitorRow[]>(initialCompetitors);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeLanguage, setActiveLanguage] = useState(languages[0]?.code ?? "nl");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [competitorForm, setCompetitorForm] = useState({ url: "", title: "", tags: "", keywords: "", languageCode: languages[0]?.code ?? "nl" });
  const [keywordFile, setKeywordFile] = useState("");
  const [settingsForm, setSettingsForm] = useState({
    backupEnabled: settings.backupEnabled,
    primaryModel: settings.primaryModel ?? "",
    backupModel: settings.backupModel ?? "",
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    geminiApiKey: "",
    openRouterApiKey: "",
  });

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const projectListings = useMemo(() => listings.filter((l) => l.project_id === selectedId), [listings, selectedId]);
  const projectKeywords = useMemo(() => keywords.filter((k) => k.project_id === selectedId), [keywords, selectedId]);
  const trackedProject = selected ?? (creating ? form : null);

  const validated = projectListings.filter((l) => l.validation_status === "pass").length;
  const needsWork = projectListings.filter((l) => l.validation_status !== "pass").length;

  function resetDrafts() {
    setDrafts({});
    setError(null);
    setNotice(null);
  }

  function chooseProject(project: SeoProjectRecord) {
    setSelectedId(project.id);
    setForm(project);
    setCreating(false);
    setActiveLanguage(languages[0]?.code ?? "nl");
    resetDrafts();
  }

  function startNew() {
    setSelectedId(null);
    setForm(emptyProject());
    setCreating(true);
    setStep("product");
    resetDrafts();
  }

  function patchForm(patch: Partial<SeoProjectRecord>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function patchFact(key: string, value: string) {
    setForm((prev) => ({ ...prev, product: { ...prev.product, [key]: value } }));
  }

  async function saveProject() {
    setBusy("save-project");
    setError(null);
    setNotice(null);
    try {
      const result = await saveSeoProject({
        id: form.id || undefined,
        sku: form.sku ?? undefined,
        projectName: form.project_name,
        category: form.category ?? undefined,
        englishTitle: form.original_title,
        englishDescription: form.original_description,
        englishTags: form.original_tags,
        product: form.product,
        images: form.images,
      });
      if (!result.ok || !result.data) throw new Error(result.error ?? "Save failed.");
      setNotice(form.id ? "Project saved." : "Project created — continue with images.");
      setCreating(false);
      setSelectedId(result.data.id);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(file: File) {
    if (!form.id) {
      setError("Save the project first, then upload photos.");
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const data = new FormData();
      data.set("file", file);
      data.set("projectId", form.id);
      data.set("order", String(form.images.length));
      const result = await uploadSeoImage(data);
      if (!result.ok || !result.image) throw new Error(result.error ?? "Upload failed.");
      const images = [...form.images, result.image];
      patchForm({ images });
      await saveSeoProject({
        id: form.id,
        sku: form.sku ?? undefined,
        projectName: form.project_name,
        category: form.category ?? undefined,
        englishTitle: form.original_title,
        englishDescription: form.original_description,
        englishTags: form.original_tags,
        product: form.product,
        images,
      });
      setNotice(`Image ${images.length} uploaded.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function researchKeywords(languageCode: string) {
    if (!selectedId) return;
    setBusy(`research-${languageCode}`);
    setError(null);
    setNotice(null);
    try {
      const result = await postJson<{ total: number; aiSuggested: number; verified: number }>("/api/etsy-seo/research/keywords", {
        projectId: selectedId,
        languageCode,
        fileText: keywordFile.trim() || undefined,
      });
      setNotice(`${languageCode}: ${result.total} keywords (${result.aiSuggested} AI-suggested, ${result.verified} verified).`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function analyzeCompetitor() {
    if (!selectedId) return;
    setBusy("competitor");
    setError(null);
    try {
      await postJson("/api/etsy-seo/research/competitors", {
        projectId: selectedId,
        languageCode: competitorForm.languageCode,
        competitorUrl: competitorForm.url || undefined,
        competitorTitle: competitorForm.title || undefined,
        competitorTags: competitorForm.tags || undefined,
        competitorKeywords: competitorForm.keywords || undefined,
      });
      setNotice("Competitor analysis saved.");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function upsertListing(listing: SeoListingRecord) {
    setListings((prev) => {
      const others = prev.filter((l) => !(l.project_id === listing.project_id && l.language_code === listing.language_code));
      return [...others, listing];
    });
  }

  async function generateOne(languageCode: string, field: "all" | "title" | "description" | "tags" = "all") {
    if (!selectedId) throw new Error("Save the project first.");
    const language = languages.find((l) => l.code === languageCode);
    const result = await postJson<{ listing: SeoListingRecord; report: ValidationReport; provider: string; model: string; backupUsed: boolean; notes: string[] }>(
      "/api/etsy-seo/generate",
      { projectId: selectedId, languageCode, field }
    );
    upsertListing({ ...result.listing, validation_report: result.report });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[result.listing.id];
      return next;
    });
    const note = result.notes?.length ? ` ${result.notes.join(" ")}` : "";
    setNotice(
      `${language?.name ?? languageCode}: ${result.report.status.toUpperCase()} · score ${result.report.score} · ${result.provider}${result.backupUsed ? " (backup)" : ""}.${note}`
    );
    return result;
  }

  async function generateAll() {
    if (!selectedId) {
      setError("Save the project first.");
      return;
    }
    setBusy("generate-all");
    setError(null);
    const failed: string[] = [];
    for (let i = 0; i < languages.length; i++) {
      const language = languages[i];
      setProgress(`${i + 1}/${languages.length} — ${language.name}`);
      try {
        await generateOne(language.code);
      } catch (err) {
        failed.push(`${language.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setProgress(null);
    setBusy(null);
    if (failed.length > 0) setError(`${languages.length - failed.length}/${languages.length} generated. Failed → ${failed.join(" | ")}`);
    startTransition(() => router.refresh());
  }

  async function regenerateField(languageCode: string, field: "title" | "description" | "tags") {
    setBusy(`regen-${languageCode}-${field}`);
    setError(null);
    try {
      await generateOne(languageCode, field);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function generateAltTexts() {
    if (!selectedId || !trackedProject || trackedProject.images.length === 0) {
      setError("Upload at least one image first.");
      return;
    }
    setBusy("alt-text");
    setError(null);
    const failures: string[] = [];
    for (let i = 0; i < trackedProject.images.length; i++) {
      setProgress(`Alt text — image ${i + 1}/${trackedProject.images.length}`);
      try {
        const result = await postJson<{ altTexts: Record<string, string>; skipped: string[] }>("/api/etsy-seo/alt-text", {
          projectId: selectedId,
          imageIndex: i,
        });
        setListings((prev) =>
          prev.map((listing) => {
            const text = result.altTexts[listing.language_code];
            if (!text || listing.project_id !== selectedId) return listing;
            const altTexts = [...listing.alt_texts.filter((a) => a.image !== i + 1), { image: i + 1, text }].sort((a, b) => a.image - b.image);
            return { ...listing, alt_texts: altTexts };
          })
        );
        if (result.skipped.length > 0) failures.push(`image ${i + 1}: no listing yet for ${result.skipped.join(", ")}`);
      } catch (err) {
        failures.push(`image ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setProgress(null);
    setBusy(null);
    setNotice("Alt text generated for every language that has a listing.");
    if (failures.length > 0) setError(failures.join(" | "));
    startTransition(() => router.refresh());
  }

  function draftFor(listing: SeoListingRecord): Draft {
    return drafts[listing.id] ?? { title: listing.title, description: listing.description, tags: listing.tags.join(", "), altTexts: listing.alt_texts, dirty: false };
  }

  function patchDraft(listing: SeoListingRecord, patch: Partial<Draft>) {
    const current = draftFor(listing);
    setDrafts((prev) => ({ ...prev, [listing.id]: { ...current, ...patch, dirty: true } }));
  }

  async function saveListing(listing: SeoListingRecord) {
    const draft = draftFor(listing);
    setBusy(`save-${listing.id}`);
    setError(null);
    try {
      const result = await saveListingEdits({
        listingId: listing.id,
        title: draft.title,
        description: draft.description,
        tags: draft.tags,
        altTexts: draft.altTexts,
      });
      if (!result.ok) throw new Error(result.error ?? "Save failed.");
      const report = result.report as ValidationReport;
      setListings((prev) =>
        prev.map((l) =>
          l.id === listing.id
            ? { ...l, title: draft.title.trim(), description: draft.description.trim(), tags: parseTags(draft.tags), validation_report: report, validation_status: report.status, seo_score: report.score, version: l.version + 1, edited_manually: true }
            : l
        )
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[listing.id];
        return next;
      });
      setNotice(`${listing.language_name} saved — ${report.status.toUpperCase()} · score ${report.score}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function revalidateAll() {
    if (!selectedId) return;
    setBusy("validate");
    setError(null);
    try {
      const result = await postJson<{ summary: { pass: number; warning: number; fail: number } }>("/api/etsy-seo/validate", { projectId: selectedId });
      setNotice(`Revalidated: ${result.summary.pass} pass · ${result.summary.warning} warning · ${result.summary.fail} fail.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    setBusy("settings");
    setError(null);
    try {
      await fetch("/api/etsy-seo/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupEnabled: settingsForm.backupEnabled,
          primaryModel: settingsForm.primaryModel || null,
          backupModel: settingsForm.backupModel || null,
          monthlyBudgetUsd: Number(settingsForm.monthlyBudgetUsd) || 0,
          geminiApiKey: settingsForm.geminiApiKey || undefined,
          openRouterApiKey: settingsForm.openRouterApiKey || undefined,
        }),
      }).then(async (response) => {
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Settings save failed.");
      });
      setSettingsForm((prev) => ({ ...prev, geminiApiKey: "", openRouterApiKey: "" }));
      setNotice("Settings saved.");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(provider: "gemini" | "openrouter") {
    setBusy(`test-${provider}`);
    setError(null);
    try {
      const result = await postJson<{ ok: boolean; model: string | null; error: string | null }>("/api/etsy-seo/settings", { test: provider });
      setNotice(result.ok ? `${provider} works (${result.model}).` : `${provider} failed: ${result.error ?? "unknown error"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyText(text: string, label: string) {
    if (!text.trim()) {
      setError(`Nothing to copy for ${label}.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied.`);
    } catch {
      setError("Clipboard is blocked by the browser — select the text and copy manually.");
    }
  }

  const activeListing = projectListings.find((l) => l.language_code === activeLanguage) ?? null;
  const activeDraft = activeListing ? draftFor(activeListing) : null;
  const activeTitleCheck = validateTitle(activeDraft?.title ?? "");
  const activeTagCheck = validateTags(activeDraft?.tags ?? "");
  const keywordCounts = languages.map((language) => ({
    language,
    total: projectKeywords.filter((k) => k.language_code === language.code).length,
    verified: projectKeywords.filter((k) => k.language_code === language.code && k.verified).length,
  }));

  return (
    <div className="space-y-4">
      {/* Widgets */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Widget label="Projects" value={projects.length} />
        <Widget label="Listings generated" value={projectListings.length} />
        <Widget label="Listings completed" value={validated} tone="good" />
        <Widget label="Need correction" value={needsWork} tone={needsWork ? "warn" : undefined} />
        <Widget label="Keywords researched" value={projectKeywords.length} />
        <Widget label="AI requests" value={usage.requests} />
        <Widget label="Est. cost (MTD)" value={`$${usage.costUsd.toFixed(4)}`} hint={usage.unknownCost ? `${usage.unknownCost} request(s) with unknown pricing` : undefined} />
        <div className={cardClass}>
          <p className={labelClass}>Providers</p>
          <p className="mt-1 text-xs text-slate-700">
            Gemini <span className={providers.gemini.configured ? "font-semibold text-emerald-600" : "font-semibold text-rose-600"}>{providers.gemini.configured ? "configured" : "missing"}</span>
          </p>
          <p className="text-xs text-slate-700">
            Backup <span className={providers.openrouter.configured ? "font-semibold text-emerald-600" : "font-semibold text-slate-500"}>{providers.openrouter.configured ? "ready" : "not set"}</span>
          </p>
        </div>
      </div>

      {(error || notice || progress) && (
        <div className="space-y-2">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
          {notice && <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{notice}</div>}
          {progress && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{progress}</div>}
        </div>
      )}

      {/* Project bar */}
      <div className={`${cardClass} flex flex-wrap items-center gap-2`}>
        <select
          className={`${inputClass} max-w-xs`}
          value={selectedId ?? ""}
          onChange={(event) => {
            const project = projects.find((p) => p.id === event.target.value);
            if (project) chooseProject(project);
          }}
        >
          {!selectedId && <option value="">New project (unsaved)</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_name} {project.sku ? `· ${project.sku}` : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={startNew} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          + New SEO project
        </button>
        {selected && (
          <>
            <span className={statusBadge(selected.status)}>{selected.status}</span>
            <span className="text-xs text-slate-500">{selected.images.length} image(s) · {projectListings.length}/10 languages saved</span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm("Delete this project and all its listings?")) return;
                const result = await deleteSeoProject(selected.id);
                if (!result.ok) setError(result.error ?? "Delete failed.");
                else {
                  setSelectedId(null);
                  startNew();
                  startTransition(() => router.refresh());
                }
              }}
              className="ml-auto rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              Delete project
            </button>
          </>
        )}
      </div>

      {/* Step nav */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {STEPS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${step === item.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* PRODUCT */}
      {step === "product" && (
        <section className={`${cardClass} space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900">{form.id ? "Product information" : "New SEO project"}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Project name *</span>
              <input className={inputClass} value={form.project_name} onChange={(e) => patchForm({ project_name: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelClass}>SKU</span>
              <input className={inputClass} value={form.sku ?? ""} onChange={(e) => patchForm({ sku: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelClass}>Category</span>
              <select className={inputClass} value={form.category ?? ""} onChange={(e) => patchForm({ category: e.target.value })}>
                <option value="">Not set</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className={labelClass}>English product title * (the protected source)</span>
              <input className={inputClass} value={form.original_title} onChange={(e) => patchForm({ original_title: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelClass}>Existing English description</span>
              <textarea className={`${inputClass} h-32`} value={form.original_description} onChange={(e) => patchForm({ original_description: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelClass}>Existing English tags</span>
              <textarea className={`${inputClass} h-32`} value={form.original_tags} onChange={(e) => patchForm({ original_tags: e.target.value })} />
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Product facts — optional, never invented by the AI</p>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              {PRODUCT_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className={labelClass}>{field.label}</span>
                  {field.multiline ? (
                    <textarea className={`${inputClass} h-20`} value={form.product[field.key] ?? ""} placeholder={field.placeholder} onChange={(e) => patchFact(field.key, e.target.value)} />
                  ) : (
                    <input className={inputClass} value={form.product[field.key] ?? ""} placeholder={field.placeholder} onChange={(e) => patchFact(field.key, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveProject} disabled={busy !== null} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {busy === "save-project" ? "Saving…" : form.id ? "Save changes" : "Create project"}
            </button>
            <AddCategory onAdd={async (name) => {
              const result = await addSeoCategory(name);
              if (!result.ok) setError(result.error ?? "Could not add category.");
              else {
                setNotice(`Category "${name}" added.`);
                startTransition(() => router.refresh());
              }
            }} />
            <span className="text-xs text-slate-500">Empty optional fields are fine — generation still works.</span>
          </div>
        </section>
      )}

      {/* IMAGES */}
      {step === "images" && (
        <section className={`${cardClass} space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900">Product images &amp; alt text</h2>
          <p className="text-xs text-slate-600">
            JPEG/PNG/WEBP up to 8 MB. Alt text is written from the photo itself (vision), in all ten languages, and each is
            kept under 250 characters.
          </p>
          {!form.id ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Save the project on step 1 first.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                  event.target.value = "";
                }}
                className="text-sm"
              />
              <button type="button" onClick={generateAltTexts} disabled={busy !== null || form.images.length === 0} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                {busy === "alt-text" ? "Generating…" : "Generate alt text (10 languages)"}
              </button>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            {form.images.map((image, index) => (
              <figure key={`${image.url}-${index}`} className="overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`Product image ${index + 1}`} className="h-40 w-full object-cover" />
                <figcaption className="space-y-1 p-2 text-[11px] text-slate-600">
                  <span className="font-semibold">Image {index + 1}</span>
                  {projectListings[0]?.alt_texts.find((a) => a.image === index + 1) && (
                    <p className="line-clamp-3">{projectListings[0].alt_texts.find((a) => a.image === index + 1)?.text}</p>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* KEYWORDS */}
      {step === "keywords" && (
        <section className="space-y-4">
          <div className={cardClass}>
            <h2 className="text-sm font-bold text-slate-900">Live keyword research</h2>
            <p className="mt-1 text-xs text-slate-600">
              Every market gets its own native-language research — never a translation of the English list. Rows without a
              measured metric are labelled <span className="font-semibold">“AI Suggested – Search Volume Not Verified”</span>.
            </p>
            <label className="mt-3 block">
              <span className={labelClass}>Optional: paste your own keyword data (keyword,volume,competition per line)</span>
              <textarea className={`${inputClass} h-24`} value={keywordFile} onChange={(e) => setKeywordFile(e.target.value)} placeholder={"handmade cotton rug,1300,0.42\njute rug living room"} />
            </label>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1">Market</th>
                    <th className="py-1">Language</th>
                    <th className="py-1">Keywords</th>
                    <th className="py-1">Verified</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {keywordCounts.map(({ language, total, verified }) => (
                    <tr key={language.code} className="border-t border-slate-100">
                      <td className="py-1.5">{language.flag} {language.country}</td>
                      <td className="py-1.5">{language.name}</td>
                      <td className="py-1.5">{total}</td>
                      <td className="py-1.5">{verified}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          disabled={busy !== null || !selectedId}
                          onClick={() => researchKeywords(language.code)}
                          className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy === `research-${language.code}` ? "Researching…" : total ? "Re-research" : "Research"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">Research sources &amp; which need credentials</summary>
              <ul className="mt-2 space-y-1">
                {researchSources.map((source) => (
                  <li key={source.id}>
                    <span className="font-semibold">{source.label}</span> — {source.provides}.{" "}
                    {source.requiresCredentials ? <span className="text-amber-700">Needs {source.envVars.join(" / ") || "credentials"}.</span> : <span className="text-emerald-700">Available.</span>} {source.note}
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className={cardClass}>
            <h3 className="text-sm font-bold text-slate-900">Competitor analysis</h3>
            <p className="mt-1 text-xs text-slate-600">Use public or user-supplied competitor details. No sales, conversion or ranking data is claimed.</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <input className={inputClass} placeholder="Competitor Etsy URL" value={competitorForm.url} onChange={(e) => setCompetitorForm({ ...competitorForm, url: e.target.value })} />
              <input className={inputClass} placeholder="Competitor title" value={competitorForm.title} onChange={(e) => setCompetitorForm({ ...competitorForm, title: e.target.value })} />
              <input className={inputClass} placeholder="Competitor tags" value={competitorForm.tags} onChange={(e) => setCompetitorForm({ ...competitorForm, tags: e.target.value })} />
              <input className={inputClass} placeholder="Competitor keywords" value={competitorForm.keywords} onChange={(e) => setCompetitorForm({ ...competitorForm, keywords: e.target.value })} />
              <select className={inputClass} value={competitorForm.languageCode} onChange={(e) => setCompetitorForm({ ...competitorForm, languageCode: e.target.value })}>
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={analyzeCompetitor} disabled={busy !== null || !selectedId} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy === "competitor" ? "Analyzing…" : "Analyze competitor"}
            </button>
            <div className="mt-3 space-y-2">
              {competitors.filter((c) => c.project_id === selectedId).map((competitor) => (
                <div key={competitor.id} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
                  <p className="font-semibold">{competitor.competitor_title ?? competitor.competitor_url}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{JSON.stringify(competitor.analysis, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* GENERATE */}
      {step === "generate" && (
        <section className={`${cardClass} space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">Generate all 10 languages</h2>
            <button type="button" onClick={generateAll} disabled={busy !== null || !selectedId} className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {busy === "generate-all" ? "Generating…" : "Generate all 10"}
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Each language is a separate request, so a failure in one market keeps the other nine. The provider used is stored
            per listing — a backup run is visible, never silent.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1">Market</th>
                  <th className="py-1">Status</th>
                  <th className="py-1">Score</th>
                  <th className="py-1">Provider</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {languages.map((language) => {
                  const listing = projectListings.find((l) => l.language_code === language.code);
                  return (
                    <tr key={language.code} className="border-t border-slate-100">
                      <td className="py-1.5">{language.flag} {language.country} · {language.name}</td>
                      <td className="py-1.5">
                        {listing ? <span className={statusBadge(listing.validation_status)}>{listing.validation_status}</span> : <span className="text-slate-400">not generated</span>}
                      </td>
                      <td className="py-1.5">{listing?.seo_score ?? "—"}</td>
                      <td className="py-1.5 text-slate-500">{listing?.provider ? `${listing.provider}${listing.backup_used ? " (backup)" : ""}` : "—"}</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          disabled={busy !== null || !selectedId}
                          onClick={async () => {
                            setBusy(`gen-${language.code}`);
                            setError(null);
                            try {
                              await generateOne(language.code);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            } finally {
                              setBusy(null);
                              startTransition(() => router.refresh());
                            }
                          }}
                          className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy === `gen-${language.code}` ? "Working…" : listing ? "Regenerate" : "Generate"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* REVIEW */}
      {step === "review" && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {languages.map((language) => {
              const listing = projectListings.find((l) => l.language_code === language.code);
              const dot = listing ? (listing.validation_status === "pass" ? "bg-emerald-500" : listing.validation_status === "warning" ? "bg-amber-500" : "bg-rose-500") : "bg-slate-300";
              return (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => setActiveLanguage(language.code)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${activeLanguage === language.code ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {language.flag} {language.name}
                </button>
              );
            })}
          </div>

          {!activeListing || !activeDraft ? (
            <div className={`${cardClass} text-sm text-slate-600`}>
              This language has not been generated yet. Go to step 4 and generate it.
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
              <div className={`${cardClass} space-y-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{activeListing.language_name} · {activeListing.country}</h2>
                  <span className={statusBadge(activeListing.validation_status)}>{activeListing.validation_status}</span>
                  <span className="text-xs text-slate-500">Score {activeListing.seo_score ?? "—"}/100 · v{activeListing.version}</span>
                </div>

                <label className="block">
                  <span className={labelClass}>
                    SEO title — {charCount(activeDraft.title)}/{TITLE_MAX_CHARS} {activeTitleCheck.valid ? "✓" : `✗ ${activeTitleCheck.message ?? ""}`}
                  </span>
                  <textarea className={`${inputClass} h-20`} value={activeDraft.title} onChange={(e) => patchDraft(activeListing, { title: e.target.value })} />
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => copyText(activeDraft.title, "Title")} className="text-[11px] font-semibold text-sky-700 hover:underline">Copy title</button>
                    <button type="button" onClick={() => regenerateField(activeListing.language_code, "title")} disabled={busy !== null} className="text-[11px] font-semibold text-slate-600 hover:underline disabled:opacity-50">Regenerate title</button>
                  </div>
                </label>

                <label className="block">
                  <span className={labelClass}>
                    Exactly 13 tags — {activeTagCheck.total}/{REQUIRED_TAG_COUNT}, longest {activeTagCheck.maxTagLength}/{TAG_MAX_CHARS}
                  </span>
                  <textarea className={`${inputClass} h-24`} value={activeDraft.tags} onChange={(e) => patchDraft(activeListing, { tags: e.target.value })} />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <button type="button" onClick={() => copyText(formatTags(parseTags(activeDraft.tags)), "Tags")} className="font-semibold text-sky-700 hover:underline">Copy tags</button>
                    <button type="button" onClick={() => regenerateField(activeListing.language_code, "tags")} disabled={busy !== null} className="font-semibold text-slate-600 hover:underline disabled:opacity-50">Regenerate tags</button>
                    {activeTagCheck.tooLong.length > 0 && <span className="text-rose-600">Too long: {activeTagCheck.tooLong.join(", ")}</span>}
                    {activeTagCheck.duplicates.length > 0 && <span className="text-rose-600">Duplicates: {activeTagCheck.duplicates.join(", ")}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {parseTags(activeDraft.tags).map((tag, index) => (
                      <span key={`${tag}-${index}`} className={`rounded-full border px-2 py-0.5 text-[11px] ${charCount(tag) > TAG_MAX_CHARS ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                        {tag} <span className="text-slate-400">{charCount(tag)}</span>
                      </span>
                    ))}
                  </div>
                </label>

                <label className="block">
                  <span className={labelClass}>Description — {activeDraft.description.length} characters</span>
                  <textarea className={`${inputClass} h-72`} value={activeDraft.description} onChange={(e) => patchDraft(activeListing, { description: e.target.value })} />
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    <button type="button" onClick={() => copyText(activeDraft.description, "Description")} className="font-semibold text-sky-700 hover:underline">Copy description</button>
                    <button type="button" onClick={() => regenerateField(activeListing.language_code, "description")} disabled={busy !== null} className="font-semibold text-slate-600 hover:underline disabled:opacity-50">Regenerate description</button>
                  </div>
                </label>

                {activeDraft.altTexts.length > 0 && (
                  <div>
                    <p className={labelClass}>Image alt text</p>
                    <div className="mt-1 space-y-2">
                      {activeDraft.altTexts.map((alt, index) => (
                        <div key={`${alt.image}-${index}`} className="rounded-lg border border-slate-200 p-2">
                          <p className="text-[11px] font-semibold text-slate-500">Image {alt.image} · {charCount(alt.text)}/250</p>
                          <textarea
                            className={`${inputClass} mt-1 h-16`}
                            value={alt.text}
                            onChange={(e) =>
                              patchDraft(activeListing, {
                                altTexts: activeDraft.altTexts.map((a) => (a.image === alt.image ? { ...a, text: e.target.value } : a)),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => copyText(activeDraft.altTexts.map((a) => `Image ${a.image}: ${a.text}`).join("\n"), "Alt text")} className="mt-1 text-[11px] font-semibold text-sky-700 hover:underline">Copy all alt text</button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button type="button" onClick={() => saveListing(activeListing)} disabled={busy !== null || !activeDraft.dirty} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                    {busy === `save-${activeListing.id}` ? "Saving…" : activeDraft.dirty ? "Save changes" : "Saved"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(
                      [activeDraft.title, "", formatTags(parseTags(activeDraft.tags)), "", activeDraft.description, "", ...activeDraft.altTexts.map((a) => `Image ${a.image}: ${a.text}`)].join("\n"),
                      "Complete listing"
                    )}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Copy complete listing
                  </button>
                  <span className="text-[11px] text-slate-500">Saving keeps the previous text as version {activeListing.version}, then revalidates.</span>
                </div>
              </div>

              <div className={`${cardClass} space-y-2 text-xs`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Validation report</h3>
                  <button type="button" onClick={revalidateAll} disabled={busy !== null} className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {busy === "validate" ? "Checking…" : "Revalidate all"}
                  </button>
                </div>
                {activeListing.validation_report ? (
                  <>
                    <div className="grid grid-cols-2 gap-1">
                      {Object.entries(activeListing.validation_report.categories).map(([category, value]) => (
                        <div key={category} className="rounded border border-slate-200 px-2 py-1">
                          <p className="text-[10px] uppercase text-slate-500">{category.replace("_", " ")}</p>
                          <p className="font-semibold text-slate-800">{value.score}/{value.max}</p>
                        </div>
                      ))}
                    </div>
                    {activeListing.validation_report.errors.length > 0 && (
                      <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-800">
                        <p className="font-semibold">Must fix</p>
                        <ul className="mt-1 list-disc pl-4">{activeListing.validation_report.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                      </div>
                    )}
                    {activeListing.validation_report.warnings.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                        <p className="font-semibold">Suggestions</p>
                        <ul className="mt-1 list-disc pl-4">{activeListing.validation_report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400">Deterministic checks — no AI decides this status. The score is a quality checklist, not Etsy&rsquo;s ranking.</p>
                  </>
                ) : (
                  <p className="text-slate-500">No report yet — run Revalidate.</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* VALIDATE */}
      {step === "validate" && (
        <section className={`${cardClass} space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">Validation reports</h2>
            <button type="button" onClick={revalidateAll} disabled={busy !== null || !selectedId} className="ml-auto rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
              {busy === "validate" ? "Validating…" : "Revalidate all 10"}
            </button>
          </div>
          {projectListings.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing generated yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1">Language</th>
                    <th className="py-1">Title</th>
                    <th className="py-1">Tags</th>
                    <th className="py-1">Score</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Must fix</th>
                  </tr>
                </thead>
                <tbody>
                  {projectListings.map((listing) => (
                    <tr key={listing.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5">{listing.language_name}</td>
                      <td className="py-1.5">{charCount(listing.title)}/140</td>
                      <td className="py-1.5">{listing.tags.length}/13 · max {Math.max(0, ...listing.tags.map((t) => charCount(t)))}</td>
                      <td className="py-1.5">{listing.seo_score ?? "—"}</td>
                      <td className="py-1.5"><span className={statusBadge(listing.validation_status)}>{listing.validation_status}</span></td>
                      <td className="py-1.5 text-rose-700">{listing.validation_report?.errors.join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* EXPORT */}
      {step === "export" && (
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-sm font-bold text-slate-900">Export center</h2>
          {!selectedId ? (
            <p className="text-sm text-slate-600">Select a saved project to export.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/etsy-seo/export?projectId=${selectedId}&format=xlsx`} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">Excel workbook (.xlsx)</a>
              <a href={`/api/etsy-seo/export?projectId=${selectedId}&format=csv`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">CSV — all languages</a>
              <a href={`/api/etsy-seo/export?projectId=${selectedId}&format=keywords`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">CSV — keyword research</a>
              <a href={`/api/etsy-seo/export?projectId=${selectedId}&format=json`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">JSON — full project</a>
            </div>
          )}
          <p className="text-xs text-slate-500">UTF-8 with BOM: Japanese, Russian and Polish characters stay intact in Excel. Excel has Summary, Keyword Research, Validation and one sheet per language.</p>
        </section>
      )}

      {/* SETTINGS / USAGE */}
      {step === "settings" && (
        <section className="grid gap-3 xl:grid-cols-2">
          <div className={`${cardClass} space-y-3`}>
            <h2 className="text-sm font-bold text-slate-900">AI providers</h2>
            <div className="rounded-lg border border-slate-200 p-3 text-xs">
              <p className="font-semibold">Primary — Gemini</p>
              <p className="text-slate-600">Key source: {providers.gemini.source}. Model: {providers.gemini.model ?? "server default"}</p>
              <button type="button" onClick={() => testProvider("gemini")} disabled={busy !== null} className="mt-2 rounded-md border border-slate-300 px-2 py-1 font-semibold hover:bg-slate-50 disabled:opacity-50">
                {busy === "test-gemini" ? "Testing…" : "Test Gemini"}
              </button>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 text-xs">
              <p className="font-semibold">Backup — OpenRouter (optional)</p>
              <p className="text-slate-600">Key source: {providers.openrouter.source}. Model: {providers.openrouter.model ?? "not set"}</p>
              <button type="button" onClick={() => testProvider("openrouter")} disabled={busy !== null} className="mt-2 rounded-md border border-slate-300 px-2 py-1 font-semibold hover:bg-slate-50 disabled:opacity-50">
                {busy === "test-openrouter" ? "Testing…" : "Test OpenRouter"}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              If Gemini fails (timeout, rate limit, outage), the same request is retried on the alternate Gemini model and then
              on the backup provider when enabled. A job is only marked saved when a provider returned valid content.
            </p>
          </div>

          <div className={`${cardClass} space-y-3`}>
            <h2 className="text-sm font-bold text-slate-900">Settings</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settingsForm.backupEnabled} onChange={(e) => setSettingsForm({ ...settingsForm, backupEnabled: e.target.checked })} />
              Automatic backup enabled
            </label>
            <label className="block">
              <span className={labelClass}>Primary model id (blank = server default)</span>
              <input className={inputClass} value={settingsForm.primaryModel} onChange={(e) => setSettingsForm({ ...settingsForm, primaryModel: e.target.value })} placeholder="gemini-flash-latest" />
            </label>
            <label className="block">
              <span className={labelClass}>Backup model id</span>
              <input className={inputClass} value={settingsForm.backupModel} onChange={(e) => setSettingsForm({ ...settingsForm, backupModel: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelClass}>Monthly AI budget (USD, 0 = no limit)</span>
              <input type="number" min={0} step={0.5} className={inputClass} value={settingsForm.monthlyBudgetUsd} onChange={(e) => setSettingsForm({ ...settingsForm, monthlyBudgetUsd: Number(e.target.value) })} />
            </label>
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-slate-700">Store a company API key (encrypted)</summary>
              <p className="mt-1 text-slate-500">Stored with AES-256-GCM and never returned by any API. Leave blank to use the server environment keys.</p>
              <input type="password" className={`${inputClass} mt-2`} placeholder="Gemini API key" value={settingsForm.geminiApiKey} onChange={(e) => setSettingsForm({ ...settingsForm, geminiApiKey: e.target.value })} />
              <input type="password" className={`${inputClass} mt-2`} placeholder="OpenRouter API key" value={settingsForm.openRouterApiKey} onChange={(e) => setSettingsForm({ ...settingsForm, openRouterApiKey: e.target.value })} />
            </details>
            <button type="button" onClick={saveSettings} disabled={busy !== null} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {busy === "settings" ? "Saving…" : "Save settings"}
            </button>
            <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">
              <p className="font-semibold text-slate-700">This month</p>
              <p>{usage.requests} requests · {usage.failures} failed · {usage.inputTokens + usage.outputTokens} tokens</p>
              <p>Estimated cost ${usage.costUsd.toFixed(4)}{usage.unknownCost ? ` (${usage.unknownCost} request(s) with unknown model pricing)` : ""}</p>
            </div>
          </div>
        </section>
      )}

      {trackedProject && step !== "product" && (
        <p className="text-[11px] text-slate-400">Project: {trackedProject.project_name} · {trackedProject.original_title}</p>
      )}
    </div>
  );
}

function Widget({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className={cardClass}>
      <p className={labelClass}>{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function AddCategory({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <span className="flex items-center gap-1">
      <input className={`${inputClass} w-44`} placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        type="button"
        onClick={() => {
          if (!name.trim()) return;
          onAdd(name.trim());
          setName("");
        }}
        className="rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        Add category
      </button>
    </span>
  );
}
