// 2026-10-22 — "ESI HI SHEET PURCHASE BILLS KI SHEET BANNI CHAHIYE OR LINK
// HONI CHAHIYE": Courier/Duty bills already had their own A4 report page, so
// Bill Payment's invoice number could not show a REAL purchase-bill sheet —
// Purchase Bills only had the field-list preview in Document Entry. This page
// is that sheet, in the same shape as freight-bills/[id]/report: bill header,
// one row per item (PO ref / item / size / qty / rate / amount / GST / total),
// and the invoice totals underneath.
//
// The row addressed here is ONE purchase_bills row, but a vendor invoice can
// legitimately cover several items/POs (several rows sharing
// vendor_party_id + vendor_invoice_no — see src/lib/bill-grouping.ts, and the
// UNIQUE (vendor_party_id, vendor_invoice_no, order_id) key in schema.sql).
// So the whole invoice is resolved from whichever row's id was opened, exactly
// like loadBillStatement does for the grouped statement — otherwise a
// multi-item invoice would print just its first item.
//
// 2026-10-24 — TWO fixes the user reported against this sheet:
//
//  1) "sheet generate karte waqt error aa raha hai" — the whole sheet used to
//     render Next's bare 404 page. Root cause: the SELECT named columns that
//     arrive with the newest one-time SQL file (purchase_bills.size_mode from
//     db/2026-10-24b-…, freight_bills/duty_tax_bills.round_off_amt from the
//     same file). PostgREST rejects the WHOLE query with 42703 when one named
//     column is missing, `billRaw` came back null and this page called
//     notFound() — so an un-run migration was indistinguishable from a
//     deleted bill. It now selects `*` (missing optional columns simply come
//     back absent and fall back to their pre-migration defaults) and a
//     genuinely missing row gets an explanation card, not a 404.
//
//  2) "agar PO 3 companies me ho to bill no par sheet sabhi PO ki bane…
//     bill me 20 entry hai to ye sabhi aaye" — the invoice was resolved by
//     (vendor_party_id, vendor_invoice_no) only, so a supplier filed once per
//     company (its own parties row in Nyko Mart / Rugara / CASA ARRA) split
//     the same invoice into 3 islands; the sheet silently printed just the
//     one it was opened from. Rows are now resolved by the VENDOR INVOICE
//     NUMBER across every company: the seed vendor's own rows plus every
//     other party with the same (normalised) supplier name. The sheet then
//     auto-adjusts — a Company column appears when the invoice spans more
//     than one company, and every total (entries, POs, GST, round off, gross,
//     order value, purchase %) is computed over ALL rows, with a per-company
//     breakdown underneath.
//
// GST per line follows the same rule the statement uses: gst_rate_pct is the
// CGST/SGST INDIVIDUAL rate (total = ×2) or the full rate for IGST; 0 means
// "No GST" (2026-10-20 migration), NULL keeps the historical flat-5%
// fallback so an old bill's lines still tie out to its stored invoice total.
import Link from "next/link";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { loadOrderShippingFigures } from "@/lib/orders/shipping-figures";
import { purchaseAreaSqFt } from "@/lib/length-units";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
type PurchaseBillRow = Database["public"]["Tables"]["purchase_bills"]["Row"];

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : String(v));

/** Loose comparison key for invoice numbers / supplier names: case, padding and repeated spaces must not split one invoice. */
const normText = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
/**
 * Escapes LIKE wildcards so an invoice number containing % or _ is matched
 * literally. Anything a wildcard still lets through is dropped by the
 * normalised comparison in loadInvoiceRows — this filter can only over-fetch,
 * never mis-group two invoices.
 */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (m) => `\\${m}`);

export default async function PurchaseBillReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await PurchaseBillReportInner(await params);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Access Denied</p>
          <p className="mt-1">{err.message}</p>
        </div>
      );
    }
    throw err;
  }
}

/** Shown instead of a bare 404 — a stale link must explain itself. */
function SheetProblem({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="text-base font-semibold">⚠ {title}</p>
      <p className="mt-2 leading-relaxed">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/bill-payment"
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 hover:no-underline"
        >
          Open Bill Payment
        </Link>
        <Link
          href="/dashboard/documents"
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 hover:no-underline"
        >
          Open Document Entry
        </Link>
      </div>
    </div>
  );
}

/**
 * Every purchase_bills row that belongs to the same vendor invoice — across
 * companies. See the 2026-10-24 (2) note above for why the vendor-name match
 * is needed and why it is still safe (the vendor invoice NUMBER has to match
 * too, so two unrelated bills can never be pulled together).
 */
async function loadInvoiceRows(supabase: Client, seed: PurchaseBillRow): Promise<PurchaseBillRow[]> {
  const invoiceNo = (seed.vendor_invoice_no ?? "").trim();
  if (!invoiceNo) return [seed];

  // parties is deliberately global (one supplier can be billed by more than
  // one company), but in practice the same supplier is often filed as a
  // separate row per company — those rows carry the same NAME.
  const { data: parties } = await supabase.from("parties").select("id, name");
  const seedNameKey = normText((parties ?? []).find((p) => p.id === seed.vendor_party_id)?.name);
  const vendorIds = Array.from(
    new Set([
      seed.vendor_party_id,
      ...(seedNameKey ? (parties ?? []).filter((p) => normText(p.name) === seedNameKey).map((p) => p.id) : []),
    ])
  );

  const { data } = await supabase
    .from("purchase_bills")
    .select("*")
    .in("vendor_party_id", vendorIds)
    .ilike("vendor_invoice_no", escapeLike(invoiceNo))
    .order("created_at", { ascending: true });

  // Same vendor invoice NUMBER and same bill KIND — a Printing bill and a
  // normal Purchase bill never share a sheet even if a vendor reused the
  // number. `bill_kind` arrives with db/2026-10-24b-…; before that file is
  // run every row IS a purchase bill, so a missing column reads as 'purchase'.
  const kindOf = (r: PurchaseBillRow) => (r as { bill_kind?: string | null }).bill_kind ?? "purchase";
  const seedKind = kindOf(seed);
  const rows = (data ?? []).filter((r) => normText(r.vendor_invoice_no) === normText(invoiceNo) && kindOf(r) === seedKind);
  // The seed row must always be on its own sheet, even if its invoice number
  // has since been edited to something that no longer matches.
  if (!rows.some((r) => r.id === seed.id)) rows.unshift(seed);
  return rows;
}

async function PurchaseBillReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  // `*` on purpose — see the 2026-10-24 (1) header note. A not-yet-run
  // migration must not be able to turn this sheet into a 404.
  const { data: seed, error: seedError } = await supabase.from("purchase_bills").select("*").eq("id", id).maybeSingle();

  if (seedError) {
    return (
      <SheetProblem
        title="This purchase bill could not be loaded"
        message={`The database refused the request: ${seedError.message}`}
      />
    );
  }
  if (!seed) {
    return (
      <SheetProblem
        title="This purchase bill entry no longer exists"
        message="The finance ledger still points at this Purchase Bill, but the entry itself is gone (deleted or replaced after the bill was posted). Re-save the bill from Document Entry to relink it — an un-run one-time SQL file never causes this."
      />
    );
  }

  const rows = await loadInvoiceRows(supabase, seed);

  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((v): v is string => !!v)));
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id).filter((v): v is string => !!v)));

  const [{ data: party }, { data: companies }, { data: orders }, { data: profiles }] = await Promise.all([
    supabase.from("parties").select("id, name, address, contact_no, email, gst").eq("id", seed.vendor_party_id).maybeSingle(),
    companyIds.length
      ? supabase.from("companies").select("id, name, logo_url").in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string; logo_url: string | null }[] }),
    orderIds.length ? supabase.from("orders").select("id, ref_no, size_label").in("id", orderIds) : Promise.resolve({ data: [] }),
    companyIds.length
      ? supabase
          .from("company_profiles")
          .select("company_id, address, phone, whatsapp, email, gstin")
          .in("company_id", companyIds)
      : Promise.resolve({ data: [] as { company_id: string; address: string | null; phone: string | null; whatsapp: string | null; email: string | null; gstin: string | null }[] }),
  ]);

  const companyNameById = new Map((companies ?? []).map((c) => [c.id, c.name] as const));
  const companyLogoById = new Map((companies ?? []).map((c) => [c.id, c.logo_url] as const));
  const profileById = new Map((profiles ?? []).map((p) => [p.company_id, p] as const));
  const orderRef = new Map((orders ?? []).map((o) => [o.id, o.ref_no] as const));
  const orderSize = new Map((orders ?? []).map((o) => [o.id, o.size_label] as const));

  // 2026-10-24b — a "Printing" bill reuses purchase_bills, so name the sheet
  // after what it actually is (printing = job work billed against a PO).
  const sheetTitle = ((seed as { bill_kind?: string | null }).bill_kind ?? "purchase") === "printing" ? "Printing Bill" : "Purchase Bill";

  const multiCompany = companyIds.length > 1;
  // 2026-10-24 — "jo bill jis company me add hua hai report me usi company ka
  // letterhead aaye": the letterhead is ALWAYS the company this bill row
  // belongs to (bill_pass_register.company_id → purchase_bills.company_id),
  // never the company picked in the top-nav switcher, and never blank just
  // because the same invoice number also exists in the other companies. The
  // other companies' entries are still listed, but the document is issued by
  // the company whose bill this is — so the Company column and the per-company
  // table carry the rest.
  const headerCompanyId = seed.company_id ?? companyIds[0] ?? null;
  const headerCompany = headerCompanyId ? { id: headerCompanyId, name: companyNameById.get(headerCompanyId) ?? "—", logo_url: companyLogoById.get(headerCompanyId) ?? null } : null;
  const headerProfile = headerCompanyId ? profileById.get(headerCompanyId) ?? null : null;
  const headerContact = [
    headerProfile?.gstin ? `GSTIN: ${headerProfile.gstin}` : null,
    headerProfile?.phone ? `Ph: ${headerProfile.phone}` : null,
    headerProfile?.email,
  ]
    .filter(Boolean)
    .join(" · ");

  // 2026-10-24 — "PURCHASE BILL SHEET JO GENRATE HO RAHI HAI, USME KUCH DATA OR
  // CHAHIYE JAISE FREIGHT SHEET ME AATA HAI: SHIPPING CHARGES, SHIPPING
  // CHARGES COURIER, ORDER VALUE, PURCHASE %". All four are LIVE reads of the
  // order and its courier bill (src/lib/orders/shipping-figures.ts) — nothing
  // is copied onto purchase_bills, so correcting an order's value/country or
  // a courier bill's charges is reflected the very next time this sheet is
  // opened.
  const figures = await loadOrderShippingFigures(supabase, orderIds);

  // 2026-10-24 — "sheet par paid / balance bhi dikhe": the finance-ledger rows
  // this bill was posted as (one per item per company). Read-only totals — the
  // source of truth stays bill_pass_register, so the sheet can never disagree
  // with Bill Payment / the Party Ledger. Missing rows simply means the bill
  // has not been sent to Finance yet.
  const { data: ledgerRows } = await supabase
    .from("bill_pass_register")
    .select("company_id, total_amt, credit_note_amt, adj_amt, total_paid, balance_due")
    .eq("source", "purchase_bill")
    .in("source_id", rows.map((r) => r.id));
  const payableByCompany = new Map<string, { paid: number; credited: number; balance: number; billed: number }>();
  let ledgerPaid = 0;
  let ledgerCredited = 0;
  let ledgerBalance = 0;
  let ledgerBilled = 0;
  for (const l of ledgerRows ?? []) {
    const key = l.company_id ?? "none";
    const bucket = payableByCompany.get(key) ?? { paid: 0, credited: 0, balance: 0, billed: 0 };
    bucket.paid += Number(l.total_paid ?? 0);
    bucket.credited += Number(l.credit_note_amt ?? 0) + Number(l.adj_amt ?? 0);
    bucket.balance += Number(l.balance_due ?? 0);
    bucket.billed += Number(l.total_amt ?? 0);
    payableByCompany.set(key, bucket);
    ledgerPaid += Number(l.total_paid ?? 0);
    ledgerCredited += Number(l.credit_note_amt ?? 0) + Number(l.adj_amt ?? 0);
    ledgerBalance += Number(l.balance_due ?? 0);
    ledgerBilled += Number(l.total_amt ?? 0);
  }
  const hasLedger = (ledgerRows ?? []).length > 0;

  const lines = rows.map((r, i) => {
    const qty = Number(r.qty);
    const size = Number(r.sq_feet ?? 0);
    const rate = Number(r.unit_rate);
    // Same formula as the schema's generated total_amount column.
    const amount = qty * size * rate;
    const storedRate = r.gst_rate_pct != null ? Number(r.gst_rate_pct) : null;
    const totalRatePct = storedRate != null ? (r.gst_type === "IGST" ? storedRate : storedRate * 2) : 5;
    const gstAmount = Math.round(amount * totalRatePct) / 100;
    const fig = r.order_id ? figures.get(r.order_id) : undefined;
    const orderValue = fig?.orderValueInr ?? 0;
    return {
      sr: i + 1,
      id: r.id,
      orderId: r.order_id,
      companyId: r.company_id,
      companyName: r.company_id ? companyNameById.get(r.company_id) ?? "—" : "—",
      refNo: r.order_id ? orderRef.get(r.order_id) ?? "—" : "—",
      orderSize: r.order_id ? orderSize.get(r.order_id) ?? null : null,
      description: r.work_description,
      qty,
      unit: r.qty_unit,
      // Raw value as billed, in the bill's own unit — this is what the amount
      // formula below must keep using (qty × this × rate, rate being per that
      // same unit). `sizeSqFt` is the same area normalised to square feet for
      // DISPLAY only.
      size,
      // 2026-10-24b — 'as_billed' means the vendor billed a LENGTH in that
      // unit, so squaring it would be meaningless; the sheet then prints the
      // figure exactly as entered instead of a Sq Ft conversion. The column
      // may be absent on a database where that migration hasn't run — the
      // default keeps the previous (area) behaviour.
      asBilled: (r.size_mode ?? "area") === "as_billed",
      sizeSqFt: purchaseAreaSqFt(size, r.qty_unit),
      sizeUnit: r.qty_unit ?? "FT",
      rate,
      amount,
      gstRatePct: storedRate,
      gstType: r.gst_type,
      gstAmount,
      lineTotal: amount + gstAmount,
      orderValue,
      ourShipping: fig?.ourShippingInr ?? null,
      courierShipping: fig?.courierGrossInr ?? null,
      courierBillSourced: fig?.courierBillSourced ?? false,
      // 2026-10-24 (c) — "PERSENT ... PURCHASE COST WITHOUT GST VALI VALUE SE
      // NIKAL RAHA HAI LEKIN MUJHE TOTAL VALUE SE CHAHIYE GST ADD HONE KE BAAD":
      // purchase % is now measured on the TOTAL line value (amount + GST, i.e.
      // what the vendor is actually paid), not on the pre-GST base.
      purchasePct: orderValue > 0 ? ((amount + gstAmount) / orderValue) * 100 : null,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gstTotal = lines.reduce((s, l) => s + l.gstAmount, 0);
  // Round off is stored per row (db/2026-10-24b); a not-yet-migrated row has
  // no such column at all, which must read as 0 rather than NaN.
  const roundOff = rows.reduce((s, r) => s + Number((r as { round_off_amt?: number | null }).round_off_amt ?? 0), 0);
  const grossTotal = subtotal + gstTotal + roundOff;
  const isGst = gstTotal > 0;

  // 2026-10-24 — "YE JO MENE MARK KIYA SS ME VO TO SQ FT ME AAYEGA NA TO SIZE
  // KYA LIKHA HAI": the old "Size" header was wrong. The values there are
  // purchase_bills.sq_feet — the billed AREA in the bill's own qty_unit (FT →
  // sq ft, MTR → sq m, INCH → sq in…), which is why the screenshot shows
  // 60.00 / 9.00 / 48.00 for rows whose actual 3X20 FT / 3X3 FT size is
  // already printed in the separate "Type / Size" column. Reading it as a
  // length made 60.00 look like 60 ft instead of 60 sq ft.
  //
  // 2026-10-24 (2) — "CHAHE SIZE INCH ME HO YA CM ME JO AREA HAI VO SQ FT ME
  // NIKAL KE AAYE": rather than relabelling per unit (Sq Mtr / Sq In / Sq Cm),
  // every row is now converted to Sq Ft for display (purchaseAreaSqFt), with
  // the value as entered shown underneath in small grey text whenever the
  // bill's unit isn't FT — so the figure can still be tied back to the
  // vendor's own bill and the Rate column's unit stays unambiguous.
  const SQ_UNIT_WORD: Record<string, string> = { FT: "ft", MTR: "mtr", INCH: "in", YARD: "yd", CM: "cm" };
  // 2026-10-24b — the column can hold two different things now: a Sq Ft area
  // (default) or a linear length billed as-is. Name it after what is actually
  // on THIS invoice.
  const anyAsBilled = lines.some((l) => l.asBilled);
  const anyArea = lines.some((l) => !l.asBilled);
  const sizeColumnLabel = anyAsBilled && anyArea ? "Sq Ft / As billed" : anyAsBilled ? "As billed" : "Sq Ft";

  // Order-level totals are summed ONCE PER ORDER, not once per purchase line:
  // one vendor invoice commonly covers several lines for the same PO, and
  // adding that PO's order value/shipping once per line would multiply it.
  let totalOrderValue = 0;
  let totalOurShipping = 0;
  let totalCourierShipping = 0;
  const countedOrders = new Set<string>();
  for (const l of lines) {
    if (!l.orderId || countedOrders.has(l.orderId)) continue;
    countedOrders.add(l.orderId);
    totalOrderValue += l.orderValue;
    totalOurShipping += l.ourShipping ?? 0;
    totalCourierShipping += l.courierShipping ?? 0;
  }
  // 2026-10-24 (c) — same rule for the invoice total: total purchase value
  // INCLUDING GST as a share of the order value.
  const overallPurchasePct = totalOrderValue > 0 ? ((subtotal + gstTotal) / totalOrderValue) * 100 : null;

  // 2026-10-24 (2) — per-company split of the same invoice, printed under the
  // totals whenever the invoice number exists in more than one company.
  type CompanyTotal = {
    id: string | null;
    name: string;
    entries: number;
    poCount: number;
    subtotal: number;
    gst: number;
    roundOff: number;
    total: number;
  };
  const companyTotals = new Map<string, CompanyTotal>();
  for (const r of rows) {
    const key = r.company_id ?? "none";
    const current =
      companyTotals.get(key) ??
      ({
        id: r.company_id,
        name: r.company_id ? companyNameById.get(r.company_id) ?? "—" : "No company linked",
        entries: 0,
        poCount: 0,
        subtotal: 0,
        gst: 0,
        roundOff: 0,
        total: 0,
      } satisfies CompanyTotal);
    current.entries += 1;
    companyTotals.set(key, current);
  }
  for (const l of lines) {
    const bucket = companyTotals.get(l.companyId ?? "none");
    if (!bucket) continue;
    bucket.subtotal += l.amount;
    bucket.gst += l.gstAmount;
    bucket.total += l.lineTotal;
  }
  for (const r of rows) {
    const bucket = companyTotals.get(r.company_id ?? "none");
    if (!bucket) continue;
    const rOff = Number((r as { round_off_amt?: number | null }).round_off_amt ?? 0);
    bucket.roundOff += rOff;
    bucket.total += rOff;
  }
  // Count POs per company (each PO counted once even with several item rows).
  const poKeysByCompany = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.order_id) continue;
    const key = r.company_id ?? "none";
    const set = poKeysByCompany.get(key) ?? new Set<string>();
    set.add(r.order_id);
    poKeysByCompany.set(key, set);
  }
  for (const [key, set] of poKeysByCompany) {
    const bucket = companyTotals.get(key);
    if (bucket) bucket.poCount = set.size;
  }
  const companyTotalsList = Array.from(companyTotals.values()).sort((a, b) => a.name.localeCompare(b.name));

  // Inside the A4 preview dialog this page is embedded with ?embed=1
  // (src/components/print-dialog.tsx) → x-embed; the dialog supplies its own
  // Print/Close footer, so the page's own Back/Download bar is dropped there.
  const embedded = (await headers()).get("x-embed") === "1";

  return (
    <div>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/dashboard/documents" className="text-sm text-slate-500 hover:underline">
            ← Back to Document Entry
          </Link>
          <PrintButton label="🖨 Download PDF" />
        </div>
      )}

      <PrintArea id="purchase-bill-report-area" companyName={headerCompany?.name} companyLogoUrl={headerCompany?.logo_url ?? undefined}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-900 print:border-0 print:p-0">
          <div className="mb-4 flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {headerCompany?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- print document; a plain <img> keeps the logo out of next/image's optimizer
                <img src={headerCompany.logo_url} alt={headerCompany.name} className="h-10 w-10 object-contain" />
              )}
              <div className="leading-tight">
                {/* 2026-10-24 — full letterhead of the company this bill was
                    entered under: name, address, GSTIN/phone/email, then the
                    document title. Same shape as the Courier/Duty sheets, so
                    all three bills print an identical letterhead. */}
                {headerCompany?.name && <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{headerCompany.name}</p>}
                {headerProfile?.address && (
                  <p className="max-w-[22rem] whitespace-pre-wrap text-[10px] text-slate-500">{headerProfile.address}</p>
                )}
                {headerContact && <p className="text-[10px] text-slate-500">{headerContact}</p>}
                <h1 className="mt-1 text-lg font-bold text-slate-900">{sheetTitle}</h1>
                <p className="text-slate-500">
                  Invoice {seed.vendor_invoice_no || "—"} · {seed.vendor_invoice_date ?? "—"}
                </p>
              </div>
            </div>
            <div className="text-right text-slate-600">
              <p className="font-semibold text-slate-900">{party?.name ?? "—"}</p>
              {party?.address && <p className="max-w-[15rem] whitespace-pre-wrap text-[11px]">{party.address}</p>}
              {party?.contact_no && <p className="text-[11px]">Phone: {party.contact_no}</p>}
              {party?.gst && <p className="text-[11px]">GST: {party.gst}</p>}
            </div>
          </div>

          {/* 2026-10-24 (2) — the cross-company note: the reader must be able to
              tell why this one sheet lists more POs than the company they came
              from. Prints too, so the vendor sees the same scope. */}
          {multiCompany && (
            <p className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-900 print:border-slate-300 print:bg-transparent">
              This bill is issued by <strong>{headerCompany?.name ?? "—"}</strong>. The same invoice number also exists in the
              other companies — every entry is included: {rows.length} entries · {countedOrders.size} PO
              {countedOrders.size === 1 ? "" : "s"} · {companyTotalsList.map((c) => c.name).join(", ")}
            </p>
          )}

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Sr.</th>
                {multiCompany && <th className="py-1 pr-2">Company</th>}
                <th className="py-1 pr-2">PO No.</th>
                <th className="py-1 pr-2">Item / Work</th>
                <th className="py-1 pr-2">Type / Size</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2 text-right">{sizeColumnLabel}</th>
                <th className="py-1 pr-2 text-right">Rate</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2 text-right">GST</th>
                <th className="py-1 pr-2 text-right">Total</th>
                <th className="py-1 pr-2 text-right">Order Value</th>
                <th className="py-1 pr-2 text-right">Shipping</th>
                <th className="py-1 pr-2 text-right">Courier</th>
                <th className="py-1 pr-2 text-right">Purchase %</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1 pr-2">{r.sr}</td>
                  {multiCompany && <td className="py-1 pr-2 text-slate-500">{r.companyName}</td>}
                  <td className="py-1 pr-2 font-medium text-slate-900">{r.refNo}</td>
                  <td className="py-1 pr-2">{dash(r.description)}</td>
                  <td className="py-1 pr-2">{r.orderSize ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.qty}</td>
                  <td className="py-1 pr-2">{r.unit}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.asBilled ? (
                      `${money(r.size)} ${SQ_UNIT_WORD[r.sizeUnit] ?? r.sizeUnit}`
                    ) : r.sizeSqFt != null ? (
                      money(r.sizeSqFt)
                    ) : (
                      "—"
                    )}
                    {!r.asBilled && r.sizeSqFt != null && r.sizeUnit !== "FT" && (
                      <div className="text-[9px] font-normal text-slate-400">
                        ({money(r.size)} sq {SQ_UNIT_WORD[r.sizeUnit] ?? r.sizeUnit})
                      </div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(r.rate)}</td>
                  <td className="py-1 pr-2 text-right">{money(r.amount)}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.gstRatePct === 0 ? "No GST" : money(r.gstAmount)}
                    {r.gstRatePct !== 0 && r.gstRatePct != null && (
                      <span className="text-[9px] text-slate-400">
                        {" "}
                        ({r.gstType === "IGST" ? r.gstRatePct : r.gstRatePct * 2}%)
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold">{money(r.lineTotal)}</td>
                  <td className="py-1 pr-2 text-right">{r.orderValue > 0 ? money(r.orderValue) : "—"}</td>
                  <td className="py-1 pr-2 text-right text-slate-500">{r.ourShipping != null ? money(r.ourShipping) : "—"}</td>
                  <td className={`py-1 pr-2 text-right ${r.courierBillSourced ? "text-slate-900" : "text-slate-400"}`}>
                    {r.courierShipping != null ? money(r.courierShipping) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right font-medium">{r.purchasePct != null ? `${r.purchasePct.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={multiCompany ? 16 : 15} className="py-3 text-center text-slate-400">
                    No items on this invoice.
                  </td>
                </tr>
              )}
              {lines.length > 0 && (
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td colSpan={multiCompany ? 9 : 8} className="py-1 pr-2 text-right">
                    TOTAL
                  </td>
                  <td className="py-1 pr-2 text-right">{money(subtotal)}</td>
                  <td className="py-1 pr-2 text-right">{isGst ? money(gstTotal) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(subtotal + gstTotal)}</td>
                  <td className="py-1 pr-2 text-right">{totalOrderValue > 0 ? money(totalOrderValue) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(totalOurShipping)}</td>
                  <td className="py-1 pr-2 text-right">{money(totalCourierShipping)}</td>
                  <td className="py-1 pr-2 text-right">{overallPurchasePct != null ? `${overallPurchasePct.toFixed(1)}%` : "—"}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-300 pt-3">
            <div className="text-[11px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Invoice Summary</p>
              <p>
                {lines.length} entr{lines.length === 1 ? "y" : "ies"}
                {countedOrders.size > 0 && ` · ${countedOrders.size} PO`}
                {companyTotalsList.length > 1 && ` · ${companyTotalsList.length} companies`}
              </p>
              {seed.company_id == null && !multiCompany && <p className="text-amber-700">⚠ No company linked on this bill</p>}
              {party?.email && <p>Email: {party.email}</p>}

              {/* Per-company split — only when the invoice really spans companies. */}
              {multiCompany && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="mb-1 font-semibold text-slate-700">Company-wise</p>                      <table className="w-full border-collapse text-left text-[10px]">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-0.5 pr-2">Company</th>
                        <th className="py-0.5 pr-2 text-right">Entries</th>
                        <th className="py-0.5 pr-2 text-right">POs</th>
                        <th className="py-0.5 pr-2 text-right">Pre-GST</th>
                        <th className="py-0.5 pr-2 text-right">GST</th>
                        <th className="py-0.5 pr-2 text-right">Total</th>
                        {hasLedger && <th className="py-0.5 pr-2 text-right">Paid</th>}
                        {hasLedger && <th className="py-0.5 text-right">Balance</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {companyTotalsList.map((c) => {
                        const pay = c.id ? payableByCompany.get(c.id) : undefined;
                        return (
                          <tr key={c.id ?? "none"} className="text-slate-700">
                            <td className="py-0.5 pr-2">{c.name}</td>
                            <td className="py-0.5 pr-2 text-right">{c.entries}</td>
                            <td className="py-0.5 pr-2 text-right">{c.poCount}</td>
                            <td className="py-0.5 pr-2 text-right">{money(c.subtotal)}</td>
                            <td className="py-0.5 pr-2 text-right">{money(c.gst)}</td>
                            <td className="py-0.5 pr-2 text-right font-semibold">{money(c.total)}</td>
                            {hasLedger && <td className="py-0.5 pr-2 text-right text-emerald-700">{money(pay?.paid ?? 0)}</td>}
                            {hasLedger && (
                              <td className={`py-0.5 text-right font-semibold ${(pay?.balance ?? 0) > 0 ? "text-amber-800" : "text-slate-500"}`}>
                                {money(pay?.balance ?? 0)}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-slate-600">SUBTOTAL (pre-GST): ₹{money(subtotal)}</p>
              <p className="text-slate-600">GST: ₹{money(gstTotal)}</p>
              <p className="text-slate-600">ROUND OFF: ₹{money(roundOff)}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">GROSS TOTAL: ₹{money(grossTotal)}</p>
              {hasLedger && (
                <div className="mt-1 border-t border-slate-200 pt-1">
                  <p className="text-slate-600">BILLED (finance): ₹{money(ledgerBilled)}</p>
                  <p className="text-slate-600">CREDIT NOTES / ADJ: ₹{money(ledgerCredited)}</p>
                  <p className="text-slate-600">PAID: ₹{money(ledgerPaid)}</p>
                  <p className={`font-semibold ${ledgerBalance > 0.005 ? "text-amber-800" : "text-emerald-700"}`}>
                    BALANCE DUE: ₹{money(ledgerBalance)}
                  </p>
                </div>
              )}
              {!hasLedger && <p className="mt-1 text-[10px] text-slate-400">Not sent to the finance ledger yet — no paid/balance yet.</p>}
              {countedOrders.size > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="text-slate-600">ORDER VALUE: ₹{money(totalOrderValue)}</p>
                  <p className="text-slate-600">OUR SHIPPING CHARGE: ₹{money(totalOurShipping)}</p>
                  <p className="text-slate-600">COURIER SHIPPING CHARGE (incl. GST): ₹{money(totalCourierShipping)}</p>
                  <p className="font-semibold text-slate-900">
                    PURCHASE % (of order value, incl. GST): {overallPurchasePct != null ? `${overallPurchasePct.toFixed(1)}%` : "—"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
