import { redirect } from "next/navigation";

// 2026-11-23 — "JO INVOICE KA SECTION HAI USKO VAHA SE REMOVE KAR KE SARE
// SYSTEM IDHR HI KAR DO": invoice generation moved onto the Orders hub (tick
// the order rows → Generate Invoice). The separate Invoices section is gone
// from the nav (see src/lib/capability-info.ts) and this URL now sends old
// bookmarks/links to the Orders page instead of showing a second, competing
// list. The invoice documents themselves still live at
// /dashboard/invoices/[id] — that is what the Invoiced badge links to.
export default function InvoicesPage() {
  redirect("/dashboard/orders");
}
