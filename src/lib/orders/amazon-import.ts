// 2026-11-03 — "ye jo book.png hai ye actual me excel me hai jo amazon ka
// order ka data hai to isi formate me bulk order sirf amazon ke dalne ka set
// kar do": Amazon-only bulk order import. Pure parsing only (no Supabase), so
// the action that creates the orders stays a thin wrapper and the same
// parser can drive both the PREVIEW and the CREATE pass over one upload.
//
// Two shapes are recognized, because Amazon order data reaches this app in
// two forms:
//  1. The Amazon "All Orders" report (tab/comma separated or Excel): a real
//     header row with amazon-order-id / buyer-name / purchase-date /
//     item-price / quantity-purchased / currency / ship-* columns. One row
//     = one order line.
//  2. A ledger/"book" sheet: one block per order, opened by a row whose
//     label cell reads Order No / PO No / Order Id, with the values printed
//     to its right (order no, date, buyer, size, qty, amount, currency …)
//     and follow-up rows labelled SALE / Refund / OUT / Status / Notes.
//     Anything after the label rows is treated as notes/remarks.
//
// Every row that cannot be read unambiguously is reported with its line
// number instead of being guessed at — the preview shows exactly what would
// be created before anything is written.

export type AmazonOrderRow = {
  line: number;
  orderNo: string;
  orderDate: string | null; // YYYY-MM-DD
  buyerName: string;
  address: string; // buyer_name_address as it will be stored
  city: string;
  state: string;
  postalCode: string;
  country: string;
  size: string;
  colour: string;
  sku: string;
  qty: number | null;
  /** What the buyer paid: item price + shipping + tax − promotion discount when
   *  those columns exist, otherwise the plain amount column. */
  amount: number | null;
  currency: string | null;
  remark: string;
  /** Amazon "All Orders" extras, carried through the preview so nothing from the
   *  sheet is silently dropped (the OMS order itself has no column for them). */
  itemId: string;
  asin: string;
  productName: string;
  orderStatus: string;
  channel: string;
  merchantOrderId: string;
  tax: number | null;
  shipping: number | null;
  discount: number | null;
};

export type AmazonParseResult = {
  /** Rows ready to be created (may still be missing qty/amount — the action reports those). */
  rows: AmazonOrderRow[];
  issues: string[];
  shape: "amazon-report" | "ledger-blocks" | "none";
};

const MAX_ISSUES = 60;
const KNOWN_CURRENCIES = new Set([
  "USD", "INR", "EUR", "GBP", "CAD", "AUD", "AED", "SAR", "JPY", "SGD", "MXN", "BRL", "TRY", "SEK", "CHF", "NZD", "QAR", "KWD",
]);

function norm(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ORDER_HEADERS = ["amazonorderid", "orderid", "orderno", "ordernumber", "amazonorderno", "ordercode", "pono", "poid"];
const DATE_HEADERS = ["purchasedate", "orderdate", "saledate", "date", "saledt", "orderdt"];
const BUYER_HEADERS = ["buyername", "customername", "shiptoname", "billtoname", "name", "buyer", "customer"];
const ADDRESS_HEADERS = ["shipaddress1", "shiptoaddress1", "shiptoaddress", "buyeraddress", "buyernameaddress", "address", "fulladdress"];
const CITY_HEADERS = ["shipcity", "city", "buyercity"];
const STATE_HEADERS = ["shipstate", "state", "province", "buyerstate"];
const POSTAL_HEADERS = ["shippostalcode", "postalcode", "zip", "zipcode", "pincode"];
const COUNTRY_HEADERS = ["shipcountry", "country", "buyercountry"];
const QTY_HEADERS = ["quantitypurchased", "quantity", "qty", "itemquantity", "pieces", "pcs"];
const AMOUNT_HEADERS = ["itemprice", "orderamount", "ordervalue", "amount", "total", "price", "value", "saleprice"];
const CURRENCY_HEADERS = ["currency", "ordercurrency", "currencycode", "curr"];
const SKU_HEADERS = ["sku", "sellersku", "itemsku"];
const SIZE_HEADERS = ["size", "itemsize", "sizelabel"];
const COLOUR_HEADERS = ["colour", "color", "itemcolor", "itemcolour"];
const NOTE_HEADERS = ["remark", "remarks", "note", "notes", "comment", "comments"];
// Amazon "All Orders" report (the sheet shape the OMS is fed manually).
const ITEM_ID_HEADERS = ["orderitemid", "itemid", "orderlineid", "lineitemid"];
const ASIN_HEADERS = ["asin", "productasin"];
const PRODUCT_HEADERS = ["productname", "itemname", "itemtitle", "title"];
const STATUS_HEADERS = ["orderstatus", "status", "itemstatus"];
const CHANNEL_HEADERS = ["fulfillmentchannel", "saleschannel", "channel", "fulfilledby", "shipservicelevel"];
const MERCHANT_ORDER_HEADERS = ["merchantorderid", "merchantid", "sellerorderid"];
const TAX_HEADERS = ["itemtax", "tax", "taxamount"];
const SHIPPING_HEADERS = ["shippingprice", "shipping", "shippingamount", "shipcharge"];
const DISCOUNT_HEADERS = ["itempromotiondiscount", "promotiondiscount", "discount", "itemdiscount"];

type Field =
  | "orderNo"
  | "orderDate"
  | "buyerName"
  | "address"
  | "city"
  | "state"
  | "postalCode"
  | "country"
  | "size"
  | "colour"
  | "sku"
  | "qty"
  | "amount"
  | "currency"
  | "remark"
  | "itemId"
  | "asin"
  | "productName"
  | "orderStatus"
  | "channel"
  | "merchantOrderId"
  | "tax"
  | "shipping"
  | "discount";

const HEADER_FIELDS: Record<Field, string[]> = {
  orderNo: ORDER_HEADERS,
  orderDate: DATE_HEADERS,
  buyerName: BUYER_HEADERS,
  address: ADDRESS_HEADERS,
  city: CITY_HEADERS,
  state: STATE_HEADERS,
  postalCode: POSTAL_HEADERS,
  country: COUNTRY_HEADERS,
  size: SIZE_HEADERS,
  colour: COLOUR_HEADERS,
  sku: SKU_HEADERS,
  qty: QTY_HEADERS,
  amount: AMOUNT_HEADERS,
  currency: CURRENCY_HEADERS,
  remark: NOTE_HEADERS,
  itemId: ITEM_ID_HEADERS,
  asin: ASIN_HEADERS,
  productName: PRODUCT_HEADERS,
  orderStatus: STATUS_HEADERS,
  channel: CHANNEL_HEADERS,
  merchantOrderId: MERCHANT_ORDER_HEADERS,
  tax: TAX_HEADERS,
  shipping: SHIPPING_HEADERS,
  discount: DISCOUNT_HEADERS,
};

/** "01/10/2026" | "2026-10-01" | "1 Oct 2026" | "2026-10-01T12:00:00Z" → YYYY-MM-DD. */
export function parseAmazonDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12 && day <= 12) {
      const t = day;
      day = month;
      month = t;
    }
    if (day > 31 || month > 12) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2,4})/.exec(s);
  if (m) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return `${year}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

/** "$72.39" | "USD 72.39" | "1,234.50" | "72.39" → 72.39. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").replace(/[^\d.\-,]/g, "").replace(/,/g, "");
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function looksLikeOrderNo(s: string): boolean {
  const v = s.trim();
  if (!v || v.length < 5 || v.length > 40) return false;
  if (!/\d/.test(v)) return false;
  return /^[A-Za-z0-9#\-_/]+$/.test(v);
}

function looksLikeCurrency(s: string): boolean {
  return KNOWN_CURRENCIES.has(s.trim().toUpperCase());
}

function looksLikeSize(s: string): boolean {
  const v = s.trim();
  return /\d+\s*[xX×]\s*\d+/.test(v) || /\b(ft|feet|inch|in|cm|mm|mtr|m)\b/i.test(v) || /^custom/i.test(v);
}

function looksLikeQty(s: string): boolean {
  return /^\d{1,4}(\.0+)?$/.test(s.trim());
}

/** Does this row look like a header row (≥3 recognized labels)? */
function headerMap(row: unknown[]): Map<Field, number> | null {
  const map = new Map<Field, number>();
  row.forEach((cell, i) => {
    const key = norm(cell);
    if (!key) return;
    for (const field of Object.keys(HEADER_FIELDS) as Field[]) {
      if (!map.has(field) && HEADER_FIELDS[field].includes(key)) {
        map.set(field, i);
        return;
      }
    }
  });
  const hasWho = map.has("buyerName") || map.has("address");
  const hasWhat = map.has("qty") || map.has("amount") || map.has("size");
  return map.has("orderNo") && (hasWho || hasWhat) && map.size >= 3 ? map : null;
}

function cell(v: unknown): string {
  return String(v ?? "").trim();
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((c) => cell(c) === "");
}

function buildAddress(r: Partial<AmazonOrderRow>): string {
  const parts = [r.address, r.city, r.state, r.postalCode, r.country].map((p) => (p ?? "").trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), true)));
  const buyer = (r.buyerName ?? "").trim();
  if (!buyer) return unique.join(", ");
  if (unique.length === 0) return buyer;
  // Avoid "Jane Doe, 123 Main St, …, USA" repeated when the address column
  // already contains the buyer's name.
  return unique[0].toLowerCase().startsWith(buyer.toLowerCase())
    ? unique.join(", ")
    : [buyer, ...unique].join(", ");
}

function rowFromMap(row: unknown[], map: Map<Field, number>, line: number): AmazonOrderRow {
  const at = (f: Field) => (map.has(f) ? cell(row[map.get(f)!]) : "");
  const num = (f: Field) => (map.has(f) ? parseAmount(at(f)) : null);
  const currencyRaw = at("currency").toUpperCase();
  const base = num("amount");
  const tax = num("tax");
  const shipping = num("shipping");
  const discount = num("discount");
  // Amazon's item-price excludes shipping/tax and is BEFORE the promotion
  // discount, so the order value is the sum Amazon actually charged. Only
  // applied when the sheet really carries those columns.
  const hasBreakdown = tax != null || shipping != null || discount != null;
  const total =
    base == null ? null : Math.max(0, base + (shipping ?? 0) + (tax ?? 0) - (discount ?? 0));

  const remarkParts: string[] = [];
  const status = at("orderStatus");
  const channel = at("channel");
  const asin = at("asin");
  const itemId = at("itemId");
  const productName = at("productName");
  if (status) remarkParts.push(`Status: ${status}`);
  if (channel) remarkParts.push(`Channel: ${channel}`);
  if (productName) remarkParts.push(productName);
  if (asin) remarkParts.push(`ASIN ${asin}`);
  if (itemId) remarkParts.push(`Amazon item ${itemId}`);
  const sheetRemark = at("remark");
  if (sheetRemark) remarkParts.push(sheetRemark);

  return {
    line,
    orderNo: at("orderNo"),
    orderDate: parseAmazonDate(at("orderDate")),
    buyerName: at("buyerName"),
    address: at("address"),
    city: at("city"),
    state: at("state"),
    postalCode: at("postalCode"),
    country: at("country"),
    size: at("size"),
    colour: at("colour"),
    sku: at("sku"),
    qty: map.has("qty") ? parseAmount(at("qty")) : null,
    amount: hasBreakdown ? total : base,
    currency: looksLikeCurrency(currencyRaw) ? currencyRaw : null,
    remark: remarkParts.join(" · "),
    itemId,
    asin,
    productName,
    orderStatus: status,
    channel,
    merchantOrderId: at("merchantOrderId"),
    tax,
    shipping,
    discount,
  };
}

/** Label of the block layout ("Order No", "PO No", "SALE", "Refund", "OUT", …). */
function blockLabel(s: string): "order" | "sale" | "refund" | "out" | "status" | "notes" | null {
  const k = norm(s);
  if (["orderno", "ordernumber", "orderid", "amazonorderno", "amazonorderid", "pono", "poid", "refno"].includes(k)) return "order";
  if (["sale", "item", "product", "products"].includes(k)) return "sale";
  if (["refund", "return", "returns"].includes(k)) return "refund";
  if (["out", "dispatch", "dispatched", "shipped", "ship"].includes(k)) return "out";
  if (["status", "payment", "pay"].includes(k)) return "status";
  if (["notes", "note", "remark", "remarks", "comment", "comments"].includes(k)) return "notes";
  return null;
}

/**
 * Values printed to the right of a block label, classified by shape. Used for
 * the ledger/book layout where there is no header row to map columns from.
 */
function classifyBlockValues(values: string[]): Partial<AmazonOrderRow> & { leftover: string[] } {
  const out: Partial<AmazonOrderRow> & { leftover: string[] } = { leftover: [] };
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (!out.orderNo && looksLikeOrderNo(v) && !parseAmazonDate(v)) {
      out.orderNo = v;
      continue;
    }
    const d = parseAmazonDate(v);
    if (d && !out.orderDate) {
      out.orderDate = d;
      continue;
    }
    if (!out.currency && looksLikeCurrency(v) && !/\d/.test(v)) {
      out.currency = v.toUpperCase();
      continue;
    }
    if (!out.size && looksLikeSize(v)) {
      out.size = v;
      continue;
    }
    if (!out.colour && /^[A-Za-z][A-Za-z\s/&.'-]{2,24}$/.test(v) && /\b(black|white|grey|gray|beige|brown|blue|green|red|pink|yellow|orange|ivory|cream|multicolour|multicolor)\b/i.test(v)) {
      out.colour = v;
      continue;
    }
    const amt = parseAmount(v);
    if (amt != null) {
      const hasDecimals = /[.,]\d{1,2}\b/.test(v) || /[$₹€£]/.test(v);
      if (!hasDecimals && looksLikeQty(v) && out.qty == null && amt > 0 && amt <= 500) {
        out.qty = amt;
        continue;
      }
      if (out.amount == null) {
        out.amount = amt;
        continue;
      }
      if (out.qty == null && amt > 0 && amt <= 500) {
        out.qty = amt;
        continue;
      }
    }
    if (!out.buyerName && /[A-Za-z]{2,}/.test(v) && v.split(/\s+/).length <= 4 && v.length <= 60) {
      out.buyerName = v;
      continue;
    }
    out.leftover.push(v);
  }
  return out;
}

export function parseAmazonOrders(aoa: unknown[][]): AmazonParseResult {
  const issues: string[] = [];
  const pushIssue = (msg: string) => {
    if (issues.length < MAX_ISSUES) issues.push(msg);
  };
  const rows: AmazonOrderRow[] = [];
  const sheet = (aoa ?? []).filter((r) => !isBlankRow(r));
  if (!sheet.length) return { rows, issues: ["File me koi row nahi mili."], shape: "none" };

  // 1. Standard Amazon report / any flat sheet with a recognizable header.
  let headerRow = -1;
  let map: Map<Field, number> | null = null;
  for (let r = 0; r < Math.min(sheet.length, 15); r++) {
    const candidate = headerMap(sheet[r]);
    if (candidate) {
      headerRow = r;
      map = candidate;
      break;
    }
  }
  if (map && headerRow >= 0) {
    for (let r = headerRow + 1; r < sheet.length; r++) {
      const parsed = rowFromMap(sheet[r], map, r + 1);
      if (!parsed.orderNo && !parsed.buyerName && parsed.amount == null) continue;
      rows.push({ ...parsed, address: buildAddress(parsed) });
    }
    return { rows, issues, shape: "amazon-report" };
  }

  // 2. Ledger/"book" layout: one block per order, no header row.
  let current: (Partial<AmazonOrderRow> & { line: number; leftovers: string[] }) | null = null;
  const flush = () => {
    if (!current) return;
    const c = current;
    current = null;
    if (!c.orderNo) {
      pushIssue(`Line ${c.line}: order block me Order No nahi mila — skip kiya.`);
      return;
    }
    const row: AmazonOrderRow = {
      line: c.line,
      orderNo: c.orderNo,
      orderDate: c.orderDate ?? null,
      buyerName: c.buyerName ?? "",
      address: "",
      city: c.city ?? "",
      state: c.state ?? "",
      postalCode: c.postalCode ?? "",
      country: c.country ?? "",
      size: c.size ?? "",
      colour: c.colour ?? "",
      sku: c.sku ?? "",
      qty: c.qty ?? null,
      amount: c.amount ?? null,
      currency: c.currency ?? null,
      remark: c.remark ?? "",
      itemId: c.itemId ?? "",
      asin: c.asin ?? "",
      productName: c.productName ?? "",
      orderStatus: c.orderStatus ?? "",
      channel: c.channel ?? "",
      merchantOrderId: c.merchantOrderId ?? "",
      tax: c.tax ?? null,
      shipping: c.shipping ?? null,
      discount: c.discount ?? null,
    };
    row.address = buildAddress(row);
    rows.push(row);
  };

  for (let r = 0; r < sheet.length; r++) {
    const row = sheet[r];
    // Label = first non-empty cell.
    let labelCol = -1;
    for (let i = 0; i < row.length; i++) {
      if (cell(row[i])) {
        labelCol = i;
        break;
      }
    }
    if (labelCol < 0) continue;
    const label = blockLabel(cell(row[labelCol]));
    const values = row.slice(labelCol + 1).map(cell).filter(Boolean);

    if (label === "order") {
      flush();
      const classified = classifyBlockValues(values);
      current = { ...classified, line: r + 1, leftovers: classified.leftover };
      continue;
    }
    if (!current) continue;
    if (label === "notes") {
      const note = values.join(" ").trim();
      if (note) current.remark = current.remark ? `${current.remark} ${note}` : note;
      continue;
    }
    if (label === "sale" || label === "refund") {
      // SALE row often carries the item details (size/qty/amount); a REFUND
      // row is money moving back and is NOT the order's value — record it as
      // a remark instead of subtracting it from what the order cost.
      const classified = classifyBlockValues(values);
      if (label === "sale") {
        for (const key of ["size", "colour", "qty", "amount", "currency", "sku", "orderDate"] as const) {
          if (classified[key] != null && classified[key] !== "" && current[key] == null) {
            (current as Record<string, unknown>)[key] = classified[key];
          }
        }
      } else if (values.length) {
        const note = `Refund: ${values.join(" ")}`;
        current.remark = current.remark ? `${current.remark} · ${note}` : note;
      }
      continue;
    }
    if (label === "out" || label === "status") {
      const note = `${cell(row[labelCol])}: ${values.join(" ")}`.trim();
      if (values.length) current.remark = current.remark ? `${current.remark} · ${note}` : note;
      continue;
    }
    // Unlabelled continuation row inside a block: merge anything usable.
    const classified = classifyBlockValues(values);
    for (const key of ["orderDate", "buyerName", "city", "state", "postalCode", "country", "size", "colour", "sku", "qty", "amount", "currency"] as const) {
      if (classified[key] != null && classified[key] !== "" && current[key] == null) {
        (current as Record<string, unknown>)[key] = classified[key];
      }
    }
  }
  flush();

  if (rows.length === 0) {
    return {
      rows,
      issues: [
        "Sheet ka format pehchana nahi gaya. Amazon All Orders report (headers: amazon-order-id, buyer-name, purchase-date, item-price, quantity-purchased, currency) ya Order No wale book format me bhejo.",
      ],
      shape: "none",
    };
  }
  return { rows, issues, shape: "ledger-blocks" };
}
