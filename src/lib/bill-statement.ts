// 2026-09-15 — shared READ-ONLY bill statement loader, extracted from the
// Party Ledger's [billId] page so the same statement can open from
// EVERYWHERE ("ab jo ye kiya vo or jaha jaha par jaruri hai vaha par bhi
// kar do"): Bill Payment's invoice cells, Documents' Purchase/Courier/Duty
// lists, anywhere a bill_pass_register id is known. Two hard rules:
//
//  1. ACCESS-CHECKED ("jaha se sirf preview dikh jaye gar access nahi hai
//     to nahi open hoye"): loadBillStatement() runs getAuthedEmployee()
//     itself and refuses (401/403/404) any bill outside the caller's
//     companies — the [billId] page and the /api/bill-statement route both
//     go through THIS function, so there is exactly one access gate.
//  2. SERVER-ONLY: imports createServiceRoleClient/getAuthedEmployee.
//     Client code (the dialog) must reach it only through the API route.
//
// The statement's own content ("jo jo important section hai vo apne aap
// aajaye") is source-aware: Purchase bills get their PO line item,
// freight/duty bills get their per-AWB assignment lines, and every bill
// gets payments, CN/DN adjustments, wallet settlements and vendor bank
// details when they exist.
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type BillStatementPoLine = {
  /** The purchase_bills row this line came from — the key per-entry Edit/Delete acts on. */
  purchaseBillId: string;
  refNo: string | null;
  description: string | null;
  qty: number;
  unit: string;
  /** Size as billed (qty_unit is the unit sq_feet + unit_rate are in, e.g. FT/MTR/PCS). */
  size: number;
  /**
   * 2026-10-24b — true when the vendor billed a LENGTH in that unit, so the
   * statement must print the number as-is instead of normalising it to Sq Ft
   * (see db/2026-10-24b-round-figure-printing-bill-and-size-mode.sql).
   */
  asBilled: boolean;
  rate: number;
  /** Pre-GST line amount (qty × sq_feet × unit_rate). */
  amount: number;
  /** The RAW stored rate (individual CGST/SGST rate, or full rate for IGST) — what the edit form must round-trip. */
  gstRatePct: number | null;
  gstType: string | null;
  /** Total GST on this line (rate × 2 when CGST+SGST, else the single IGST rate). */
  gstAmount: number;
  /** amount + gstAmount (excludes round-off, which is per-invoice not per-line). */
  amountWithGst: number;
};

export type BillStatementAwbLine = {
  awb: string;
  refNo: string | null;
  weightKg: number | null;
  billedAmt: number | null;
};

export type BillStatementPayment = {
  id: string;
  amount: number;
  payment_date: string;
  payment_mode: string | null;
  reference_no: string | null;
};

export type BillStatementData = {
  bill: {
    id: string;
    company_id: string;
    invoice_no: string | null;
    vendor_invoice_no: string | null;
    invoice_type: string | null;
    invoice_date: string | null;
    invoice_recv_date: string | null;
    total_amt: number;
    credit_note_amt: number;
    adj_amt: number;
    total_paid: number;
    balance_due: number;
    due_date: string | null;
    approval_status: string | null;
    remark: string | null;
    source: string | null;
  };
  party: {
    id: string;
    name: string;
    party_type: string | null;
    address: string | null;
    contact_no: string | null;
    email: string | null;
    gst: string | null;
    bank_name: string | null;
    account_no: string | null;
    ifsc_code: string | null;
    account_holder_name: string | null;
  };
  company: { id: string; name: string; logo_url: string | null } | null;
  profile: {
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    gstin: string | null;
    bank_name: string | null;
    account_no: string | null;
    ifsc_code: string | null;
  } | null;
  companyName: string;
  docTitle: string;
  invoiceRef: string;
  poLines: BillStatementPoLine[];
  /** Sum of every poLine's amountWithGst — the combined value of ALL entries on this invoice. */
  poSubtotal: number;
  awbLines: BillStatementAwbLine[];
  payments: BillStatementPayment[];
  walletConsumes: { id: string; txn_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null; amount: number }[];
  adjustments: { id: string; amount: number; remark: string | null; createdDate: string; label: string }[];
  walletPaid: number;
  settledTotal: number;
  outstanding: number;
  fullyPaid: boolean;
  waPhone: string;
};

export type BillStatementResult =
  | { ok: true; data: BillStatementData }
  | { ok: false; status: 401 | 403 | 404; error: string };

export async function loadBillStatement(billId: string): Promise<BillStatementResult> {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, status: 401, error: "Sign in to view this bill statement." };
    }
    return { ok: false, status: 401, error: "Not authorized." };
  }

  const supabase = createServiceRoleClient();

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at"
    )
    .eq("id", billId)
    .maybeSingle();

  if (!bill) return { ok: false, status: 404, error: "Bill not found." };
  if (!employee.companyIds.includes(bill.company_id)) {
    return { ok: false, status: 403, error: "You don't have access to this bill's company." };
  }
  if (!bill.party_id) return { ok: false, status: 404, error: "This bill has no vendor party linked." };

  const { data: partyRow } = await supabase
    .from("parties")
    .select("id, name, party_type, address, contact_no, email, gst, bank_name, account_no, ifsc_code, account_holder_name")
    .eq("id", bill.party_id)
    .maybeSingle();
  if (!partyRow) return { ok: false, status: 404, error: "Vendor not found." };

  const [companyRes, profileRes, paymentsRes, adjustmentsRes, walletRes, companiesRes] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", bill.company_id).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, gstin, bank_name, account_no, ifsc_code")
      .eq("company_id", bill.company_id)
      .maybeSingle(),
    supabase
      .from("bill_pass_register_payments")
      .select("id, amount, payment_date, payment_mode, reference_no, remark")
      .eq("bill_pass_register_id", bill.id)
      .order("payment_date", { ascending: true }),
    supabase
      .from("bill_pass_register_adjustments")
      .select("id, amount, remark, created_at, debit_note_id, credit_note_id")
      .eq("bill_pass_register_id", bill.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("party_wallet_txns")
      .select("id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark")
      .eq("bill_pass_register_id", bill.id)
      .eq("party_id", bill.party_id)
      .order("txn_date", { ascending: true }),
    supabase.from("companies").select("id, name"),
  ]);

  const company = companyRes.data;
  const profile = profileRes.data;
  const payments = (paymentsRes.data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
  const adjustmentsRaw = adjustmentsRes.data ?? [];
  const walletTxns = walletRes.data ?? [];

  const companyNames = new Map((companiesRes.data ?? []).map((c) => [c.id, c.name]));
  const companyName = companyNames.get(bill.company_id) ?? "—";
  const invoiceRef = (bill.vendor_invoice_no || bill.invoice_no || "").trim();

  const walletPaid = walletTxns.filter((w) => w.txn_type === "consume").reduce((s, w) => s + Number(w.amount), 0);
  const bankPaid = payments.reduce((s, p) => s + p.amount, 0);
  const settledTotal = bankPaid + walletPaid;
  const outstanding = Math.max(Number(bill.balance_due ?? 0), 0);
  const fullyPaid = Number(bill.balance_due ?? 0) <= 0.005;

  // Source-aware sections. Follow-up fetches are manual (no embedded
  // joins) — the generated types' Relationships array has gone stale
  // before (order_shipment_id FK), and a SelectQueryError would surface at
  // runtime, not just in tsc.
  let poLines: BillStatementPoLine[] = [];
  let awbLines: BillStatementAwbLine[] = [];
  if (bill.source === "purchase_bill" && bill.source_id) {
    // 2026-10-13 — "COTTON RUG PRINTING BILL ... A4 DILOG BOX ME DIKHNA
    // CHAHIYE NA KI KONKONSA PO KI ENTRY HUI HAI KYA KYA SIZE AMMOUNT RATE
    // GST". A multi-item / multi-PO Purchase Bill is stored as SEVERAL
    // purchase_bills rows sharing one (vendor, vendor_invoice_no) — see
    // src/lib/bill-grouping.ts. This loader used to read only the ONE row
    // the opened bill_pass_register row mirrored (bill.source_id), so a
    // grouped invoice's statement silently showed just its first item.
    // Now it resolves the whole invoice: match the same (vendor_party_id,
    // vendor_invoice_no) pair that defines the group. A single-item bill
    // trivially matches only itself, so nothing changes there. Order-ref
    // is resolved per line (each row can point at a different PO).
    // 2026-10-24 — SELECT * on purpose. This loader feeds the bill statement
    // AND its PDF (src/app/api/bill-statement/[billId]?format=pdf, which every
    // WhatsApp/Telegram/email share button downloads). It used to name
    // purchase_bills.size_mode, which arrives with
    // db/2026-10-24b-round-figure-printing-bill-and-size-mode.sql — and on a
    // database where that file hasn't been run PostgREST rejects the WHOLE
    // query (42703), so the statement AND its PDF failed for every purchase
    // bill with a generic "Could not load this bill statement". `*` returns
    // whatever columns exist; a missing size_mode just falls back to the
    // previous area behaviour below instead of taking the document down.
    const { data: pbRows } = await supabase
      .from("purchase_bills")
      .select("*")
      .eq("vendor_party_id", bill.party_id)
      .eq("vendor_invoice_no", bill.vendor_invoice_no ?? "")
      .order("created_at", { ascending: true });
    const rows = pbRows ?? [];
    const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((v): v is string => !!v)));
    const { data: ords } = orderIds.length
      ? await supabase.from("orders").select("id, ref_no").in("id", orderIds)
      : { data: [] as { id: string; ref_no: string | null }[] };
    const refById = new Map((ords ?? []).map((o) => [o.id, o.ref_no] as const));
    poLines = rows.map((pb) => {
      const amount = Number(pb.total_amount ?? 0);
      // gst_rate_pct is the CGST/SGST INDIVIDUAL rate — total GST is double
      // it (see db/2026-08-17-purchase-bills-gst.sql). IGST stores the full
      // rate as-is. No rate picked -> the historical flat-5% fallback the
      // g_total_plus_gst generated column uses, so the shown GST always
      // ties out to the invoice total.
      // 2026-10-20 — 0 now means "explicitly No GST"
      // (db/2026-10-20-purchase-bill-no-gst-and-audit.sql), so a NO-GST line
      // shows no GST at all instead of "0%". NULL keeps the legacy flat-5%
      // fallback so an old bill's per-line GST still ties out to its stored
      // invoice total.
      const storedRatePct = pb.gst_rate_pct != null ? Number(pb.gst_rate_pct) : null;
      const totalRatePct = storedRatePct != null ? (pb.gst_type === "IGST" ? storedRatePct : storedRatePct * 2) : 5;
      const gstAmount = Math.round(amount * totalRatePct) / 100;
      return {
        purchaseBillId: pb.id,
        refNo: pb.order_id ? refById.get(pb.order_id) ?? null : null,
        description: pb.work_description,
        qty: Number(pb.qty),
        unit: pb.qty_unit,
        size: Number(pb.sq_feet ?? 0),
        asBilled: (pb.size_mode ?? "area") === "as_billed",
        rate: Number(pb.unit_rate),
        amount,
        gstRatePct: storedRatePct && storedRatePct > 0 ? storedRatePct : null,
        gstType: storedRatePct && storedRatePct > 0 ? pb.gst_type : null,
        gstAmount,
        amountWithGst: amount + gstAmount,
      };
    });
  } else if (bill.source === "freight_bill" && bill.source_id) {
    const { data: assigns } = await supabase
      .from("freight_bill_awb_assignments")
      .select("order_id, order_shipment_id, bill_weight_kg, billed_freight_amt")
      .eq("freight_bill_id", bill.source_id);
    const shipmentIds = (assigns ?? []).map((a) => a.order_shipment_id);
    const { data: ships } = shipmentIds.length
      ? await supabase.from("order_shipments").select("id, awb_no").in("id", shipmentIds)
      : { data: [] };
    const awbById = new Map((ships ?? []).map((s) => [s.id, s.awb_no] as const));
    const orderIds = Array.from(new Set((assigns ?? []).map((a) => a.order_id)));
    const { data: ords } = orderIds.length ? await supabase.from("orders").select("id, ref_no").in("id", orderIds) : { data: [] };
    const refById = new Map((ords ?? []).map((o) => [o.id, o.ref_no] as const));
    awbLines = (assigns ?? []).map((a) => ({
      awb: awbById.get(a.order_shipment_id) ?? "—",
      refNo: refById.get(a.order_id) ?? null,
      weightKg: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
      billedAmt: a.billed_freight_amt != null ? Number(a.billed_freight_amt) : null,
    }));
  } else if (bill.source === "duty_tax_bill" && bill.source_id) {
    const { data: assigns } = await supabase
      .from("duty_bill_awb_assignments")
      .select("order_id, order_shipment_id, duty_tax_amt_inr")
      .eq("duty_tax_bill_id", bill.source_id);
    const shipmentIds = (assigns ?? []).map((a) => a.order_shipment_id);
    const { data: ships } = shipmentIds.length
      ? await supabase.from("order_shipments").select("id, awb_no").in("id", shipmentIds)
      : { data: [] };
    const awbById = new Map((ships ?? []).map((s) => [s.id, s.awb_no] as const));
    const orderIds = Array.from(new Set((assigns ?? []).map((a) => a.order_id)));
    const { data: ords } = orderIds.length ? await supabase.from("orders").select("id, ref_no").in("id", orderIds) : { data: [] };
    const refById = new Map((ords ?? []).map((o) => [o.id, o.ref_no] as const));
    awbLines = (assigns ?? []).map((a) => ({
      awb: awbById.get(a.order_shipment_id) ?? "—",
      refNo: refById.get(a.order_id) ?? null,
      weightKg: null,
      billedAmt: a.duty_tax_amt_inr != null ? Number(a.duty_tax_amt_inr) : null,
    }));
  }

  const noteIds = adjustmentsRaw.map((a) => a.credit_note_id ?? a.debit_note_id).filter((v): v is string => !!v);
  const [cnRes, dnRes] = await Promise.all([
    noteIds.length ? supabase.from("credit_notes").select("id, cn_no, vendor_cn_no").in("id", noteIds) : Promise.resolve({ data: [] }),
    noteIds.length ? supabase.from("debit_notes").select("id, debit_note_no").in("id", noteIds) : Promise.resolve({ data: [] }),
  ]);
  const noteLabel = new Map<string, string>();
  for (const n of cnRes.data ?? []) {
    noteLabel.set(n.id, n.vendor_cn_no ? `${n.cn_no ?? "CN"} (party: ${n.vendor_cn_no})` : n.cn_no ?? "CN");
  }
  for (const n of dnRes.data ?? []) noteLabel.set(n.id, n.debit_note_no ?? "DN");

  const adjustments = adjustmentsRaw.map((a) => ({
    id: a.id,
    amount: Number(a.amount),
    remark: a.remark,
    createdDate: a.created_at.slice(0, 10),
    label: `${a.credit_note_id ? "Credit Note" : "Debit Note"} ${noteLabel.get(a.credit_note_id ?? a.debit_note_id ?? "") ?? ""}`.trim(),
  }));

  const waPhoneRaw = (partyRow.contact_no ?? "").replace(/\D/g, "");
  const waPhone = waPhoneRaw.length === 10 ? `91${waPhoneRaw}` : waPhoneRaw;

  const docTitle =
    bill.source === "freight_bill"
      ? "COURIER FREIGHT BILL STATEMENT"
      : bill.source === "duty_tax_bill"
        ? "DUTY & TAX BILL STATEMENT"
        : "PURCHASE BILL STATEMENT";

  return {
    ok: true,
    data: {
      bill: {
        id: bill.id,
        company_id: bill.company_id,
        invoice_no: bill.invoice_no,
        vendor_invoice_no: bill.vendor_invoice_no,
        invoice_type: bill.invoice_type,
        invoice_date: bill.invoice_date,
        invoice_recv_date: bill.invoice_recv_date,
        total_amt: Number(bill.total_amt ?? 0),
        credit_note_amt: Number(bill.credit_note_amt ?? 0),
        adj_amt: Number(bill.adj_amt ?? 0),
        total_paid: Number(bill.total_paid ?? 0),
        balance_due: Number(bill.balance_due ?? 0),
        due_date: bill.due_date,
        approval_status: bill.approval_status,
        remark: bill.remark,
        source: bill.source,
      },
      party: partyRow,
      company: company ?? null,
      profile: profile ?? null,
      companyName,
      docTitle,
      invoiceRef: invoiceRef || bill.invoice_no || "—",
      poLines,
      poSubtotal: poLines.reduce((s, l) => s + l.amountWithGst, 0),
      awbLines,
      payments,
      walletConsumes: walletTxns
        .filter((w) => w.txn_type === "consume")
        .map((w) => ({
          id: w.id,
          txn_date: w.txn_date,
          payment_mode: w.payment_mode,
          reference_no: w.reference_no,
          remark: w.remark,
          amount: Number(w.amount),
        })),
      adjustments,
      walletPaid,
      settledTotal,
      outstanding,
      fullyPaid,
      waPhone,
    },
  };
}
