"use client";

// 2026-08-22 — The actual DOM element the theme lands on. Kept as a
// separate component from ThemeProvider (theme-provider.tsx) because
// ThemeProvider is pure React context (no DOM of its own) so it can sit
// above other layout providers (Celebration/HelpCenter/Presence in
// dashboard/layout.tsx) without adding an extra wrapping element there;
// this component is the one real `<div>` that carries `data-theme` and,
// when a custom accent is set, the inline CSS-variable override — see
// globals.css's `[data-theme]` blocks for what each theme's tokens are and
// why `--oms-accent` specifically is broken out as an overridable
// variable.
//
// Replaces dashboard/layout.tsx's previous plain
// `<div className="flex h-screen overflow-hidden bg-slate-100">` — same
// layout classes, now theme-token-driven instead of a hardcoded
// bg-slate-100 (which is exactly what the Navy/Gold theme's --oms-canvas
// still resolves to, so the default look is unchanged).
//
// 2026-09-09 — "CHAT KA COLOUR DESBORD SE MATCH HO JATA HAI FONT BHI NHI
// DIKHTA... YE FONT VALA ISSUE HAR JAGH LAGTA HAI KAI BAAR": traced to
// this component being the ONLY place `--oms-*` gets defined — on this
// one <div>, not <html>. dashboard/layout.tsx renders the AI Companion
// dock/chat/event-popup, the message toast, and the Messenger popup as
// SIBLINGS of this div (fixed-position overlays, not children of it), so
// none of them were ever inside this div's subtree and none of them
// could ever resolve a single `--oms-*` variable — on ANY theme, not
// just Clay, which is why the same washed-out/invisible text has shown
// up in more than one place. Fixed by ALSO mirroring data-theme + the
// custom-accent override onto <html> below, so every fixed/portaled
// element site-wide can see them too, while /login stays completely
// unaffected (this component only ever mounts inside the authenticated
// dashboard layout) and cleans up on unmount so a client-side Logout
// can't leave a stale theme on <html> for whatever renders next.
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "./theme-provider";

// 2026-09-15 — "mobile view & tablate view sahi nahi hai ek dusre par chadh
// rahe hain, page ese hona chahiye ki screen auto adjust hojaye": the shell
// height now uses dvh (dynamic viewport height) instead of vh — on mobile
// browsers the URL bar collapsing/expanding used to leave the shell taller
// than the visible screen, pushing the bottom of every page (and the fixed
// dock/messenger widgets) under the fold. `h-screen` → `h-dvh` is the one-
// line fix; everything else about the layout model (fixed sidebar +
// scrollable main) is unchanged.

/**
 * Cheap perceived-luminance check (ITU-R BT.601) to pick a legible
 * black/white contrast color for a user-chosen custom accent — same idea
 * as e.g. picking dark vs. light button text against an arbitrary
 * background swatch. Not trying to be a full WCAG contrast solver, just
 * good enough that gold-on-white and navy-on-white both come out readable
 * for whatever hex a color-picker input hands us.
 */
function contrastColorFor(hex: string): string {
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "#ffffff";
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

export function ThemedShell({ children }: { children: ReactNode }) {
  const { themeId, customAccent } = useTheme();

  const style: CSSProperties | undefined = customAccent
    ? ({
        "--oms-accent": customAccent,
        "--oms-accent-contrast": contrastColorFor(customAccent),
      } as CSSProperties)
    : undefined;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", themeId);
    if (customAccent) {
      root.style.setProperty("--oms-accent", customAccent);
      root.style.setProperty("--oms-accent-contrast", contrastColorFor(customAccent));
    } else {
      root.style.removeProperty("--oms-accent");
      root.style.removeProperty("--oms-accent-contrast");
    }
    return () => {
      root.removeAttribute("data-theme");
      root.style.removeProperty("--oms-accent");
      root.style.removeProperty("--oms-accent-contrast");
    };
  }, [themeId, customAccent]);

  return (
    <div data-theme={themeId} style={style} className="flex h-dvh overflow-hidden bg-[var(--oms-canvas)] text-[var(--oms-text)]">
      {children}
    </div>
  );
}
