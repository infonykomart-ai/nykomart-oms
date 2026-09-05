// 2026-09-05 — AI desktop companion / mascot: MOCKUP ONLY.
//
// Background: user wants an eventual persistent floating widget (shows on
// every dashboard page) whose mood reflects real app signals — attendance
// punch-in, task/order completion, overdue items, time of day — not random
// idle animation. Explicitly asked for a MOCKUP FIRST, before any further
// scoping/discussion, so this is a single standalone preview page, NOT
// wired into the global layout/sidebar/dock, and NOT a new capability (see
// capability-info.ts — nothing added there on purpose). It's reachable only
// by direct URL; the giant banner in companion-preview-client.tsx exists so
// nobody mistakes it for a shipped feature.
//
// Kept open to every signed-in employee, no requireCapability() gate — same
// reasoning as Theme settings (src/app/dashboard/settings/theme/page.tsx)
// and My Profile: this page reads/writes nothing, it's pure client-side
// simulation, so there's no data access to gate.
//
// The character is hand-built inline SVG + CSS keyframes (see the
// oms-companion-* rules added to globals.css) — no image assets, no canvas
// lib, no new dependency. See companion-preview-client.tsx for the 5
// simulated states and the fixed (non-open-ended) wardrobe.
import { CompanionPreviewClient } from "./companion-preview-client";

export default function CompanionPreviewPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <CompanionPreviewClient />
    </div>
  );
}
