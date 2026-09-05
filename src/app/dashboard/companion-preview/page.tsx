// 2026-09-05 — AI desktop companion / mascot.
//
// Originally shipped as a MOCKUP-ONLY page (see git history for the
// original header comment). Later the same day, "AI MOOKUP KO AB FINAL
// KARO" finalized this into a real feature: the character now floats live
// on every dashboard page and reacts to real events (see
// src/components/companion/companion-live-provider.tsx, mounted from
// dashboard/layout.tsx) instead of only these simulate-buttons, gated
// per-employee by Admin/MD (companion_enabled column +
// /dashboard/admin/companion-access — companion_admin capability). There's
// also a chatbot (src/app/api/companion-chat/route.ts).
//
// THIS PAGE stays as-is on purpose: a wardrobe/simulate playground for
// trying out moods and looks without waiting for a real order/task to fire
// one — still reachable by direct URL only, still no capability gate (pure
// client-side simulation, no data access to gate), still not on the
// sidebar/dock. The character itself (companion-character.tsx +
// companion-config.ts) now lives in src/components/companion/ so this page
// and the live widget share one definition — no forked copies.
//
// The character is hand-built inline SVG + CSS keyframes (see the
// oms-companion-* rules in globals.css) — no image assets, no canvas lib,
// no new dependency. This environment has no image-generation tool, so the
// 6 reference photos the user sent (glasses, wavy brown hair, cream top)
// were matched by extending this SVG — new "wavy" hair, "cream" outfit,
// and a glasses overlay — rather than literal generated artwork; see
// companion-config.ts's header comment for the full explanation.
import { CompanionPreviewClient } from "./companion-preview-client";

export default function CompanionPreviewPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <CompanionPreviewClient />
    </div>
  );
}
