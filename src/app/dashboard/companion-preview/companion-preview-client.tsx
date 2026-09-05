"use client";

import { useState, type CSSProperties } from "react";
import { CompanionCharacter } from "@/components/companion/companion-character";
import {
  COMPANION_STATES,
  COMPANION_OUTFITS,
  COMPANION_HAIR,
  DEFAULT_COMPANION_STATE,
  DEFAULT_OUTFIT,
  DEFAULT_HAIR,
  DEFAULT_GLASSES,
  type CompanionStateId,
  type OutfitId,
  type HairId,
} from "@/components/companion/companion-config";

// 2026-09-05 — this page is now a wardrobe/simulate PLAYGROUND for the same
// character the live widget uses (companion-live-provider.tsx), not a
// throwaway mockup — both import companion-character.tsx +
// companion-config.ts from src/components/companion/ so there is exactly
// one character definition. The "PREVIEW / MOCKUP" banner below is kept
// (buttons here still simulate rather than read real events — that's a
// genuinely accurate description now too, for trying out looks/moods
// without waiting for a real order/task), just no longer implies the
// character itself is throwaway.
export function CompanionPreviewClient() {
  const [stateId, setStateId] = useState<CompanionStateId>(DEFAULT_COMPANION_STATE);
  const [outfit, setOutfit] = useState<OutfitId>(DEFAULT_OUTFIT);
  const [hair, setHair] = useState<HairId>(DEFAULT_HAIR);
  const [glasses, setGlasses] = useState<boolean>(DEFAULT_GLASSES);

  const active = COMPANION_STATES.find((s) => s.id === stateId) ?? COMPANION_STATES[0];

  return (
    <div className="space-y-6 pb-10">
      {/* PREVIEW banner — the whole point of this page is that it must never
          be mistaken for a shipped feature. */}
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-amber-900">
        <span className="text-2xl" aria-hidden="true">
          🧪
        </span>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide">Preview / Mockup — not wired into the live app yet</p>
          <p className="text-xs text-amber-800">
            This page is a standalone concept for an AI desktop companion. It only lives here, at this URL — it is
            not on the sidebar, the dock, or any other page, and the buttons below simulate app signals rather than
            reading real ones.
          </p>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-[var(--oms-text)]">AI Desktop Companion — concept mockup</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--oms-text-muted)]">
          A small mascot meant to eventually float persistently in a corner of every dashboard page, reacting to
          real signals — an attendance punch-in, a completed task or order, an overdue item, the time of day. For
          this mockup those signals are simulated with the buttons below.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Character card */}
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-2xl border p-6"
          style={
            {
              borderColor: "var(--oms-surface-border)",
              background: "var(--oms-surface)",
              "--companion-aura": active.auraColor,
            } as CSSProperties
          }
        >
          <div className="flex h-64 w-64 items-center justify-center sm:h-72 sm:w-72">
            <CompanionCharacter state={stateId} outfit={outfit} hair={hair} glasses={glasses} className="h-full w-full" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-[var(--oms-text)]">{active.label}</p>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: active.auraColor }}>
              {active.moodTag}
            </p>
            <p className="mt-1 text-xs text-[var(--oms-text-muted)]">{active.signal}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-5">
          <section
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--oms-surface-border)", background: "var(--oms-surface)" }}
          >
            <h2 className="text-sm font-semibold text-[var(--oms-text)]">Simulate a signal</h2>
            <p className="mt-0.5 text-xs text-[var(--oms-text-muted)]">
              Each of these stands in for something the real app would eventually detect on its own.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COMPANION_STATES.map((s) => {
                const isActive = s.id === stateId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStateId(s.id)}
                    className="rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors"
                    style={{
                      borderColor: isActive ? active.auraColor : "var(--oms-surface-border)",
                      background: isActive ? `color-mix(in srgb, ${s.auraColor} 14%, var(--oms-surface))` : "var(--oms-canvas)",
                      color: "var(--oms-text)",
                    }}
                    aria-pressed={isActive}
                  >
                    {s.buttonLabel}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="rounded-2xl border p-4"
            style={{ borderColor: "var(--oms-surface-border)", background: "var(--oms-surface)" }}
          >
            <h2 className="text-sm font-semibold text-[var(--oms-text)]">Wardrobe</h2>
            <p className="mt-0.5 text-xs text-[var(--oms-text-muted)]">
              A small fixed set of looks — not an open-ended dress-up system.
            </p>

            <p className="mt-3 text-xs font-medium text-[var(--oms-text-muted)]">Outfit</p>
            <div className="mt-1.5 flex gap-2">
              {COMPANION_OUTFITS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOutfit(o.id)}
                  aria-pressed={outfit === o.id}
                  title={o.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform"
                  style={{
                    background: o.vestColor,
                    borderColor: outfit === o.id ? "var(--oms-text)" : "transparent",
                    transform: outfit === o.id ? "scale(1.08)" : "scale(1)",
                  }}
                >
                  <span className="sr-only">{o.label}</span>
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs font-medium text-[var(--oms-text-muted)]">Hairstyle</p>
            <div className="mt-1.5 flex gap-2">
              {COMPANION_HAIR.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHair(h.id)}
                  aria-pressed={hair === h.id}
                  className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                  style={{
                    borderColor: hair === h.id ? "var(--oms-text)" : "var(--oms-surface-border)",
                    background: hair === h.id ? "var(--oms-canvas)" : "transparent",
                    color: "var(--oms-text)",
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs font-medium text-[var(--oms-text-muted)]">Glasses</p>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => setGlasses((g) => !g)}
                aria-pressed={glasses}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                style={{
                  borderColor: glasses ? "var(--oms-text)" : "var(--oms-surface-border)",
                  background: glasses ? "var(--oms-canvas)" : "transparent",
                  color: "var(--oms-text)",
                }}
              >
                {glasses ? "On 👓" : "Off"}
              </button>
            </div>
          </section>

          <section
            className="rounded-2xl border p-4 text-xs text-[var(--oms-text-muted)]"
            style={{ borderColor: "var(--oms-surface-border)", background: "var(--oms-surface)" }}
          >
            <h2 className="mb-1 text-sm font-semibold text-[var(--oms-text)]">How this would eventually work</h2>
            <ul className="list-inside list-disc space-y-1">
              <li>Rendered as a small floating widget, persistent across every dashboard page.</li>
              <li>Mood driven by real signals (attendance, tasks/orders, time of day) — never random idle animation.</li>
              <li>This page is the mockup only; wiring it into the live layout is a separate, later decision.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
