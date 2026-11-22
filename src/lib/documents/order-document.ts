// 2026-11-22d — Phase 4: the data model behind the four order documents
// (Order Sheet / Invoice / Tax Invoice / Packing List).
//
// Pure on purpose (no React, no PDF, no Supabase): the same model feeds the
// PDF renderer today and could feed the on-screen print sheet later, and the
// rules that matter — which columns a document shows, how a line's money is
// added up, what a mixed-currency invoice means, what the downloaded file is
// called — are all unit-tested without a database
// (order-document.test.ts).

export const DOCUMENT_KINDS = ["order", "invoice", "tax-invoice", "packing-list"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  order: "Order Sheet",
  invoice: "Invoice",
  "tax-invoice": "Tax Invoice",
  "packing-list": "Packing List",
};

/** A Packing List is a shipping document: quantities, no money. */
export function showsPrices(kind: DocumentKind): boolean {
  return kind !== "packing-list";
}

/** HSN + taxable-value columns belong to a tax invoice only. */
export function showsTaxColumns(kind: DocumentKind): boolean {
  return kind === "tax-invoice";
}

export type DocumentLine = {
  refNo: string | null;
  description: string | null;
  sku: string | null;
  size: string | null;
  colour: string | null;
  hsn: string | null;
  qty: number;
  /** Value of this line in its own currency (null when not recorded). */
  amount: number | null;
  currency: string | null;
  /** INR equivalent already stored on the order (invoice conversion). */
  amountInr: number | null;
};

export type DocumentMoneyTotal = { currency: string; amount: number };

export type DocumentTotals = {
  qty: number;
  /** One entry per distinct currency — usually exactly one. */
  money: DocumentMoneyTotal[];
  /** True when the lines are not all in the same currency. */
  mixedCurrency: boolean;
  /** Sum of the stored INR equivalents, when every line has one. */
  inr: number | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A document that shows no prices reports no money — but keeps its quantity. */
function withoutMoney(totals: DocumentTotals): DocumentTotals {
  return { ...totals, money: [], mixedCurrency: false, inr: null };
}

/** Adds up a document's lines. Money is summed per currency, never across. */
export function documentTotals(lines: DocumentLine[]): DocumentTotals {
  const qty = lines.reduce((sum, line) => sum + (Number.isFinite(line.qty) ? line.qty : 0), 0);

  const byCurrency = new Map<string, number>();
  for (const line of lines) {
    if (line.amount === null || !Number.isFinite(line.amount)) continue;
    const currency = (line.currency ?? "").trim() || "—";
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + line.amount);
  }

  const money = Array.from(byCurrency.entries())
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));

  const allHaveInr = lines.length > 0 && lines.every((line) => line.amountInr !== null && Number.isFinite(line.amountInr));
  const inr = allHaveInr ? round2(lines.reduce((sum, line) => sum + (line.amountInr ?? 0), 0)) : null;

  return { qty, money, mixedCurrency: money.length > 1, inr };
}

export type DocumentCompany = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  logoUrl: string | null;
};

export type DocumentParty = {
  heading: string;
  name: string;
  address: string | null;
  contact: string | null;
  destination: string | null;
};

export type OrderDocumentModel = {
  kind: DocumentKind;
  title: string;
  docNo: string;
  docDate: string;
  /** Master invoice no. / marketplace order no., when one exists. */
  secondaryNo: string | null;
  status: string | null;
  storeName: string | null;
  company: DocumentCompany;
  party: DocumentParty;
  lines: DocumentLine[];
  totals: DocumentTotals;
  currency: string | null;
  photos: string[];
  showPrices: boolean;
  showTaxColumns: boolean;
};

export type CompanySource = {
  name?: string | null;
  logo_url?: string | null;
};

export type CompanyProfileSource = {
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
};

export type OrderSource = {
  ref_no: string;
  order_date: string;
  buyer_name_address?: string | null;
  contact_no?: string | null;
  destination_country?: string | null;
  sku_label?: string | null;
  size_label?: string | null;
  colour?: string | null;
  qty?: number | null;
  order_currency?: string | null;
  order_value_original?: number | string | null;
  order_value_inr?: number | string | null;
  marketplace_order_no?: string | null;
  photo_url?: string | null;
  photo_urls?: (string | null)[] | null;
  status?: string | null;
};

export type InvoiceSource = {
  invoice_no: string;
  invoice_date: string;
  master_invoice_no?: string | null;
};

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function companyOf(company: CompanySource | null | undefined, profile: CompanyProfileSource | null | undefined): DocumentCompany {
  return {
    name: company?.name ?? "",
    address: profile?.address ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    gstin: profile?.gstin ?? null,
    logoUrl: company?.logo_url ?? null,
  };
}

/** Close-up photos come from the shared read path; main photo excluded here. */
function photosOf(source: OrderSource): string[] {
  return (source.photo_urls ?? []).filter((url): url is string => typeof url === "string" && !!url.trim());
}

function lineOf(source: OrderSource, hsn: string | null): DocumentLine {
  return {
    refNo: source.ref_no ?? null,
    description: null,
    sku: source.sku_label ?? null,
    size: source.size_label ?? null,
    colour: source.colour ?? null,
    hsn,
    qty: num(source.qty) ?? 0,
    amount: num(source.order_value_original),
    currency: source.order_currency ?? null,
    amountInr: num(source.order_value_inr),
  };
}

/**
 * A single order as its own document. `kind` only controls what is shown —
 * Packing List hides money, Tax Invoice adds the HSN column.
 */
export function buildOrderDocument(input: {
  kind: DocumentKind;
  order: OrderSource;
  company?: CompanySource | null;
  profile?: CompanyProfileSource | null;
  invoice?: InvoiceSource | null;
  storeName?: string | null;
  hsnCode?: string | null;
}): OrderDocumentModel {
  const { kind, order } = input;
  const line = lineOf(order, input.hsnCode ?? null);
  // Quantities are always reported; a Packing List carries no money at all.
  const measured = documentTotals([line]);
  const totals = showsPrices(kind) ? measured : withoutMoney(measured);

  return {
    kind,
    title: DOCUMENT_TITLES[kind],
    docNo: kind === "order" ? order.ref_no : input.invoice?.invoice_no ?? order.ref_no,
    docDate: kind === "order" ? order.order_date : input.invoice?.invoice_date ?? order.order_date,
    secondaryNo: input.invoice?.master_invoice_no ?? order.marketplace_order_no ?? null,
    status: order.status ?? null,
    storeName: input.storeName ?? null,
    company: companyOf(input.company, input.profile),
    party: {
      heading: "Buyer",
      name: order.buyer_name_address ?? "",
      address: order.destination_country ? `Destination: ${order.destination_country}` : null,
      contact: order.contact_no ?? null,
      destination: order.destination_country ?? null,
    },
    lines: [line],
    totals,
    currency: order.order_currency ?? null,
    photos: photosOf(order),
    showPrices: showsPrices(kind),
    showTaxColumns: showsTaxColumns(kind),
  };
}

/**
 * One invoice with all of its orders as lines. The invoice's own buyer is the
 * first order's buyer; a multi-buyer invoice keeps them in the line's reference
 * column instead of inventing a combined name.
 */
export function buildInvoiceDocument(input: {
  kind: DocumentKind;
  invoice: InvoiceSource;
  orders: OrderSource[];
  company?: CompanySource | null;
  profile?: CompanyProfileSource | null;
  storeName?: string | null;
  hsnByRef?: Record<string, string | null>;
}): OrderDocumentModel {
  const { kind, invoice, orders } = input;
  const priced = showsPrices(kind);
  const lines = orders.map((order) =>
    lineOf(order, input.hsnByRef?.[order.ref_no] ?? null)
  );
  // Quantities are always reported; a Packing List carries no money at all.
  const measured = documentTotals(lines);
  const totals = priced ? measured : withoutMoney(measured);
  const first = orders[0] ?? null;
  const currencies = new Set(
    orders.map((order) => (order.order_currency ?? "").trim()).filter((currency) => !!currency)
  );

  return {
    kind,
    title: DOCUMENT_TITLES[kind],
    docNo: invoice.invoice_no,
    docDate: invoice.invoice_date,
    secondaryNo: invoice.master_invoice_no ?? null,
    status: null,
    storeName: input.storeName ?? null,
    company: companyOf(input.company, input.profile),
    party: {
      heading: "Buyer",
      name: first?.buyer_name_address ?? "",
      address: first?.destination_country ? `Destination: ${first.destination_country}` : null,
      contact: first?.contact_no ?? null,
      destination: first?.destination_country ?? null,
    },
    lines,
    totals,
    currency: currencies.size === 1 ? Array.from(currencies)[0] : null,
    photos: orders.flatMap((order) => photosOf(order)).filter((url, index, all) => all.indexOf(url) === index),
    showPrices: priced,
    showTaxColumns: showsTaxColumns(kind),
  };
}

/** "INVOICE-INV-0001.pdf", "PACKING-LIST-NPO-26-27-0001.pdf". */
export function documentFileName(model: Pick<OrderDocumentModel, "kind" | "docNo">): string {
  const clean = (value: string) =>
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  const prefix = DOCUMENT_TITLES[model.kind].toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  const number = clean(model.docNo) || "document";
  return `${prefix}-${number}.pdf`;
}

/** Lines per printed page, chosen so a full page of line items still fits. */
export const LINES_PER_PAGE = 20;

/**
 * Splits a document's lines into explicit printed pages.
 *
 * The PDF builder renders ONE page per chunk, which is what lets every sheet
 * carry the letterhead, the table head and the correct "Page X of Y" — no
 * relying on the renderer's automatic page breaks. A document with no lines
 * still has one (empty) page.
 */
export function paginateLines<T>(lines: T[], perPage: number = LINES_PER_PAGE): T[][] {
  const size = Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : LINES_PER_PAGE;
  if (!lines.length) return [[]];
  const pages: T[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    pages.push(lines.slice(index, index + size));
  }
  return pages;
}

/** "1,234.50" — grouped, 2dp; the currency code is rendered separately. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
