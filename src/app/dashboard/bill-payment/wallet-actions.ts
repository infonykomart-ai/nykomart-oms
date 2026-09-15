"use server";

// 2026-09-15 — "kuch kuch courier me shipment bhejne se pehle wallet
// recharge karna padta hai phir baad me adjust hota hai jab uska invoice
// aata hai to iska kese karenge"
//
// Prepaid courier wallets (FedEx / UPS / Delhivery style): money goes INTO
// the courier's wallet before shipments fly, the courier's freight/duty
// invoice later lands in bill_pass_register as always, and instead of a
// bank payment the wallet balance settles it. Three txn types:
//
//   recharge  (direction 'in')  — bank → wallet (payment_mode/reference
//                                 = NEFT/RTGS/UPI + UTR, same columns as
//                                 bill_pass_register_payments)
//   consume   (direction 'out') — a bill paid from the wallet; sets
//                                 bill_pass_register.wallet_paid, NEVER
//                                 touches bill_pass_register_payments
//                                 (that table means bank money left the
//                                 account — a wallet consume didn't)
//   refund    (direction 'in')  — courier returned unused wallet money
//
// balance = SUM(in) − SUM(out) over (company, party). This file holds the
// ledger primitives (overview / recharge / refund); the consume action
// that settles a bill lives in wallet-pay-actions.ts.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type WalletTxnRow = {
  id: string;
  company_id: string;
  party_id: string;
  party_name: string;
  txn_type: "recharge" | "consume" | "refund";
  direction: "in" | "out";
  amount: number;
  txn_date: string;
  payment_mode: string | null;
  reference_no: string | null;
  remark: string | null;
  bill_pass_register_id: string | null;
};

export type WalletPartyBalance = {
  party_id: string;
  party_name: string;
  balance: number;
};

export type WalletOverview = {
  balances: WalletPartyBalance[];
  recent: WalletTxnRow[];
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export async function getWalletOverview(companyIds: string[]): Promise<WalletOverview> {
  if (companyIds.length === 0) return { balances: [], recent: [] };
  const supabase = createServiceRoleClient();

  const [{ data: txns }, { data: parties }] = await Promise.all([
    supabase
      .from("party_wallet_txns")
      .select("id, company_id, party_id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark, bill_pass_register_id")
      .in("company_id", companyIds)
      .order("txn_date", { ascending: false })
      .order("entered_on", { ascending: false })
      .limit(400),
    supabase.from("parties").select("id, name"),
  ]);

  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const bal = new Map<string, number>();
  // Recharge/refund add, consume subtracts — walk OLDEST-first so the
  // signed sum is order-independent anyway, but keep the map fill simple.
  const ordered = [...(txns ?? [])].reverse();
  for (const t of ordered) {
    const prev = bal.get(t.party_id) ?? 0;
    bal.set(t.party_id, t.direction === "in" ? prev + Number(t.amount) : prev - Number(t.amount));
  }

  const balances: WalletPartyBalance[] = Array.from(bal.entries())
    .map(([party_id, balance]) => ({ party_id, party_name: partyName.get(party_id) ?? "—", balance }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const recent: WalletTxnRow[] = (txns ?? []).map((t) => ({
    id: t.id,
    company_id: t.company_id,
    party_id: t.party_id,
    party_name: partyName.get(t.party_id) ?? "—",
    txn_type: t.txn_type as WalletTxnRow["txn_type"],
    direction: t.direction as WalletTxnRow["direction"],
    amount: Number(t.amount),
    txn_date: t.txn_date,
    payment_mode: t.payment_mode,
    reference_no: t.reference_no,
    remark: t.remark,
    bill_pass_register_id: t.bill_pass_register_id,
  }));

  return { balances, recent };
}

export type WalletActionState = { error: string | null; success: boolean };

export async function walletRecharge(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const amount = Number(str(formData, "amount"));
  const txnDate = str(formData, "txn_date") || new Date().toISOString().slice(0, 10);

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: false };
  }
  if (!partyId) return { error: "Choose the courier party.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Recharge amount must be a positive number.", success: false };
  }

  const { error } = await supabase.from("party_wallet_txns").insert({
    company_id: companyId,
    party_id: partyId,
    txn_type: "recharge",
    direction: "in",
    amount,
    txn_date: txnDate,
    payment_mode: strOrNull(formData, "payment_mode"),
    reference_no: strOrNull(formData, "reference_no"),
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}

export async function walletRefund(_prev: WalletActionState, formData: FormData): Promise<WalletActionState> {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = str(formData, "company_id");
  const partyId = str(formData, "party_id");
  const amount = Number(str(formData, "amount"));
  const txnDate = str(formData, "txn_date") || new Date().toISOString().slice(0, 10);

  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: false };
  }
  if (!partyId) return { error: "Choose the courier party.", success: false };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Refund amount must be a positive number.", success: false };
  }

  // Balance guard: a refund can't push the wallet negative.
  const { data: txns } = await supabase
    .from("party_wallet_txns")
    .select("direction, amount")
    .eq("company_id", companyId)
    .eq("party_id", partyId);
  const balance = (txns ?? []).reduce((s, t) => s + (t.direction === "in" ? Number(t.amount) : -Number(t.amount)), 0);
  if (amount > balance + 0.005) {
    return { error: `Refund ₹${amount.toFixed(2)} exceeds wallet balance ₹${balance.toFixed(2)}.`, success: false };
  }

  const { error } = await supabase.from("party_wallet_txns").insert({
    company_id: companyId,
    party_id: partyId,
    txn_type: "refund",
    direction: "in",
    amount,
    txn_date: txnDate,
    remark: strOrNull(formData, "remark"),
    entered_by: employee.id,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/bill-payment");
  return { error: null, success: true };
}
