import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { FreightMatchTable, type FreightMatchRow } from "./freight-match-table";

// 2026-11-03 — Courier 3-WAY MATCH + disputed-AWB ageing.
//
// User's asks, verbatim: "Rate-card vs billed 3-way match" and "Disputed AWB ka
// payment-hold + ageing report", plus "CN ko AWB-wise split karke us AWB ke
// order margin me dikhana".
//
// One table answers all three, because they share the same grain — ONE AWB on
// ONE courier/duty invoice:
//
//   rate card  = what our own rate sheet says this courier/zone/slab should cost
//                (courier_rate_cards: base + per-kg + fuel % + other)
//   booked     = what we were quoted at booking time (order_shipments.booked_freight_amt
//                — API quote, rate-card estimate or manual)
//   billed     = what the courier actually charged this AWB (the assignment's
//                charge breakup / billed amount + GST), and what remains after
//                the credit/debit notes (freight_awb_net_view / duty_awb_net_view,
//                which split a bill-header CN across its AWBs pro-rata).
//
// Dispute columns come straight off the assignment row (2026-11-03 migration):
// a disputed AWB keeps its ledger payable, only the payment is held — the "Days
// open" column is the ageing the user asked for.
//
// Company scoping follows the Freight/Duty report's rule (2026-10-29): the
// bill's own Finance ledger company is what the report is filed under; an
// order's company is only used for a bill that has not been sent yet. Neither
// freight_bills nor duty_tax_bills carries a company_id (one invoice can span
// AWBs across companies), so the ledger row is the only booked truth.
//
// Rate matching is deliberately conservative: courier name + country (the
// courier's own zone label, e.g. "USA") + the weight slab. No match = "no rate
// card", never a guessed rate — a wrong expected cost is worse than none.

const round2 = (n: number) => Math.round(n * 100) / 100;

type RateCard = {
  id: string;
  company_id: string;
  courier_name: string;
  zone_label: string;
  min_weight_kg: number;
  max_weight_kg: number;
  base_rate: number;
  rate_per_kg: number;
  fuel_surcharge_pct: number;
  other_charges: number;
};

function expectedFromCard(card: RateCard, weightKg: number): number {
  const weight = Math.max(weightKg, Number(card.min_weight_kg));
  const variable = Number(card.base_rate) + Number(card.rate_per_kg) * weight;
  return round2(variable + (variable * Number(card.fuel_surcharge_pct)) / 100 + Number(card.other_charges));
}

function pickCard(
  cards: RateCard[],
  companyId: string,
  courierName: string | null,
  zone: string | null,
  weightKg: number | null
): RateCard | null {
  if (!courierName || !zone || weightKg == null || weightKg <= 0) return null;
  const courier = courierName.trim().toLowerCase();
  const zoneLabel = zone.trim().toLowerCase();
  const sameZone = cards.filter(
    (c) =>
      c.company_id === companyId &&
      c.zone_label.trim().toLowerCase() === zoneLabel &&
      weightKg >= Number(c.min_weight_kg) &&
      weightKg <= Number(c.max_weight_kg)
  );
  if (sameZone.length === 0) return null;
  // Exact courier name first; a rate card naming a variant ("FedEx Express")
  // still matches the shipment's "FedEx" so a slightly different label does
  // not silently hide the card.
  const exact = sameZone.find((c) => c.courier_name.trim().toLowerCase() === courier);
  if (exact) return exact;
  return (
    sameZone.find((c) => c.courier_name.trim().toLowerCase().includes(courier)) ??
    sameZone.find((c) => courier.includes(c.courier_name.trim().toLowerCase())) ??
    null
  );
}

export default async function FreightMatchReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  // The two net views are SECURITY DEFINER and revoked from authenticated (see
  // db/2026-09-19-security-definer-views-revoke-authenticated.sql), so they are
  // read with the service role and scoped here — same pattern as the
  // Freight/Duty report and sale-profit.
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const onlyDisputed = sp.only === "disputed";
  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;
  const today = todayIST();

  const [{ data: companies }, { data: vendors }, { data: rateCards }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name"),
    // Rate cards are read with the service role: the card is maintained under
    // the freight-rate capability, but this report only needs the `reports`
    // capability — reading with the viewer's own client would silently empty
    // the expected column for everyone who cannot edit the rate card.
    finSupabase
      .from("courier_rate_cards")
      .select("id, company_id, courier_name, zone_label, min_weight_kg, max_weight_kg, base_rate, rate_per_kg, fuel_surcharge_pct, other_charges")
      .in("company_id", scopedCompanyIds),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const cards = (rateCards ?? []) as RateCard[];

  let freightBillsQuery = supabase
    .from("freight_bills")
    .select("id, invoice_no, invoice_date, vendor_party_id")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(400);
  if (fromDate) freightBillsQuery = freightBillsQuery.gte("invoice_date", fromDate);
  if (toDate) freightBillsQuery = freightBillsQuery.lte("invoice_date", toDate);
  const { data: freightBills } = await freightBillsQuery;

  let dutyBillsQuery = supabase
    .from("duty_tax_bills")
    .select("id, invoice_no, invoice_date, vendor_party_id")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(400);
  if (fromDate) dutyBillsQuery = dutyBillsQuery.gte("invoice_date", fromDate);
  if (toDate) dutyBillsQuery = dutyBillsQuery.lte("invoice_date", toDate);
  const { data: dutyBills } = await dutyBillsQuery;

  const freightBillById = new Map((freightBills ?? []).map((b) => [b.id, b]));
  const dutyBillById = new Map((dutyBills ?? []).map((b) => [b.id, b]));
  const freightBillIds = [...freightBillById.keys()];
  const dutyBillIds = [...dutyBillById.keys()];
  const billIds = [...freightBillIds, ...dutyBillIds];

  // Which company each bill is booked under in Finance (2026-10-29 rule).
  const ledgerCompanyBySource = new Map<string, string>();
  if (billIds.length) {
    const { data: links } = await finSupabase
      .from("bill_pass_register")
      .select("source, source_id, company_id")
      .in("source", ["freight_bill", "duty_tax_bill"])
      .in("source_id", billIds);
    for (const l of links ?? []) if (l.source_id) ledgerCompanyBySource.set(`${l.source}:${l.source_id}`, l.company_id);
  }

  // Assignment rows carry the billed amounts AND the dispute case.
  const [{ data: freightAssignments }, { data: dutyAssignments }] = await Promise.all([
    freightBillIds.length
      ? supabase
          .from("freight_bill_awb_assignments")
          .select(
            "id, freight_bill_id, order_id, order_shipment_id, bill_weight_kg, billed_freight_amt, billed_base_amt, billed_fuel_amt, billed_remote_amt, billed_other_amt, billed_gst_amt, credit_note_amt, debit_note_amt, dispute_status, dispute_amount, dispute_reason, dispute_raised_on, dispute_resolved_on"
          )
          .in("freight_bill_id", freightBillIds)
      : Promise.resolve({ data: [] as never[] }),
    dutyBillIds.length
      ? supabase
          .from("duty_bill_awb_assignments")
          .select(
            "id, duty_tax_bill_id, order_id, order_shipment_id, duty_tax_amt_inr, other_charge, gst_18pct, credit_note_amt, debit_note_amt, dispute_status, dispute_amount, dispute_reason, dispute_raised_on, dispute_resolved_on"
          )
          .in("duty_tax_bill_id", dutyBillIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const [{ data: freightNet }, { data: dutyNet }] = await Promise.all([
    (freightAssignments ?? []).length
      ? finSupabase
          .from("freight_awb_net_view")
          .select("assignment_id, cn_allocated_inr, net_shipping_amt")
          .in("assignment_id", (freightAssignments ?? []).map((a) => a.id))
      : Promise.resolve({ data: [] as { assignment_id: string | null; cn_allocated_inr: number | null; net_shipping_amt: number | null }[] }),
    (dutyAssignments ?? []).length
      ? finSupabase
          .from("duty_awb_net_view")
          .select("assignment_id, cn_allocated_inr, net_duty_amt")
          .in("assignment_id", (dutyAssignments ?? []).map((a) => a.id))
      : Promise.resolve({ data: [] as { assignment_id: string | null; cn_allocated_inr: number | null; net_duty_amt: number | null }[] }),
  ]);
  const cnByAssignment = new Map<string, number>();
  const netByAssignment = new Map<string, number>();
  for (const r of freightNet ?? []) {
    if (!r.assignment_id) continue;
    cnByAssignment.set(r.assignment_id, Number(r.cn_allocated_inr ?? 0));
    if (r.net_shipping_amt != null) netByAssignment.set(r.assignment_id, Number(r.net_shipping_amt));
  }
  for (const r of dutyNet ?? []) {
    if (!r.assignment_id) continue;
    cnByAssignment.set(r.assignment_id, Number(r.cn_allocated_inr ?? 0));
    if (r.net_duty_amt != null) netByAssignment.set(r.assignment_id, Number(r.net_duty_amt));
  }

  const orderIds = Array.from(
    new Set([...(freightAssignments ?? []).map((a) => a.order_id), ...(dutyAssignments ?? []).map((a) => a.order_id)].filter((v): v is string => !!v))
  );
  const shipmentIds = Array.from(
    new Set(
      [...(freightAssignments ?? []).map((a) => a.order_shipment_id), ...(dutyAssignments ?? []).map((a) => a.order_shipment_id)].filter(
        (v): v is string => !!v
      )
    )
  );

  const [{ data: orders }, { data: shipments }] = await Promise.all([
    orderIds.length
      ? supabase.from("orders").select("id, ref_no, company_id, buyer_country, destination_country").in("id", orderIds)
      : Promise.resolve({ data: [] as { id: string; ref_no: string; company_id: string; buyer_country: string | null; destination_country: string | null }[] }),
    shipmentIds.length
      ? supabase
          .from("order_shipments")
          .select("id, awb_no, courier_name, booked_freight_amt, booked_currency, booked_amount_source")
          .in("id", shipmentIds)
      : Promise.resolve({
          data: [] as { id: string; awb_no: string | null; courier_name: string | null; booked_freight_amt: number | null; booked_currency: string | null; booked_amount_source: string | null }[],
        }),
  ]);
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const shipmentById = new Map((shipments ?? []).map((s) => [s.id, s]));

  const daysOpen = (raisedOn: string | null): number | null => {
    if (!raisedOn) return null;
    const start = Date.parse(`${raisedOn}T00:00:00Z`);
    const end = Date.parse(`${today}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.max(0, Math.round((end - start) / 86_400_000));
  };

  const rows: FreightMatchRow[] = [];

  for (const a of freightAssignments ?? []) {
    const bill = freightBillById.get(a.freight_bill_id);
    const order = orderById.get(a.order_id);
    const shipment = a.order_shipment_id ? shipmentById.get(a.order_shipment_id) : undefined;
    if (!bill || !order) continue;
    const bookedCompanyId = ledgerCompanyBySource.get(`freight_bill:${bill.id}`) ?? order.company_id;
    if (!scopedCompanyIds.includes(bookedCompanyId)) continue;

    const breakup =
      Number(a.billed_base_amt ?? 0) + Number(a.billed_fuel_amt ?? 0) + Number(a.billed_remote_amt ?? 0) + Number(a.billed_other_amt ?? 0);
    const preTax = round2(breakup > 0 ? breakup : Number(a.billed_freight_amt ?? 0));
    const gst = a.billed_gst_amt != null ? round2(Number(a.billed_gst_amt)) : round2((preTax * 18) / 100);
    const gross = round2(preTax + gst);
    const cn = round2(cnByAssignment.get(a.id) ?? Number(a.credit_note_amt ?? 0) - Number(a.debit_note_amt ?? 0));
    const net = round2(netByAssignment.get(a.id) ?? gross - cn);
    // Weight slab for the rate card: the weight printed on the courier bill
    // (that is what the courier charged on). No bill weight = no card match.
    const weight = a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null;
    const zone = order.destination_country || order.buyer_country || null;
    const card = pickCard(cards, bookedCompanyId, shipment?.courier_name ?? null, zone, weight ?? null);
    const expected = card ? expectedFromCard(card, weight ?? 0) : null;
    const bookedAmt = shipment?.booked_freight_amt != null ? Number(shipment.booked_freight_amt) : null;
    const bookedInr = bookedAmt != null && (!shipment?.booked_currency || shipment.booked_currency === "INR") ? bookedAmt : null;

    const disputeStatus = (a.dispute_status ?? "none") as "none" | "under_dispute" | "resolved";
    if (onlyDisputed && disputeStatus !== "under_dispute") continue;

    rows.push({
      id: `freight_${a.id}`,
      kind: "Freight",
      invoice_no: bill.invoice_no,
      invoice_date: bill.invoice_date,
      company_name: companyName.get(bookedCompanyId) ?? "—",
      vendor_name: bill.vendor_party_id ? vendorName.get(bill.vendor_party_id) ?? "—" : "—",
      awb_no: shipment?.awb_no ?? null,
      ref_no: order.ref_no,
      courier_name: shipment?.courier_name ?? null,
      zone_label: zone,
      weight_kg: weight,
      rate_card_expected_inr: expected,
      booked_amt: bookedAmt,
      booked_currency: shipment?.booked_currency ?? null,
      booked_variance_inr: expected != null && bookedInr != null ? round2(bookedInr - expected) : null,
      billed_pretax_inr: preTax,
      billed_gst_inr: gst,
      billed_gross_inr: gross,
      cn_allocated_inr: cn,
      net_cost_inr: net,
      rate_card_variance_inr: expected != null ? round2(net - expected) : null,
      rate_card_variance_pct: expected != null && expected !== 0 ? round2(((net - expected) / expected) * 1000) / 10 : null,
      dispute_status: disputeStatus,
      dispute_amount_inr: Number(a.dispute_amount ?? 0),
      dispute_reason: a.dispute_reason ?? null,
      dispute_raised_on: a.dispute_raised_on ?? null,
      dispute_days_open: disputeStatus === "under_dispute" ? daysOpen(a.dispute_raised_on ?? null) : null,
    });
  }

  for (const a of dutyAssignments ?? []) {
    const bill = dutyBillById.get(a.duty_tax_bill_id);
    const order = orderById.get(a.order_id);
    const shipment = a.order_shipment_id ? shipmentById.get(a.order_shipment_id) : undefined;
    if (!bill || !order) continue;
    const bookedCompanyId = ledgerCompanyBySource.get(`duty_tax_bill:${bill.id}`) ?? order.company_id;
    if (!scopedCompanyIds.includes(bookedCompanyId)) continue;

    const preTax = round2(Number(a.duty_tax_amt_inr ?? 0) + Number(a.other_charge ?? 0));
    const gst = a.gst_18pct != null ? round2(Number(a.gst_18pct)) : round2((Number(a.duty_tax_amt_inr ?? 0) * 18) / 100);
    const gross = round2(preTax + gst);
    const cn = round2(cnByAssignment.get(a.id) ?? Number(a.credit_note_amt ?? 0) - Number(a.debit_note_amt ?? 0));
    const net = round2(netByAssignment.get(a.id) ?? gross - cn);
    const zone = order.destination_country || order.buyer_country || null;
    // Duty bills have no weight of their own; the rate card models freight, so
    // a duty row is never "expected" against it (it would compare duty to a
    // freight rate). Shown as "—" on purpose.
    const bookedAmt = shipment?.booked_freight_amt != null ? Number(shipment.booked_freight_amt) : null;

    const disputeStatus = (a.dispute_status ?? "none") as "none" | "under_dispute" | "resolved";
    if (onlyDisputed && disputeStatus !== "under_dispute") continue;

    rows.push({
      id: `duty_${a.id}`,
      kind: "Duty",
      invoice_no: bill.invoice_no,
      invoice_date: bill.invoice_date,
      company_name: companyName.get(bookedCompanyId) ?? "—",
      vendor_name: bill.vendor_party_id ? vendorName.get(bill.vendor_party_id) ?? "—" : "—",
      awb_no: shipment?.awb_no ?? null,
      ref_no: order.ref_no,
      courier_name: shipment?.courier_name ?? null,
      zone_label: zone,
      weight_kg: null,
      rate_card_expected_inr: null,
      booked_amt: bookedAmt,
      booked_currency: shipment?.booked_currency ?? null,
      booked_variance_inr: null,
      billed_pretax_inr: preTax,
      billed_gst_inr: gst,
      billed_gross_inr: gross,
      cn_allocated_inr: cn,
      net_cost_inr: net,
      rate_card_variance_inr: null,
      rate_card_variance_pct: null,
      dispute_status: disputeStatus,
      dispute_amount_inr: Number(a.dispute_amount ?? 0),
      dispute_reason: a.dispute_reason ?? null,
      dispute_raised_on: a.dispute_raised_on ?? null,
      dispute_days_open: disputeStatus === "under_dispute" ? daysOpen(a.dispute_raised_on ?? null) : null,
    });
  }

  rows.sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || a.ref_no.localeCompare(b.ref_no));

  const disputed = rows.filter((r) => r.dispute_status === "under_dispute");
  const holdTotal = round2(disputed.reduce((s, r) => s + r.dispute_amount_inr, 0));
  const oldestDispute = disputed.reduce<number | null>((max, r) => (r.dispute_days_open == null ? max : Math.max(max ?? 0, r.dispute_days_open)), null);
  const noRateCard = rows.filter((r) => r.kind === "Freight" && r.rate_card_expected_inr == null).length;
  const overRateCard = rows.filter((r) => r.rate_card_variance_inr != null && r.rate_card_variance_inr > 0).length;

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🔍 Courier 3-Way Match &amp; Disputes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rate card → booked → actual courier bill, per AWB. Net cost is after that AWB&apos;s share of the bill&apos;s credit
            notes; disputed AWBs show how long the case has been open and how much is held from payment.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/dashboard/reports" className="text-slate-500 hover:underline">← Reports</Link>
          <Link href="/dashboard/courier-rates" className="text-amber-700 hover:underline">Rate Card →</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Rows (AWB × bill)</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">Under dispute · held</p>
          <p className="mt-1 text-lg font-semibold text-red-900">
            ₹{holdTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-red-700">
            {disputed.length} AWB(s){oldestDispute != null ? ` · oldest ${oldestDispute} day(s)` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">Billed above rate card</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">{overRateCard}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Freight rows with no rate card</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{noRateCard}</p>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyId} className={inputClass}>
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" name="only" value="disputed" defaultChecked={onlyDisputed} className="h-3.5 w-3.5 rounded border-slate-300" />
          Only disputed AWBs
        </label>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/freight-match" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <FreightMatchTable rows={rows} today={today} />
    </div>
  );
}
