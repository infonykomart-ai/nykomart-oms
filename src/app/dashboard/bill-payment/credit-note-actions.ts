"use server";

// Credit Notes against ANY bill — 2026-09-13. User (Hindi, verbatim):
// "couriour ka bill ho ya purchase ka agar inme ek se jyada credit note
// adjust karne ka option nahi bs ek hi entry hoti hai dusra ye ki agar
// bina credit note ki entry kiye agar kisi bill me entry kar di hai to vo
// auto sambandhit section ke credit note me chali jaye us se ye hoga ki
// apne ko pata chal jayega ki kis party se apne ko kitne ammonut ka credit
// mil gaya tha."
//
// Two distinct problems, both already half-solved at the DB layer:
//
// 1. "ek se jyada credit note ... bs ek hi entry hoti hai" — the schema
//    ALREADY supports N credit notes per bill:
//    bill_pass_register_adjustments (db/2026-08-27-note-linking-and-
//    adjustments.sql) holds one row per applied adjustment and a trigger
//    keeps bill_pass_register.adj_amt = SUM(those rows); balance_due is a
//    GENERATED column that already nets adj_amt + credit_note_amt +
//    total_paid. The gap was purely UI: the only writer was
//    saveCreditNoteCore's single optional "adjust against one invoice"
//    field (Documents → Credit Note), so nobody could add a 2nd/3rd
//    credit note to a bill afterwards.
//
// 2. "bina credit note ki entry kiye agar kisi bill me entry kar di hai"
//    — a manual amount typed into a bill's own credit_note_amt column
//    (Courier Bill / Duty Bill entry, Bill Payment's own edit form)
//    reduces that bill but vanishes from the Credit Notes section, so the
//    per-party "kitna credit mila" picture was incomplete.
//
// This file therefore exposes, all inside bill-payment's own folder so
// the entry point sits exactly where the bills already are (works
// identically for Purchase / FREIGHT INVOICE / DUTY TAX / any
// invoice_type, since they all live in bill_pass_register):
//
//   - applyBillCreditNote — one action, three modes:
//       mode="new"      → insert a real credit_notes row AND apply it via
//                         bill_pass_register_adjustments (repeatable —
//                         call it once per credit note).
//       mode="link"     → apply an EXISTING credit_notes row to this bill
//                         (its refund_amount, or a custom amount).
//       mode="register" → backfill: wrap a bill's existing manual
//                         credit_note_amt into a proper credit_notes
//                         document (NO adjustment row — the manual column
//                         already reduces balance_due; adding an
//                         adjustment too would double-reduce).
//
//   - removeBillCreditNote — undo one applied adjustment (the trigger
//     recomputes adj_amt/balance_due automatically).
//
//   - listCreditNoteRegister — every credit note in the selected
//     company(ies), with per-party totals: the "kis party se apne ko
//     kitne amount ka credit mil gaya tha" answer.
//
//   - findUnregisteredManualCreditNotes — bills whose manual
//     credit_note_amt has no credit_notes document behind it, for the
//     register page's "backlog" section (the register-mode fix).
//
// Capability: doc_entry — the same gate Document Entry's Credit Note tab
// already requires; anyone who could create a credit note before can use
// these, and nobody without document-entry rights can silently reduce a
// bill's payable. Company scoping on every write via employee.companyIds,
// same posture as everywhere else in this app.
// 2026-09-13 — every guard in this file is requireAnyCapability(
// "bill_payment", "doc_entry") rather than doc_entry alone: these actions
// are reached from Bill Payment (gated bill_payment), and a
// bill_payment-only role got ForbiddenError screens on exactly the
// surfaces this file powers ("link to open hi nahi ho raha"). Credit
// notes against bills are bill-payment work, so either capability grants
// it — same posture as the register page itself.
import { requireAnyCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ApplyCreditNoteState = { error: string | null; success: boolean };

/** Admin = a role that actually holds the permissions screen itself. */
function isAdmin(employee: AuthedEmployee): boolean {
  return employee.capabilities.includes("permissions_admin");
}

/**
 * "AGAR US BILL KE AGAINST PAYMENT REFRANCE ADD HO GAYA YA USKA PAYMENT HO
 * GAYA HO TO PHIR USKI ENTRY EDIT SIRF ADMIN SE HO" — a bill with any
 * payment posted against it is payment-locked: its credit-note wiring
 * changes what the already-recorded payments were computed against, so
 * only Admin may touch it. Kept in ONE place because the panel's Remove
 * button and (via this file's exports) the bill edit gate both need it.
 */
export async function billHasPayments(billId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { count } = await supabase
    .from("bill_pass_register_payments")
    .select("id", { count: "exact", head: true })
    .eq("bill_pass_register_id", billId);
  return (count ?? 0) > 0;
}

/**
 * Server-side gate shared by every mutation on a PAYMENT-LOCKED bill:
 * callers pass the pre-checked employee + bill; this throws for
 * non-admins (the caller renders the message instead).
 */
function assertPaymentLockAllowed(employee: AuthedEmployee, billTotalPaid: number): string | null {
  if (billTotalPaid > 0 && !isAdmin(employee)) {
    return "Payments have been recorded against this bill, so its credit notes are locked — only an Admin can change them.";
  }
  return null;
}

async function loadBillScoped(supabase: ReturnType<typeof createServiceRoleClient>, billId: string, companyIds: string[]) {
  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, vendor_invoice_no, invoice_no, invoice_type, total_amt, credit_note_amt, adj_amt, source")
    .eq("id", billId)
    .maybeSingle();
  if (!bill || !companyIds.includes(bill.company_id)) return null;
  return bill;
}

// 2026-09-13 — "COURIOUR KA JO CREDIT NOTE HOTA HAI VO AWB KE AGAINST ME
// AATA HAI TO AGAR EK CREDIT NOTE ME 1 SE JYADA AWB HUYE TO KYA UNKE
// AGAINST ME ADJUST KARNE KA OPTION HAI": one courier CN document often
// covers SEVERAL AWBs, each of which is its own bill_pass_register row
// (freight bills post per-AWB). This lists the party's outstanding
// freight/duty/purchase bills so the panel's multi-AWB mode can offer
// them as split-adjustment targets.
export type PartyAwbBill = {
  id: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  balance_due: number;
};

export async function listPartyBillsForCn(partyId: string): Promise<PartyAwbBill[]> {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();
  if (!partyId) return [];
  const { data } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, invoice_no, vendor_invoice_no, invoice_type, balance_due")
    .eq("party_id", partyId)
    .in("company_id", employee.companyIds)
    .gt("balance_due", 0)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(100);
  return (data ?? []).map((b) => ({
    id: b.id,
    invoice_no: b.invoice_no,
    vendor_invoice_no: b.vendor_invoice_no,
    invoice_type: b.invoice_type,
    balance_due: Number(b.balance_due),
  }));
}

/**
 * Mode "new": the dropdown/amount form the user asked for. Repeatable —
 * applying a second credit note just adds a second adjustment row and the
 * trigger re-sums adj_amt (balance_due recomputes itself, being GENERATED).
 */
export async function applyBillCreditNote(_prev: ApplyCreditNoteState, formData: FormData): Promise<ApplyCreditNoteState> {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();

  const mode = String(formData.get("mode") ?? "new");
  const billId = String(formData.get("bill_pass_register_id") ?? "");
  const bill = billId ? await loadBillScoped(supabase, billId, employee.companyIds) : null;
  if (!bill) return { error: "Bill not found, or you don't have access to its company.", success: false };

  const remark = String(formData.get("remark") ?? "").trim() || null;

  if (mode === "new") {
    const amount = Number(formData.get("amount") ?? 0);
    const cnDate = String(formData.get("credit_note_date") ?? "").trim();
    // 2026-09-13 — "credit note no ka option nahi hai usme gst kitni hai":
    // a real party-issued CN carries the PARTY's own number + a GST rate.
    // vendor_cn_no is free text (every vendor numbers their own way);
    // gst_rate_pct is nullable — blank means no GST applies. Both stored
    // on the document so the register shows exactly what the party sent.
    const vendorCnNo = String(formData.get("vendor_cn_no") ?? "").trim() || null;
    const gstRaw = String(formData.get("gst_rate_pct") ?? "").trim();
    const gstRatePct = gstRaw ? Number(gstRaw) : null;
    if (gstRatePct != null && ![2.5, 3, 4, 6, 9].includes(gstRatePct)) return { error: "GST rate must be one of 2.5, 3, 4, 6 or 9 (or leave blank for no GST).", success: false };
    if (!(amount > 0)) return { error: "Credit note amount must be a positive number.", success: false };
    if (!cnDate) return { error: "Credit note date is required.", success: false };

    // Payment lock (admin-only once payments exist) — see
    // assertPaymentLockAllowed above for the user's exact rule.
    const { data: paidCheck } = await supabase
      .from("bill_pass_register")
      .select("total_paid")
      .eq("id", bill.id)
      .single();
    const lockError = assertPaymentLockAllowed(employee, Number(paidCheck?.total_paid ?? 0));
    if (lockError) return { error: lockError, success: false };

    // Insert the real document first (cn_no auto-assigns via trigger), so
    // the note shows up in Documents → Credit Notes and in the per-party
    // register like every other credit note.
    const { data: cn, error: cnError } = await supabase
      .from("credit_notes")
      .insert({
        company_id: bill.company_id,
        credit_note_date: cnDate,
        vendor_cn_no: vendorCnNo,
        cn_kind: "supplier" as const,
        gst_rate_pct: gstRatePct,
        invoice_no: bill.vendor_invoice_no ?? bill.invoice_no ?? null,
        refund_amount: amount,
        party_id: bill.party_id,
        bill_pass_register_id: bill.id,
        credit_note_status: "Applied to bill",
        remark: remark ? `Against ${bill.vendor_invoice_no ?? bill.invoice_no ?? "bill"} — ${remark}` : `Against ${bill.vendor_invoice_no ?? bill.invoice_no ?? "bill"}`,
        created_by_employee_id: employee.id,
      })
      .select("id, cn_no")
      .single();
    if (cnError || !cn) return { error: `Failed to save the Credit Note: ${cnError?.message ?? "unknown error"}`, success: false };

    // Then apply it to the bill. If THIS half fails the note still exists
    // (money-wise nothing changed) — surface that loudly instead of lying.
    const { error: adjError } = await supabase.from("bill_pass_register_adjustments").insert({
      bill_pass_register_id: bill.id,
      credit_note_id: cn.id,
      amount,
      remark: remark ?? `Credit note ${cn.cn_no ?? ""}`.trim(),
      created_by_employee_id: employee.id,
    });
    if (adjError) {
      return {
        error: `Credit Note ${cn.cn_no ?? ""} saved, but applying it to the bill failed: ${adjError.message} — apply it from Documents → Credit Note.`,
        success: false,
      };
    }

    revalidatePath("/dashboard/bill-payment");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/dashboard/credit-notes-register`);
    return { error: null, success: true };
  }

  if (mode === "link") {
    const creditNoteId = String(formData.get("credit_note_id") ?? "");
    const amountRaw = String(formData.get("amount") ?? "").trim();
    if (!creditNoteId) return { error: "Pick a credit note to link.", success: false };

    const { data: paidCheck2 } = await supabase
      .from("bill_pass_register")
      .select("total_paid")
      .eq("id", bill.id)
      .single();
    const lockError2 = assertPaymentLockAllowed(employee, Number(paidCheck2?.total_paid ?? 0));
    if (lockError2) return { error: lockError2, success: false };

    const { data: cn } = await supabase
      .from("credit_notes")
      .select("id, cn_no, company_id, refund_amount, party_id")
      .eq("id", creditNoteId)
      .maybeSingle();
    if (!cn || !employee.companyIds.includes(cn.company_id)) return { error: "Credit note not found, or you don't have access to its company.", success: false };

    // Default to the note's own refund_amount when no explicit amount is
    // given (the overwhelmingly common case).
    const amount = amountRaw ? Number(amountRaw) : Number(cn.refund_amount ?? 0);
    if (!(amount > 0)) return { error: "Amount must be a positive number.", success: false };

    const { error: adjError } = await supabase.from("bill_pass_register_adjustments").insert({
      bill_pass_register_id: bill.id,
      credit_note_id: cn.id,
      amount,
      remark: remark ?? `Credit note ${cn.cn_no ?? ""}`.trim(),
      created_by_employee_id: employee.id,
    });
    if (adjError) return { error: adjError.message, success: false };

    // Backfill the document's "raised against" link if it had none, so the
    // register/note views stay coherent — never overwrite an existing link
    // (a note is raised against exactly one bill by design).
    if (!cn.party_id) {
      await supabase.from("credit_notes").update({ party_id: bill.party_id, bill_pass_register_id: bill.id }).eq("id", cn.id);
    }

    revalidatePath("/dashboard/bill-payment");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/dashboard/credit-notes-register`);
    return { error: null, success: true };
  }

  if (mode === "register") {
    // Backfill: wrap the bill's existing manual credit_note_amt into a
    // proper credit_notes document. NO adjustment row — the manual column
    // already flows into balance_due; an adjustment on top would
    // double-reduce the payable. Idempotent-ish: refuses to run when this
    // bill already has a registered CN for its manual amount.
    const manualAmt = Number(bill.credit_note_amt ?? 0);
    if (!(manualAmt > 0)) return { error: "This bill has no manual Credit Note amount to register.", success: false };

    const { data: already } = await supabase
      .from("credit_notes")
      .select("id")
      .eq("bill_pass_register_id", bill.id)
      .eq("refund_amount", manualAmt)
      .eq("credit_note_status", "Registered from bill entry")
      .limit(1)
      .maybeSingle();
    if (already) return { error: "This bill's manual credit note is already registered.", success: false };

    const { error: cnError } = await supabase.from("credit_notes").insert({
      company_id: bill.company_id,
      credit_note_date: new Date().toISOString().slice(0, 10),
      invoice_no: bill.vendor_invoice_no ?? bill.invoice_no ?? null,
      refund_amount: manualAmt,
      party_id: bill.party_id,
      bill_pass_register_id: bill.id,
      credit_note_status: "Registered from bill entry",
      remark: `Auto-registered from the manual Credit Note Amt on ${bill.vendor_invoice_no ?? bill.invoice_no ?? "this bill"}.`,
      created_by_employee_id: employee.id,
    });
    if (cnError) return { error: cnError.message, success: false };

    revalidatePath("/dashboard/bill-payment");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/dashboard/credit-notes-register`);
    return { error: null, success: true };
  }

  if (mode === "multi_awb") {
    // 2026-09-13 — "EK CREDIT NOTE ME 1 SE JYADA AWB HUYE TO KYA UNKE
    // AGAINST ME ADJUST KARNE KA OPTION HAI" + "CREDTI AMMOUNT + GST 18%
    // = TOTAL AMMOUNT": ONE courier CN document covers several AWB bills.
    // The party's outstanding bills are submitted as per-bill amounts
    // (awb_amounts JSON: {billId: amount}); the CN document stores the
    // TOTAL (base + GST) while each adjustment row carries that bill's
    // base share — GST lives on the document, not per bill.
    const cnDate = String(formData.get("credit_note_date") ?? "").trim();
    const partyId = String(formData.get("party_id") ?? "").trim();
    if (!partyId) return { error: "Party is required — open this from a bill row so the party is known.", success: false };
    const awbNos = String(formData.get("awb_no") ?? "").trim() || null;
    const vendorCnNo = String(formData.get("vendor_cn_no") ?? "").trim() || null;
    const gstRaw = String(formData.get("gst_rate_pct") ?? "9").trim();
    const gstRatePct = gstRaw ? Number(gstRaw) : null;
    if (gstRatePct != null && ![2.5, 3, 4, 6, 9].includes(gstRatePct)) return { error: "GST rate must be one of 2.5, 3, 4, 6 or 9.", success: false };
    const baseTotal = Number(formData.get("base_amount") ?? 0);
    if (!(baseTotal > 0)) return { error: "Credit note base amount must be positive.", success: false };
    if (!cnDate) return { error: "Credit note date is required.", success: false };

    // Per-bill split (must sum to the base amount).
    let splits: Record<string, number>;
    try {
      splits = JSON.parse(String(formData.get("awb_amounts") ?? "{}"));
    } catch {
      return { error: "Invalid AWB split — please retry.", success: false };
    }
    const splitEntries = Object.entries(splits).filter(([, v]) => Number(v) > 0);
    if (splitEntries.length === 0) return { error: "Enter at least one AWB amount.", success: false };
    const splitSum = splitEntries.reduce((sum, [, v]) => sum + Number(v), 0);
    if (Math.abs(splitSum - baseTotal) > 0.05) {
      return { error: `AWB amounts total (Rs ${splitSum.toFixed(2)}) must equal the CN base amount (Rs ${baseTotal.toFixed(2)}).`, success: false };
    }

    // Load + scope-check every target bill in one query.
    const targetIds = splitEntries.map(([id]) => id);
    const { data: targets } = await supabase
      .from("bill_pass_register")
      .select("id, company_id, party_id, vendor_invoice_no, invoice_no, total_paid")
      .in("id", targetIds);
    const targetById = new Map((targets ?? []).map((t) => [t.id, t]));
    for (const [id] of splitEntries) {
      const t = targetById.get(id);
      if (!t || !employee.companyIds.includes(t.company_id)) return { error: "One of the selected AWB bills is not accessible.", success: false };
      const lockErr = assertPaymentLockAllowed(employee, Number(t.total_paid ?? 0));
      if (lockErr) return { error: `AWB bill ${t.vendor_invoice_no ?? t.invoice_no ?? id.slice(0, 8)}: ${lockErr}`, success: false };
    }

    const gstTotal = gstRatePct != null ? Math.round(baseTotal * (1 + (gstRatePct * 2) / 100) * 100) / 100 : baseTotal;

    // ONE real CN document carrying the GST-inclusive total + the AWB list.
    const { data: cn, error: cnError } = await supabase
      .from("credit_notes")
      .insert({
        company_id: employee.currentCompanyId,
        credit_note_date: cnDate,
        vendor_cn_no: vendorCnNo,
        cn_kind: "supplier" as const,
        awb_no: awbNos,
        gst_rate_pct: gstRatePct,
        invoice_no: vendorCnNo ?? null,
        refund_amount: gstTotal,
        party_id: partyId,
        credit_note_status: "Applied to bills",
        remark: remark ? `Against ${splitEntries.length} AWB bill(s) — ${remark}` : `Against ${splitEntries.length} AWB bill(s)`,
        created_by_employee_id: employee.id,
      })
      .select("id, cn_no")
      .single();
    if (cnError || !cn) return { error: `Failed to save the Credit Note: ${cnError?.message ?? "unknown error"}`, success: false };

    // Split adjustments: per-bill base amounts (the document carries GST).
    const adjRows = splitEntries.map(([id, amt]) => ({
      bill_pass_register_id: id,
      credit_note_id: cn.id,
      amount: Number(amt),
      remark: remark ? remark : `Credit note ${cn.cn_no ?? ""} (multi-AWB)`.trim(),
      created_by_employee_id: employee.id,
    }));
    const { error: adjError } = await supabase.from("bill_pass_register_adjustments").insert(adjRows);
    if (adjError) {
      return {
        error: `Credit Note ${cn.cn_no ?? ""} saved, but applying it to the bills failed: ${adjError.message} — apply it from Documents → Credit Note.`,
        success: false,
      };
    }

    revalidatePath("/dashboard/bill-payment");
    revalidatePath("/dashboard/documents");
    revalidatePath("/dashboard/credit-notes-register");
    return { error: null, success: true };
  }
  return { error: "Unknown action.", success: false };
}

/** Undo one applied credit-note adjustment (trigger re-sums adj_amt). */
export async function removeBillCreditNote(adjustmentId: string): Promise<ApplyCreditNoteState> {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();

  if (!adjustmentId) return { error: "Missing adjustment.", success: false };

  const { data: adj } = await supabase
    .from("bill_pass_register_adjustments")
    .select("id, bill_pass_register_id")
    .eq("id", adjustmentId)
    .maybeSingle();
  if (!adj) return { error: "Adjustment not found.", success: false };

  const bill = await loadBillScoped(supabase, adj.bill_pass_register_id, employee.companyIds);
  if (!bill) return { error: "You don't have access to this bill's company.", success: false };

  // Removing a credit note RAISES the payable — on a bill that already has
  // payments recorded that silently breaks the "paid in full" state those
  // payments assumed. Admin-only, same lock as adding (see
  // assertPaymentLockAllowed).
  const { data: paidRow } = await supabase
    .from("bill_pass_register")
    .select("total_paid")
    .eq("id", adj.bill_pass_register_id)
    .single();
  const removeLock = assertPaymentLockAllowed(employee, Number(paidRow?.total_paid ?? 0));
  if (removeLock) return { error: removeLock, success: false };

  const { error } = await supabase.from("bill_pass_register_adjustments").delete().eq("id", adjustmentId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  revalidatePath("/dashboard/documents");
  revalidatePath(`/dashboard/credit-notes-register`);
  return { error: null, success: true };
}

export type RegisterCnRow = {
  id: string;
  cn_no: string | null;
  vendor_cn_no: string | null;
  cn_kind: string | null;
  buyer_name: string | null;
  gst_rate_pct: number | null;
  awb_no: string | null;
  credit_note_date: string;
  invoice_no: string | null;
  refund_amount: number;
  remark: string | null;
  status: string | null;
  company_id: string;
  party_id: string | null;
  party_name: string;
};

export type RegisterPartyGroup = {
  party_id: string | null;
  party_name: string;
  notes: RegisterCnRow[];
  total: number;
};

/**
 * The "kis party se kitna credit mila" view: every credit note in the
 * selected company(ies), grouped by party with per-party totals. Notes
 * without a party (old buyer-refund CNs) group under "(No party)".
 */
export async function listCreditNoteRegister(companyIds: string[]): Promise<RegisterPartyGroup[]> {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();

  const scoped = (companyIds ?? []).filter((c) => employee.companyIds.includes(c));
  if (scoped.length === 0) return [];

  const [{ data: notes }, { data: parties }] = await Promise.all([
    supabase
      .from("credit_notes")
      .select("id, cn_no, vendor_cn_no, cn_kind, buyer_name, awb_no, gst_rate_pct, company_id, credit_note_date, invoice_no, refund_amount, remark, credit_note_status, party_id")
      .in("company_id", scoped)
      .order("credit_note_date", { ascending: false }),
    supabase.from("parties").select("id, name"),
  ]);
  const nameById = new Map((parties ?? []).map((p) => [p.id, p.name]));

  const groups = new Map<string, RegisterPartyGroup>();
  for (const n of notes ?? []) {
    const key = n.party_id ?? "__none__";
    if (!groups.has(key)) groups.set(key, { party_id: n.party_id, party_name: n.party_id ? nameById.get(n.party_id) ?? "—" : "(No party — buyer refunds)", notes: [], total: 0 });
    const g = groups.get(key)!;
    g.notes.push({
      id: n.id,
      cn_no: n.cn_no,
      vendor_cn_no: n.vendor_cn_no,
      cn_kind: n.cn_kind,
      buyer_name: n.buyer_name,
      awb_no: n.awb_no,
      gst_rate_pct: n.gst_rate_pct,
      credit_note_date: n.credit_note_date,
      invoice_no: n.invoice_no,
      refund_amount: Number(n.refund_amount ?? 0),
      remark: n.remark,
      status: n.credit_note_status,
      company_id: n.company_id,
      party_id: n.party_id,
      party_name: n.party_id ? nameById.get(n.party_id) ?? "—" : "(No party)",
    });
    g.total += Number(n.refund_amount ?? 0);
  }

  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}

export type UnregisteredBill = {
  bill_id: string;
  company_name: string;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  party_name: string | null;
  credit_note_amt: number;
};

/**
 * Bills whose manual credit_note_amt column holds an amount but which have
 * no credit_notes document behind it yet — the "bina credit note ki entry
 * kiye" backlog, one "Register" click each to fix.
 */
export async function findUnregisteredManualCreditNotes(companyIds: string[]): Promise<UnregisteredBill[]> {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();

  const scoped = (companyIds ?? []).filter((c) => employee.companyIds.includes(c));
  if (scoped.length === 0) return [];

  const [{ data: bills }, { data: companies }, { data: parties }, { data: registered }] = await Promise.all([
    supabase
      .from("bill_pass_register")
      .select("id, company_id, vendor_invoice_no, invoice_no, invoice_type, party_id, credit_note_amt")
      .in("company_id", scoped)
      .gt("credit_note_amt", 0),
    supabase.from("companies").select("id, name"),
    supabase.from("parties").select("id, name"),
    supabase
      .from("credit_notes")
      .select("bill_pass_register_id")
      .eq("credit_note_status", "Registered from bill entry")
      .in("company_id", scoped),
  ]);

  const alreadyRegistered = new Set((registered ?? []).map((r) => r.bill_pass_register_id).filter((v): v is string => !!v));
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  return (bills ?? [])
    .filter((b) => !alreadyRegistered.has(b.id))
    .map((b) => ({
      bill_id: b.id,
      company_name: companyName.get(b.company_id) ?? "—",
      vendor_invoice_no: b.vendor_invoice_no ?? b.invoice_no,
      invoice_type: b.invoice_type,
      party_name: b.party_id ? partyName.get(b.party_id) ?? null : null,
      credit_note_amt: Number(b.credit_note_amt),
    }));
}
