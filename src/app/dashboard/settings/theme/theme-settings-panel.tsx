"use client";

// 2026-08-22 — the actual picker UI: 5 theme swatches + a custom accent
// color override. Reads/writes entirely through the ThemeProvider context
// (theme-provider.tsx) — no separate fetch here, since the context is
// already seeded server-side from dashboard/layout.tsx and every change
// already persists itself (optimistic UI, see that file's header comment)
// the instant a swatch or the color picker is used. This page is really
// just a bigger, more discoverable version of what a compact header
// dropdown would offer — same state, same actions.
import { useState } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { THEME_IDS, THEME_META, isValidHexColor, type ThemeId } from "@/lib/theme/themes";

export function ThemeSettingsPanel() {
  const { themeId, customAccent, setThemeId, setCustomAccent } = useTheme();
  const [accentDraft, setAccentDraft] = useState(customAccent ?? "");
  const [accentError, setAccentError] = useState<string | null>(null);

  function applyAccent(hex: string) {
    if (!isValidHexColor(hex)) {
      setAccentError("Enter a valid hex color, e.g. #d9a441.");
      return;
    }
    setAccentError(null);
    setCustomAccent(hex);
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-[var(--oms-text)]">Choose a theme</h2>
        <p className="mb-4 text-xs text-[var(--oms-text-muted)]">
          Applies across the whole dashboard for your login only — everyone else keeps their own choice.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_IDS.map((id) => (
            <ThemeSwatchCard key={id} id={id} active={themeId === id} onSelect={() => setThemeId(id)} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--oms-text)]">Custom accent color</h2>
        <p className="mb-4 text-xs text-[var(--oms-text-muted)]">
          Optional — overrides just the accent color of whichever theme is active above (buttons, highlights, active
          menu tile). Leave unset to use that theme&apos;s own accent.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={isValidHexColor(accentDraft) ? accentDraft : "#f59e0b"}
            onChange={(e) => {
              setAccentDraft(e.target.value);
              applyAccent(e.target.value);
            }}
            className="h-10 w-14 cursor-pointer rounded border border-[var(--oms-surface-border)] bg-transparent p-0"
            title="Pick a custom accent color"
          />
          <input
            type="text"
            value={accentDraft}
            onChange={(e) => setAccentDraft(e.target.value)}
            onBlur={() => {
              if (accentDraft.trim() === "") return;
              applyAccent(accentDraft.trim());
            }}
            placeholder="#d9a441"
            className="w-32 rounded-lg border border-[var(--oms-surface-border)] bg-transparent px-3 py-2 text-sm text-[var(--oms-text)] outline-none focus:border-[var(--oms-accent)]"
          />
          {customAccent && (
            <button
              type="button"
              onClick={() => {
                setAccentDraft("");
                setAccentError(null);
                setCustomAccent(null);
              }}
              className="rounded-lg border border-[var(--oms-surface-border)] px-3 py-2 text-xs font-medium text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]"
            >
              Reset to theme default
            </button>
          )}
        </div>
        {accentError && <p className="mt-2 text-xs text-red-500">{accentError}</p>}
      </section>
    </div>
  );
}

function ThemeSwatchCard({ id, active, onSelect }: { id: ThemeId; active: boolean; onSelect: () => void }) {
  const meta = THEME_META[id];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col overflow-hidden rounded-xl border-2 text-left transition ${
        active ? "border-[var(--oms-accent)] shadow-md" : "border-[var(--oms-surface-border)] hover:border-[var(--oms-accent)]/50"
      }`}
      style={{ background: meta.swatch.surface }}
    >
      <div className="flex h-16" style={{ background: meta.swatch.canvas }}>
        <div className="h-full w-8" style={{ background: meta.swatch.sidebar }} />
        <div className="flex flex-1 items-center justify-end p-2">
          <div className="h-4 w-10 rounded-full" style={{ background: meta.swatch.accent }} />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold" style={{ color: "#1e293b" }}>
            {meta.label}
          </div>
          <div className="text-[11px]" style={{ color: "#64748b" }}>
            {meta.description}
          </div>
        </div>
        {active && (
          <span className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: meta.swatch.accent }}>
            Active
          </span>
        )}
      </div>
    </button>
  );
}
