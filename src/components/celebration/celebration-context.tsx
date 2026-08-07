"use client";

// Real-time celebration broadcast (2026-08-07) — user's explicit choice
// ("Real-time sabko turant") over a simpler "show on next dashboard load"
// version: whoever clicks "Celebrate" on today's birthday/anniversary
// banner fires a Supabase Realtime BROADCAST (not a Postgres Changes
// subscription — no table write involved, so no RLS/trigger concerns) on
// a shared "celebrations" channel. Every employee currently sitting on any
// dashboard page — anywhere in the app, not just the Document Entry page
// or wherever the click happened — is subscribed via <CelebrationProvider>
// in the dashboard layout, and pops the same full-screen fireworks
// overlay at (near) the same instant.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { FireworksOverlay } from "./fireworks-overlay";

export type CelebrationPayload = {
  name: string;
  kind: "birthday" | "anniversary" | "work_anniversary";
  photoUrl: string | null;
  years?: number;
};

type CelebrationContextValue = {
  fireCelebration: (payload: CelebrationPayload) => void;
};

const CelebrationContext = createContext<CelebrationContextValue | null>(null);

export function useCelebration(): CelebrationContextValue {
  const ctx = useContext(CelebrationContext);
  if (!ctx) throw new Error("useCelebration must be used inside <CelebrationProvider>");
  return ctx;
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [active, setActive] = useState<CelebrationPayload | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel("celebrations")
      .on("broadcast", { event: "fire" }, ({ payload }) => {
        setActive(payload as CelebrationPayload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function fireCelebration(payload: CelebrationPayload) {
    // Broadcast to everyone else...
    supabase.channel("celebrations").send({ type: "broadcast", event: "fire", payload });
    // ...and show it immediately for the clicker too, rather than waiting
    // on the round-trip through Realtime's own subscription.
    setActive(payload);
  }

  return (
    <CelebrationContext.Provider value={{ fireCelebration }}>
      {children}
      {active && <FireworksOverlay celebration={active} onDone={() => setActive(null)} />}
    </CelebrationContext.Provider>
  );
}
