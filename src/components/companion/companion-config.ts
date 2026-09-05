// Shared data for the AI Companion character — moved here from
// src/app/dashboard/companion-preview/companion-config.ts on 2026-09-05 so
// both the (still-existing) preview/mockup page AND the new live widget
// (companion-live-provider.tsx) share exactly one character definition —
// no forked copies to keep in sync. Pure data, no React here.
//
// 2026-09-05 — "AI MOOKUP KO AB FINAL KARO": user sent 6 reference photos
// of a specific look (glasses, wavy brown hair, cream top) and asked for
// this to be the character going forward. This environment has no image-
// generation tool, so that reference can't be reproduced as literal
// generated artwork — instead the existing hand-drawn inline-SVG mascot
// (companion-character.tsx) gets 2 new wardrobe options ("wavy" hair,
// "cream" outfit) plus a glasses overlay, and those become the new
// defaults everywhere. The mascot's overall proportions/style are
// unchanged (same body shape, same animation rig) — only hair/outfit/
// glasses moved to match the reference as closely as a flat vector mascot
// reasonably can.

export type CompanionStateId = "punch_in" | "task_completed" | "overdue" | "idle_night" | "focused";

export interface CompanionStateConfig {
  id: CompanionStateId;
  buttonLabel: string; // what the simulate-button says
  label: string; // what the state label under the character says
  moodTag: string;
  signal: string; // the real app signal this would map to, once wired up
  auraColor: string; // background glow behind the character for this mood
}

export const COMPANION_STATES: CompanionStateConfig[] = [
  {
    id: "punch_in",
    buttonLabel: "Simulate: Punch In",
    label: "Punched In",
    moodTag: "Energetic & happy",
    signal: "Real signal: attendance punch-in recorded for the day",
    auraColor: "#f59e0b",
  },
  {
    id: "task_completed",
    buttonLabel: "Simulate: Task Completed",
    label: "Task Completed",
    moodTag: "Celebratory",
    signal: "Real signal: a task or order gets marked complete",
    auraColor: "#eab308",
  },
  {
    id: "overdue",
    buttonLabel: "Simulate: Order Overdue",
    label: "Order Overdue",
    moodTag: "Concerned",
    signal: "Real signal: a task/order goes past its due date, or an error needs attention",
    auraColor: "#ef4444",
  },
  {
    id: "idle_night",
    buttonLabel: "Simulate: Idle (Late Night)",
    label: "Idle (Late Night)",
    moodTag: "Sleepy",
    signal: "Real signal: no activity + it's after-hours (e.g. past 10pm, nobody punched in)",
    auraColor: "#6366f1",
  },
  {
    id: "focused",
    buttonLabel: "Simulate: Normal Work",
    label: "Normal Work",
    moodTag: "Neutral & focused",
    signal: "Real signal: regular business hours, no special event — the day-to-day baseline",
    auraColor: "#64748b",
  },
];

export const DEFAULT_COMPANION_STATE: CompanionStateId = "focused";

// LIVE (real-world) event types — these drive the widget on every
// dashboard page (companion-live-provider.tsx), separate from the 5
// COMPANION_STATES above (which stay simulate-button-only on the preview
// page). Each maps onto one of the existing 5 moods/poses above, so no new
// pose art was needed to cover the wider event list the user asked for
// ("zyada events ek sath — returns, shipment, attendance, etc.").
export type CompanionEventType =
  | "order_placed"
  | "task_assigned"
  | "return_processed"
  | "shipment_booked"
  | "attendance_marked";

export const EVENT_TYPE_TO_MOOD: Record<CompanionEventType, CompanionStateId> = {
  order_placed: "task_completed", // celebratory
  task_assigned: "punch_in", // energetic / "heads up, new thing to do"
  return_processed: "overdue", // concerned face fits a return best of the 5 existing moods
  shipment_booked: "task_completed", // celebratory
  attendance_marked: "punch_in", // literally the mockup's original signal for this pose
};

export type OutfitId = "sunny" | "ocean" | "berry" | "cream";

export interface CompanionOutfit {
  id: OutfitId;
  label: string;
  vestColor: string;
  vestShade: string;
  shoeColor: string;
}

export const COMPANION_OUTFITS: CompanionOutfit[] = [
  { id: "sunny", label: "Sunny Vest", vestColor: "#f59e0b", vestShade: "#c2740a", shoeColor: "#1f2937" },
  { id: "ocean", label: "Ocean Hoodie", vestColor: "#2563eb", vestShade: "#1d4ed8", shoeColor: "#0f172a" },
  { id: "berry", label: "Berry Overalls", vestColor: "#db2777", vestShade: "#9d174d", shoeColor: "#3f0d24" },
  // 2026-09-05 — the reference photos' cream/beige top + denim shoes.
  { id: "cream", label: "Cream Top", vestColor: "#f1e6d2", vestShade: "#cbb98f", shoeColor: "#3b5a78" },
];

export const DEFAULT_OUTFIT: OutfitId = "cream";

export type HairId = "curl" | "spike" | "wavy";

export interface CompanionHair {
  id: HairId;
  label: string;
}

export const COMPANION_HAIR: CompanionHair[] = [
  { id: "curl", label: "Curl Tuft" },
  { id: "spike", label: "Spike Mohawk" },
  // 2026-09-05 — the reference photos' wavy shoulder-length brown hair.
  { id: "wavy", label: "Wavy Brown" },
];

export const DEFAULT_HAIR: HairId = "wavy";

// 2026-09-05 — glasses overlay, on by default (matches every reference
// photo). Kept as its own boolean rather than folded into hair/outfit so
// it can be toggled independently on the wardrobe panel.
export const DEFAULT_GLASSES = true;
