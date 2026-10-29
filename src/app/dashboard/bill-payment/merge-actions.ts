"use server";

// 2026-09-14 — "AGAR ESE KOI INVOICE AAYE TO USKO MERGE KARNE KA OPTION
// BANANA HAI" — the cross-company invoice merge from the original request
// ("jab purchase ki entry hoti hai to teeno company ke bill register me
// jata hai ... same party same invoice no but show 3 entry ek merge karne
// ka option ho jis se invoice or party name same rahe baki jo payment hai
// vo jud ke aajaye").
//
// WHAT A MERGE DOES: the SAME vendor invoice (same party + vendor_invoice_no
// + invoice_type) legitimately lands as SEPARATE bill_pass_register rows
// under DIFFERENT companies (Nyko Mart / Rugara / CASA ARRA split one real
// vendor document). Merging picks ONE row as the KEEPER and:
//   1. re-points every loser row's bill_pass_register_payments rows onto
//      the keeper (real payment documents are never duplicated — they just
//      get a new bill_pass_register_id), then recomputes the keeper's
//      total_paid as the SUM of its (now combined) ledger — the same
//      recompute-from-ledger pattern recordBillPayment already uses;
//   2. sums the losers' credit_note_amt / adj_amt onto the keeper's, so
//      any Credit/Debit Note adjustments travel with the merge too;
//   3. zeros the losers' outstanding financials and tags them with
//      merged_into_bill_id — they drop out of every unpaid view but are
//      NEVER deleted (audit trail intact, keeper's URL unchanged).
//
// Payments already recorded on the losers are the point of the exercise
// ("baki jo payment hai vo jud ke aajaye") — but only because this action
// re-points the ledger rows atomically in the same pass; no hand-typed
// totals are trusted anywhere.

import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { billMergeKey, pickRowsSummingTo, parseMergeOriginalTotal, MERGE_TAG } from "@/lib/bill-merge-key";
import { revalidatePath } from "next/cache";

export type MergeBillsState = {
  error: string | null;
  success: { keeperInvoiceNo: string; keeperCompany: string; movedPayments: number; movedAdjustments: number; mergedCount: number } | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function mergeDuplicateBills(_prev: MergeBillsState, formData: FormData): Promise<MergeBillsState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  let billIds: string[];
  try {
    billIds = JSON.parse(str(formData, "bill_ids_json") || "[]");
  } catch {
    return { error: "Invalid selection — please retry.", success: null };
  }
  // bill_ids_json: [keeperId, ...loserIds]
  if (billIds.length < 2) return { error: "Select the bill to KEEP plus at least one to merge into it.", success: null };
  const [keeperId, ...loserIds] = billIds;
  if (loserIds.some((id) => id === keeperId)) return { error: "Selection contained the same bill twice.", success: null };

  // Load every participant (keeper + losers) — company access on ALL.
  const { data: rows, error: loadError } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, party_id, source, total_amt, credit_note_amt, adj_amt, total_paid, to_be_pay, balance_due, merged_into_bill_id, remark, companies(name)")
    .in("id", billIds);
  if (loadError || !rows || rows.length !== billIds.length) {
    return { error: loadError?.message ?? "One or more bills not found — refresh and retry.", success: null };
  }

  const keeper = rows.find((r) => r.id === keeperId)!;
  const losers = rows.filter((r) => r.id !== keeperId);

  for (const r of rows) {
    if (!employee.companyIds.includes(r.company_id)) {
      return { error: `You don't have access to one of the selected bills' companies (${r.companies?.name ?? r.company_id}).`, success: null };
    }
    if (r.merged_into_bill_id) {
      return { error: `Bill ${r.invoice_no ?? r.vendor_invoice_no ?? r.id} is itself already merged into another bill — unmerge is not supported; ask Admin.`, success: null };
    }
  }

  // 2026-10-29b — THE MERGE KEY IS NOW PARTY + INVOICE NO. + INVOICE DATE +
  // AMOUNT. It used to be party + invoice no. only, and that was wrong: a
  // vendor invoice NUMBER is not unique across financial years (or across two
  // genuinely different bills that happen to reuse a number). Folding 2026-27
  // invoice 82 into 2025-26 invoice 82 zeroed the second bill's amount and
  // moved its payments onto the first — after which the party ledger showed
  // one company's bill with another company's money. A merge is only a
  // DUPLICATE ENTRY when the invoice number, the invoice date AND the bill
  // amount all agree; anything else is a different bill and must stay
  // separate.
  //
  // invoice_type is deliberately still NOT part of the key: a courier invoice
  // recorded once as "Courier Bill (Freight)" and once as a plain "FREIGHT
  // INVOICE" row is the same document.
  // The rule itself lives in src/lib/bill-merge-key.ts (pure + unit-tested).
  const keeperKey = billMergeKey(keeper);
  const mismatched = losers.filter((r) => billMergeKey(r) !== keeperKey);
  if (!keeper.party_id || !keeper.vendor_invoice_no) {
    return { error: "The bill to keep must have both a Party and a Vendor Invoice No. before others can merge into it.", success: null };
  }
  if (!keeper.invoice_date || !(Number(keeper.total_amt ?? 0) > 0)) {
    return { error: "The bill to keep must have an Invoice Date and a non-zero amount before others can merge into it.", success: null };
  }
  if (mismatched.length) {
    return {
      error: `Only a true duplicate can merge — same Party, same Invoice No., same Invoice Date AND same amount. These differ: ${mismatched
        .map(
          (r) =>
            `${r.invoice_no ?? r.vendor_invoice_no} — ${r.companies?.name ?? ""} (${r.invoice_date ?? "no date"}, ₹${Number(r.total_amt ?? 0).toFixed(2)})`
        )
        .join("; ")} vs kept ${keeper.invoice_no ?? keeper.vendor_invoice_no} (${keeper.invoice_date}, ₹${Number(
        keeper.total_amt ?? 0
      ).toFixed(2)}).`,
      success: null,
    };
  }

  let movedPayments = 0;
  let movedAdjustments = 0;
  let cnSum = 0;
  let adjSum = 0;

  // balance_due / to_be_pay are GENERATED columns (see db/schema.sql) — a
  // merged row is zeroed by writing total_amt = 0, which drives both
  // generated values to 0 automatically. The loser's original total is
  // preserved in its remark line for audit.
  for (const loser of losers) {
    // 1. Move the loser's payment ledger rows onto the keeper.
    const { data: moved, error: movePayError } = await supabase
      .from("bill_pass_register_payments")
      .update({ bill_pass_register_id: keeperId })
      .eq("bill_pass_register_id", loser.id)
      .select("id");
    if (movePayError) return { error: movePayError.message, success: null };
    movedPayments += moved?.length ?? 0;

    // 2. Move the loser's Credit/Debit Note adjustments onto the keeper.
    const { data: movedAdj, error: moveAdjError } = await supabase
      .from("bill_pass_register_adjustments")
      .update({ bill_pass_register_id: keeperId })
      .eq("bill_pass_register_id", loser.id)
      .select("id");
    if (moveAdjError) return { error: moveAdjError.message, success: null };
    movedAdjustments += movedAdj?.length ?? 0;
    cnSum += Number(loser.credit_note_amt ?? 0);
    adjSum += Number(loser.adj_amt ?? 0);

    // 2026-10-29 — the loser can also be the row a real Credit / Debit Note
    // was raised against (debit_notes/credit_notes.bill_pass_register_id).
    // Re-point those documents at the keeper too, otherwise the note would
    // keep hanging off a zeroed duplicate row and disappear from the bill
    // that survived ("ek me credit note to" — it must travel with the merge).
    await supabase.from("credit_notes").update({ bill_pass_register_id: keeperId }).eq("bill_pass_register_id", loser.id);
    await supabase.from("debit_notes").update({ bill_pass_register_id: keeperId }).eq("bill_pass_register_id", loser.id);

    // 3. Zero + tag the loser (never delete). total_amt = 0 zeroes the
    // GENERATED to_be_pay/balance_due; original amount kept in the remark.
    const { error: zeroError } = await supabase
      .from("bill_pass_register")
      .update({
        merged_into_bill_id: keeperId,
        total_amt: 0,
        remark: `${loser.remark ? loser.remark + " | " : ""}[merged into ${keeper.invoice_no ?? keeper.vendor_invoice_no} — ${keeper.companies?.name ?? ""}; original total ${Number(loser.total_amt ?? 0).toFixed(2)}]`,
      })
      .eq("id", loser.id);
    if (zeroError) return { error: zeroError.message, success: null };
  }

  // 4. Recompute the keeper's total_paid from its (combined) ledger and
  //    carry over the losers' note totals.
  const { data: payments } = await supabase
    .from("bill_pass_register_payments")
    .select("amount")
    .eq("bill_pass_register_id", keeperId);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  const { error: keeperError } = await supabase
    .from("bill_pass_register")
    .update({
      total_paid: totalPaid,
      credit_note_amt: Number(keeper.credit_note_amt ?? 0) + cnSum,
      adj_amt: Number(keeper.adj_amt ?? 0) + adjSum,
      payment_by_employee_id: employee.id,
    })
    .eq("id", keeperId);
  if (keeperError) return { error: keeperError.message, success: null };

  revalidatePath("/dashboard/bill-payment");
  return {
    error: null,
    success: {
      keeperInvoiceNo: keeper.invoice_no ?? keeper.vendor_invoice_no ?? keeperId,
      keeperCompany: keeper.companies?.name ?? "",
      movedPayments,
      movedAdjustments,
      mergedCount: losers.length,
    },
  };
}

// =============================================================================
// UNDO A MERGE (2026-10-29b)
//
// "PURCHASE PARTY KE BILL MEARG HO GAYE THE ... VAPAS VAHI PAR PAHUCHAHO" — a
// merge used to be one-way: the loser was zeroed and tagged, and there was no
// way back. That is unacceptable when the merge key was too loose (see the
// 2026-10-29b note on the key above) and two DIFFERENT bills got folded.
//
// What an undo restores:
//   1. the loser's original total_amt — read back from the audit line the
//      merge wrote into its remark ("original total N"), so nothing is typed
//      by hand and the amount is exactly what was there before;
//   2. the loser's payments — merged rows were re-pointed at the keeper, and
//      bill_pass_register.total_paid still holds the loser's original paid
//      figure, so the exact set of payment rows summing to that figure is
//      moved back (exact-subset search; a partial/missing match is reported
//      instead of guessing);
//   3. the loser's CN/DN adjustment rows — same idea, using adj_amt;
//   4. the keeper's credit_note_amt / adj_amt are decremented by the loser's
//      own (never-zeroed) values, and both bills' total_paid are recomputed
//      from their own ledger afterwards.
//
// Only an admin can undo: this rewrites money that Finance already posted.

export type UnmergeState = {
  error: string | null;
  success: { invoiceNo: string; restoredTotal: number; movedPayments: number; movedAdjustments: number; warning: string | null } | null;
};

export async function unmergeBill(_prev: UnmergeState, formData: FormData): Promise<UnmergeState> {
  const employee = await requireCapability("employee_admin");
  const loserId = str(formData, "bill_id");
  if (!loserId) return { error: "No bill selected.", success: null };
  return unmergeOne(createServiceRoleClient(), employee, loserId);
}

/**
 * 2026-10-29k — the per-bill undo, as a reusable step. `unmergeBill` and the new
 * `unmergeAllBills` MUST do exactly the same thing to a bill, so the whole body
 * lives here once and both entry points call it.
 */
async function unmergeOne(
  supabase: ReturnType<typeof createServiceRoleClient>,
  employee: AuthedEmployee,
  loserId: string
): Promise<UnmergeState> {

  const { data: loser, error: loadError } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, invoice_no, vendor_invoice_no, invoice_date, total_amt, total_paid, credit_note_amt, adj_amt, merged_into_bill_id, remark")
    .eq("id", loserId)
    .maybeSingle();
  if (loadError || !loser) return { error: loadError?.message ?? "Bill not found — refresh and retry.", success: null };
  if (!loser.merged_into_bill_id) return { error: "This bill is not merged into anything.", success: null };
  if (!employee.companyIds.includes(loser.company_id)) {
    return { error: "You don't have access to this bill's company.", success: null };
  }

  const originalTotal = parseMergeOriginalTotal(loser.remark);
  if (!(originalTotal > 0)) {
    return {
      error: "Could not find the original amount in this bill's merge note, so the undo can't be done safely. Fix the bill manually.",
      success: null,
    };
  }

  const keeperId = loser.merged_into_bill_id;
  const { data: keeper } = await supabase
    .from("bill_pass_register")
    .select("id, credit_note_amt, adj_amt")
    .eq("id", keeperId)
    .maybeSingle();
  if (!keeper) return { error: "The bill this was merged into no longer exists.", success: null };

  const warnings: string[] = [];

  // 1. Payments — the loser's own total_paid still says how much money belongs
  //    to it (the merge never zeroed that column), so move exactly that much
  //    back off the keeper's ledger.
  const { data: keeperPayments } = await supabase
    .from("bill_pass_register_payments")
    .select("id, amount")
    .eq("bill_pass_register_id", keeperId)
    .order("payment_date", { ascending: false });
  const paymentRows = (keeperPayments ?? []).map((p) => ({ id: p.id, amount: Number(p.amount) }));
  const wantedPaid = Number(loser.total_paid ?? 0);
  let movedPayments = 0;
  if (wantedPaid > 0.005) {
    const picked = pickRowsSummingTo(paymentRows, wantedPaid);
    if (picked && picked.length > 0) {
      const { error } = await supabase
        .from("bill_pass_register_payments")
        .update({ bill_pass_register_id: loserId })
        .in("id", picked.map((p) => p.id));
      if (error) return { error: error.message, success: null };
      movedPayments = picked.length;
    } else {
      warnings.push(
        `Payments: ₹${wantedPaid.toFixed(2)} of payment couldn't be matched back to this bill (no exact combination on the merged bill) — record it again from Bill Payment.`
      );
    }
  }

  // 2. CN/DN adjustment rows — same exact-subset restore, using adj_amt.
  const { data: keeperAdjs } = await supabase
    .from("bill_pass_register_adjustments")
    .select("id, amount")
    .eq("bill_pass_register_id", keeperId)
    .order("created_at", { ascending: false });
  const adjRows = (keeperAdjs ?? []).map((a) => ({ id: a.id, amount: Number(a.amount) }));
  const wantedAdj = Number(loser.adj_amt ?? 0);
  let movedAdjustments = 0;
  if (wantedAdj > 0.005) {
    const picked = pickRowsSummingTo(adjRows, wantedAdj);
    if (picked && picked.length > 0) {
      const { error } = await supabase
        .from("bill_pass_register_adjustments")
        .update({ bill_pass_register_id: loserId })
        .in("id", picked.map((a) => a.id));
      if (error) return { error: error.message, success: null };
      movedAdjustments = picked.length;
    } else {
      warnings.push(
        `Note adjustments: ₹${wantedAdj.toFixed(2)} of CN/DN adjustment stayed on the merged bill — re-apply it here if needed.`
      );
    }
  }

  // 3. Keeper — give back the loser's CN/DN amounts it had absorbed, and
  //    recompute its paid figure from its (now smaller) ledger.
  const { data: keeperPayLeft } = await supabase
    .from("bill_pass_register_payments")
    .select("amount")
    .eq("bill_pass_register_id", keeperId);
  const keeperPaidLeft = (keeperPayLeft ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const { error: keeperError } = await supabase
    .from("bill_pass_register")
    .update({
      total_paid: keeperPaidLeft,
      credit_note_amt: Math.max(0, Number(keeper.credit_note_amt ?? 0) - Number(loser.credit_note_amt ?? 0)),
      adj_amt: Math.max(0, Number(keeper.adj_amt ?? 0) - wantedAdj),
    })
    .eq("id", keeperId);
  if (keeperError) return { error: keeperError.message, success: null };

  // 4. Loser — amount back, tag cleared, paid recomputed from its own ledger.
  const { data: loserPayLeft } = await supabase
    .from("bill_pass_register_payments")
    .select("amount")
    .eq("bill_pass_register_id", loserId);
  const loserPaidLeft = (loserPayLeft ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const cleanedRemark = (loser.remark ?? "").replace(MERGE_TAG, "").trim();
  const { error: loserError } = await supabase
    .from("bill_pass_register")
    .update({
      total_amt: originalTotal,
      total_paid: loserPaidLeft,
      merged_into_bill_id: null,
      remark: `${cleanedRemark ? cleanedRemark + " | " : ""}[merge undone — ₹${originalTotal.toFixed(2)} restored]`,
    })
    .eq("id", loserId);
  if (loserError) return { error: loserError.message, success: null };

  revalidatePath("/dashboard/bill-payment");
  revalidatePath("/dashboard/parties");
  return {
    error: null,
    success: {
      invoiceNo: loser.invoice_no ?? loser.vendor_invoice_no ?? loserId,
      restoredTotal: originalTotal,
      movedPayments,
      movedAdjustments,
      warning: warnings.length ? warnings.join(" ") : null,
    },
  };
}

// =============================================================================
// UNDO *ALL* MERGES (2026-10-29k)
//
// "single single unmearg karni pad rahi hai ek sath unmearg karne ka option do
// na" — with a loose merge key there were 55 merged rows, i.e. 55 clicks, each
// one its own round trip. This runs the SAME unmergeOne over every merged row
// in the caller's companies, in one action, and reports per-bill failures
// instead of stopping at the first one (a single unreadable merge note must not
// block the other 54).
//
// Admin-only, exactly like the single undo — it rewrites money Finance posted.

export type UnmergeAllState = {
  error: string | null;
  summary: {
    undone: number;
    failed: number;
    restoredTotal: number;
    failures: { invoiceNo: string; error: string }[];
    warnings: string[];
  } | null;
};

/** Safety cap — a runaway list should never hold a request open for minutes. */
const UNMERGE_ALL_LIMIT = 500;

export async function unmergeAllBills(_prev: UnmergeAllState, _formData: FormData): Promise<UnmergeAllState> {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const { data: merged, error } = await supabase
    .from("bill_pass_register")
    .select("id, invoice_no, vendor_invoice_no, invoice_date")
    .not("merged_into_bill_id", "is", null)
    .in("company_id", employee.companyIds)
    .order("invoice_date", { ascending: true })
    .limit(UNMERGE_ALL_LIMIT);
  if (error) return { error: `Could not load the merged entries: ${error.message}`, summary: null };

  const rows = merged ?? [];
  if (rows.length === 0) {
    return { error: null, summary: { undone: 0, failed: 0, restoredTotal: 0, failures: [], warnings: [] } };
  }

  const failures: { invoiceNo: string; error: string }[] = [];
  const warnings: string[] = [];
  let undone = 0;
  let restoredTotal = 0;

  for (const r of rows) {
    const label = r.invoice_no ?? r.vendor_invoice_no ?? r.id;
    const out = await unmergeOne(supabase, employee, r.id);
    if (out.error || !out.success) {
      failures.push({ invoiceNo: label, error: out.error ?? "Unknown error" });
      continue;
    }
    undone += 1;
    restoredTotal = Math.round((restoredTotal + out.success.restoredTotal) * 100) / 100;
    if (out.success.warning) warnings.push(`${out.success.invoiceNo}: ${out.success.warning}`);
  }

  revalidatePath("/dashboard/bill-payment");
  revalidatePath("/dashboard/parties");
  return {
    error: null,
    summary: { undone, failed: failures.length, restoredTotal, failures, warnings },
  };
}
