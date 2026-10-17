import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import {
  buildPrintingRegister,
  qtyLabel,
  type PrintingBill,
  type PrintingInChalan,
  type PrintingOutChalan,
} from "@/lib/printing-register";

// 2026-10-15 — "Printing gap: Unified Printing register". Printing job
// work lived in three unrelated places (Material OUT Chalan in Stock,
// Received Chalan in Documents, printing charges in the Bill Pass
// Register) with nothing showing them together — this page is the one
// register that unifies them per party: what went out, what came back,
// what is still lying with the printer, and what the printing bills came
// to / how much is still due.
//
// Scope default is ALL parties that have a chalan or a printing bill (not
// only vendors already typed 'Printing' in Party Master) — the whole point
// of a "gap" register is that an entry typed the wrong way can never be
// invisible here. "Printing vendors only" narrows it once the master data
// is trustworthy. Bills join via invoice_type = 'Printing' OR via a vendor
// whose Party Master says 'Printing' (see src/lib/printing-register.ts's
// header comment for why both are needed).
//
// Capability gate is the same dual gate as the Credit Note Register:
// either module's users can reach it (chalan links go to their own report
// pages, which are gated individually — stock_entry for Material OUT,
// doc_entry for Received — so each link is only rendered as a link for
// someone who can actually open it).
export default async function PrintingRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireAnyCapability("stock_entry", "doc_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  // Same company-select pattern as Bill Payment / Credit Note Register:
  // top-nav company by default, ?company= (blank = all my companies) overrides.
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyParam
    ? [companyParam]
    : companyParamPresent
      ? employee.companyIds
      : [employee.currentCompanyId];
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const scope = sp.scope === "vendors" ? "vendors" : "all";
  const canOpenStockReport = employee.capabilities.includes("stock_entry");
  const canOpenDocReport = employee.capabilities.includes("doc_entry");

  const [{ data: companies }, { data: partyRows }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name, invoice_type").order("name"),
  ]);
  const parties = (partyRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    invoiceType: p.invoice_type,
  }));
  const printingVendorIds = parties.filter((p) => p.invoiceType === "Printing").map((p) => p.id);
  // Supabase/PostgREST rejects an empty `in.()` list outright, and a scope
  // narrowed to printing vendors with none on file is simply "no rows".
  const noPrintingVendors = scope === "vendors" && printingVendorIds.length === 0;

  // ── 1. OUT — Material OUT Chalan (+ lines + PO links) ────────────────────
  let mocQ = supabase
    .from("material_out_chalans")
    .select("id, company_id, party_id, chalan_no, chalan_date, through, no_of_packages, remark")
    .in("company_id", effectiveCompanyIds)
    .order("chalan_date", { ascending: false })
    .order("chalan_no", { ascending: false });
  if (fromDate) mocQ = mocQ.gte("chalan_date", fromDate);
  if (toDate) mocQ = mocQ.lte("chalan_date", toDate);
  // `.in("party_id", [])` is a PostgREST 400, so the empty-printing-vendor
  // case is guarded with `noPrintingVendors` instead of an empty list.
  if (scope === "vendors" && printingVendorIds.length > 0) {
    mocQ = mocQ.in("party_id", printingVendorIds);
  }
  const mocData = noPrintingVendors ? [] : (await mocQ).data ?? [];
  const mocIds = mocData.map((c) => c.id);

  const { data: outLineRows } = mocIds.length
    ? await supabase
        .from("stock_out")
        .select("id, chalan_id, sku_code, product_name, quantity_out")
        .in("chalan_id", mocIds)
    : { data: [] as { id: string; chalan_id: string | null; sku_code: string; product_name: string | null; quantity_out: number }[] };
  const outLines = outLineRows ?? [];
  const outLineIds = outLines.map((l) => l.id);
  const { data: outLinkRows } = outLineIds.length
    ? await supabase
        .from("stock_out_order_links")
        .select("stock_out_id, order_id, orders(ref_no)")
        .in("stock_out_id", outLineIds)
    : { data: [] as { stock_out_id: string; order_id: string; orders: { ref_no: string } | null }[] };
  const ordersByStockOutId = new Map<string, string[]>();
  for (const link of outLinkRows ?? []) {
    if (!link.orders) continue;
    const list = ordersByStockOutId.get(link.stock_out_id) ?? [];
    list.push(link.orders.ref_no);
    ordersByStockOutId.set(link.stock_out_id, list);
  }

  const outChalans: PrintingOutChalan[] = mocData.map((c) => ({
    id: c.id,
    chalanNo: c.chalan_no ?? "—",
    chalanDate: c.chalan_date,
    partyId: c.party_id,
    through: c.through,
    noOfPackages: c.no_of_packages,
    remark: c.remark,
    lines: outLines
      .filter((l) => l.chalan_id === c.id)
      .map((l) => ({
        skuCode: l.sku_code,
        productName: l.product_name,
        qtyFt: Number(l.quantity_out) || 0,
        orderRefs: ordersByStockOutId.get(l.id) ?? [],
      })),
  }));

  // ── 2. IN — Received Chalan (+ items + PO) ───────────────────────────────
  let rcQ = supabase
    .from("received_chalans")
    .select("id, company_id, party_id, chalan_no, chalan_date, order_id, through, no_of_packages, remark")
    .in("company_id", effectiveCompanyIds)
    .order("chalan_date", { ascending: false })
    .order("chalan_no", { ascending: false });
  if (fromDate) rcQ = rcQ.gte("chalan_date", fromDate);
  if (toDate) rcQ = rcQ.lte("chalan_date", toDate);
  if (scope === "vendors" && printingVendorIds.length > 0) {
    rcQ = rcQ.in("party_id", printingVendorIds);
  }
  const rcData = noPrintingVendors ? [] : (await rcQ).data ?? [];
  const rcIds = rcData.map((c) => c.id);

  const { data: rcItemRows } = rcIds.length
    ? await supabase
        .from("received_chalan_items")
        .select("chalan_id, description, qty, qty_unit, rate")
        .in("chalan_id", rcIds)
    : { data: [] as { chalan_id: string; description: string; qty: number; qty_unit: string; rate: number | null }[] };
  const rcOrderIds = Array.from(new Set(rcData.map((c) => c.order_id).filter((id): id is string => !!id)));
  const { data: rcOrderRows } = rcOrderIds.length
    ? await supabase.from("orders").select("id, ref_no").in("id", rcOrderIds)
    : { data: [] as { id: string; ref_no: string }[] };
  const refNoByOrder = new Map((rcOrderRows ?? []).map((o) => [o.id, o.ref_no]));

  const inChalans: PrintingInChalan[] = rcData.map((c) => ({
    id: c.id,
    chalanNo: c.chalan_no ?? "—",
    chalanDate: c.chalan_date,
    partyId: c.party_id,
    orderRefNo: c.order_id ? refNoByOrder.get(c.order_id) ?? null : null,
    remark: c.remark,
    items: (rcItemRows ?? [])
      .filter((it) => it.chalan_id === c.id)
      .map((it) => {
        const qty = Number(it.qty) || 0;
        const rate = it.rate != null ? Number(it.rate) : null;
        return {
          description: it.description,
          qty,
          unit: it.qty_unit,
          rate,
          amount: rate != null ? qty * rate : 0,
        };
      }),
  }));

  // ── 3. CHARGES — printing bills in the Bill Pass Register ────────────────
  let bprQ = supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, total_paid, balance_due"
    )
    .in("company_id", effectiveCompanyIds);
  if (noPrintingVendors) {
    // scope=printing-vendors with no such vendors — nothing can match.
  } else if (scope === "vendors") {
    // noPrintingVendors is false here, so printingVendorIds is non-empty.
    bprQ = bprQ.in("party_id", printingVendorIds);
  } else if (printingVendorIds.length > 0) {
    bprQ = bprQ.or(
      `invoice_type.eq.Printing,party_id.in.(${printingVendorIds.join(",")})`
    );
  } else {
    bprQ = bprQ.eq("invoice_type", "Printing");
  }
  const bprData = noPrintingVendors ? [] : (await bprQ).data ?? [];

  // Date filter applied here rather than in SQL: the effective bill date is
  // invoice_recv_date ?? invoice_date and either can be NULL on old
  // imports — SQL-side gte/lte would silently drop those money rows, and a
  // register must never lose one. Undated bills are always kept.
  const billRows: PrintingBill[] = bprData
    .filter((b) => {
      const d = b.invoice_recv_date ?? b.invoice_date;
      if (fromDate && d && d < fromDate) return false;
      if (toDate && d && d > toDate) return false;
      return true;
    })
    .map((b) => ({
      id: b.id,
      partyId: b.party_id,
      invoiceNo: b.invoice_no,
      vendorInvoiceNo: b.vendor_invoice_no,
      invoiceType: b.invoice_type,
      date: b.invoice_recv_date ?? b.invoice_date,
      totalAmt: Number(b.total_amt) || 0,
      paidAmt: Number(b.total_paid) || 0,
      balanceDue: Number(b.balance_due) || 0,
      matchedBy: b.invoice_type === "Printing" ? "invoice_type" : "printing_vendor",
    }));

  // ── 4. COTTON RUG WORKFLOW ──────────────────────────────────────────────
  // "cotton rug ke jo bill aate hai vo is parkar hai: kache maal ka invoice
  // (bina PO ke), phir block print (PO ke according), phir washing, phir
  // silai" — the four stages the register itself did not show as a chain.
  // These are read-only roll-ups of the tables each stage already writes:
  // purchase_bills (raw material = no order/PO; block print = PO-linked),
  // washing_entries, and JOB WORK bills in the Bill Pass Register (silai).
  const [{ data: pbStageRows }, { data: washStageRows }, { data: silaiStageRows }] = await Promise.all([
    supabase
      .from("purchase_bills")
      .select("id, order_id, total_amount, g_total_plus_gst, vendor_invoice_date")
      .in("company_id", effectiveCompanyIds),
    supabase
      .from("washing_entries")
      .select("id, amount, chalan_date, company_id")
      .in("company_id", effectiveCompanyIds),
    supabase
      .from("bill_pass_register")
      .select("id, invoice_type, total_amt, invoice_date, invoice_recv_date, company_id")
      .in("company_id", effectiveCompanyIds)
      .eq("invoice_type", "JOB WORK"),
  ]);

  const inRange = (d: string | null | undefined) => {
    if (fromDate && d && d < fromDate) return false;
    if (toDate && d && d > toDate) return false;
    return true;
  };
  const pb = (pbStageRows ?? []).filter((b) => inRange(b.vendor_invoice_date));
  const rawMaterial = pb.filter((b) => !b.order_id);
  const blockPrint = pb.filter((b) => !!b.order_id);
  const washing = (washStageRows ?? []).filter((w) => inRange(w.chalan_date));
  const silai = (silaiStageRows ?? []).filter((s) => inRange(s.invoice_recv_date ?? s.invoice_date));
  const sum = (rows: { amount?: number | string | null; total_amount?: number | string | null; total_amt?: number | string | null; g_total_plus_gst?: number | string | null }[], key: "amount" | "total_amount" | "total_amt") =>
    rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const workflow = [
    {
      step: 1,
      title: "Kacha Maal (Raw Material)",
      note: "Purchase bill without PO — cloth/yarn received from the supplier.",
      count: rawMaterial.length,
      amount: sum(rawMaterial, "total_amount"),
      href: "/dashboard/documents?tab=purchase-bill",
      tone: "bg-amber-50 text-amber-800 border-amber-200",
    },
    {
      step: 2,
      title: "Block Print (PO-wise)",
      note: "Purchase bill / printing charges entered against a PO.",
      count: blockPrint.length,
      amount: sum(blockPrint, "total_amount"),
      href: "/dashboard/documents?tab=purchase-bill",
      tone: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
    },
    {
      step: 3,
      title: "Washing",
      note: "Washing chalan — sq.ft × rate expense against the same lot.",
      count: washing.length,
      amount: sum(washing, "amount"),
      href: "/dashboard/documents?tab=washing-entry",
      tone: "bg-sky-50 text-sky-800 border-sky-200",
    },
    {
      step: 4,
      title: "Silai (Stitching)",
      note: "Stitching job-work bill, recorded as JOB WORK in the bill pass register.",
      count: silai.length,
      amount: sum(silai, "total_amt"),
      href: "/dashboard/salary",
      tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
  ];

  const register = buildPrintingRegister({
    outChalans,
    inChalans,
    bills: billRows,
    parties,
  });
  const t = register.totals;

  const selectedCompany =
    companyParam && effectiveCompanyIds.length === 1
      ? (companies ?? []).find((c) => c.id === companyParam)?.name ?? null
      : null;
  const scopeLabel =
    scope === "vendors" ? "Printing vendors only" : "All parties with a chalan or printing bill";
  const rangeLabel =
    fromDate || toDate ? `${fromDate || "start"} → ${toDate || "today"}` : "All dates";

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500";
  const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🖨️ Printing Register</h1>
          <p className="mt-1 text-sm text-slate-500">
            Material sent for printing, material received back, and every printing bill — one register.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="pr_company">Company</label>
              <select id="pr_company" name="company" defaultValue={companyParamPresent ? companyParam : employee.currentCompanyId} className={inputClass}>
                <option value="">All</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="pr_scope">Parties</label>
              <select id="pr_scope" name="scope" defaultValue={scope} className={inputClass}>
                <option value="all">All with activity</option>
                <option value="vendors">Printing vendors only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="pr_from">From</label>
              <input id="pr_from" name="from" type="date" defaultValue={fromDate} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="pr_to">To</label>
              <input id="pr_to" name="to" type="date" defaultValue={toDate} className={inputClass} />
            </div>
            <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
              Filter
            </button>
            <a href="/dashboard/printing-register" className="pb-2 text-xs text-slate-400 underline">Clear</a>
          </form>
          <PrintButton label="🖨 Print register" />
        </div>
      </div>

      <PrintArea id="printing-register" companyName={selectedCompany ?? undefined}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Printing Register — {scopeLabel}</h2>
          <p className="text-xs text-slate-500">{selectedCompany ?? "All my companies"} · {rangeLabel}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="Sent out (chalan)" value={`${t.outChalanCount}`} sub={qtyLabel(t.outQtyFt, 0)} tone="amber" />
          <Stat label="Received back (chalan)" value={`${t.inChalanCount}`} sub={qtyLabel(t.inQtyFt, t.inQtyPcs)} tone="teal" />
          <Stat label="Still with printer" value="" sub={qtyLabel(Math.max(t.outQtyFt - t.inQtyFt, 0), 0)} tone="slate" />
          <Stat label="Printing bills" value={`₹${t.billTotal.toFixed(2)}`} sub={`${t.billCount} bill${t.billCount === 1 ? "" : "s"}`} tone="indigo" />
          <Stat label="Still due" value={`₹${t.billDue.toFixed(2)}`} sub={`paid ₹${t.billPaid.toFixed(2)}`} tone="rose" />
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">🧶 Cotton Rug Bill Workflow</h3>
          <p className="mb-3 mt-0.5 text-[11px] text-slate-500">
            The four bills a rug lot passes through, in order. Each card rolls up the entries already saved in its
            own screen — click it to add or review that stage.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {workflow.map((w) => (
              <a
                key={w.step}
                href={w.href}
                className={`rounded-lg border p-3 transition hover:shadow-sm ${w.tone}`}
              >
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
                  <span>Step {w.step}</span>
                  <span>{w.count} entr{w.count === 1 ? "y" : "ies"}</span>
                </div>
                <div className="mt-1 text-sm font-semibold">{w.title}</div>
                <div className="mt-0.5 text-[11px] opacity-80">{w.note}</div>
                <div className="mt-2 text-base font-bold">₹{w.amount.toFixed(2)}</div>
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {register.groups.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
              Nothing found for this selection — no Material OUT Chalan, Received Chalan or printing bill in range.
            </div>
          )}
          {register.groups.map((g) => (
            <details
              key={g.partyId ?? "__no_party__"}
              className="rounded-xl border border-slate-200 bg-white"
              open={register.groups.length <= 3}
            >
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                  {g.partyName}
                  {g.isPrintingVendor && (
                    <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700">
                      🖨️ Printing vendor
                    </span>
                  )}
                  <span className="text-xs font-normal text-slate-400">
                    {g.outChalanCount} out · {g.inChalanCount} in · {g.billCount} bill{g.billCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3 text-sm">
                  {(g.outQtyFt !== 0 || g.inQtyFt !== 0) && (
                    <span className={`font-semibold ${g.pendingFt > 0 ? "text-amber-700" : "text-slate-500"}`}>
                      Pending {qtyLabel(g.pendingFt, 0)}
                    </span>
                  )}
                  {g.billCount > 0 && (
                    <span className="font-bold text-indigo-700">
                      ₹{g.billTotal.toFixed(2)}
                      {g.billDue > 0 && <span className="ml-1 text-[11px] font-medium text-rose-600">due ₹{g.billDue.toFixed(2)}</span>}
                    </span>
                  )}
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="min-w-full divide-y divide-slate-100 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>Type</th>
                      <th className={th}>Date</th>
                      <th className={th}>Doc No.</th>
                      <th className={th}>Details</th>
                      <th className={th}>PO / Order</th>
                      <th className={th}>Qty</th>
                      <th className={`${th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.rows.map((row, i) => {
                      const key = `${row.kind}-${row.docId}-${i}`;
                      const docCell =
                        row.kind === "out" ? (
                          canOpenStockReport ? (
                            <Link
                              href={`/dashboard/stock/material-out-chalans/${row.docId}/report`}
                              className="font-medium text-slate-800 underline hover:text-amber-700"
                            >
                              {row.docNo}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-700">{row.docNo}</span>
                          )
                        ) : row.kind === "in" ? (
                          canOpenDocReport ? (
                            <Link
                              href={`/dashboard/documents/received-chalans/${row.docId}/report`}
                              className="font-medium text-slate-800 underline hover:text-amber-700"
                            >
                              {row.docNo}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-700">{row.docNo}</span>
                          )
                        ) : (
                          <span className="font-medium text-slate-700">{row.docNo}</span>
                        );

                      return (
                        <tr key={key} className="hover:bg-slate-50/70">
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                row.kind === "out"
                                  ? "bg-amber-100 text-amber-700"
                                  : row.kind === "in"
                                    ? "bg-teal-100 text-teal-700"
                                    : "bg-indigo-100 text-indigo-700"
                              }`}
                            >
                              {row.kind === "out" ? "📤 Sent" : row.kind === "in" ? "📥 Received" : "🧾 Bill"}
                            </span>
                            {row.kind === "bill" && (
                              <span className="ml-1 text-[10px] text-slate-400">
                                {row.matchedBy === "invoice_type" ? row.invoiceType : "printing vendor"}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{row.date || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">{docCell}</td>
                          <td className="px-3 py-1.5 text-slate-600">
                            <span className="block max-w-[34rem] whitespace-normal leading-snug">{row.details}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            {row.orders.length > 0 ? (
                              <span className="font-mono text-[10px] leading-snug text-slate-600">{row.orders.join(", ")}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{row.qtyLabel ?? "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-slate-800">
                            {row.kind === "bill" ? (
                              <>
                                ₹{row.amount.toFixed(2)}
                                <span className="block text-[10px] font-normal text-slate-400">
                                  {row.balanceDue > 0 ? `due ₹${row.balanceDue.toFixed(2)}` : "paid"}
                                </span>
                              </>
                            ) : row.amount ? (
                              `₹${row.amount.toFixed(2)}`
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <tr>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-800" colSpan={4}>
                        Party total — sent {qtyLabel(g.outQtyFt, 0)}, received {qtyLabel(g.inQtyFt, g.inQtyPcs)}, pending{" "}
                        {qtyLabel(g.pendingFt, 0)}
                      </td>
                      <td className="px-3 py-2"></td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                        {qtyLabel(g.inQtyFt, g.inQtyPcs)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-800">
                        {g.billCount > 0 ? `₹${g.billTotal.toFixed(2)}` : g.inAmount > 0 ? `₹${g.inAmount.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          ))}
        </div>
      </PrintArea>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "amber" | "teal" | "slate" | "indigo" | "rose";
}) {
  const tones: Record<typeof tone, string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    teal: "border-teal-200 bg-teal-50 text-teal-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      {value && <div className="text-lg font-bold leading-tight">{value}</div>}
      <div className="text-xs font-medium opacity-80">{sub}</div>
    </div>
  );
}
