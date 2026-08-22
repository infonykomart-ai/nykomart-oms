"use client";

// 2026-08-22 — Dashboard theme system: client-side React context holding
// the signed-in employee's active theme + optional custom accent color,
// and persisting changes back via a server action.
//
// Initial values come from the server (dashboard/layout.tsx already reads
// the employee row for other things — theme_id/custom_accent_color are
// fetched alongside those queries and passed in as props here), so the
// FIRST paint already renders the employee's saved theme with no flash of
// the default. Every change after that is optimistic: local state updates
// immediately (instant UI feedback), then `saveThemePreference` fires in
// the background — see settings/theme/actions.ts. A failed save silently
// keeps the locally-applied theme rather than snapping back, since a
// theme choice failing to persist is a low-stakes, easily-retried
// annoyance, not something worth surfacing as an error toast on every
// dashboard page.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { DEFAULT_THEME, isThemeId, isValidHexColor, type ThemeId } from "@/lib/theme/themes";
import { saveThemePreference } from "@/app/dashboard/settings/theme/actions";

type ThemeContextValue = {
  themeId: ThemeId;
  customAccent: string | null;
  setThemeId: (id: ThemeId) => void;
  setCustomAccent: (hex: string | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  initialThemeId,
  initialCustomAccent,
  children,
}: {
  initialThemeId: string | null;
  initialCustomAccent: string | null;
  children: ReactNode;
}) {
  const [themeId, setThemeIdState] = useState<ThemeId>(isThemeId(initialThemeId) ? initialThemeId : DEFAULT_THEME);
  const [customAccent, setCustomAccentState] = useState<string | null>(
    isValidHexColor(initialCustomAccent) ? initialCustomAccent : null
  );

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    saveThemePreference({ themeId: id }).catch(() => {
      // Optimistic UI per the build spec — see header comment. Nothing to
      // roll back to that the employee would recognize as "correct"; the
      // Settings page's own save-state indicator (see theme-settings-
      // panel.tsx) is where a failure actually gets surfaced.
    });
  }, []);

  const setCustomAccent = useCallback((hex: string | null) => {
    setCustomAccentState(hex);
    saveThemePreference({ customAccentColor: hex }).catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ themeId, customAccent, setThemeId, setCustomAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be used within a ThemeProvider");
  return ctx;
}
