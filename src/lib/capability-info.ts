// UI metadata for every capability — direct port of the old Index.html's
// CAPABILITY_INFO object. One dashboard tile per capability the signed-in
// employee's role actually has (see db/schema.sql's role_capabilities seed
// for which roles get which). Adding a capability here does NOT grant it to
// anyone — that's the role_capabilities table's job; this is presentation
// only, same separation of concerns as the old system.
export type CapabilityInfo = {
  code: string;
  label: string;
  icon: string;
  description: string;
  href: string;
};

export const CAPABILITY_INFO: CapabilityInfo[] = [
  { code: "order_entry", label: "Order Entry", icon: "📝", href: "/dashboard/orders",
    description: "View, edit, delete orders, or enter a new one — PO/RF/RG No. assigned automatically, duplicate-dispatched-order reuse checked first." },
  { code: "csv_upload", label: "CSV Upload", icon: "📤", href: "/dashboard/csv-upload",
    description: "Bulk-load rows into the back-office log sheets from a CSV file." },
  { code: "doc_entry", label: "Document Entry", icon: "🧾", href: "/dashboard/documents",
    description: "Credit Note, Debit Note, Washing Entry, Purchase Bill, Courier Bill, Duty & Tax Bill, Internal Invoice — via PO/RF/RG or AWB lookup." },
  { code: "stock_entry", label: "Stock Entry", icon: "📦", href: "/dashboard/stock",
    description: "Stock In / Stock Out for raw material — Chalan No. mandatory on every entry." },
  { code: "shipglobal_shipment", label: "Shipglobal Shipments", icon: "🌍", href: "/dashboard/shipglobal",
    description: "Create a real Shipglobal shipment + label for an order (DPD / UniUni / VipParcel / DHL E-Commerce / UBI)." },
  { code: "courier_booking_shipment", label: "Courier Booking", icon: "🚚", href: "/dashboard/courier-booking",
    description: "Create a real shipment + AWB via FedEx, UPS, Aramex, Delhivery, or Shiprocket's own API — the same real-booking pattern Shipglobal uses." },
  { code: "bill_payment", label: "Bill Payment", icon: "💳", href: "/dashboard/bill-payment",
    description: "Bill-payment approval workflow." },
  { code: "internal_expense_entry", label: "Office Expenses", icon: "🧾", href: "/dashboard/expenses",
    description: "Log rent, electricity, fuel and other costs not tied to a purchase order or AWB — feeds the P&L Dashboard as a separate overhead line." },
  { code: "freight_estimate", label: "Freight Cost Estimator", icon: "🧮", href: "/dashboard/freight-estimate",
    description: "Estimate/compare shipping cost by courier, zone and weight before booking or dispatch — from the manually-maintained Courier Rate Card." },
  { code: "freight_rate_admin", label: "Courier Rate Card", icon: "📊", href: "/dashboard/courier-rates",
    description: "Maintain the manual courier rate sheet (courier / zone / weight-slab) that the Freight Cost Estimator uses." },
  { code: "doc_entry", label: "Order Shipments & Packages", icon: "📦", href: "/dashboard/order-packages",
    description: "Record how an order actually shipped — one or more physical packages, each under a shipment/AWB (packages can share one AWB or each get their own)." },
  { code: "salary_admin", label: "Salary & Advances", icon: "💰", href: "/dashboard/salary",
    description: "Salary and advance tracking." },
  { code: "statement_entry", label: "Statement Entry", icon: "📄", href: "/dashboard/statements",
    description: "Manual entry for PDF-only statements (Etsy Monthly Tax Invoice, eBay Financial Summary)." },
  { code: "party_admin", label: "Party Master", icon: "🤝", href: "/dashboard/parties",
    description: "Add / update vendor (Party Master) records." },
  { code: "exchange_rate_admin", label: "Exchange Rates", icon: "💱", href: "/dashboard/exchange-rates",
    description: "Maintain the Exchange Rate Master." },
  { code: "attendance_punch", label: "Attendance", icon: "🕒", href: "/dashboard/attendance",
    description: "Punch In / Punch Out." },
  { code: "attendance_admin", label: "Attendance Admin", icon: "🗓️", href: "/dashboard/attendance/admin",
    description: "Import the TeamOffice attendance report, review mismatches." },
  { code: "leave_management", label: "Leave", icon: "🏖️", href: "/dashboard/leave",
    description: "Apply for leave with an application, and track its approval status." },
  { code: "leave_admin", label: "Leave Approvals", icon: "✋", href: "/dashboard/leave/admin",
    description: "Approve/reject leave requests and assign who covers the absent employee's store work." },
  // 2026-08-11 (round 3): "task vala option isi page par show hona chahiye
  // usko alag se kyu banaya hai" — Tasks / Task Reports no longer have
  // their own sidebar tile or standalone route; the Task Assignment UI now
  // renders directly on Attendance / Attendance Admin (see those pages),
  // gated on the same task_management/task_admin capabilities as before.
  { code: "crm_dashboard", label: "CRM Overview", icon: "📊", href: "/dashboard/crm",
    description: "Company-wide CRM / overview dashboard, including the P&L Dashboard." },
  { code: "approve_level1", label: "Approvals (L1)", icon: "✅", href: "/dashboard/approvals/l1",
    description: "First-level bill / approval sign-off." },
  { code: "approve_level2", label: "Approvals (L2)", icon: "✅", href: "/dashboard/approvals/l2",
    description: "Second-level bill / approval sign-off." },
  { code: "company_item_admin", label: "Company & Items", icon: "🏢", href: "/dashboard/admin/companies",
    description: "Add new companies, item categories, sizes." },
  { code: "hr_letters", label: "HR Letters", icon: "✉️", href: "/dashboard/hr-letters",
    description: "Generate Joining / Promotion / Experience / Salary Slip and other letters." },
  { code: "employee_admin", label: "Employees", icon: "👥", href: "/dashboard/admin/employees",
    description: "Manage the employee roster." },
  { code: "permissions_admin", label: "Roles & Permissions", icon: "🔐", href: "/dashboard/admin/permissions",
    description: "Set which role gets which capability — self-service, no code change needed." },
  { code: "reports", label: "Reports", icon: "📈", href: "/dashboard/reports",
    description: "The Reports suite." },
  { code: "invoicing", label: "Invoices", icon: "🧾", href: "/dashboard/invoices",
    description: "Generate export sales invoices (CSB-V/CSB-IV) against dispatched orders." },
  { code: "ad_spend_entry", label: "Store Ad Spend", icon: "📈", href: "/dashboard/ad-spend",
    description: "Enter daily Budget/Spend per store and view the combined Orders + Ad Spend report." },
  { code: "finished_stock_view", label: "Inventory", icon: "📦", href: "/dashboard/inventory",
    description: "Finished-goods Stock — auto-restocked from cancelled+refunded+already-purchased orders." },
  // 2026-08-14: Help Center itself (the 🤖 chat bubble) and Messages (the
  // header 💬 icon) are open to EVERY signed-in employee and are NOT
  // capability-gated tiles — they don't appear here, same reasoning as My
  // Profile. This tile only gates who may edit the Help Center's own
  // article content.
  { code: "help_center_admin", label: "Help Center Admin", icon: "🛠️", href: "/dashboard/admin/help-center",
    description: "Add / edit / delete the Help Center's FAQ & guide articles." },
  // 2026-08-22: Backup Export — see db/2026-08-22-backup-export-admin.sql.
  // Admin/MD only (own capability, not "reports" — bypasses per-company
  // scoping and reads every company's orders at once).
  { code: "data_export_admin", label: "Backup Export", icon: "💾", href: "/dashboard/admin/backup",
    description: "Export every order + its generated invoice fields (all companies) as one Excel workbook." },
  // 2026-08-24: see db/2026-08-24-audit-log.sql and
  // db/2026-08-24-automation-rules.sql.
  { code: "audit_log_view", label: "Audit Log", icon: "🕵️", href: "/dashboard/admin/audit-log",
    description: "Who changed or deleted what, and when — order status changes, bill/expense/shipment deletions." },
  { code: "automation_admin", label: "Automation Rules", icon: "🤖", href: "/dashboard/admin/automation",
    description: "Trigger → condition → action rules that run automatically on order status changes (internal-only actions, no customer messaging)." },
];

export function capabilityInfoFor(code: string): CapabilityInfo | undefined {
  return CAPABILITY_INFO.find((c) => c.code === code);
}
