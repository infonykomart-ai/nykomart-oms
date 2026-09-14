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

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
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

  // Same-invoice sanity: keeper must share party + vendor invoice no. +
  // type with every loser (that's the definition of the merge — otherwise
  // payments would move onto an unrelated bill).
  const key = (r: (typeof rows)[number]) => `${r.party_id ?? ""}|${(r.vendor_invoice_no ?? "").toLowerCase().trim()}|${r.invoice_type ?? ""}`;
  const keeperKey = key(keeper);
  const mismatched = losers.filter((r) => key(r) !== keeperKey);
  if (!keeper.party_id || !keeper.vendor_invoice_no) {
    return { error: "The bill to keep must have both a Party and a Vendor Invoice No. before others can merge into it.", success: null };
  }
  if (mismatched.length) {
    return {
      error: `These bills don't share the same Party + Vendor Invoice No. + Type (${mismatched.map((r) => `${r.invoice_no ?? r.vendor_invoice_no} — ${r.companies?.name ?? ""}`).join("; ")}). Only same-invoice entries can merge.`,
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
