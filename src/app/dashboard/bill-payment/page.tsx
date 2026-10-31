import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import Link from "next/link";
import { BillPaymentList, type PayableBillRow } from "./bill-payment-list";
import { MergedBillsPanel, type MergedBillRow } from "./merged-bills-panel";
import { listRelatedNotesForBills } from "../documents/actions";
import { resolveBillDocHrefs } from "@/lib/bill-doc-href";
import { fetchBillsInCompanyView } from "@/lib/ledger/bill-company";
// 2026-09-15 — courier prepaid wallets ("shipment bhejne se PEHLE wallet
// recharge karna padta hai, invoice aane pe adjust hota hai"). The panel
// (recharge/refund/history) + per-bill "Pay from Wallet" balance map.
import { WalletSection } from "./wallet-section";
import { getWalletOverview } from "./wallet-actions";
// 2026-10-24 — financial-year filter (same FY system the Party Balance
// Summary uses): Bill Payment used to be "everything unpaid, ever", so the
// FY the admin is actually closing was buried under old carry-forward bills.
import { fyOptions, fyWindow } from "@/lib/fy-date";

// Bill Payment (round 11) — see actions.ts header comment. Lists every
// bill_pass_register row (any invoice_type — vendor/courier/duty/salary/
// advance, this ledger is shared by all of them) with balance_due > 0,
// scoped to the CURRENTLY SELECTED company (top-nav switcher), oldest due
// date first.
// 2026-08-17 fix — same bug/fix as Party Ledger: this used to scope to
// `employee.companyIds` (every company this login can access), so an
// admin with access to all 3 companies saw every company's outstanding
// bills mixed together regardless of which company was selected up top.
// Now matches the pattern used by orders/new, shipglobal, attendance, etc.
//
// 2026-08-22 — filter UI added (GET-form + searchParams, same pattern as
// Orders): Company, Status, Due. This page had zero filter UI before —
// every unpaid bill for the selected company, full stop. `status` here is
// a DERIVED condition (there is no stored status column on
// bill_pass_register — see db/schema.sql), computed from balance_due vs 0
// and due_date vs today, same idea as Orders' "Late Order" derived filter:
//   - "" (default)   -> balance_due > 0 (unchanged default behaviour)
//   - "pending"       -> balance_due > 0 AND due_date >= today (not yet due)
//   - "overdue"       -> balance_due > 0 AND due_date <  today
//   - "paid"          -> balance_due <= 0
//
// 2026-08-27 — rows here are grouped client-side (see bill-payment-list.tsx
// + src/lib/bill-grouping.ts) so a multi-item/multi-order Purchase Bill's
// several bill_pass_register rows show as one invoice row. The query below
// is unchanged (still fetches every underlying row) — grouping is a
// display/action concern, not a query concern.
export default async function BillPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  // Same "respect the top-nav company switcher by default, but let an
  // explicit ?company= (including an explicit blank = All) override it" as
  // Orders (see that page.tsx's 2026-08-17 comment for the full reasoning).
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyParam
    ? [companyParam]
    : companyParamPresent
      ? employee.companyIds
      : [employee.currentCompanyId];
  const status = typeof sp.status === "string" ? sp.status : "";
  // "2026-27" — the FY the bill was RAISED in (invoice_date), not the due
  // date: a March bill falling due in April still belongs to the FY that
  // raised it, which is how the P&L and the Ageing report count it too.
  const fyParam = typeof sp.fy === "string" ? sp.fy : "";
  const fyStartYear = /^\d{4}-\d{2}$/.test(fyParam) ? Number(fyParam.slice(0, 4)) : null;
  const fyWin = fyStartYear != null ? fyWindow(fyStartYear) : null;
  const fyChoices = fyOptions(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  // 2026-10-24 (perf) — "sabhi page fast khule": companies/parties/bills have
  // no dependency on each other, so they go out as ONE parallel wave instead
  // of three serial round trips (each serial Supabase hop is added straight
  // to the page's time-to-first-byte).
  const [{ data: companies }, { data: parties }, bills] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name, party_type, invoice_type"),
    // 2026-10-31 — one invoice = one document = ONE company (see
    // src/lib/ledger/bill-company.ts). The page's own query stays exactly as
    // it was; a Purchase/Printing invoice whose item rows sit in another
    // company gets those rows pulled in (same filters, that invoice only) and
    // the whole document is then kept only in the company that registered it.
    // So a split invoice shows here ONCE, with its full amount and every
    // payment, instead of two part-amounts in two companies — same rule as the
    // Party Ledger.
    (async () => {
      /** One builder for both reads, so the sibling read can never drift. */
      const build = (companyIds: string[], vendorInvoiceNos?: string[]) => {
        let q = supabase
          .from("bill_pass_register")
          .select(
            // 2026-10-20 — source_id added so a grouped Purchase Bill's per-item
            // rows can name the actual item (see itemLabelBySourceId below).
            "id, company_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, party_id, party_type, source, source_id, due_date, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due, remark"
          )
          .in("company_id", companyIds)
          .order("due_date", { ascending: true, nullsFirst: false });

        if (vendorInvoiceNos) q = q.eq("source", "purchase_bill").in("vendor_invoice_no", vendorInvoiceNos);
        if (fyWin) q = q.gte("invoice_date", fyWin.start).lte("invoice_date", fyWin.end);

        if (status === "paid") {
          q = q.lte("balance_due", 0);
        } else if (status === "pending") {
          q = q.gt("balance_due", 0).gte("due_date", todayStr);
        } else if (status === "overdue") {
          q = q.gt("balance_due", 0).lt("due_date", todayStr);
        } else {
          // Default (no status filter picked yet) — unchanged from before this
          // filter UI existed: every unpaid/partially-paid bill.
          q = q.gt("balance_due", 0);
        }
        return q;
      };

      return fetchBillsInCompanyView({
        supabase,
        viewCompanyIds: effectiveCompanyIds,
        allCompanyIds: employee.companyIds,
        fetch: async (companyIds, vendorInvoiceNos) => (await build(companyIds, vendorInvoiceNos)).data ?? [],
      });
    })(),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  // 2026-08-27 (later same day) — "credite note ya debit note agar us
  // invoice se related ho to vaha dikhna cahiye": one batched lookup for
  // every bill on this page, then fanned back out per row below — never
  // call listRelatedNotesForBills per-row (see its own comment).
  //
  // 2026-10-24 (perf) — "sabhi page fast khule": every lookup below depends
  // only on the bills already in memory, so they all go out as ONE parallel
  // wave. Before this they ran as four serial awaits (notes → adjustments +
  // credit notes → purchase items → document hrefs), each adding a full
  // Supabase round trip to the page's load time for zero extra safety.
  const pageBillIds = (bills ?? []).map((b) => b.id);
  const purchaseSourceIds = (bills ?? [])
    .filter((b) => b.source === "purchase_bill" && !!b.source_id)
    .map((b) => b.source_id as string);
  // 2026-11-03 — courier/duty bills on this page that may carry a disputed-AWB
  // payment hold. Only source_id matters: the hold lives on the AWB assignment
  // rows, not on the ledger row (see the migration's own comment).
  const freightBillSourceIds = (bills ?? [])
    .filter((b) => b.source === "freight_bill" && !!b.source_id)
    .map((b) => b.source_id as string);
  const dutyBillSourceIds = (bills ?? [])
    .filter((b) => b.source === "duty_tax_bill" && !!b.source_id)
    .map((b) => b.source_id as string);

  const [
    relatedNotes,
    { data: appliedAdj },
    { data: pageCreditNotes },
    { data: purchaseItems },
    docHrefByBillId,
    walletOverview,
    { data: freightDisputes },
    { data: dutyDisputes },
  ] = await Promise.all([
    listRelatedNotesForBills(pageBillIds),
    pageBillIds.length
      ? supabase
          .from("bill_pass_register_adjustments")
          .select("id, bill_pass_register_id, amount, remark, credit_note_id, credit_notes(vendor_cn_no, gst_rate_pct)")
          .in("bill_pass_register_id", pageBillIds)
      : Promise.resolve({ data: [] as { id: string; bill_pass_register_id: string; amount: number; remark: string | null; credit_note_id: string | null; credit_notes: { vendor_cn_no: string | null; gst_rate_pct: number | null }[] | null }[] }),
    supabase
      .from("credit_notes")
      .select("id, cn_no, company_id, credit_note_date, refund_amount, party_id")
      .in("company_id", effectiveCompanyIds)
      .order("credit_note_date", { ascending: false })
      .limit(300),
    purchaseSourceIds.length
      ? supabase
          .from("purchase_bills")
          .select("id, work_description, qty, sq_feet, qty_unit, unit_rate")
          .in("id", purchaseSourceIds)
      : Promise.resolve({
          data: [] as { id: string; work_description: string | null; qty: number; sq_feet: number; qty_unit: string | null; unit_rate: number }[],
        }),
    // 2026-10-24 — the invoice-number → document-sheet resolver (see
    // src/lib/bill-doc-href.ts), shared with the Party Ledger so both pages
    // open exactly the same document for the same invoice number.
    resolveBillDocHrefs(supabase, bills ?? []),
    // 2026-09-15 — courier prepaid wallet balances for the "Pay from Wallet"
    // action, and the wallet panel itself.
    getWalletOverview(effectiveCompanyIds),
    // 2026-11-03 — open disputes on this page's courier/duty bills. Missing
    // columns (migration not run) just yield an error + empty data → no holds.
    freightBillSourceIds.length
      ? supabase
          .from("freight_bill_awb_assignments")
          .select("freight_bill_id, dispute_amount")
          .eq("dispute_status", "under_dispute")
          .in("freight_bill_id", freightBillSourceIds)
      : Promise.resolve({ data: [] as { freight_bill_id: string | null; dispute_amount: number | null }[] }),
    dutyBillSourceIds.length
      ? supabase
          .from("duty_bill_awb_assignments")
          .select("duty_tax_bill_id, dispute_amount")
          .eq("dispute_status", "under_dispute")
          .in("duty_tax_bill_id", dutyBillSourceIds)
      : Promise.resolve({ data: [] as { duty_tax_bill_id: string | null; dispute_amount: number | null }[] }),
  ]);

  // 2026-11-03 — "under_dispute" holds, summed per source bill.
  const disputeHoldBySourceId = new Map<string, number>();
  for (const d of freightDisputes ?? []) {
    if (!d.freight_bill_id) continue;
    disputeHoldBySourceId.set(
      `freight_bill:${d.freight_bill_id}`,
      (disputeHoldBySourceId.get(`freight_bill:${d.freight_bill_id}`) ?? 0) + Number(d.dispute_amount ?? 0)
    );
  }
  for (const d of dutyDisputes ?? []) {
    if (!d.duty_tax_bill_id) continue;
    disputeHoldBySourceId.set(
      `duty_tax_bill:${d.duty_tax_bill_id}`,
      (disputeHoldBySourceId.get(`duty_tax_bill:${d.duty_tax_bill_id}`) ?? 0) + Number(d.dispute_amount ?? 0)
    );
  }
  const notesByBillId = new Map<string, typeof relatedNotes>();
  for (const n of relatedNotes) {
    const list = notesByBillId.get(n.billPassRegisterId) ?? [];
    list.push(n);
    notesByBillId.set(n.billPassRegisterId, list);
  }

  // 2026-09-13 — Credit Notes data for the per-bill panel + register link.
  // One batched query per side (never per-row): every adjustment targeting
  // any bill on this page, and every credit note in the visible companies
  // (for the "link existing" dropdown), plus which companies hold notes so
  // the header link can point at a meaningful register.
  // MUST run before `rows` is built — rows' .map closure reads
  // adjByBillId/cnNoById, and a closure over a later `const` executes
  // immediately, which was a live TDZ crash ("Cannot access 'D' before
  // initialization", digest 122932879): the whole Bill Payment page threw
  // whenever any unpaid bill existed.
  const adjByBillId = new Map<string, { id: string; amount: number; remark: string | null; credit_note_id: string | null; vendor_cn_no: string | null; gst_rate_pct: number | null }[]>();
  for (const a of appliedAdj ?? []) {
    const list = adjByBillId.get(a.bill_pass_register_id) ?? [];
    const noteMeta = Array.isArray(a.credit_notes) ? a.credit_notes[0] : null;
    list.push({
      id: a.id,
      amount: Number(a.amount),
      remark: a.remark,
      credit_note_id: a.credit_note_id,
      vendor_cn_no: noteMeta?.vendor_cn_no ?? null,
      gst_rate_pct: noteMeta?.gst_rate_pct ?? null,
    });
    adjByBillId.set(a.bill_pass_register_id, list);
  }
  const cnNoById = new Map((pageCreditNotes ?? []).map((n) => [n.id, n.cn_no]));

  // 2026-10-20 — "ek invoice me agar 10 entry hai to ... usi se link me dikh
  // jaye ki kon kon si entry hai": a grouped Purchase Bill's per-item rows
  // only ever showed `id.slice(0, 8)` ("d4bb0ea4"), so the expanded breakdown
  // and the per-item payment form named nothing. Each bill_pass_register row
  // already carries source_id -> purchase_bills.id; one batched lookup (never
  // per row) gives every item its description + size + rate.
  const itemLabelBySourceId = new Map(
    (purchaseItems ?? []).map((p) => {
      const unit = p.qty_unit ?? "FT";
      const size = unit === "PCS" ? `${p.qty} pcs` : `${p.qty} × ${Number(p.sq_feet)} ${unit}`;
      return [p.id, `${p.work_description?.trim() || "Item"} · ${size} @ ₹${Number(p.unit_rate).toFixed(2)}`] as const;
    })
  );

  const rows: PayableBillRow[] = (bills ?? []).map((b) => ({
    id: b.id,
    company_id: b.company_id,
    company_name: companyName.get(b.company_id) ?? "—",
    invoice_no: b.invoice_no,
    vendor_invoice_no: b.vendor_invoice_no,
    invoice_type: b.invoice_type,
    invoice_date: b.invoice_date,
    invoice_recv_date: b.invoice_recv_date,
    party_id: b.party_id,
    party_name: b.party_id ? partyName.get(b.party_id) ?? null : null,
    party_type: b.party_type,
    // 2026-08-17: null = manually entered/imported straight onto this
    // table — editable here. Non-null means it was auto-mirrored FROM a
    // Purchase Bill / Courier Bill / Duty & Tax Bill / Salary / Advance
    // row, so editing belongs at that source instead (see actions.ts's
    // comment on updateBillPassRegisterEntry).
    source: b.source,
    source_id: b.source_id,
    item_label: b.source === "purchase_bill" && b.source_id ? itemLabelBySourceId.get(b.source_id) ?? null : null,
    // 2026-10-22 — the document sheet the invoice number opens (see
    // BillDocLink): the source bill's own report page when there is one,
    // otherwise a freight_bills record matched by invoice number for a
    // manually-entered courier bill. null = no document exists → bill
    // statement (or plain text for salary/advance).
    doc_href: docHrefByBillId.get(b.id) ?? null,
    due_date: b.due_date,
    total_amt: Number(b.total_amt),
    credit_note_amt: Number(b.credit_note_amt),
    to_be_pay: Number(b.to_be_pay),
    total_paid: Number(b.total_paid),
    balance_due: Number(b.balance_due),
    // 2026-11-03 — disputed-AWB hold; never part of the ledger balance.
    dispute_hold: b.source && b.source_id ? Math.round((disputeHoldBySourceId.get(`${b.source}:${b.source_id}`) ?? 0) * 100) / 100 : 0,
    remark: b.remark,
    related_notes: notesByBillId.get(b.id) ?? [],
    // 2026-09-13 — Credit Notes panel data (see the page-level comment on
    // adjByBillId above; the CN number is filled from the batched map).
    credit_notes: (adjByBillId.get(b.id) ?? []).map((a) => ({
      adjustment_id: a.id,
      credit_note_id: a.credit_note_id,
      cn_no: a.credit_note_id ? cnNoById.get(a.credit_note_id) ?? null : null,
      vendor_cn_no: a.vendor_cn_no,
      gst_rate_pct: a.gst_rate_pct,
      amount: a.amount,
      remark: a.remark,
    })),
  }));

  // 2026-10-29b — merged duplicates, so a wrong merge can be undone from the
  // UI instead of living forever ("vapas vahi par pahuchao"). Admin only: an
  // undo rewrites payments Finance has already posted. The list is its OWN
  // query because merged rows have balance_due <= 0 and the bills query above
  // filters those out by default.
  let mergedRows: MergedBillRow[] = [];
  if (employee.capabilities.includes("employee_admin") || employee.capabilities.includes("permissions_admin")) {
    const { data: mergedRaw } = await supabase
      .from("bill_pass_register")
      .select("id, company_id, invoice_no, vendor_invoice_no, invoice_date, party_id, merged_into_bill_id, remark")
      .in("company_id", effectiveCompanyIds)
      .not("merged_into_bill_id", "is", null)
      .order("invoice_date", { ascending: false, nullsFirst: false })
      .limit(300);
    const keeperIds = Array.from(new Set((mergedRaw ?? []).map((m) => m.merged_into_bill_id as string)));
    const { data: keepers } = keeperIds.length
      ? await supabase.from("bill_pass_register").select("id, invoice_no, vendor_invoice_no, company_id").in("id", keeperIds)
      : { data: [] as { id: string; invoice_no: string | null; vendor_invoice_no: string | null; company_id: string }[] };
    const keeperById = new Map((keepers ?? []).map((k) => [k.id, k]));
    // The merge wrote "[merged into <inv> — <company>; original total N]" into
    // the loser's remark — that N is the amount the bill carried before.
    const mergeTag = /original total ([\d.]+)/i;
    mergedRows = (mergedRaw ?? []).map((m) => {
      const keeper = keeperById.get(m.merged_into_bill_id as string);
      return {
        id: m.id,
        invoiceNo: m.invoice_no ?? m.vendor_invoice_no ?? "—",
        invoiceDate: m.invoice_date,
        partyName: m.party_id ? partyName.get(m.party_id) ?? null : null,
        companyName: companyName.get(m.company_id) ?? "—",
        keeperInvoiceNo: keeper?.invoice_no ?? keeper?.vendor_invoice_no ?? "—",
        keeperCompany: keeper ? companyName.get(keeper.company_id) ?? "—" : "—",
        originalTotal: Number(mergeTag.exec(m.remark ?? "")?.[1] ?? 0),
        remark: m.remark,
      };
    });
  }

  // 2026-09-15 — wallet overview (loaded in the parallel wave above).
  // Client-side show/hide toggle (useState) instead of a route param so
  // opening the panel never loses the bill filters.
  const partyWalletBalances = Object.fromEntries(walletOverview.balances.map((b) => [b.party_id, b.balance]));
  const walletCompanies = (companies ?? []).map((c) => ({ id: c.id, name: c.name }));
  const hasWalletParties = Object.keys(partyWalletBalances).length > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💳 Bill Payment</h1>
        {/* 2026-09-13 — "apne ko pata chal jayega ki kis party se apne ko
            kitne amount ka credit mil gaya tha": the per-party Credit Note
            Register lives on its own page; this is the standing doorway. */}
        <p className="mt-1 text-sm">
          <Link href="/dashboard/credit-notes-register" className="font-medium text-teal-700 underline hover:text-teal-800">
            🧾 Credit Note Register — credit received per party
          </Link>
          {"  ·  "}
          {/* 2026-10-29b — Debit Notes had no list/print page at all. */}
          <Link href="/dashboard/debit-notes-register" className="font-medium text-rose-700 underline hover:text-rose-800">
            📉 Debit Note Register — debit raised per party
          </Link>
        </p>
        {/* 2026-09-15 — prepaid courier wallets: recharge / refund / history,
            plus the per-bill "💳 Pay from Wallet" action on rows below. */}
        <p className="mt-1 text-[11px] text-slate-400">
          {hasWalletParties
            ? `💳 ${Object.keys(partyWalletBalances).length} courier wallet${Object.keys(partyWalletBalances).length === 1 ? "" : "s"} active — bills paid from a party wallet show the "Pay from Wallet" action.`
            : "💳 Prepaid courier wallet (FedEx/UPS style): recharge first, then the invoice is paid out of that wallet. Start from the wallet panel below."}
        </p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyParamPresent ? companyParam : employee.currentCompanyId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fy">Financial Year</label>
          <select id="fy" name="fy" defaultValue={fyParam} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All years</option>
            {fyChoices.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All Unpaid (default)</option>
            <option value="pending">Pending (not yet due)</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        {fyWin && (
          <span className="text-[11px] text-slate-500">
            Bills raised {fyWin.start} → {fyWin.end} ({rows.length} row{rows.length === 1 ? "" : "s"})
          </span>
        )}
        <a href="/dashboard/bill-payment" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      {/* 2026-10-12 — parties go in too: the wallet's Courier-party select
          used to be built ONLY from existing wallet history, so a first
          recharge had an empty dropdown ("—") and could never be submitted. */}
      <WalletSection overview={walletOverview} companies={walletCompanies} parties={parties ?? []} />

      <BillPaymentList
        bills={rows}
        parties={parties ?? []}
        existingCreditNotes={(pageCreditNotes ?? []).map((n) => ({ id: n.id, cn_no: n.cn_no, credit_note_date: n.credit_note_date, refund_amount: Number(n.refund_amount ?? 0) }))}
        // 2026-09-13 — "edit sirf admin se ho" once payments exist: non-Admin
        // viewers get locked edit forms + credit-note panels on paid bills.
        isPaidLockedViewer={!employee.capabilities.includes("permissions_admin")}
        partyWalletBalances={partyWalletBalances}
      />

      <MergedBillsPanel rows={mergedRows} />
    </div>
  );
}
