import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea } from "@/components/print-view";
import { groupBills } from "@/lib/bill-grouping";
import { LedgerExportBar } from "./ledger-export-bar";
import { LedgerBillAdminActions, LedgerPaymentAdminActions, LedgerPaymentBatchAdminActions } from "./admin-row-actions";

// Party Ledger (2026-08-17) — "SABHI PARTY KE LADGER BHI NAHI BANE ABHI TAK
// MERE HISAB SE". Investigated first (see db/2026-08-17-freight-duty-bills-
// vendor-party.sql's header comment): no per-party running statement page
// existed anywhere — Party Master is pure CRUD, and Bill Payment only lists
// outstanding bills flat across every party at once. bill_pass_register
// already has everything a real ledger needs (party_id, total_amt,
// credit_note_amt, total_paid, balance_due, due_date) since it's already
// the shared landing table for Purchase Bills (auto-posted, party_id always
// set) and — as of this same round — Courier/Duty bills too (previously
// party_id stayed NULL for those even when sent to Finance). This page is
// simply that table filtered to one party, oldest-first, with a running
// balance and each entry's payment history from bill_pass_register_payments.
//
// 2026-09-13 revamp (user's 8-item request, items #8 + #4):
//  - Separate INVOICE NO. column (vendor_invoice_no preferred, system
//    invoice_no fallback) instead of burying the number inside Particulars.
//  - Particulars now says WHAT the row is in plain words — "Courier Bill
//    (Freight)", "Duty & Tax Bill", "Purchase Bill", "Payment against
//    <invoice> via UPI · UTR-123" — pulled from `source`, so a Courier bill
//    is never mistaken for a Duty bill.
//  - Payment Mode + UTR/Ref No. get their own columns on payment rows
//    (bill_pass_register_payments.payment_mode / reference_no already held
//    both — they were only ever concatenated into Particulars).
//  - Row colors: a bill FULLY paid (balance_due <= 0) renders GREEN — both
//    the bill row and every payment row paid against it ("jis bill ke
//    against payment hua hai to bill ki dono entry green ho jaye");
//    balance-due bills render AMBER; bills past their due date (invoice
//    recv date + 7) render RED — "jo bill jyada late ho rahe hai vo red".
//  - "Merge same invoice across companies" (#4): one purchase of 20 orders
//    split 10/5/5 across Nyko Mart/Rugara/CASA ARRA posts three
//    bill_pass_register rows (same party, same vendor invoice no., three
//    companies) and previously showed as three disconnected entries. The
//    new `allCompanies=1` toggle drops the company filter, groups those
//    same-party+same-invoice rows into ONE Credit line summing the three
//    bills, and their payments join under it — invoice & party name stay
//    shared, "baki jo payment hai vo jud ke aajaye". Same merge logic is
//    what courier/duty bills need too ("ese hi courier bill, duty taxs me
//    hona chahiye"), so the group key is (party, vendor_invoice_no,
//    source-bucket) regardless of source, not purchase-only like
//    groupBills()'s same-company path.
export default async function PartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    return await PartyLedgerInner(await params, await searchParams);
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

// 2026-09-13 — the #4/#8 source-bucket labels. `source` is the
// discriminator Bill Payment/Purchase Bill already key on (and edit gates on,
// see bill-payment/actions.ts's source IS NULL rule) — reusing it here means
// Particulars is derived from the same field the rest of the app trusts,
// never guessed from the amount.
const SOURCE_LABEL: Record<string, string> = {
  purchase_bill: "Purchase Bill",
  freight_bill: "Courier Bill (Freight)",
  duty_tax_bill: "Duty & Tax Bill",
};

function sourceLabelFor(e: { source: string | null; invoice_type: string | null }): string {
  return SOURCE_LABEL[e.source ?? ""] ?? e.invoice_type ?? "Bill";
}

async function PartyLedgerInner(
  { id }: { id: string },
  sp: { [key: string]: string | string[] | undefined }
) {
  const employee = await requireCapability("bill_payment");
  const isAdmin = employee.capabilities.includes("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: party } = await supabase.from("parties").select("id, name, party_type").eq("id", id).maybeSingle();
  if (!party) notFound();

  const spVal = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  // #4 — cross-company merge toggle. Deliberately opt-in (default OFF =
  // today's per-company view): parties is deliberately NOT company-scoped
  // (one party can have bills against more than one company), so the
  // default view still filters to employee.currentCompanyId exactly as the
  // 2026-08-17 fix below mandates; the toggle just widens it to every
  // company this login can access, grouped per invoice.
  const allCompanies = spVal("allCompanies") === "1";
  const scopedCompanyIds = allCompanies ? employee.companyIds : [employee.currentCompanyId];

  const { data: entriesRaw } = await supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at"
    )
    .eq("party_id", id)
    .in("company_id", scopedCompanyIds)
    .order("invoice_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  // 2026-08-17 fix — "RUGARA ME RUG ARA KI SUMMERY DIKHNI CHAHIYE NYKO MART
  // ME KYU AARI HAI": `parties` is deliberately NOT company-scoped (one
  // party can have bills against more than one company, e.g. a courier or
  // "Prachi Rugs" appearing in both the Nyko Mart and Rug Ara historical
  // imports) — so the DEFAULT view must filter bill_pass_register down to
  // `employee.currentCompanyId` (the company picked in the top-nav
  // switcher), NOT `employee.companyIds` (every company this login can
  // access). The old `.in(..., companyIds)` leaked another company's bills
  // for the same party into whichever company happened to be selected —
  // matches the pattern every other per-company page in this app already
  // uses (orders/new, shipglobal, attendance, etc.). The `allCompanies=1`
  // toggle above is the explicit exception, clearly labeled in the UI.
  const { data: companies } = await supabase.from("companies").select("id, name");
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const currentCompanyName = companyName.get(employee.currentCompanyId) ?? "—";

  const entries = entriesRaw ?? [];
  const billIds = entries.map((e) => e.id);
  const { data: paymentsRaw } = billIds.length
    ? await supabase
        .from("bill_pass_register_payments")
        .select("id, bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark")
        .in("bill_pass_register_id", billIds)
        .order("payment_date", { ascending: true })
    : { data: [] };

  // 2026-09-13 — "CREDIT OR DEBIT NOTE ADJUST KI ENTRY EK SATH DIKHE NA":
  // the party's CN/DN adjustments against these bills, joined to their
  // note numbers, so EACH adjustment shows as its own dated ledger line
  // (exactly like each partial payment already does) instead of one
  // opaque adj_amt sum.
  const { data: adjustmentsRaw } = billIds.length
    ? await supabase
        .from("bill_pass_register_adjustments")
        .select("id, bill_pass_register_id, amount, remark, created_at, debit_note_id, credit_note_id")
        .in("bill_pass_register_id", billIds)
        .order("created_at", { ascending: true })
    : { data: [] };
  const noteIds = (adjustmentsRaw ?? []).map((a) => a.credit_note_id ?? a.debit_note_id).filter((v): v is string => !!v);
  const [cnRows, dnRows] = await Promise.all([
    noteIds.length ? supabase.from("credit_notes").select("id, cn_no, vendor_cn_no").in("id", noteIds) : Promise.resolve({ data: [] }),
    noteIds.length ? supabase.from("debit_notes").select("id, debit_note_no").in("id", noteIds) : Promise.resolve({ data: [] }),
  ]);
  const noteLabel = new Map<string, string>();
  for (const n of cnRows.data ?? []) {
    noteLabel.set(n.id, n.vendor_cn_no ? `${n.cn_no ?? "CN"} (party: ${n.vendor_cn_no})` : n.cn_no ?? "CN");
  }
  for (const n of dnRows.data ?? []) {
    noteLabel.set(n.id, n.debit_note_no ?? "DN");
  }

  // 2026-09-15 — "kuch kuch courier me shipment bhejne se pehle wallet
  // recharge karna padta hai phir baad me adjust hota hai jab uska invoice
  // aata hai": the party's prepaid courier wallet txns belong in THIS
  // passbook too. Recharge = we gave the courier money (CREDIT — our
  // receivable from them rises, exactly like a payment TO us in spirit;
  // convention: ledger balance > 0 = we owe the party, so a recharge
  // pushes the balance DOWN as a debit… but wallet money is the OPPOSITE
  // of a payable — it's prepaid). Simplest true-to-cash model: recharge
  // lines post as CREDIT (courier owes us that money back in service),
  // consume lines post as DEBIT (their invoice settled against it) — the
  // running balance then shows a positive figure while wallet credit is
  // unused and crosses to the payable side as invoices eat it. Refund =
  // DEBIT (courier handed cash back, wallet credit consumed).
  const { data: walletRaw } = await supabase
    .from("party_wallet_txns")
    .select("id, company_id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark, bill_pass_register_id")
    .eq("party_id", id)
    .in("company_id", scopedCompanyIds)
    .order("txn_date", { ascending: true });
  const walletBillIds = (walletRaw ?? []).map((w) => w.bill_pass_register_id).filter((v): v is string => !!v);
  const { data: walletBills } = walletBillIds.length
    ? await supabase.from("bill_pass_register").select("id, invoice_no, vendor_invoice_no").in("id", walletBillIds)
    : { data: [] };
  const walletBillLabel = new Map((walletBills ?? []).map((b) => [b.id, b.vendor_invoice_no || b.invoice_no || b.id.slice(0, 8)] as const));
  type LedgerPayment = { id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null };
  const paymentsByBill = new Map<string, LedgerPayment[]>();
  for (const p of paymentsRaw ?? []) {
    const list = paymentsByBill.get(p.bill_pass_register_id) ?? [];
    list.push({ ...p, amount: Number(p.amount) });
    paymentsByBill.set(p.bill_pass_register_id, list);
  }

  // 2026-08-18 — "ek entry debit ki dikh rahi hai phir credit ki dikh rahi
  // hai, ese ladger format apne system me": redesigned from "one row per
  // invoice, with its payments nested inside" to a real chronological
  // Debit/Credit/Balance ledger — the classic passbook format, same shape
  // as the vendor statements this gets reconciled against (see
  // claude/onpoint-express-ledger-reconciliation-2026-08-18.md).
  //
  // 2026-08-20 — Debit/Credit swap ("purchase/courier party se service
  // lete hain to credit hoga ya debit... mere hisab se credit me jayega"):
  // every party on this ledger is a vendor/supplier — a Creditor in
  // standard (Tally-style) bookkeeping. Standard convention posts a bill
  // (liability increases — we now owe them) to the CREDIT side of the
  // party's account, and a payment (liability decreases) to the DEBIT
  // side. Bill → Credit line, Credit Note → Debit line, Payment → Debit
  // line. `balance = credit - debit` so `closingBalance > 0` still means
  // "we owe the party this much". The 2026-09-13 color/merge work below
  // keeps this math byte-for-byte unchanged — it only changes which
  // columns exist and how rows are shaded.
  type Txn = {
    date: string;
    particulars: string;
    type: "Debit" | "Credit";
    debit: number;
    credit: number;
    sortKey: string; // date + a same-day tiebreaker so a bill sorts before its own same-day payment
    // #8 — row identity for coloring + the admin actions. billIds covers
    // merged groups (a merged line carries all 3 company rows' ids).
    billIds: string[];
    // #8 — the invoice column's value for this row ("" for payments,
    // which repeat their bill's invoice via the group's shade, not text).
    invoiceNo: string;
    paymentMode: string | null;
    referenceNo: string | null;
    // Set on payment rows only — every bill_pass_register_payments.id this
    // line posts from (a merged group's collapsed batch carries several),
    // so the Admin edit forms target the exact rows instead of
    // re-matching by (amount, mode, ref).
    paymentItems: { id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null }[];
    // The worst status across every bill this row represents — drives the
    // green/amber/red shading. Payments inherit their bill's status so
    // "dono entry green ho jaye" literally holds.
    status: "paid" | "pending" | "overdue" | null;
  };

  // #4/#8 — group key. Purchase-only same-company grouping stays exactly
  // as groupBills() defined it (that helper is shared with Approvals/Bill
  // Payment and I'm not changing its behavior under them); this page's
  // OWN pass re-groups the result by (party, vendor invoice no., source
  // bucket) across the already-fetched rows, which for allCompanies=1
  // merges the 3-company split of one invoice, and for courier/duty bills
  // merges their same-invoice duplicates too ("ese hi courier bill, duty
  // taxs me hona chahiye"). Rows with no vendor invoice no. stay
  // singletons (same never-merge-unknowns rule groupBills uses).
  type MergedBillGroup = {
    key: string;
    bills: typeof entries;
    isCrossCompanyMerge: boolean;
  };
  const mergedGroups: MergedBillGroup[] = [];
  {
    const baseGroups = groupBills(
      entries.filter((e): e is typeof e & { party_id: string } => !!e.party_id)
    );
    const byKey = new Map<string, MergedBillGroup>();
    const order: string[] = [];
    for (const bg of baseGroups) {
      const first = bg.bills[0];
      // Merge on the VENDOR's invoice number — that's the one real-world
      // document, whatever split it into several of our rows. System
      // invoice_no (our own reserve_next_number output) differs per
      // company by design and must never be a merge key.
      const vendorInv = (first.vendor_invoice_no ?? "").trim();
      const bucket = sourceLabelFor(first);
      const key = vendorInv ? `m:${bucket}|${vendorInv}` : `s:${bg.key}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.bills.push(...bg.bills);
      } else {
        const g: MergedBillGroup = { key, bills: [...bg.bills], isCrossCompanyMerge: false };
        byKey.set(key, g);
        order.push(key);
        mergedGroups.push(g);
      }
    }
    for (const g of mergedGroups) {
      g.isCrossCompanyMerge = new Set(g.bills.map((b) => b.company_id)).size > 1;
    }
    // Keep chronological order by the group's earliest bill date, stable
    // with the fetch order otherwise (sortKey ties broken by row order).
    mergedGroups.sort((a, b) => {
      const da = a.bills[0].invoice_date ?? a.bills[0].invoice_recv_date ?? a.bills[0].created_at.slice(0, 10);
      const db = b.bills[0].invoice_date ?? b.bills[0].invoice_recv_date ?? b.bills[0].created_at.slice(0, 10);
      if (da !== db) return da < db ? -1 : 1;
      return order.indexOf(a.key) - order.indexOf(b.key);
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const txns: Txn[] = [];
  for (const eg of mergedGroups) {
    const first = eg.bills[0];
    const vendorInv = (first.vendor_invoice_no ?? "").trim();
    const ref = vendorInv || first.invoice_no || "—";
    const label = sourceLabelFor(first);
    const billDate = first.invoice_date ?? first.invoice_recv_date ?? first.created_at.slice(0, 10);

    const totalAmt = eg.bills.reduce((sum, b) => sum + Number(b.total_amt), 0);
    const creditNoteAmt = eg.bills.reduce((sum, b) => sum + Number(b.credit_note_amt), 0);
    const adjAmt = eg.bills.reduce((sum, b) => sum + Number(b.adj_amt ?? 0), 0);
    // #8 — group status = worst member status. balance_due is a GENERATED
    // column (total_amt - credit_note_amt - adj_amt - total_paid), so <= 0
    // here IS "fully paid off" by the ledger's own math. due_date is
    // generated as invoice_recv_date + 7.
    const groupBillIds = eg.bills.map((b) => b.id);
    let status: Txn["status"];
    if (eg.bills.every((b) => Number(b.balance_due) <= 0.005)) status = "paid";
    else if (eg.bills.some((b) => b.due_date && b.due_date < today)) status = "overdue";
    else status = "pending";
    const groupSuffix =
      (eg.isCrossCompanyMerge ? ` — merged ${eg.bills.length} entries` : eg.bills.length > 1 ? ` (${eg.bills.length} items)` : "") +
      (eg.isCrossCompanyMerge ? ` (${Array.from(new Set(eg.bills.map((b) => companyName.get(b.company_id) ?? ""))).filter(Boolean).join(", ")})` : "");

    if (totalAmt !== 0) {
      txns.push({
        date: billDate,
        particulars: `${label}${groupSuffix}`,
        type: "Credit",
        debit: 0,
        credit: totalAmt,
        sortKey: `${billDate}_0_${eg.key}`,
        billIds: groupBillIds,
        invoiceNo: ref,
        paymentMode: null,
        referenceNo: null,
        paymentItems: [],
        status,
      });
    }
    if (creditNoteAmt > 0) {
      txns.push({
        date: billDate,
        particulars: `Credit Note against ${ref}${groupSuffix}`,
        type: "Debit",
        debit: creditNoteAmt,
        credit: 0,
        sortKey: `${billDate}_1_${eg.key}`,
        billIds: groupBillIds,
        invoiceNo: ref,
        paymentMode: null,
        referenceNo: null,
        paymentItems: [],
        status,
      });
    }
    // 2026-09-13 — "CREDIT OR DEBIT NOTE ADJUST KI ENTRY EK SATH DIKHE
    // NA": each adjustment is its OWN dated line with the note number in
    // Particulars (falling back to the old single sum only when the
    // adjustment rows couldn't be loaded). Same math — the lines still sum
    // to adj_amt, so Debit/Credit/Balance are byte-identical.
    const groupAdjRows = (adjustmentsRaw ?? []).filter((a) => groupBillIds.includes(a.bill_pass_register_id));
    if (adjAmt > 0 && groupAdjRows.length > 0) {
      for (const a of groupAdjRows) {
        const noteNo = a.credit_note_id ?? a.debit_note_id ? noteLabel.get(a.credit_note_id ?? a.debit_note_id ?? "") ?? "Note" : "Note";
        txns.push({
          date: a.created_at.slice(0, 10),
          particulars: `${a.credit_note_id ? "Credit Note" : "Debit Note"} ${noteNo} adjusted against ${ref}${groupSuffix}`,
          type: "Debit",
          debit: Number(a.amount),
          credit: 0,
          sortKey: `${a.created_at.slice(0, 10)}_1b_${eg.key}_${a.id}`,
          billIds: [a.bill_pass_register_id],
          invoiceNo: ref,
          paymentMode: null,
          referenceNo: null,
          paymentItems: [],
          status,
        });
      }
    }
    // 2026-09-15 — "ek invoice me 10 po ki agar entry kar raha hu to
    // payment me bhi alag alag ho raha, mearge ho jana chahiye na": one
    // vendor invoice becomes one bill_pass_register row per PO, and every
    // PO row used to render its own payment lines — Prachi's ledger showed
    // 13 separate NEFT lines for the single invoice P/26-27/41. Within a
    // merged group, payments collapse into ONE line per (date, mode, UTR)
    // batch — the same bank transaction split across PO rows reads as one
    // debit with the summed amount. A different date/mode/UTR still gets
    // its own line, so genuinely distinct transactions are never falsely
    // combined.
    const groupPayments = eg.bills.flatMap((b) => (paymentsByBill.get(b.id) ?? []).map((p) => ({ ...p, billId: b.id })));
    const batchesByKey = new Map<string, typeof groupPayments>();
    for (const p of groupPayments) {
      const batchKey = `${p.payment_date}|${p.payment_mode ?? ""}|${p.reference_no ?? ""}`;
      const batch = batchesByKey.get(batchKey);
      if (batch) batch.push(p);
      else batchesByKey.set(batchKey, [p]);
    }
    for (const batch of [...batchesByKey.values()].sort((a, b) => (a[0].payment_date < b[0].payment_date ? -1 : a[0].payment_date > b[0].payment_date ? 1 : 0))) {
      const p0 = batch[0];
      const batchTotal = batch.reduce((s, p) => s + p.amount, 0);
      txns.push({
        date: p0.payment_date,
        // #8 — Particulars names the mode explicitly ("via UPI"), with
        // mode+UTR ALSO in their own columns below. A collapsed batch of
        // several payment rows says how many it merged.
        particulars: `Payment against ${ref}${p0.payment_mode ? ` via ${p0.payment_mode}` : ""}${batch.length > 1 ? ` (${batch.length} payments merged)` : ""}`,
        type: "Debit",
        debit: batchTotal,
        credit: 0,
        sortKey: `${p0.payment_date}_2_${eg.key}_${p0.reference_no ?? ""}`,
        billIds: batch.map((p) => p.billId),
        invoiceNo: ref,
        paymentMode: p0.payment_mode,
        referenceNo: p0.reference_no,
        paymentItems: batch.map((p) => ({
          id: p.id,
          amount: p.amount,
          payment_date: p.payment_date,
          payment_mode: p.payment_mode,
          reference_no: p.reference_no,
        })),
        status,
      });
    }
  }
  // 2026-09-15 — wallet txns as their own dated lines (see the fetch-side
  // comment above for the credit/debit convention). sortKey tier "1c"
  // slots them same-day before payments ("_2").
  for (const w of walletRaw ?? []) {
    const isRecharge = w.txn_type === "recharge";
    const isConsume = w.txn_type === "consume";
    const billRef = w.bill_pass_register_id ? walletBillLabel.get(w.bill_pass_register_id) ?? "" : "";
    const label = isRecharge
      ? `Wallet recharge${w.payment_mode ? ` via ${w.payment_mode}` : ""}`
      : isConsume
        ? `Wallet paid invoice ${billRef || ""}`.trim()
        : `Wallet refund to us`;
    txns.push({
      date: w.txn_date,
      particulars: label,
      type: isRecharge ? "Credit" : "Debit",
      debit: isRecharge ? 0 : Number(w.amount),
      credit: isRecharge ? Number(w.amount) : 0,
      sortKey: `${w.txn_date}_1c_${w.id}`,
      billIds: w.bill_pass_register_id ? [w.bill_pass_register_id] : [],
      invoiceNo: billRef,
      paymentMode: w.payment_mode,
      referenceNo: w.reference_no ?? w.remark,
      paymentItems: [],
      status: null,
    });
  }
  txns.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  type LedgerLine = Txn & { balance: number };
  const ledgerLines = txns.reduce<LedgerLine[]>((acc, t) => {
    const prevBalance = acc.length ? acc[acc.length - 1].balance : 0;
    acc.push({ ...t, balance: prevBalance + t.credit - t.debit });
    return acc;
  }, []);

  // Total Debit / Total Credit / Closing Balance always reflect the FULL,
  // unfiltered history — same as a real bank passbook: filtering the view
  // below to a date range or Debit/Credit-only doesn't change what's
  // actually still owed, it just changes which rows are shown. Each row's
  // own `balance` value (computed above, before filtering) is likewise
  // always the true running balance at that point in time, not recomputed
  // against the filtered subset — filtering out earlier rows must not make
  // a later row's Balance column look wrong.
  const totalDebit = ledgerLines.reduce((s, t) => s + t.debit, 0);
  const totalCredit = ledgerLines.reduce((s, t) => s + t.credit, 0);
  const closingBalance = ledgerLines.length ? ledgerLines[ledgerLines.length - 1].balance : 0;

  // 2026-08-19 — "kaha pata chal raha hai ki apne ko ab kitna payment
  // karna hai" + "ladger me bhi to filter hona chaihiye credit debit date
  // sabhi filter ka" + "sabhi party ke ladger me hona chahiye": the
  // Closing Balance figure above IS that answer (it's total_amt minus
  // every credit note and every payment, running the same way
  // balance_due does on Bill Payment) — but it wasn't called out clearly,
  // and this page had no filter UI at all despite every other list page
  // in the app having one. This is the single shared page every party's
  // ledger renders through (`/dashboard/parties/[id]/ledger`), so both
  // fixes apply to every party automatically, not just this one.
  const fromDate = spVal("from");
  const toDate = spVal("to");
  const txnType = spVal("type");

  const displayedLines = ledgerLines.filter((t) => {
    if (fromDate && t.date < fromDate) return false;
    if (toDate && t.date > toDate) return false;
    if (txnType === "debit" && !(t.debit > 0)) return false;
    if (txnType === "credit" && !(t.credit > 0)) return false;
    return true;
  });
  const filtersActive = Boolean(fromDate || toDate || txnType);
  const shownDebit = displayedLines.reduce((s, t) => s + t.debit, 0);
  const shownCredit = displayedLines.reduce((s, t) => s + t.credit, 0);

  const isPayable = closingBalance > 0.005;
  const isCredit = closingBalance < -0.005;

  // 2026-08-19 — "print ka option bhi karo... export ka option bhi karo
  // jisme chose karne par option mange ki file ko kisme export karni hai
  // pdf ya xls": exports whatever's currently shown (respects the active
  // filter above, same as the printed view does) — CSV/Excel/Word/
  // PDF-via-Print/Email/WhatsApp, via the app's existing Universal Export
  // system (see ledger-export-bar.tsx).
  const exportRows = displayedLines.map((t) => ({
    date: t.date,
    particulars: t.particulars,
    invoice_no: t.invoiceNo,
    payment_mode: t.paymentMode ?? "",
    reference_no: t.referenceNo ?? "",
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
  }));

  // #8 — row shading. The shade classes are defined in globals.css (search
  // "oms-row-paid") — 2026-09-13: "green collom red collor dark me dikhe":
  // plain Tailwind pastels were tuned for the white card and nearly
  // invisible on the night/nova themes, so the classes now carry
  // theme-scoped dark tints there (plus a print block pinning the original
  // light look). The card gets .oms-ledger-card for the same reason.
  const rowShade: Record<NonNullable<Txn["status"]>, string> = {
    paid: "oms-row-paid",
    pending: "oms-row-pending",
    overdue: "oms-row-overdue",
  };

  // Bills/payments keyed by id for the per-row admin forms (Admin only).
  const billById = new Map(entries.map((e) => [e.id, e]));
  const paymentsByBillRemark = new Map<string, string | null>((paymentsRaw ?? []).map((p) => [p.id, p.remark] as const));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/parties" className="text-sm text-slate-500 hover:underline">← Back to Party Master</Link>
        <LedgerExportBar partyName={party.name} rows={exportRows} printAreaId="party-ledger-area" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={txnType} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All (Debit + Credit)</option>
            <option value="debit">Debit only (bills)</option>
            <option value="credit">Credit only (credit notes + payments)</option>
          </select>
        </div>
        {/* #4 — merge toggle. Preserves the date/type filters above since
            they're the same form; the toggle is its own checkbox. */}
        <label className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-slate-600" title="Show this party's bills from ALL your companies, merged into one entry per vendor invoice no. (purchase, courier and duty bills alike)">
          <input type="checkbox" name="allCompanies" value="1" defaultChecked={allCompanies} />
          Merge same invoice across companies
        </label>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Apply
        </button>
        {filtersActive && (
          <a href={`/dashboard/parties/${id}/ledger`} className="text-xs text-slate-400 underline">Clear</a>
        )}
      </form>

      {!allCompanies && (
        <p className="mb-2 text-[11px] text-slate-500 print:hidden">
          Showing <strong>{currentCompanyName}</strong> only. One purchase split across Nyko Mart / Rugara / CASA ARRA shows as separate entries
          per company — tick <em>Merge same invoice across companies</em> above to see them combined.
        </p>
      )}

      <PrintArea id="party-ledger-area">
        <div className="oms-ledger-card rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Party Ledger</h1>
              <p className="text-slate-500">{party.name}{party.party_type ? ` · ${party.party_type}` : ""}</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{allCompanies ? "All companies (merged)" : currentCompanyName}</p>
            </div>
            <div className="text-right text-slate-600">
              <p>Total Debit ₹{totalDebit.toFixed(2)}</p>
              <p>Total Credit ₹{totalCredit.toFixed(2)}</p>
              <p className="font-semibold text-slate-900">Closing Balance ₹{closingBalance.toFixed(2)}</p>
            </div>
          </div>

          {/* Direct, unambiguous answer to "ab kitna payment karna hai":
              closingBalance > 0 means we owe the party that much; < 0
              means the party is in credit with us (an advance/overpayment
              sitting on our books, same convention used for RJ2425004810's
              overpayment adjustment). */}
          {(isPayable || isCredit) && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2.5 text-sm font-semibold ${
                isPayable
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {isPayable
                ? `Amount payable to ${party.name}: ₹${closingBalance.toFixed(2)}`
                : `${party.name} is in credit with us: ₹${Math.abs(closingBalance).toFixed(2)} (advance/overpayment)`}
            </div>
          )}

          {filtersActive && (
            <p className="mb-2 text-[11px] text-slate-500 print:hidden">
              Showing {displayedLines.length} of {ledgerLines.length} entries
              {fromDate ? ` from ${fromDate}` : ""}{toDate ? ` to ${toDate}` : ""}
              {txnType ? ` · ${txnType} only` : ""} — Debit ₹{shownDebit.toFixed(2)}, Credit ₹{shownCredit.toFixed(2)} in this range.
              Closing Balance above is always the full, unfiltered total.
            </p>
          )}

          {/* #8 legend — matches the exact row classes used below. */}
          <p className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500 print:hidden">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Paid in full</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200" /> Pending (within due date)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-300" /> Overdue (past due date)</span>
            <span>· a bill and its payments share the same shade; due date = bill received date + 7 days.</span>
          </p>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Date</th>
                {/* #8 — Invoice No. is its own column now; the cell below
                    keeps the yellow/orange search-highlight treatment the
                    screenshot showed, since the user found rows by tapping
                    Ctrl+F into this exact text. */}
                <th className="py-1 pr-2">Invoice No.</th>
                <th className="py-1 pr-2">Particulars</th>
                <th className="py-1 pr-2">Mode</th>
                <th className="py-1 pr-2">UTR / Ref No.</th>
                <th className="py-1 pr-2 text-right">Debit</th>
                <th className="py-1 pr-2 text-right">Credit</th>
                <th className="py-1 pr-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {displayedLines.map((t, i) => (
                <tr key={i} className={`group border-b border-slate-100 align-top text-slate-700 ${t.status ? rowShade[t.status] : ""}`}>
                  <td className="whitespace-nowrap py-1 pr-2">{t.date}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">
                    {/* 2026-09-15 — "invoice no par click kar ke uski puri entry
                        dekhni ho to read only form open ho jaye": the invoice
                        cell of a BILL row (Credit) links to the read-only,
                        printable bill statement. Payment/adjustment lines
                        repeat the same invoice as plain text — one link per
                        bill, on the row that IS the bill. */}
                    {t.type === "Credit" && t.billIds[0] ? (
                      <Link
                        href={`/dashboard/parties/${id}/ledger/${t.billIds[0]}`}
                        className="underline decoration-amber-400 decoration-2 underline-offset-2 hover:text-amber-700"
                        title="Open read-only bill statement (print / WhatsApp / email)"
                      >
                        {t.invoiceNo || ""}
                      </Link>
                    ) : (
                      t.invoiceNo || ""
                    )}
                  </td>
                  <td className="py-1 pr-2 font-medium text-slate-900">
                    {t.particulars}
                    {/* #8 admin actions — hover-revealed, Admin-only,
                        print-hidden. Rendered inside the Particulars cell
                        so the extra form never disturbs the columns. */}
                    {isAdmin && t.type === "Credit" && (
                      <LedgerBillAdminActions
                        billId={t.billIds[0]}
                        partyId={id}
                        defaults={{
                          invoice_no: billById.get(t.billIds[0])?.invoice_no ?? null,
                          vendor_invoice_no: billById.get(t.billIds[0])?.vendor_invoice_no ?? null,
                          invoice_date: billById.get(t.billIds[0])?.invoice_date ?? null,
                          invoice_recv_date: billById.get(t.billIds[0])?.invoice_recv_date ?? null,
                          total_amt: Number(billById.get(t.billIds[0])?.total_amt ?? 0),
                          credit_note_amt: Number(billById.get(t.billIds[0])?.credit_note_amt ?? 0),
                          remark: billById.get(t.billIds[0])?.remark ?? null,
                        }}
                      />
                    )}
                    {/* 2026-09-15 — ONE Edit/Delete control per payment line
                        (Admin only). A merged batch line gets the batch
                        form (edits the total, re-splits across rows); a
                        single-payment line keeps the original single form. */}
                    {isAdmin && t.paymentItems.length > 1 && (
                      <LedgerPaymentBatchAdminActions
                        paymentIds={t.paymentItems.map((pi) => pi.id)}
                        partyId={id}
                        defaults={{
                          amount: t.debit,
                          payment_date: t.date,
                          payment_mode: t.paymentMode,
                          reference_no: t.referenceNo,
                        }}
                      />
                    )}
                    {isAdmin && t.paymentItems.length === 1 && (
                      <LedgerPaymentAdminActions
                        paymentId={t.paymentItems[0].id}
                        partyId={id}
                        defaults={{
                          amount: t.debit,
                          payment_date: t.date,
                          payment_mode: t.paymentMode,
                          reference_no: t.referenceNo,
                          remark: paymentsByBillRemark.get(t.paymentItems[0].id) ?? null,
                        }}
                      />
                    )}
                  </td>
                  <td className="py-1 pr-2">{t.paymentMode ?? ""}</td>
                  <td className="py-1 pr-2 font-mono text-[11px]">{t.referenceNo ?? ""}</td>
                  <td className="py-1 pr-2 text-right">{t.debit > 0 ? t.debit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right">{t.credit > 0 ? t.credit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right font-medium">{t.balance.toFixed(2)}</td>
                </tr>
              ))}
              {displayedLines.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-center text-slate-400">
                    {ledgerLines.length === 0 ? "No bills against this party yet." : "No entries match the selected filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
