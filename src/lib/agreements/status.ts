// 2026-11-03 — display labels for agreement statuses and history actions.
// Kept in one place so the hub table, the document workspace and the history
// panel can never disagree about what a status means.
export const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  generated: "PDF generated",
  shared: "Shared with vendor",
  signed_received: "Vendor signed copy received",
  countersigned: "Countersigned",
  active: "Active",
  renewed: "Renewed",
  terminated: "Terminated",
};

export const AGREEMENT_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  generated: "bg-sky-100 text-sky-700",
  shared: "bg-indigo-100 text-indigo-700",
  signed_received: "bg-amber-100 text-amber-800",
  countersigned: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-600 text-white",
  renewed: "bg-slate-200 text-slate-700",
  terminated: "bg-rose-100 text-rose-700",
};

export const AGREEMENT_HISTORY_LABELS: Record<string, string> = {
  created: "Agreement Created",
  template_selected: "Template Selected",
  pdf_generated: "PDF Generated",
  pdf_regenerated: "PDF Regenerated",
  pdf_downloaded: "PDF Downloaded",
  whatsapp_share_initiated: "WhatsApp Share Initiated",
  whatsapp_shared: "WhatsApp Shared",
  vendor_link_created: "Vendor Link Created",
  vendor_link_opened: "Vendor Link Opened",
  signed_received: "Vendor Signed Document Received",
  countersigned: "Nyko Mart Countersigned",
  activated: "Agreement Activated",
  renewed: "Agreement Renewed",
  terminated: "Agreement Terminated",
  updated: "Details Updated",
  letterhead_updated: "Letterhead / Template Updated",
};

export function historyLabel(action: string): string {
  return AGREEMENT_HISTORY_LABELS[action] ?? action;
}
