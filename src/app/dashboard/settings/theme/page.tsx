// 2026-08-22 — Theme settings page. Open to every signed-in employee, no
// capability gate — same reasoning as My Profile (src/app/dashboard/
// profile/page.tsx): this only ever touches the caller's own row. Reached
// via the 🎨 icon in the dashboard header (dashboard-header.tsx), not the
// capability-gated sidebar Work Menu, since it isn't a capability tile
// (see capability-info.ts's header comment on My Profile/Help Center/
// Messages being deliberately absent from that registry for the same
// reason).
import { ThemeSettingsPanel } from "./theme-settings-panel";

export default function ThemeSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--oms-text)]">Theme</h1>
        <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
          Pick how the dashboard looks for your own login — Navy/Gold, Day, Eye Comfort, Night, or Ocean — plus an
          optional custom accent color on top.
        </p>
      </div>
      <ThemeSettingsPanel />
    </div>
  );
}
