// 2026-10-16 — Content for the public landing page (/).
//
// EVERY module below is a real, shipped screen of this OMS — labels and
// hrefs are taken from the app's own capability registry
// (src/lib/capability-info.ts) and its route tree, so the marketing page can
// never advertise something the product doesn't actually have. Keep it that
// way: if a module is removed or renamed, change it here too.
export type LandingModule = {
  icon: string;
  label: string;
  blurb: string;
  href: string;
};

export type LandingGroup = {
  id: string;
  icon: string;
  title: string;
  summary: string;
  tone: "blue" | "cyan" | "amber" | "violet" | "emerald" | "rose";
  modules: LandingModule[];
};

export const MODULE_GROUPS: LandingGroup[] = [
  {
    id: "orders",
    icon: "📦",
    title: "Orders & Dispatch",
    summary: "Order in, shipped out and tracked — with the paperwork the courier actually needs.",
    tone: "blue",
    modules: [
      {
        icon: "📝",
        label: "Order Entry",
        blurb: "PO / RF / RG numbers assigned automatically, with a duplicate-dispatched-order check before anything new is created.",
        href: "/dashboard/orders",
      },
      {
        icon: "🚚",
        label: "Courier Booking + AWB",
        blurb: "Book a real shipment, print its label and track it — FedEx, UPS, Aramex, Delhivery, Shiprocket, DHL.",
        href: "/dashboard/courier-booking",
      },
      {
        icon: "🌍",
        label: "Shipglobal Shipments",
        blurb: "Create a real export shipment with label and customs declaration (DPD / UniUni / VipParcel / DHL eCommerce / UBI).",
        href: "/dashboard/shipglobal",
      },
      {
        icon: "🧾",
        label: "Shipments & Packages",
        blurb: "Record how an order actually shipped — one or many packages, sharing an AWB or each getting its own.",
        href: "/dashboard/order-packages",
      },
      {
        icon: "🧮",
        label: "Freight Cost Estimator",
        blurb: "Compare shipping cost by courier, zone and weight slab before booking — from the maintained rate card.",
        href: "/dashboard/freight-estimate",
      },
      {
        icon: "📊",
        label: "Courier Rate Card",
        blurb: "The courier / zone / weight-slab rate sheet the estimator reads, editable by finance.",
        href: "/dashboard/courier-rates",
      },
      {
        icon: "↩️",
        label: "Returns",
        blurb: "Returned and refunded orders flow back into finished-goods stock instead of being lost in a sheet.",
        href: "/dashboard/returns",
      },
      {
        icon: "📤",
        label: "Bulk CSV Entry",
        blurb: "Load the back-office log sheets in bulk, with a downloadable template for every upload screen.",
        href: "/dashboard/csv-upload",
      },
    ],
  },
  {
    id: "marketplace",
    icon: "🛒",
    title: "Marketplaces & Money",
    summary: "Etsy, eBay, Amazon and the website reconciled against the money that actually landed.",
    tone: "amber",
    modules: [
      {
        icon: "📄",
        label: "Marketplace Statements",
        blurb: "Etsy monthly tax invoice, eBay financial summary and Amazon transactions — imported or entered, then matched to orders.",
        href: "/dashboard/statements",
      },
      {
        icon: "📈",
        label: "Store Ad Spend",
        blurb: "Daily budget vs spend per store, budget per Amazon marketplace country, and every entry verified against the monthly statement.",
        href: "/dashboard/ad-spend",
      },
      {
        icon: "🧾",
        label: "Export Invoices",
        blurb: "Generate CSB-V / CSB-IV export invoices against dispatched orders.",
        href: "/dashboard/invoices",
      },
      {
        icon: "💳",
        label: "Bill Payment & Wallet",
        blurb: "Bill-payment workflow with a party wallet, advance adjustments and automatic settlement.",
        href: "/dashboard/bill-payment",
      },
      {
        icon: "✅",
        label: "Two-Level Approvals",
        blurb: "L1 and L2 bill sign-off, with a live queue on the dashboard header.",
        href: "/dashboard/approvals/l1",
      },
      {
        icon: "🏦",
        label: "Bank & Card Reconciliation",
        blurb: "Upload any bank or card statement, auto-map its columns and auto-match UTR / reference / invoice / store payouts.",
        href: "/dashboard/bank-recon",
      },
      {
        icon: "💱",
        label: "Exchange Rates",
        blurb: "The official rate master every USD/GBP/INR conversion reads, with a documented fallback rule.",
        href: "/dashboard/exchange-rates",
      },
      {
        icon: "🧾",
        label: "Office Expenses",
        blurb: "Rent, electricity, fuel and other overheads — fed into the P&L as their own line.",
        href: "/dashboard/expenses",
      },
    ],
  },
  {
    id: "stock",
    icon: "🗂️",
    title: "Stock & Documents",
    summary: "Every credit note, washing entry, purchase bill and stock movement in one audited place.",
    tone: "cyan",
    modules: [
      {
        icon: "🧾",
        label: "Document Entry",
        blurb: "Credit note, debit note, washing entry, purchase bill, courier bill, duty & tax bill, internal invoice — via PO / RF / RG or AWB lookup.",
        href: "/dashboard/documents",
      },
      {
        icon: "📦",
        label: "Raw Material Stock",
        blurb: "Stock in / stock out with a mandatory Chalan number on every movement.",
        href: "/dashboard/stock",
      },
      {
        icon: "🏬",
        label: "Finished Goods Inventory",
        blurb: "Finished stock auto-restocked from cancelled, refunded and already-purchased orders.",
        href: "/dashboard/inventory",
      },
      {
        icon: "🤝",
        label: "Party Master",
        blurb: "Vendor and buyer records with ledgers, outstanding and payment history.",
        href: "/dashboard/parties",
      },
      {
        icon: "🖨️",
        label: "Printing Register",
        blurb: "Production/printing entries tracked next to the orders they belong to.",
        href: "/dashboard/printing-register",
      },
      {
        icon: "📑",
        label: "Credit Notes Register",
        blurb: "Every credit note in one register, with totals and export.",
        href: "/dashboard/credit-notes-register",
      },
      {
        icon: "📉",
        label: "Debit Notes Register",
        blurb: "Every debit note we raised, party by party, printable as one list.",
        href: "/dashboard/debit-notes-register",
      },
    ],
  },
  {
    id: "b2b",
    icon: "🌐",
    title: "B2B Export ERP",
    summary: "The whole trade-buyer pipeline, from first enquiry to delivered container and payment.",
    tone: "violet",
    modules: [
      {
        icon: "🎛️",
        label: "Control Center",
        blurb: "Sales, order, production, QC, shipment, receivable and stock KPIs with an automatic alert panel.",
        href: "/dashboard/b2b/control-center",
      },
      {
        icon: "👥",
        label: "Buyers CRM",
        blurb: "Buyer profiles with lifetime value, outstanding and overdue computed from real orders and schedules.",
        href: "/dashboard/b2b/buyers",
      },
      {
        icon: "📦",
        label: "Products, Auto-SKU & BOM",
        blurb: "Five export product types with auto-SKU, type-specific specs, four price points and a live BOM requirement engine.",
        href: "/dashboard/b2b/products",
      },
      {
        icon: "🧮",
        label: "Quotation Engine",
        blurb: "Cost, packing, freight, discount, margin and a target-margin suggested price — then convert to a sales order.",
        href: "/dashboard/b2b/engine",
      },
      {
        icon: "🧾",
        label: "Sales Orders & P&L",
        blurb: "Status pipeline, per-line price vs cost, order P&L with the \"why is profit low?\" drill-down and a packing calculator.",
        href: "/dashboard/b2b/orders",
      },
      {
        icon: "🏭",
        label: "Production & QC",
        blurb: "Plans and inspections with completion %, configurable stage routing, pass / reject / rework and auto defect %.",
        href: "/dashboard/b2b/production",
      },
      {
        icon: "🚢",
        label: "Shipments",
        blurb: "Ports, forwarder, container and seal, BL/AWB and the full export document trail per shipment.",
        href: "/dashboard/b2b/shipments",
      },
      {
        icon: "🤝",
        label: "Inquiry Register",
        blurb: "Register an enquiry, discuss, quote, mark won/lost and convert — with mode-wise payment recording.",
        href: "/dashboard/b2b",
      },
    ],
  },
  {
    id: "people",
    icon: "🕒",
    title: "People, Attendance & Payroll",
    summary: "Punches, leave, shifts, performance and salary — computed from real attendance, never re-typed.",
    tone: "emerald",
    modules: [
      {
        icon: "🕒",
        label: "Web Punch In / Out",
        blurb: "Login punches in and logout punches out automatically; manual punch remains as the backup.",
        href: "/dashboard/attendance",
      },
      {
        icon: "🛰️",
        label: "GPS Reviews & Reports",
        blurb: "One-shot GPS fix on every web punch, an approve/reject queue, plus GPS and location reports.",
        href: "/dashboard/attendance/admin/gps-report",
      },
      {
        icon: "🗓️",
        label: "Attendance Admin",
        blurb: "Biometric report import with match/mismatch flags, holidays, weekly-off patterns and manual correction.",
        href: "/dashboard/attendance/admin",
      },
      {
        icon: "📒",
        label: "Attendance Reports",
        blurb: "Daily, monthly, periodic, yearly and calendar month-summary reports, exported to PDF/Excel/Word/CSV.",
        href: "/dashboard/attendance/admin/month-summary",
      },
      {
        icon: "🏖️",
        label: "Leave & Coverage",
        blurb: "Apply, approve and assign who covers the absent employee's store work, with automatic expiry.",
        href: "/dashboard/leave",
      },
      {
        icon: "💰",
        label: "Salary, PF/ESI/PT",
        blurb: "Attendance-based payroll with statutory deductions, CTC structure, advances and payslips.",
        href: "/dashboard/salary",
      },
      {
        icon: "🏆",
        label: "Performance & Awards",
        blurb: "Attendance, work efficiency, leave and order-value ranking per employee, for MD/Admin.",
        href: "/dashboard/attendance/admin/overview",
      },
      {
        icon: "✉️",
        label: "HR Letters",
        blurb: "Joining, offer, promotion, increment, experience, relieving and salary-slip letters.",
        href: "/dashboard/hr-letters",
      },
    ],
  },
  {
    id: "insight",
    icon: "📊",
    title: "Insight & Control",
    summary: "One dashboard for the numbers, one log for who changed what, and rules that keep moving.",
    tone: "rose",
    modules: [
      {
        icon: "📊",
        label: "P&L & CRM Overview",
        blurb: "Company-wide overview with the full P&L dashboard, outstanding, party ledgers and sale/profit reports.",
        href: "/dashboard/crm",
      },
      {
        icon: "📈",
        label: "Reports Suite",
        blurb: "Store expenses, freight & duty, purchase bills, SKU-country-size, sale & profit, party ledger, salary.",
        href: "/dashboard/reports",
      },
      {
        icon: "🕵️",
        label: "Audit Log",
        blurb: "Who changed or deleted what, and when — order status changes, bill, expense and shipment deletions.",
        href: "/dashboard/admin/audit-log",
      },
      {
        icon: "⚠️",
        label: "Error Tab",
        blurb: "Form failures, failed courier bookings and staff-flagged mistakes in one resolved/pending queue.",
        href: "/dashboard/error-log",
      },
      {
        icon: "🤖",
        label: "Automation Rules",
        blurb: "Trigger → condition → action rules that run on order status changes, no deploy needed.",
        href: "/dashboard/admin/automation",
      },
      {
        icon: "💾",
        label: "Backup Export",
        blurb: "Every order with its generated invoice fields, all companies, as one Excel workbook.",
        href: "/dashboard/admin/backup",
      },
      {
        icon: "🧚",
        label: "AI Companion",
        blurb: "A per-employee in-app companion plus a help center of FAQ and guide articles.",
        href: "/dashboard/admin/companion-access",
      },
      {
        icon: "🔐",
        label: "Roles & Permissions",
        blurb: "Grant any capability to any role from the UI — access control is data, not a redeploy.",
        href: "/dashboard/admin/permissions",
      },
    ],
  },
];

export const MARKETPLACES = ["Etsy", "eBay", "Amazon", "WooCommerce", "Website store"];

export const COURIERS = ["Delhivery", "UPS", "FedEx", "Shiprocket", "Aramex", "DHL", "Shipglobal"];

export const CHANNELS = [
  {
    icon: "🔔",
    title: "Telegram punch confirmations",
    detail: "Punch in/out is confirmed to each employee's own Telegram, with the day's total hours.",
  },
  {
    icon: "📸",
    title: "Order photos to Telegram",
    detail: "Order photos and documents go out over the same bot, straight from the order screen.",
  },
  {
    icon: "💬",
    title: "In-app messages, help center & companion",
    detail: "Internal messaging, a searchable help center and the AI companion on any page.",
  },
  {
    icon: "🚚",
    title: "Live carrier tracking",
    detail: "Push webhooks from Delhivery, UPS and Shiprocket, plus polling for FedEx, Aramex and DHL.",
  },
];

export const WORKFLOW = [
  {
    step: "01",
    title: "Order lands",
    detail: "Entered by hand, imported in bulk, or synced from the marketplace — PO/RF/RG numbering and the duplicate check are automatic.",
  },
  {
    step: "02",
    title: "Stock & documents",
    detail: "Raw material in/out against Chalan numbers, credit notes, purchase bills and duty bills filed against the order it belongs to.",
  },
  {
    step: "03",
    title: "Booked and shipped",
    detail: "Real AWB and label from the courier, packages recorded per shipment, freight estimated against the rate card before you commit.",
  },
  {
    step: "04",
    title: "Tracked to the door",
    detail: "Carrier events land on the order continuously, so \"where is it\" never needs a phone call to the courier.",
  },
  {
    step: "05",
    title: "Reconciled against statements",
    detail: "Etsy, eBay and Amazon fees matched to real orders, and ad budget/spend verified against the monthly statement — including Amazon marketplace country by country.",
  },
  {
    step: "06",
    title: "Approved, paid, banked",
    detail: "L1/L2 bill approvals, party wallet and advances settled, then the bank and card statement matched by UTR, reference or payout.",
  },
  {
    step: "07",
    title: "People paid, numbers closed",
    detail: "Attendance and leave feed payroll with PF/ESI/PT; the P&L, reports suite and audit log close the month.",
  },
];

export const SECURITY_PILLARS = [
  {
    icon: "🔐",
    title: "Capability-based access",
    detail: "Every screen and server action is gated on a role capability re-checked on the server — never trusted from the browser.",
  },
  {
    icon: "🛡️",
    title: "Row-level security",
    detail: "Row-level policies on the newer tables, with privileged reads deliberately routed through capability-checked server code.",
  },
  {
    icon: "📱",
    title: "Two-factor sign-in",
    detail: "Per-account TOTP: an enrolled login is challenged for its second factor before any dashboard page renders.",
  },
  {
    icon: "🏢",
    title: "Company & store scoping",
    detail: "Data is scoped to the companies and stores a login may act for — including temporary coverage grants that expire on their own.",
  },
  {
    icon: "🕵️",
    title: "Audit trail",
    detail: "Order status changes and deletions of bills, expenses and shipments are recorded with who and when.",
  },
  {
    icon: "💾",
    title: "Your data, exported",
    detail: "One-click backup export of every order and generated invoice field, plus per-screen Excel/CSV/PDF exports everywhere.",
  },
];

export const STACK_FACTS = [
  { label: "Framework", value: "Next.js 16 · React 19 · TypeScript" },
  { label: "Database", value: "Postgres (Supabase) with RLS" },
  { label: "Styling", value: "Tailwind CSS v4, themeable per company" },
  { label: "Automation", value: "Scheduled sync + carrier polling jobs" },
];

export const HERO_STATS = [
  { value: 3, suffix: "", label: "Companies on one login" },
  { value: MARKETPLACES.length, suffix: "", label: "Sales channels reconciled" },
  { value: COURIERS.length, suffix: "", label: "Courier integrations" },
  { value: MODULE_GROUPS.reduce((total, group) => total + group.modules.length, 0), suffix: "+", label: "Live modules" },
];
