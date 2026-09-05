"use client";

// 2026-09-05 — AI Companion LIVE. "AI MOOKUP KO AB FINAL KARO ... TRANSPRANT
// LIVE VEDIO KI TRH KAAM KARE JESA PREVIEW ME DIKHAYA VESA BILKUL BHI NAHI":
// mounted once from dashboard/layout.tsx (only when this employee has
// companion_enabled — see that layout's query + the /dashboard/admin/
// companion-access toggle), this is what actually floats on every
// dashboard page and reacts to real events, unlike the companion-preview
// page's simulate-buttons.
//
// Reuses the EXACT Realtime `postgres_changes` pattern already established
// by MessageToastProvider (message-toast-provider.tsx) — one channel per
// employee, RLS is the real guard, this filter is just an optimization so
// the client never even receives another employee's rows.
import { useEffect, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import { CompanionCharacter } from "./companion-character";
import { CompanionChatPanel } from "./companion-chat-panel";
import {
  EVENT_TYPE_TO_MOOD,
  DEFAULT_OUTFIT,
  DEFAULT_HAIR,
  DEFAULT_GLASSES,
  COMPANION_STATES,
  type CompanionEventType,
} from "./companion-config";

type QueuedEvent = { id: string; eventType: CompanionEventType; message: string };

const SHOW_MS = 5500;
const EXIT_TRANSITION_MS = 450;
const GAP_MS = 300;

export function CompanionLiveProvider({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // The event currently on screen is always just the head of the queue —
  // derived, never its own piece of state, so nothing here ever needs to
  // call setState synchronously from inside an effect body (every setState
  // below runs inside a setTimeout callback instead, which is fine).
  const active = queue[0] ?? null;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`companion-${employeeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "companion_events", filter: `employee_id=eq.${employeeId}` },
        ({ new: row }) => {
          const r = row as { id: string; event_type: string; message: string };
          setQueue((prev) => [...prev, { id: r.id, eventType: r.event_type as CompanionEventType, message: r.message }]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  // Drains the queue one event at a time: a short gap, slide in, hold,
  // slide out, then advance to the next queued item — never overlapping
  // two events. Each event is removed from the queue BY ID (never just
  // "the first item") once its own turn finishes, so a fast-arriving new
  // event during another's on-screen time is never accidentally dropped.
  useEffect(() => {
    if (!active) return;
    const eventId = active.id;

    const showTimer = setTimeout(() => setVisible(true), GAP_MS);
    const hideTimer = setTimeout(() => setVisible(false), GAP_MS + SHOW_MS);
    const advanceTimer = setTimeout(() => {
      setQueue((prev) => prev.filter((e) => e.id !== eventId));
    }, GAP_MS + SHOW_MS + EXIT_TRANSITION_MS);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(advanceTimer);
    };
  }, [active]);

  const dockMood = active ? EVENT_TYPE_TO_MOOD[active.eventType] : "focused";
  const dockAura = COMPANION_STATES.find((s) => s.id === dockMood)?.auraColor ?? "#64748b";

  return (
    <>
      {active ? (
        <div className={`oms-companion-event${visible ? " oms-companion-event-visible" : ""}`}>
          <div className="oms-companion-event-figure" style={{ "--companion-aura": dockAura } as CSSProperties}>
            <CompanionCharacter
              state={EVENT_TYPE_TO_MOOD[active.eventType]}
              outfit={DEFAULT_OUTFIT}
              hair={DEFAULT_HAIR}
              glasses={DEFAULT_GLASSES}
              className="h-full w-full"
            />
          </div>
          <div className="oms-companion-bubble">{active.message}</div>
        </div>
      ) : null}

      <button
        type="button"
        className="oms-companion-dock"
        onClick={() => setChatOpen((v) => !v)}
        aria-label={chatOpen ? "Close AI Companion chat" : "Open AI Companion chat"}
        style={{ "--companion-aura": dockAura } as CSSProperties}
      >
        <CompanionCharacter state="focused" outfit={DEFAULT_OUTFIT} hair={DEFAULT_HAIR} glasses={DEFAULT_GLASSES} className="h-full w-full" />
      </button>

      {chatOpen ? (
        <CompanionChatPanel employeeName={employeeName} onClose={() => setChatOpen(false)} />
      ) : null}
    </>
  );
}
