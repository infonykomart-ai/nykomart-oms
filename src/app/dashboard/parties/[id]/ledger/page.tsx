import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea } from "@/components/print-view";
import { groupBills } from "@/lib/bill-grouping";
import { LedgerExportBar, type LedgerExportRow } from "./ledger-export-bar";
import type { LedgerPdfInput } from "@/lib/ledger-pdf";
import { LedgerBillAdminActions, LedgerPaymentAdminActions, LedgerPaymentBatchAdminActions } from "./admin-row-actions";
import { BillDocLink } from "@/components/bill-doc-link";
import { LedgerDuplicateMerge, type LedgerDuplicateGroup } from "./duplicate-merge";
import { resolveBillDocHrefs } from "@/lib/bill-doc-href";
import { buildWalletLedgerLines, walletSettlementNote, type WalletSettlement } from "@/lib/ledger/wallet-ledger-lines";
import { fyOptions, fyStartYear, fyWindow } from "@/lib/fy-date";
import { todayIST } from "@/lib/attendance/ist-date";

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
//
// 2026-10-28 — company split (user: "ladger ese nikle ki jis company me
// invoice chadhaya hai usme hi payment dikhe, complete merge nahi karna
// pade"). Until now the page opened on ONE company (the top-nav switcher) and
// another company's bills/payments simply weren't there; the only way to see
// them together was the opt-in "Merge same invoice across companies" toggle,
// which welded several companies' rows into one running balance — exactly the
// "complete merge" the user does not want to have to do.
//
// Now: the default view lists this party's ledger for EVERY company the login
// can access, as SEPARATE ledgers — one block per company, each with its own
// running balance, its own closing balance and its own "amount payable"
// banner. A bill and the payments made against it always land in the same
// company block (payments hang off the bill's own bill_pass_register row, so
// they can never drift), and the top summary adds the blocks up only as a
// cross-check. The company filter in the bar narrows it to one company, which
// is what the old default effectively was.

const SOURCE_LABEL: Record<string, string> = {
  purchase_bill: "Purchase Bill",
  freight_bill: "Courier Bill (Freight)",
  duty_tax_bill: "Duty & Tax Bill",
  // 2026-10-28b — office expense bill entered with a party (payable).
  office_expense: "Office Expense Bill",
};

function sourceLabelFor(e: { source: string | null; invoice_type: string | null }): string {
  return SOURCE_LABEL[e.source ?? ""] ?? e.invoice_type ?? "Bill";
}

type LedgerPayment = { id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null };

type Txn = {
  date: string;
  particulars: string;
  type: "Debit" | "Credit";
  debit: number;
  credit: number;
  sortKey: string; // date + a same-day tiebreaker so a bill sorts before its own same-day payment
  // Row identity for coloring + the admin actions. billIds covers a merged
  // group (one vendor invoice entered per PO).
  billIds: string[];
  // The invoice column's value for this row ("" for wallet rows).
  invoiceNo: string;
  paymentMode: string | null;
  referenceNo: string | null;
  // Set on payment rows only — every bill_pass_register_payments.id this
  // line posts from, so the Admin edit forms target the exact rows instead
  // of re-matching by (amount, mode, ref).
  paymentItems: { id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null }[];
  // The worst status across every bill this row represents — drives the
  // green/amber/red shading. Payments inherit their bill's status so
  // "dono entry green ho jaye" literally holds.
  status: "paid" | "pending" | "overdue" | null;
  // The bill's own document sheet (see docHrefByBillId). Set on the bill's
  // Credit line only; null = no document → the invoice cell falls back to the
  // read-only bill statement.
  docHref?: string | null;
};

type LedgerLine = Txn & { balance: number };

type LedgerSection = {
  companyId: string;
  companyName: string;
  ledgerLines: LedgerLine[];
  displayedLines: LedgerLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  openingBalance: number;
  shownDebit: number;
  shownCredit: number;
  periodClosing: number;
};

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

async function PartyLedgerInner(
  { id }: { id: string },
  sp: { [key: string]: string | string[] | undefined }
) {
  const employee = await requireCapability("bill_payment");
  const isAdmin = employee.capabilities.includes("employee_admin");
  const supabase = createServiceRoleClient();

  // 2026-10-24 (perf) — the first three reads have no dependency on each
  // other, so they run as ONE round-trip wave instead of three in series.
  const spVal = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const todayISTStr = todayIST();
  // 2026-10-28 — `company` narrows the ledger to one company. Empty (the
  // default) shows every company this login can access as its own block.
  const companyParam = spVal("company");
  const requestedCompanyId = employee.companyIds.includes(companyParam) ? companyParam : "";
  const scopedCompanyIds = requestedCompanyId ? [requestedCompanyId] : employee.companyIds;

  const [
    { data: party },
    { data: entriesRaw },
    { data: companies },
  ] = await Promise.all([
    supabase.from("parties").select("id, name, party_type, contact_no, email, gst").eq("id", id).maybeSingle(),
    supabase
      .from("bill_pass_register")
      .select(
        "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at, merged_into_bill_id"
      )
      .eq("party_id", id)
      .in("company_id", scopedCompanyIds)
      .order("invoice_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.from("companies").select("id, name, logo_url"),
  ]);
  if (!party) notFound();

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const currentCompanyName = companyName.get(employee.currentCompanyId) ?? "—";
  // 2026-09-17 — report footer's company logo: only when this ledger is
  // scoped to ONE company (no single logo would be correct across companies).
  const currentCompanyLogoUrl = (companies ?? []).find((c) => c.id === employee.currentCompanyId)?.logo_url ?? null;

  // 2026-10-29 — a merged duplicate row is kept for audit but must not render
  // as a second entry: after "merge into one" the ledger shows the single
  // surviving entry only.
  const entries = (entriesRaw ?? []).filter((e) => !e.merged_into_bill_id);
  // 2026-10-24 — the invoice cell of a bill row opens the bill's OWN document
  // sheet (Courier / Duty & Tax / Purchase Bill), exactly like Bill Payment
  // does. Same shared resolver, so the pages can never drift apart.
  // Second wave: everything below depends ONLY on `entries`, so payments /
  // adjustments / wallet / document-hrefs all run in parallel.
  const billIds = entries.map((e) => e.id);
  const [docHrefByBillId, paymentsRes, adjustmentsRes, walletRes] = await Promise.all([
    resolveBillDocHrefs(supabase, entries),
    billIds.length
      ? supabase
          .from("bill_pass_register_payments")
          .select("id, bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark")
          .in("bill_pass_register_id", billIds)
          .order("payment_date", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; bill_pass_register_id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null }[] }),
    billIds.length
      ? supabase
          .from("bill_pass_register_adjustments")
          .select("id, bill_pass_register_id, amount, remark, created_at, debit_note_id, credit_note_id")
          .in("bill_pass_register_id", billIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; bill_pass_register_id: string; amount: number; remark: string | null; created_at: string; debit_note_id: string | null; credit_note_id: string | null }[] }),
    supabase
      .from("party_wallet_txns")
      .select("id, company_id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark, bill_pass_register_id")
      .eq("party_id", id)
      .in("company_id", scopedCompanyIds)
      .order("txn_date", { ascending: true }),
  ]);
  const paymentsRaw = paymentsRes.data;

  // 2026-09-13 — "CREDIT OR DEBIT NOTE ADJUST KI ENTRY EK SATH DIKHE NA":
  // the party's CN/DN adjustments against these bills, joined to their note
  // numbers, so EACH adjustment shows as its own dated ledger line.
  const adjustmentsRaw = adjustmentsRes.data;
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

  // 2026-09-15 — prepaid courier wallet txns belong in THIS passbook too.
  // 2026-10-12 — recharge = Debit, refund = Credit, settlements post no line
  // at all (see src/lib/ledger/wallet-ledger-lines.ts for the reasoning).
  const walletRaw = walletRes.data;

  const paymentsByBill = new Map<string, LedgerPayment[]>();
  for (const p of paymentsRaw ?? []) {
    const list = paymentsByBill.get(p.bill_pass_register_id) ?? [];
    list.push({ ...p, amount: Number(p.amount) });
    paymentsByBill.set(p.bill_pass_register_id, list);
  }

  const billById = new Map(entries.map((e) => [e.id, e]));
  const paymentsByBillRemark = new Map<string, string | null>((paymentsRaw ?? []).map((p) => [p.id, p.remark] as const));

  // 2026-10-28 — filters are read once and applied to every company block, so
  // the same date range means the same thing in each of them.
  const fyParam = spVal("fy");
  const fyMatch = /^(\d{4})-\d{2}$/.exec(fyParam);
  const fyStartYearSelected = fyMatch ? Number(fyMatch[1]) : null;
  const fy = fyStartYearSelected != null && fyStartYearSelected >= 2000 ? fyWindow(fyStartYearSelected) : null;
  const fyTo = fy ? (todayISTStr < fy.end ? todayISTStr : fy.end) : "";
  const fromDate = fy ? fy.start : spVal("from");
  const toDate = fy ? fyTo : spVal("to");
  const txnType = spVal("type");
  const filtersActive = Boolean(fromDate || toDate || txnType || fy);

  const today = todayISTStr;

  // ---- one ledger per company ---------------------------------------------
  // The math below is byte-for-byte the pre-2026-10-28 math; only its scope
  // changed from "the whole page" to "one company's rows". Each call starts
  // from balance 0, so a company's running balance can never be carried over
  // from another company's invoices.
  function buildCompanyLedger(companyId: string): LedgerSection {
    const companyEntries = entries.filter((e) => e.company_id === companyId);
    const { lines: walletLines, settledByBill } = buildWalletLedgerLines((walletRaw ?? []).filter((w) => w.company_id === companyId));

    // Group key: same-company per-vendor-invoice grouping stays exactly as
    // groupBills() defines it (shared with Approvals / Bill Payment); rows
    // with no vendor invoice no. stay singletons (never merge unknowns).
    type MergedBillGroup = { key: string; bills: typeof companyEntries; isCrossCompanyMerge: boolean };
    const mergedGroups: MergedBillGroup[] = [];
    {
      const baseGroups = groupBills(
        companyEntries.filter((e): e is typeof e & { party_id: string } => !!e.party_id)
      );
      const byKey = new Map<string, MergedBillGroup>();
      const order: string[] = [];
      for (const bg of baseGroups) {
        const first = bg.bills[0];
        // Merge on the VENDOR's invoice number + that invoice's DATE — one
        // real-world document. 2026-10-29b: the date is part of the key
        // because a vendor can reuse an invoice number in another financial
        // year (82 of 2026-10-19 vs 82 of 2026-08-02); without it the two
        // bills were summed into a single line and the ledger showed one
        // amount where there were two bills.
        const vendorInv = (first.vendor_invoice_no ?? "").trim();
        const invDate = (first.invoice_date ?? first.invoice_recv_date ?? "").slice(0, 10);
        const bucket = sourceLabelFor(first);
        const key = vendorInv ? `m:${bucket}|${vendorInv}|${invDate}` : `s:${bg.key}`;
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
      mergedGroups.sort((a, b) => {
        const da = a.bills[0].invoice_date ?? a.bills[0].invoice_recv_date ?? a.bills[0].created_at.slice(0, 10);
        const db = b.bills[0].invoice_date ?? b.bills[0].invoice_recv_date ?? b.bills[0].created_at.slice(0, 10);
        if (da !== db) return da < db ? -1 : 1;
        return order.indexOf(a.key) - order.indexOf(b.key);
      });
    }

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
      // balance_due is a GENERATED column (total_amt - credit_note_amt -
      // adj_amt - total_paid), so <= 0 here IS "fully paid off". due_date is
      // generated as invoice_recv_date + 7.
      const groupBillIds = eg.bills.map((b) => b.id);
      let status: Txn["status"];
      if (eg.bills.every((b) => Number(b.balance_due) <= 0.005)) status = "paid";
      else if (eg.bills.some((b) => b.due_date && b.due_date < today)) status = "overdue";
      else status = "pending";
      const groupSuffix =
        (eg.isCrossCompanyMerge ? ` — merged ${eg.bills.length} entries` : eg.bills.length > 1 ? ` (${eg.bills.length} items)` : "") +
        (eg.isCrossCompanyMerge
          ? ` (${Array.from(new Set(eg.bills.map((b) => companyName.get(b.company_id) ?? ""))).filter(Boolean).join(", ")})`
          : "");

      if (totalAmt !== 0) {
        // Merge every wallet settlement against this bill GROUP so Particulars
        // says how much the prepaid wallet paid and when, without posting it
        // as a second ledger line (which double-counted the rupee).
        const settled: WalletSettlement = { amount: 0, dates: [] };
        for (const b of eg.bills) {
          const s = settledByBill.get(b.id);
          if (!s) continue;
          settled.amount += s.amount;
          for (const d of s.dates) if (!settled.dates.includes(d)) settled.dates.push(d);
        }
        settled.dates.sort();

        txns.push({
          date: billDate,
          particulars: `${label}${groupSuffix}${walletSettlementNote(settled.amount > 0.005 ? settled : undefined)}`,
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
          docHref: eg.bills.map((b) => docHrefByBillId.get(b.id)).find((h): h is string => !!h) ?? null,
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
      // 2026-09-13 — "CREDIT OR DEBIT NOTE ADJUST KI ENTRY EK SATH DIKHE NA":
      // each adjustment is its OWN dated line with the note number in
      // Particulars. Same math — the lines still sum to adj_amt.
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
      // 2026-09-15 — one vendor invoice becomes one bill_pass_register row per
      // PO; payments collapse into ONE line per (date, mode, UTR) batch.
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
    for (const wl of walletLines) {
      txns.push({ ...wl, paymentItems: [], status: null });
    }
    txns.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

    const ledgerLines = txns.reduce<LedgerLine[]>((acc, t) => {
      const prevBalance = acc.length ? acc[acc.length - 1].balance : 0;
      acc.push({ ...t, balance: round2(prevBalance + t.credit - t.debit) });
      return acc;
    }, []);

    // Totals always reflect the FULL, unfiltered history — same as a real
    // bank passbook: filtering only changes which rows are shown.
    const totalDebit = round2(ledgerLines.reduce((s, t) => s + t.debit, 0));
    const totalCredit = round2(ledgerLines.reduce((s, t) => s + t.credit, 0));
    const closingBalance = ledgerLines.length ? ledgerLines[ledgerLines.length - 1].balance : 0;

    const displayedLines = ledgerLines.filter((t) => {
      if (fromDate && t.date < fromDate) return false;
      if (toDate && t.date > toDate) return false;
      if (txnType === "debit" && !(t.debit > 0)) return false;
      if (txnType === "credit" && !(t.credit > 0)) return false;
      return true;
    });
    const shownDebit = round2(displayedLines.reduce((s, t) => s + t.debit, 0));
    const shownCredit = round2(displayedLines.reduce((s, t) => s + t.credit, 0));
    // Opening = everything before the visible range (same sign convention as
    // the running balance: credit − debit). Closing = opening + this range.
    const openingBalance = fromDate
      ? round2(ledgerLines.filter((t) => t.date < fromDate).reduce((s, t) => s + t.credit - t.debit, 0))
      : 0;
    const periodClosing = round2(openingBalance + shownCredit - shownDebit);

    return {
      companyId,
      companyName: companyName.get(companyId) ?? "—",
      ledgerLines,
      displayedLines,
      totalDebit,
      totalCredit,
      closingBalance,
      openingBalance,
      shownDebit,
      shownCredit,
      periodClosing,
    };
  }

  // The current company's block first (it is the one the top-nav switcher is
  // on), then the rest alphabetically — stable and predictable on every load.
  const sectionCompanyIds = Array.from(new Set(entries.map((e) => e.company_id))).sort((a, b) => {
    if (a === employee.currentCompanyId) return -1;
    if (b === employee.currentCompanyId) return 1;
    return (companyName.get(a) ?? "").localeCompare(companyName.get(b) ?? "");
  });
  const sections = sectionCompanyIds.map(buildCompanyLedger).filter((s) => s.ledgerLines.length > 0);

  const totalDebit = round2(sections.reduce((s, sec) => s + sec.totalDebit, 0));
  const totalCredit = round2(sections.reduce((s, sec) => s + sec.totalCredit, 0));
  const closingBalance = round2(sections.reduce((s, sec) => s + sec.closingBalance, 0));
  const shownDebit = round2(sections.reduce((s, sec) => s + sec.shownDebit, 0));
  const shownCredit = round2(sections.reduce((s, sec) => s + sec.shownCredit, 0));
  const periodClosing = round2(sections.reduce((s, sec) => s + sec.periodClosing, 0));
  const isMultiCompany = sections.length > 1;
  const scopeLabel = requestedCompanyId
    ? companyName.get(requestedCompanyId) ?? currentCompanyName
    : isMultiCompany
      ? `${sections.length} companies (separate ledgers)`
      : sections[0]?.companyName ?? currentCompanyName;

  // FY presets built from this party's own history (newest first) — the same
  // helper the Party Balance Summary uses, so both pages offer identical years.
  const earliestLineDate = sections.reduce<string | null>((min, sec) => {
    const d = sec.ledgerLines[0]?.date ?? null;
    if (!d) return min;
    return min == null || d < min ? d : min;
  }, null);
  const fyChoices = fyOptions(earliestLineDate ? fyStartYear(earliestLineDate) : null, new Date(`${todayISTStr}T00:00:00Z`));

  const isPayable = closingBalance > 0.005;
  const isCredit = closingBalance < -0.005;

  // 2026-08-19 — exports whatever's currently shown (respects the active
  // filter above), via the app's existing Universal Export system.
  const exportRows: LedgerExportRow[] = sections.flatMap((sec) =>
    sec.displayedLines.map((t) => ({
      date: t.date,
      company: sec.companyName,
      particulars: t.particulars,
      invoice_no: t.invoiceNo,
      payment_mode: t.paymentMode ?? "",
      reference_no: t.referenceNo ?? "",
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
    }))
  );

  // 2026-10-24 — "LEDGER PAGE SE SUMMERY DOWNLOAD NAHI HORI": the CSV / Excel
  // / Word downloads carry the totals too. 2026-10-28 — with several company
  // blocks the file gets one closing line per company, then the combined
  // total, so a saved copy can be checked company by company.
  const exportSummaryRows: LedgerExportRow[] = [
    ...(fromDate
      ? [
          {
            date: "",
            invoice_no: "",
            company: "",
            particulars: `SUMMARY — Opening balance as on ${fromDate}`,
            payment_mode: "",
            reference_no: "",
            debit: 0,
            credit: 0,
            balance: sections.reduce((s, sec) => s + sec.openingBalance, 0),
          },
        ]
      : []),
    ...(isMultiCompany
      ? sections.map((sec) => ({
          date: "",
          invoice_no: "",
          company: sec.companyName,
          particulars: `SUMMARY — Closing balance (${sec.companyName})`,
          payment_mode: "",
          reference_no: "",
          debit: sec.totalDebit,
          credit: sec.totalCredit,
          balance: sec.closingBalance,
        }))
      : []),
    {
      date: "",
      invoice_no: "",
      company: "",
      particulars: "SUMMARY — Total Debit (bills / charges)",
      payment_mode: "",
      reference_no: "",
      debit: shownDebit,
      credit: 0,
      balance: 0,
    },
    {
      date: "",
      invoice_no: "",
      company: "",
      particulars: "SUMMARY — Total Credit (credit notes + payments)",
      payment_mode: "",
      reference_no: "",
      debit: 0,
      credit: shownCredit,
      balance: 0,
    },
    {
      date: "",
      invoice_no: "",
      company: "",
      particulars: `SUMMARY — Closing balance as on ${toDate || todayISTStr}${isMultiCompany ? " (all companies)" : ""}`,
      payment_mode: "",
      reference_no: "",
      debit: 0,
      credit: 0,
      balance: periodClosing,
    },
  ];

  // 2026-09-15 — the exact on-screen rows + totals + scope go to
  // /api/ledger-pdf (via LedgerExportBar's pdfInput) — the A4-portrait PDF.
  const ledgerPdfInput: LedgerPdfInput = {
    party: {
      name: party.name,
      party_type: party.party_type,
      contact_no: party.contact_no,
      email: party.email,
      gst: party.gst,
    },
    // Overwritten server-side (logo + profile + party row re-read there);
    // placeholders keep the shape valid until the route does that.
    companyName: scopeLabel,
    profile: null,
    logoUrl: null,
    scopeLine: scopeLabel,
    rows: exportRows,
    totalDebit,
    totalCredit,
    closingBalance,
  };

  // Row shading classes are defined in globals.css (search "oms-row-paid") —
  // theme-scoped dark tints there plus a print block pinning the light look.
  const rowShade: Record<NonNullable<Txn["status"]>, string> = {
    paid: "oms-row-paid",
    pending: "oms-row-pending",
    overdue: "oms-row-overdue",
  };

  // 2026-10-29 — one invoice, more than one ledger entry for THIS party in
  // THIS company: exactly the case the user hit (a Courier Bill carrying 11
  // AWBs plus a second "FREIGHT INVOICE" row carrying a credit note). The
  // rows are real rows in the Finance ledger, so they can be folded for real
  // — not just hidden — by the same merge action Bill Payment uses.
  const ledgerDuplicateGroups: LedgerDuplicateGroup[] = (() => {
    const byInvoice = new Map<string, typeof entries>();
    for (const e of entries) {
      const inv = (e.vendor_invoice_no ?? e.invoice_no ?? "").trim();
      if (!inv) continue;
      const key = `${e.company_id}|${inv.toLowerCase()}`;
      const list = byInvoice.get(key) ?? [];
      list.push(e);
      byInvoice.set(key, list);
    }
    const out: LedgerDuplicateGroup[] = [];
    for (const [key, list] of byInvoice) {
      if (list.length < 2) continue;
      // Purchase bills are stored one row PER ITEM on the same invoice; those
      // are not duplicates (the ledger already renders them as a single line),
      // so a group made only of purchase-bill item rows is never offered.
      if (list.every((e) => e.source === "purchase_bill")) continue;
      const first = list[0];
      out.push({
        key,
        invoiceNo: (first.vendor_invoice_no ?? first.invoice_no ?? "—") as string,
        companyName: companyName.get(first.company_id) ?? "—",
        rows: list.map((e) => ({
          id: e.id,
          label: sourceLabelFor(e),
          total: Number(e.total_amt ?? 0),
          creditNote: Number(e.credit_note_amt ?? 0),
          hasDocument: Boolean(e.source_id),
        })),
      });
    }
    return out;
  })();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/parties" className="text-sm text-slate-500 hover:underline">← Back to Party Master</Link>
        <LedgerExportBar partyId={id} partyName={party.name} rows={exportRows} summaryRows={exportSummaryRows} printAreaId="party-ledger-area" pdfInput={ledgerPdfInput} />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden">
        {/* 2026-10-28 — company scope. Default = every company this login can
            access, each shown as its own ledger below; picking one narrows it
            to that company alone (the old default view). */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select
            id="company"
            name="company"
            defaultValue={requestedCompanyId}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
            title="Each company keeps its own ledger and its own closing balance — nothing is merged."
          >
            <option value="">All companies (separate ledgers)</option>
            {employee.companyIds.map((cid) => (
              <option key={cid} value={cid}>{companyName.get(cid) ?? cid}</option>
            ))}
          </select>
        </div>
        {/* 2026-10-24 — FY jump: picks the whole FY window (From/To below follow it). */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fy">Financial year</label>
          <select id="fy" name="fy" defaultValue={fy?.label ?? ""} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" title="Sets From/To to that financial year and adds Opening / Closing balance">
            <option value="">No FY (use dates below)</option>
            {fyChoices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
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
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Apply
        </button>
        {filtersActive && (
          <a href={`/dashboard/parties/${id}/ledger`} className="text-xs text-slate-400 underline">Clear</a>
        )}
      </form>

      {isMultiCompany && !requestedCompanyId && (
        <p className="mb-2 text-[11px] text-slate-500 print:hidden">
          Showing <strong>{sections.length} companies</strong> — each with its own ledger and its own closing balance. A bill and every payment made
          against it always appear in the same company. Pick one company above to see it alone.
        </p>
      )}

      <div className="print:hidden">
        <LedgerDuplicateMerge groups={ledgerDuplicateGroups} />
      </div>

      <PrintArea
        id="party-ledger-area"
        companyName={requestedCompanyId ? scopeLabel : undefined}
        companyLogoUrl={requestedCompanyId ? currentCompanyLogoUrl : undefined}
      >
        <div className="oms-ledger-card space-y-5 rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Party Ledger</h1>
              <p className="text-slate-500">{party.name}{party.party_type ? ` · ${party.party_type}` : ""}</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{scopeLabel}</p>
            </div>
            <div className="text-right text-slate-600">
              {filtersActive ? (
                <>
                  <p>Opening ₹{sections.reduce((s, sec) => s + sec.openingBalance, 0).toFixed(2)}</p>
                  <p>
                    Debit ₹{shownDebit.toFixed(2)} · Credit ₹{shownCredit.toFixed(2)}
                  </p>
                  <p className="font-semibold text-slate-900">
                    Closing as on {toDate || todayISTStr} ₹{periodClosing.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-slate-400">Whole ledger closing ₹{closingBalance.toFixed(2)}</p>
                </>
              ) : (
                <>
                  <p>Total Debit ₹{totalDebit.toFixed(2)}</p>
                  <p>Total Credit ₹{totalCredit.toFixed(2)}</p>
                  <p className="font-semibold text-slate-900">Closing Balance ₹{closingBalance.toFixed(2)}</p>
                </>
              )}
            </div>
          </div>

          {/* Direct, unambiguous answer to "ab kitna payment karna hai":
              closingBalance > 0 means we owe the party that much; < 0 means the
              party is in credit with us. With several company blocks this is
              the combined figure — each block below carries its own. */}
          {(isPayable || isCredit) && (
            <div
              className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${
                isPayable
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {isPayable
                ? `Amount payable to ${party.name}: ₹${closingBalance.toFixed(2)}${isMultiCompany ? " (all companies)" : ""}`
                : `${party.name} is in credit with us: ₹${Math.abs(closingBalance).toFixed(2)} (advance/overpayment)${isMultiCompany ? " — all companies" : ""}`}
            </div>
          )}

          {/* #8 legend — matches the exact row classes used below. */}
          <p className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 print:hidden">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" /> Paid in full</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200" /> Pending (within due date)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-300" /> Overdue (past due date)</span>
            <span>· a bill and its payments share the same shade; due date = bill received date + 7 days.</span>
          </p>

          {sections.length === 0 && (
            <p className="py-3 text-center text-slate-400">No bills against this party yet.</p>
          )}

          {sections.map((sec) => {
            const secPayable = sec.closingBalance > 0.005;
            const secCredit = sec.closingBalance < -0.005;
            return (
              <div key={sec.companyId} className="break-inside-avoid">
                {/* 2026-10-28 — one block per company: this is the "jis company
                    me invoice chadha hai usme hi payment dikhe" part. */}
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-slate-300 pb-1">
                  <h2 className="text-sm font-bold text-slate-900">{sec.companyName}</h2>
                  <p className="text-[11px] text-slate-600">
                    Debit ₹{sec.totalDebit.toFixed(2)} · Credit ₹{sec.totalCredit.toFixed(2)} ·{" "}
                    <span className="font-semibold text-slate-900">Closing ₹{sec.closingBalance.toFixed(2)}</span>
                  </p>
                </div>
                {(secPayable || secCredit) && (
                  <p className={`mb-1 text-[11px] font-medium ${secPayable ? "text-red-700" : "text-emerald-700"}`}>
                    {secPayable
                      ? `Payable to ${party.name} in ${sec.companyName}: ₹${sec.closingBalance.toFixed(2)}`
                      : `In credit in ${sec.companyName}: ₹${Math.abs(sec.closingBalance).toFixed(2)}`}
                  </p>
                )}

                {filtersActive && (
                  <p className="mb-1 text-[10px] text-slate-500 print:hidden">
                    Showing {sec.displayedLines.length} of {sec.ledgerLines.length} entries in this company
                    {fromDate ? ` from ${fromDate}` : ""}{toDate ? ` to ${toDate}` : ""}
                    {txnType ? ` · ${txnType} only` : ""} — Debit ₹{sec.shownDebit.toFixed(2)}, Credit ₹{sec.shownCredit.toFixed(2)} in this range.
                  </p>
                )}

                {/* 2026-10-15 — on a narrow screen the table scrolls sideways
                    (min-w keeps the columns readable) instead of squashing the
                    amounts into each other. */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left print:min-w-0">
                    <thead>
                      <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                        <th className="py-1 pr-2">Date</th>
                        <th className="py-1 pr-2">Invoice No.</th>
                        <th className="py-1 pr-2">Company</th>
                        <th className="py-1 pr-2">Particulars</th>
                        <th className="py-1 pr-2">Mode</th>
                        <th className="py-1 pr-2">UTR / Ref No.</th>
                        <th className="py-1 pr-2 text-right">Debit</th>
                        <th className="py-1 pr-2 text-right">Credit</th>
                        <th className="py-1 pr-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtersActive && fromDate && (
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <td className="whitespace-nowrap py-1 pr-2">{fromDate}</td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2 font-medium">Opening balance (brought forward)</td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2"></td>
                          <td className="py-1 pr-2 text-right font-medium">{sec.openingBalance.toFixed(2)}</td>
                        </tr>
                      )}
                      {sec.displayedLines.map((t, i) => (
                        <tr key={i} className={`group border-b border-slate-100 align-top text-slate-700 ${t.status ? rowShade[t.status] : ""}`}>
                          <td className="whitespace-nowrap py-1 pr-2">{t.date}</td>
                          <td className="py-1 pr-2 font-medium text-slate-900">
                            {t.type === "Credit" && t.billIds[0] ? (
                              <BillDocLink billId={t.billIds[0]} docHref={t.docHref ?? null} label={t.invoiceNo || ""} />
                            ) : (
                              t.invoiceNo || ""
                            )}
                          </td>
                          <td className="py-1 pr-2 text-slate-600">{sec.companyName}</td>
                          <td className="py-1 pr-2 font-medium text-slate-900">
                            {t.particulars}
                            {/* #8 admin actions — hover-revealed, Admin-only,
                                print-hidden, inside the Particulars cell so the
                                extra form never disturbs the columns. */}
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
                            {/* 2026-10-29d — the printable PAYMENT VOUCHER for a
                                recorded payment (amount in words + company
                                letterhead), reachable straight from the ledger
                                line. Screen-only so the ledger print stays as-is. */}
                            {t.paymentItems.length === 1 && (
                              <Link
                                href={`/dashboard/bill-payment/voucher/${t.paymentItems[0].id}`}
                                target="_blank"
                                className="ml-2 whitespace-nowrap rounded border border-teal-300 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 print:hidden"
                                title="Open the printable Payment Voucher for this payment"
                              >
                                🧾 Voucher
                              </Link>
                            )}
                          </td>
                          <td className="py-1 pr-2">{t.paymentMode ?? ""}</td>
                          <td className="py-1 pr-2 font-mono text-[11px]">{t.referenceNo ?? ""}</td>
                          <td className="py-1 pr-2 text-right">{t.debit > 0 ? t.debit.toFixed(2) : ""}</td>
                          <td className="py-1 pr-2 text-right">{t.credit > 0 ? t.credit.toFixed(2) : ""}</td>
                          <td className="py-1 pr-2 text-right font-medium">{t.balance.toFixed(2)}</td>
                        </tr>
                      ))}
                      {sec.displayedLines.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-3 text-center text-slate-400">
                            {sec.ledgerLines.length === 0 ? "No bills against this party in this company." : "No entries match the selected filter."}
                          </td>
                        </tr>
                      )}
                      {filtersActive && sec.displayedLines.length > 0 && (
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                          <td colSpan={6} className="py-1 pr-2 text-right">
                            Closing balance as on {toDate || todayISTStr}
                          </td>
                          <td className="py-1 pr-2 text-right">{sec.shownDebit.toFixed(2)}</td>
                          <td className="py-1 pr-2 text-right">{sec.shownCredit.toFixed(2)}</td>
                          <td className="py-1 pr-2 text-right">{sec.periodClosing.toFixed(2)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {isMultiCompany && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-slate-400 pt-2 text-sm font-semibold text-slate-900">
              <span>All companies — combined</span>
              <span>Debit ₹{totalDebit.toFixed(2)} · Credit ₹{totalCredit.toFixed(2)} · Closing ₹{closingBalance.toFixed(2)}</span>
            </div>
          )}
        </div>
      </PrintArea>
    </div>
  );
}
