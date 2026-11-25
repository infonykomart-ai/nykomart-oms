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
  /** Kept in the registry (labels, permissions) but never shown as a tile. */
  hidden?: boolean;
  /**
   * Suppress this tile when the employee also holds any of these codes — for a
   * tile that is a fallback destination somebody else's tile already covers
   * (e.g. the P&L-only Office Expenses tile). Keeps one tile per section.
   */
  hideWhenAny?: string[];
};

export const CAPABILITY_INFO: CapabilityInfo[] = [
  { code: "order_entry", label: "Order Entry", icon: "📝", href: "/dashboard/orders",
    description: "View, edit, delete orders, or enter a new one — PO/RF/RG No. assigned automatically, duplicate-dispatched-order reuse checked first." },
  // 2026-11-23 — the Purchase Orders section was removed from the app at the
  // owner's request (its tables stay in the database, untouched). Orders and
  // their own status grid are the only order module now.
  { code: "csv_upload", label: "CSV Upload", icon: "📤", href: "/dashboard/csv-upload",
    description: "Bulk-load rows into the back-office log sheets from a CSV file." },
  { code: "doc_entry", label: "Document Entry", icon: "🧾", href: "/dashboard/documents",
    description: "Credit Note, Debit Note, Washing Entry, Purchase Bill, Courier Bill, Duty & Tax Bill, Internal Invoice — via PO/RF/RG or AWB lookup." },
  { code: "stock_entry", label: "Stock Entry", icon: "📦", href: "/dashboard/stock",
    description: "Stock In / Stock Out for raw material — Chalan No. mandatory on every entry." },
  { code: "shipglobal_shipment", label: "Shipglobal Shipments", icon: "🌍", href: "/dashboard/shipglobal",
    description: "Create a real Shipglobal shipment + label for an order (DPD / UniUni / VipParcel / DHL E-Commerce / UBI)." },
  { code: "courier_booking_shipment", label: "Courier Booking", icon: "🚚", href: "/dashboard/courier-booking",
    description: "Book a real shipment + AWB, track it, and print its label — FedEx, UPS, Aramex, Delhivery, Shiprocket, DHL." },
  // 2026-09-03: Courier Account Setup (the tab that stores each courier's
  // API credentials, encrypted, per company) — deliberately its own
  // capability, NOT folded into courier_booking_shipment, same reasoning
  // performance_admin was split from attendance_admin (2026-09-02):
  // entering/editing an API secret is more sensitive than booking a
  // shipment with credentials someone else already set up. Same href as
  // courier_booking_shipment (both land on the same tabbed page — see
  // attendance_admin/performance_admin above for the existing precedent of
  // two capabilities sharing one href) — see
  // db/2026-09-03-courier-account-setup.sql.
  { code: "courier_credentials_admin", label: "Courier Account Setup", icon: "🔐", href: "/dashboard/courier-booking",
    description: "Enter/edit courier API account credentials (FedEx, UPS, Aramex, Delhivery, Shiprocket, DHL) — Admin/MD only." },
  { code: "bill_payment", label: "Bill Payment", icon: "💳", href: "/dashboard/bill-payment",
    description: "Bill-payment approval workflow." },
  // 2026-11-22 — ONE Office Expenses section, per the owner's ask ("bahut
  // confuse karta hai, normal rakho single section me"). Four launcher tiles
  // (P&L log, Purchase & Accounts, Expense Vouchers, Expense Approvals) all
  // described the same job, so the landing grid now has a single tile that
  // opens the module; vouchers, approvals, petty cash, reimbursements,
  // reports, setup and the P&L overhead log are sections inside it. The other
  // three codes stay in the registry (hidden) because the permissions matrix
  // and capability-sync still need their labels — entry and approval remain
  // separate grants on purpose: whoever raises a voucher must not be the
  // only person who can approve it.
  { code: "accounts_view", label: "Office Expenses", icon: "🧾", href: "/dashboard/accounts",
    description: "One place for every office/cash expense — vouchers and their approvals, petty cash, reimbursements, the P&L overhead log, cash/bank book and trial balance." },
  // 2026-11-22 — this is a TILE only for roles that were granted the P&L log
  // and nothing else in Accounts. It used to be hidden, which left such a role
  // with no Office Expenses tile at all (the accounts page doesn't accept this
  // capability, so there was no way in). When the employee holds any accounts
  // capability, `hideWhenAny` suppresses this tile — the accounts_view tile is
  // already their one Office Expenses entry, and the P&L log is a tile inside
  // it. That keeps exactly one Office Expenses tile per person.
  { code: "internal_expense_entry", label: "Office Expenses (P&L)", icon: "📈", href: "/dashboard/expenses",
    hideWhenAny: ["accounts_view"],
    description: "Log rent, electricity, fuel and other costs not tied to a purchase order or AWB — feeds the P&L Dashboard as a separate overhead line. No ledger entry, no approval; reached from Office Expenses → P&L Overhead Log." },
  { code: "accounts_expense_entry", label: "Expense Vouchers", icon: "🧮", href: "/dashboard/accounts?tab=expenses", hidden: true,
    description: "Create and submit expense vouchers (cash / bank / UPI), petty cash movements and employee reimbursement claims." },
  { code: "accounts_expense_approve", label: "Expense Approvals", icon: "✅", href: "/dashboard/accounts?tab=approvals", hidden: true,
    description: "Review submitted expense vouchers and reimbursement claims, then post approved vouchers to the ledger. Self-approval is blocked." },
  // The setup screens (financial years, cash/bank accounts, opening balances,
  // approval limits) are the same page's Setup tab — kept in the registry for
  // grants, but no separate tile: admins already reach it via accounts_view.
  { code: "accounts_setup", label: "Accounts Setup", icon: "⚙️", href: "/dashboard/accounts?tab=setup", hidden: true,
    description: "Financial years, cash/bank/UPI accounts, opening balances and approval limits." },
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
  // 2026-11-14 — Indian Customs Exchange Rate module (history, verification,
  // calculator). Two entries point at the same page because the tile list is
  // one-per-capability and rate approval is deliberately split from viewing.
  { code: "customs_rate_view", label: "Customs Exchange Rates", icon: "🛃", href: "/dashboard/customs-rates",
    description: "Official Indian Customs import/export rates — current, historical by date, with the customs conversion calculator." },
  { code: "customs_rate_admin", label: "Customs Rate Admin", icon: "✅", href: "/dashboard/customs-rates",
    description: "Sync official sources, upload the notification/CSV, and approve or reject extracted customs rates — Admin/MD only." },
  { code: "attendance_punch", label: "Attendance", icon: "🕒", href: "/dashboard/attendance",
    description: "Punch In / Punch Out." },
  { code: "attendance_admin", label: "Attendance Admin", icon: "🗓️", href: "/dashboard/attendance/admin",
    description: "Import the TeamOffice attendance report, review mismatches." },
  { code: "leave_management", label: "Leave", icon: "🏖️", href: "/dashboard/leave",
    description: "Apply for leave with an application, and track its approval status." },
  { code: "leave_admin", label: "Leave Approvals", icon: "✋", href: "/dashboard/leave/admin",
    description: "Approve/reject leave requests and assign who covers the absent employee's store work." },
  // 2026-09-02: Performance & Awards ranking dashboard — deliberately its
  // own capability, NOT folded into attendance_admin, even though today
  // both happen to be granted to the exact same roles (MD/Admin — see
  // db/2026-09-02-performance-dashboard.sql). Kept separate so this can be
  // narrowed or widened independently later without dragging general
  // attendance-admin access along with it — this view surfaces order
  // value/growth per employee, which is more sensitive than attendance
  // records alone.
  { code: "performance_admin", label: "Performance & Awards", icon: "🏆", href: "/dashboard/attendance/admin",
    description: "Team-wide performance ranking — attendance, work efficiency, leave, and (for order-entry staff) order value/growth — Admin/MD only." },
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
  // 2026-11-03 — Vendor Agreements (agreement generator + WhatsApp/PDF).
  // Rides on the EXISTING hr_letters capability rather than a new code:
  // this is the same "issue an official document on company letterhead"
  // job MD/Admin already hold it for, and a brand-new capability would sit
  // unusable until someone ran a role_capabilities grant by hand (this
  // module ships with no migration at all — see agreements/actions.ts).
  // Same-capability-second-destination precedent as the entries below.
  // 2026-11-03b — return approvals are deliberately a SEPARATE capability
  // from order_entry: whoever raises a return can't approve it. Granted to
  // MD/Admin by db/2026-11-03b-return-approval.sql; the queue itself shows on
  // the Returns page.
  { code: "return_approval", label: "Return Approvals", icon: "↩️", href: "/dashboard/returns",
    description: "Review customer return requests raised by order-entry staff: approve to release the refund and mark the order Returned, or reject with a note." },
  // 2026-11-03b — the same page, reachable by the people who actually take
  // refund/return entries (owner: "refund/return section ... order ki entry
  // karne wale employees ko access dena hai"). A second entry under the
  // order_entry capability, because the tile list is one-to-one with the href
  // a capability opens and order_entry's own tile is the Orders page.
  { code: "order_entry", label: "Refunds & Returns", icon: "♻️", href: "/dashboard/returns",
    description: "Post a refund immediately, or raise a return for MD/Admin approval — and track what is still pending." },
  { code: "hr_letters", label: "Agreement Generator", icon: "📑", href: "/dashboard/agreements",
    description: "Legal & Compliance — vendor agreements (NDA, supplier, design IP, e-commerce, data protection, software, photography, logistics, custom) as numbered PDFs on the official letterhead, with version history, WhatsApp sharing, signed-copy upload and activation." },
  { code: "employee_admin", label: "Employees", icon: "👥", href: "/dashboard/admin/employees",
    description: "Manage the employee roster." },
  // 2026-11-25 — automatic WhatsApp order-status messages (Hold / Cancel /
  // Process). Admin-controlled like the roster: enable/disable, per-trigger
  // toggles, templates, connection test, history and manual retry.
  { code: "employee_admin", label: "WhatsApp Messages", icon: "💬", href: "/dashboard/admin/whatsapp",
    description: "Automatic customer WhatsApp messages when an order becomes Hold, Cancelled or In Production — toggles, templates, connection test, delivery history and manual retry." },
  // 2026-10-21 — same capability, a second destination (same pattern as
  // doc_entry's multiple entries below): which one-time db/2026-*.sql files
  // this database has actually had run. See src/lib/migrations/probes.ts for
  // why a pending file needs its own visible answer — the app keeps working
  // without it, which is exactly how "the fix is live" became impossible to
  // tell from "the fix was never applied".
  { code: "employee_admin", label: "Database / Migrations", icon: "🧩", href: "/dashboard/admin/migrations",
    description: "See which one-time SQL files are applied, and which are still pending." },
  { code: "permissions_admin", label: "Roles & Permissions", icon: "🔐", href: "/dashboard/admin/permissions",
    description: "Set which role gets which capability — self-service, no code change needed." },
  { code: "reports", label: "Reports", icon: "📈", href: "/dashboard/reports",
    description: "The Reports suite." },
  // 2026-11-23 — "ORDER PAGE ME HI KAR DO NA ADD KI SELECT GENRATE INVOICE, JO
  // INVOICE KA SECTION HAI USKO VAHA SE REMOVE KAR KE SARE SYSTEM IDHR HI KAR
  // DO": invoice generation lives on the Orders hub now (select rows →
  // Generate Invoice). The separate Invoices tile/section is hidden, but the
  // capability itself stays in this registry so Roles & Permissions keeps
  // showing who may generate/print invoices — and /dashboard/invoices
  // redirects to Orders for old bookmarks.
  { code: "invoicing", label: "Invoices", icon: "🧾", href: "/dashboard/orders",
    description: "Generate export sales invoices (CSB-V/CSB-IV) — done from the Orders page by selecting rows and pressing Generate Invoice. This tile is how invoicing-only staff reach that page; order entry/edit/delete actions stay hidden for them." },
  { code: "ad_spend_entry", label: "Store Ad Spend", icon: "📈", href: "/dashboard/ad-spend",
    description: "Enter daily Budget/Spend per store and view the combined Orders + Ad Spend report." },
  // 2026-11-14 — finished-goods Inventory became a full module. The legacy
  // auto-restock view that used to own /dashboard/inventory now lives one
  // level down, so its tile keeps working unchanged.
  // 2026-11-20d — "5 alag alag section bana diya sabhi ek hi section me ho":
  // every inventory sub-screen is now reached from the ONE Inventory Management
  // tile (its own tabs + dashboard shortcuts), so the sub-capabilities stay in
  // this registry (permissions matrix, labels, descriptions) but are hidden from
  // the launcher/sidebar. inventory_view is granted to every role, so nobody
  // loses their way in.
  { code: "finished_stock_view", label: "Inventory (legacy view)", icon: "♻️", href: "/dashboard/inventory/finished-goods", hidden: true,
    description: "Finished-goods Stock — auto-restocked from cancelled+refunded+already-purchased orders." },
  // 2026-11-14 — Inventory Management module (see
  // db/2026-11-14c-inventory-management-module.sql). Four capabilities share
  // one module: viewing is company-wide, the other three are split because
  // moving stock, issuing a challan and changing SKU masters are different
  // jobs done by different people.
  { code: "inventory_view", label: "Inventory Management", icon: "📦", href: "/dashboard/inventory",
    description: "Live finished-goods stock by stage (raw, printing, washing, QC, ready), PCS and SQ FT, reservations, ledger and reports." },
  { code: "inventory_manage", label: "Stock Operations", icon: "📥", href: "/dashboard/inventory/stock", hidden: true,
    description: "Stock inward, audited corrections, reservations, and printing/washing/manufacturing updates." },
  { code: "inventory_dispatch", label: "Challan & Dispatch", icon: "🚚", href: "/dashboard/inventory/challans", hidden: true,
    description: "Create, issue and cancel customer challans — issuing is what deducts READY stock." },
  { code: "inventory_settings", label: "Inventory Settings", icon: "⚙️", href: "/dashboard/inventory/settings", hidden: true,
    description: "Products, variant SKUs with size/colour and SQ FT per piece, warehouses, and each category's workflow." },
  // 2026-11-20 — central inventory layer. Master SKUs are shared physical
  // identity, so changing/merging them is its own admin capability rather
  // than part of day-to-day stock operations.
  { code: "inventory_master_admin", label: "Master SKU Admin", icon: "🧬", href: "/dashboard/inventory/masters", hidden: true,
    description: "Create and merge Master SKUs, fix their size/colour/material identity, and map each store SKU — every change is audited." },
  { code: "inventory_photo_upload", label: "Physical Stock Photos", icon: "📷", href: "/dashboard/inventory/stock", hidden: true,
    description: "Attach the mandatory actual photo(s) when recording a physical stock entry or a correction." },
  { code: "inventory_review", label: "Order–Stock Photo Review", icon: "🔍", href: "/dashboard/inventory", hidden: true,
    description: "Compare an order's reference photos with the actual stock photos side by side and approve or reject allocation." },
  { code: "inventory_stock_approve", label: "Stock Entry Approval", icon: "✅", href: "/dashboard/inventory/stock", hidden: true,
    description: "Approve or reject physical stock entries and audited corrections; unapproved entries never become available stock." },
  { code: "inventory_central_allocate", label: "Central Allocation", icon: "🏭", href: "/dashboard/inventory/reservations", hidden: true,
    description: "Allocate one Master SKU's physical stock across companies/stores when a matching stock entry is approved." },
  { code: "inventory_return_settle", label: "Return Settlement", icon: "↩️", href: "/dashboard/orders", hidden: true,
    description: "Record a return's physical settlement — only an approved locally-received return with photos may add stock back." },
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
  // 2026-09-05: AI Companion — finalized from the companion-preview mockup.
  // Per-EMPLOYEE toggle (employees.companion_enabled), not a role grant —
  // this capability only gates who may SEE/USE this admin screen, same
  // pattern as permissions_admin. See db/2026-09-05-ai-companion-live.sql.
  { code: "companion_admin", label: "AI Companion Access", icon: "🧚", href: "/dashboard/admin/companion-access",
    description: "Turn the live AI companion on/off for specific employees — a per-person switch, not a role permission." },
  // 2026-09-08: Error Tab — see db/2026-09-08-error-log.sql. Gates VIEWING
  // and RESOLVING the log (Admin/MD only, same 2 roles as audit_log_view).
  // Raising a manual flag needs no capability — any signed-in employee can
  // flag an entry from the order detail page.
  { code: "error_log_view", label: "Error Tab", icon: "⚠️", href: "/dashboard/error-log",
    description: "Wrong entries in one place — form validation failures, failed courier bookings, and staff-flagged mistakes, with who/when and a resolved/pending status." },
  // 2026-09-17: Bank & Card Reconciliation — see db/2026-09-17-bank-recon.sql.
  // Deliberately its own capability (Finance/Admin/MD grant to start): it
  // shows real bank balances + card outstanding, more sensitive than
  // bill_payment alone. Finance also keeps csv_upload, so Finance can do
  // the whole flow without a permissions change.
  { code: "bank_recon", label: "Bank & Card Reconciliation", icon: "🏦", href: "/dashboard/bank-recon",
    description: "Add every bank account and credit card, upload their statements (any format auto-maps), and auto-match UTR / reference / invoice / party / store payouts — old payments are never modified." },
  // 2026-09-29: Team Directory — a VIEW-ONLY company contact book open to
  // every signed-in employee: name, photo, designation, role, email,
  // WhatsApp, joining date. Deliberately its own capability (NOT folded
  // into employee_admin — that one manages the roster and must stay
  // Admin/MD-only) and deliberately a NARROWER field set: no bank/statutory
  // columns, no salary/advance data, no documents. The Roles & Permissions
  // matrix can grant it to any role without any code change.
  { code: "team_directory", label: "Team Directory", icon: "📇", href: "/dashboard/team",
    description: "View-only company contact book — teammates' names, photos, designations, roles and contact details. No bank/statutory data." },
  // 2026-09-30: B2B Inquiry Management — "B2B INQUIRY HANDLE / REPORT /
  // INVOICE / AND RELATED SECTION PAYMENT MODE & MANY MORE". The full
  // trade-buyer pipeline: register an inquiry, discuss, send a quotation
  // (WhatsApp/email outside the app — sent_at records when), mark it won/
  // lost, convert to a real order, and record money received mode-wise
  // (Cash / Bank Transfer / UPI / Cheque / Card / Advance). MD/Admin to
  // start — grant wider via the Roles & Permissions matrix, zero code
  // change (see db/2026-09-30-b2b-inquiries.sql).
  // 2026-11-18 — Etsy Multilingual Translation & SEO module
  // (db/2026-11-17-etsy-translations.sql). One English source listing per SKU
  // and ten independent localized listings (title + description + exactly 13
  // SEO tags) generated with the same GEMINI_API_KEY the AI companion uses.
  // 2026-11-19 — hidden from the launcher: the SEO Generator supersedes it, so
  // the OMS shows ONE Etsy section. The route still works for employees who
  // only hold `etsy_translation` (and it redirects to the SEO Generator
  // otherwise); the entry stays here so the permissions matrix keeps its label.
  { code: "etsy_translation", label: "Etsy Translations", icon: "🌐", href: "/dashboard/etsy-translations", hidden: true,
    description: "Turn one English Etsy listing into 10 localized, SEO-optimized listings — title, description and 13 tags per language, each saved and editable independently." },
  // 2026-11-18 — Etsy International SEO Generator
  // (db/2026-11-18-etsy-seo-generator.sql). Research → generate all ten
  // languages → deterministic validation → export, with Gemini as the primary
  // provider and an optional OpenRouter backup. Separate from the older
  // SKU-only `etsy_translation` module, which stays untouched.
  { code: "etsy_seo_generator", label: "Etsy SEO Generator", icon: "🌍", href: "/dashboard/etsy-seo",
    description: "Full Etsy SEO studio — per-market keyword research, ten localized listings (title, 13 tags, description, image alt text), deterministic validation and score, competitor analysis, and Excel/CSV/JSON export with AI usage tracking." },
  { code: "b2b_inquiry", label: "B2B Inquiries", icon: "🤝", href: "/dashboard/b2b",
    description: "B2B export ERP end to end — inquiry register, buyer CRM, product master (auto-SKU + BOM), quotation costing engine, sales orders, production/QC, shipments, payments and the Control Center dashboard with automatic alerts." },
];

export function capabilityInfoFor(code: string): CapabilityInfo | undefined {
  return CAPABILITY_INFO.find((c) => c.code === code);
}

/**
 * The tiles a launcher / sidebar / dock shows this employee: one per held
 * capability, minus hidden registry entries and minus fallback tiles whose
 * section is already covered by another capability the employee holds
 * (see CapabilityInfo.hideWhenAny). Shared so all three surfaces agree.
 */
export function capabilityTilesFor(capabilities: string[]): CapabilityInfo[] {
  const held = new Set(capabilities);
  return CAPABILITY_INFO.filter(
    (c) => !c.hidden && held.has(c.code) && !(c.hideWhenAny ?? []).some((code) => held.has(code))
  );
}
