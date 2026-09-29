// 2026-09-12 — shared shape for the My Profile "Recent activity" card
// (activity-section.tsx). Rows come from the EXISTING audit_log table —
// see page.tsx for the self-scoped query — reduced to the three fields the
// card renders so no Supabase row type leaks into the client tree.
export type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
};
