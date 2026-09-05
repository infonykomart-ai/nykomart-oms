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
//
// 2026-09-05, round 2 — 4 more asks folded in here:
//   - randomized entry edge/position per event (see randomEntry() below)
//   - a real generated photo when one exists (companionImageUrl), falling
//     back to the SVG mascot otherwise — passed straight through to
//     CompanionCharacter, which does the branching
//   - the per-employee custom name (companionName), threaded down to the
//     chat panel, which is also where it gets renamed
//   - dock/chat panel moved to bottom-right in globals.css (this file only
//     changed what needs JS: the event popup's position + direction)
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
type Edge = "top" | "bottom" | "left" | "right";

const SHOW_MS = 5500;
const EXIT_TRANSITION_MS = 450;
const GAP_MS = 300;
const EDGES: Edge[] = ["top", "bottom", "left", "right"];

// Picks a random edge of the screen + a random point along it, and the
// matching flex layout (so the speech bubble always sits on the "inward"
// side of the character, never off past the edge it just entered from)
// plus the transform the character sits at BEFORE it slides in from that
// edge. "PURE DESKTOP SE KAHI SE BHI NIKAL SAKTI HAI" — no fixed left-slide
// any more, a fresh roll every time a new event appears.
function randomEntry(): { style: CSSProperties; hiddenTransform: string } {
  const edge = EDGES[Math.floor(Math.random() * EDGES.length)];
  // Kept within the middle 60% of the perpendicular axis so it never lands
  // right on top of the dock/chat panel corner (bottom-right) or spills
  // past a screen edge.
  const along = 15 + Math.random() * 60;
  const base: CSSProperties = { position: "fixed", zIndex: 61 };

  switch (edge) {
    case "left":
      return {
        style: { ...base, left: 16, top: `${along}%`, flexDirection: "row" },
        hiddenTransform: "translateX(-140%)",
      };
    case "right":
      return {
        style: { ...base, right: 16, top: `${along}%`, flexDirection: "row-reverse" },
        hiddenTransform: "translateX(140%)",
      };
    case "top":
      return {
        style: { ...base, top: 16, left: `${along}%`, flexDirection: "column" },
        hiddenTransform: "translateY(-140%)",
      };
    case "bottom":
    default:
      return {
        style: { ...base, bottom: 16, left: `${along}%`, flexDirection: "column-reverse" },
        hiddenTransform: "translateY(140%)",
      };
  }
}

export function CompanionLiveProvider({
  employeeId,
  employeeName,
  companionImageUrl = null,
  companionName = null,
}: {
  employeeId: string;
  employeeName: string;
  companionImageUrl?: string | null;
  companionName?: string | null;
}) {
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [visible, setVisible] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [name, setName] = useState(companionName);
  // Lazy initializer (not an effect) so this never needs a synchronous
  // setState-in-effect on mount — only the "it changed later" case below
  // needs an effect at all, and that one only calls setState from inside
  // the event listener callback, not the effect body itself.
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // The event currently on screen is always just the head of the queue —
  // derived, never its own piece of state, so nothing here ever needs to
  // call setState synchronously from inside an effect body (every setState
  // below runs inside a setTimeout callback instead, which is fine).
  const active = queue[0] ?? null;

  // A fresh random edge/position is rolled once per event id — not on
  // every render — so it stays put for that event's whole on-screen life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => (active ? randomEntry() : null), [active?.id]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
      {active && entry ? (
        <div
          className={`oms-companion-event${visible ? " oms-companion-event-visible" : ""}`}
          style={{
            ...entry.style,
            transform: reducedMotion ? "none" : visible ? "translate(0, 0)" : entry.hiddenTransform,
          }}
        >
          <div className="oms-companion-event-figure" style={{ "--companion-aura": dockAura } as CSSProperties}>
            <CompanionCharacter
              state={EVENT_TYPE_TO_MOOD[active.eventType]}
              outfit={DEFAULT_OUTFIT}
              hair={DEFAULT_HAIR}
              glasses={DEFAULT_GLASSES}
              imageUrl={companionImageUrl}
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
        aria-label={chatOpen ? `Close ${name || "AI Companion"} chat` : `Open ${name || "AI Companion"} chat`}
        style={{ "--companion-aura": dockAura } as CSSProperties}
      >
        <CompanionCharacter
          state="focused"
          outfit={DEFAULT_OUTFIT}
          hair={DEFAULT_HAIR}
          glasses={DEFAULT_GLASSES}
          imageUrl={companionImageUrl}
          className="h-full w-full"
        />
      </button>

      {chatOpen ? (
        <CompanionChatPanel
          employeeName={employeeName}
          companionName={name}
          onRename={setName}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </>
  );
}
