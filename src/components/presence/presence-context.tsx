"use client";

// 2026-08-18 — "messaging me kon kon online hai... dikhao" (show who's
// online in Messaging, like Instagram/Facebook). Uses Supabase Realtime's
// PRESENCE feature (not a Postgres table — presence is ephemeral,
// membership-of-a-channel, exactly what "online right now" means, and
// needs no schema change). Every signed-in employee's browser tracks
// itself on one shared channel while the app tab is open; every other
// browser's `sync` event recomputes the full online set. No heartbeat/
// idle-timeout logic — "online" here means "has this app open in a tab
// right now", same semantics WhatsApp Web uses, and disappears within
// Supabase's own presence timeout (~30s) if a tab is closed/crashes
// without a clean disconnect.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

const PresenceContext = createContext<Set<string>>(new Set());

export function useOnlineEmployeeIds(): Set<string> {
  return useContext(PresenceContext);
}

export function PresenceProvider({ meId, children }: { meId: string; children: ReactNode }) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channel = supabase.channel("online-employees", { config: { presence: { key: meId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId]);

  return <PresenceContext.Provider value={onlineIds}>{children}</PresenceContext.Provider>;
}
