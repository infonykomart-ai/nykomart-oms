// Shared data for the companion mockup — kept separate from the client
// component so the "what states/wardrobe exist" list is easy to scan on
// its own. Pure data, no React here.
//
// IMPORTANT: this is a MOCKUP. Nothing here reads a real attendance punch,
// task, or order — see companion-preview-client.tsx for how each state is
// currently triggered (a button click). The `signal` string on each state
// is the real-world event that would drive it once/if this ships for real.

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

export type OutfitId = "sunny" | "ocean" | "berry";

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
];

export const DEFAULT_OUTFIT: OutfitId = "sunny";

export type HairId = "curl" | "spike";

export interface CompanionHair {
  id: HairId;
  label: string;
}

export const COMPANION_HAIR: CompanionHair[] = [
  { id: "curl", label: "Curl Tuft" },
  { id: "spike", label: "Spike Mohawk" },
];

export const DEFAULT_HAIR: HairId = "curl";
