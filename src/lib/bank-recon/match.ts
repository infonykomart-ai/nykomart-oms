// Bank & Card Reconciliation (2026-09-17) — matching layer.
//
// THE ONE INVARIANT (user's explicit rule): "lekin purane payment ko
// distrub nahi kare" — matching NEVER touches any existing system row.
// It only creates bank_recon_links rows and stamps the STATEMENT line
// itself (recon_status/linked_*). No bill_pass_register.total_paid, no
// internal_expenses, no orders row is ever written by this module.
//
// Matching ladder (money first, weakest last):
//   1. UTR / reference no  → bill_pass_register_payments.reference_no,
//      salaries/bill_pass (source='salary_payment'), recurring card debits'
//      internal_expenses rows, sale_profit_ledger order rows, and orders'
//      own reference fields — exact substring, case-insensitive (banks
//      embed the UTR inside a longer narration).
//   2. Portal payout → marketplace order no (sale_profit_ledger /
//      etsy_ledger_lines.order_number / amazon_transactions.order_id /
//      ebay_transaction_lines.order_number) + amount within tolerance —
//      "itna paisa is store se aaya" (store name is shown from the row).
//   3. Bill Pass Register: vendor invoice no found in narration + amount
//      within tolerance.
//   4. Party NAME substring from narration (with amount) — confidence
//      'fuzzy', always needs the user's Verify click.
//   5. Internal-expense MONTH+amount similarity — for auto-debits like
//      eRank/Etsy bill (recurring_debit_id rows) — 'heuristic'.
//
// Every candidate carries a confidence; only 'exact' candidates are
// auto-linked, everything else lands as a pending suggestion the user
// confirms with one click ("check and verify karte hi payment reference
// auto link ho jaye").
export type ReconTargetType = "bill_payment" | "salary_payment" | "card_expense" | "order_sale" | "expense" | "unmatched";

export type MatchCandidate = {
  target_type: ReconTargetType;
  target_id: string;
  target_company_id: string | null;
  target_label: string;
  matched_amount: number | null;
  match_method: "utr" | "order_no" | "invoice_no" | "party_name" | "amount_month";
  match_score: number;
  confidence: "exact" | "high" | "fuzzy" | "heuristic";
};

export type MatchSourceRow = {
  // the statement line being matched
  line_id: string;
  txn_date: string | null;
  description: string | null;
  ref_no: string | null;
  cheque_no: string | null;
  amount: number; // positive number, sign already applied by caller
  is_credit: boolean;
  company_id: string;
};

// What the actions layer fetches once per import/run and passes in — keeps
// this lib pure (no DB) and testable.
export type MatchIndex = {
  // bill_pass_register_payments rows joined to their bill (party + bill no)
  billPayments: {
    payment_id: string;
    bill_id: string;
    reference_no: string | null;
    amount: number;
    payment_date: string | null;
    payment_mode: string | null;
    company_id: string;
    party_name: string | null;
    vendor_invoice_no: string | null;
    invoice_type: string | null;
  }[];
  // salary payouts mirrored into bill_pass_register (source='salary_payment')
  salaryBills: {
    bill_id: string;
    employee_name: string | null;
    net_amount: number;
    period_label: string | null;
    company_id: string;
  }[];
  // internal_expenses — includes recurring card debits (eRank, Etsy bill…)
  internalExpenses: {
    id: string;
    expense_date: string;
    amount_inr: number;
    category: string;
    remark: string | null;
    recurring_vendor: string | null;
    company_id: string;
  }[];
  // marketplace sales — for "is store se aaya" payouts
  orderSales: {
    order_id: string;
    marketplace_order_no: string;
    total_value_inr: number | null;
    buyer_name: string | null;
    store_name: string | null;
    company_id: string;
  }[];
  parties: { id: string; name: string; company_id: string }[];
};

const TOLERANCE_PCT = 0.015; // 1.5% — bank charges/forex rounding
const TOLERANCE_ABS = 20; // or ₹20 flat, whichever is larger

export function amountWithin(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(TOLERANCE_ABS, Math.max(a, b) * TOLERANCE_PCT);
}

function includesRef(haystack: string | null | undefined, ref: string): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase().replace(/[^a-z0-9]/g, "");
  const r = ref.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!r || r.length < 4) return false;
  return h.includes(r);
}

function nameInNarration(narration: string | null | undefined, name: string): boolean {
  if (!narration || !name) return false;
  const tokens = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !["the", "and", "enterprises", "industries", "private", "limited", "pvt", "ltd", "traders", "textiles"].includes(t));
  if (!tokens.length) return false;
  const h = ` ${narration.toLowerCase().replace(/[^a-z0-9]/g, " ")} `;
  return tokens.every((t) => h.includes(` ${t}`));
}

// Ladder 1+2+3+4 combined. Amount sign convention: credits (money in) are
// matched against money we RECEIVED (portal payouts, refunds); debits
// (money out) against payments we MADE (bill payments, salary, card).
export function matchStatementLine(line: MatchSourceRow, index: MatchIndex): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const narr = line.description ?? "";
  const ref = line.ref_no || line.cheque_no;

  if (line.is_credit) {
    // --- money IN ---
    // 1. portal payout by order number appearing in narration
    if (line.amount > 0) {
      for (const sale of index.orderSales) {
        if (sale.company_id !== line.company_id) continue;
        if (sale.total_value_inr == null) continue;
        const orderNo = String(sale.marketplace_order_no ?? "").trim();
        if (!orderNo || !includesRef(narr, orderNo)) continue;
        if (!amountWithin(line.amount, sale.total_value_inr)) continue;
        out.push({
          target_type: "order_sale",
          target_id: sale.order_id,
          target_company_id: sale.company_id,
          target_label: `Order ${orderNo}${sale.store_name ? ` — ${sale.store_name}` : ""}${sale.buyer_name ? ` (${sale.buyer_name})` : ""}`,
          matched_amount: line.amount,
          match_method: "order_no",
          match_score: 95,
          confidence: "exact",
        });
        break;
      }
    }
    // 2. bill_pass_register credit rows don't exist; refunds handled by
    //    amounts only — a credit matching a known party NAME (rare, e.g.
    //    a vendor refunding to the account) gets a fuzzy candidate.
    for (const p of index.parties) {
      if (p.company_id !== line.company_id) continue;
      if (nameInNarration(narr, p.name)) {
        out.push({
          target_type: "bill_payment",
          target_id: `party:${p.id}`,
          target_company_id: p.company_id,
          target_label: `Party: ${p.name} (credit — refund/reversal?)`,
          matched_amount: line.amount,
          match_method: "party_name",
          match_score: 40,
          confidence: "fuzzy",
        });
        break;
      }
    }
    return dedupe(out);
  }

  // --- money OUT (payments we made) ---
  // 1. UTR / ref no exact
  if (ref) {
    let bestBill: MatchCandidate | null = null;
    for (const bp of index.billPayments) {
      // ref embedded both ways: bank writes full UTR, book wrote last-4, etc.
      if (!bp.reference_no || !includesRef(bp.reference_no, ref)) continue;
      const c: MatchCandidate = {
        target_type: "bill_payment",
        target_id: bp.bill_id,
        target_company_id: bp.company_id,
        target_label: `${bp.invoice_type ?? "Bill"} ${bp.vendor_invoice_no ?? ""} — ${bp.party_name ?? "?"} (payment ref ${bp.reference_no})`,
        matched_amount: bp.amount,
        match_method: "utr",
        match_score: amountWithin(line.amount, bp.amount) ? 100 : 80,
        confidence: amountWithin(line.amount, bp.amount) ? "exact" : "high",
      };
      if (!bestBill || c.match_score > bestBill.match_score) bestBill = c;
    }
    if (bestBill) out.push(bestBill);

    // salary payouts recorded as bill_pass rows — no payment ref stored
    // per-employee beyond the bill itself; match by narration name+amount.
  }
  // 2. salary bill by employee name + amount
  for (const s of index.salaryBills) {
    if (s.company_id !== line.company_id) continue;
    if (!s.employee_name) continue;
    if (!amountWithin(line.amount, s.net_amount)) continue;
    if (!nameInNarration(narr, s.employee_name)) continue;
    out.push({
      target_type: "salary_payment",
      target_id: s.bill_id,
      target_company_id: s.company_id,
      target_label: `Salary — ${s.employee_name}${s.period_label ? ` (${s.period_label})` : ""}`,
      matched_amount: line.amount,
      match_method: "party_name",
      match_score: 85,
      confidence: "high",
    });
    break;
  }
  // 3. internal_expenses (card auto-debits like eRank / Etsy bill / eBay)
  for (const ex of index.internalExpenses) {
    if (ex.company_id !== line.company_id) continue;
    const vendor = ex.recurring_vendor ?? ex.category;
    const nameHit = nameInNarration(narr, vendor) || (ex.remark ? (ref ? includesRef(ex.remark, ref) : false) || nameInNarration(narr, ex.remark) : false);
    if (!nameHit) continue;
    const exact = amountWithin(line.amount, ex.amount_inr);
    const sameMonth = line.txn_date ? line.txn_date.slice(0, 7) === String(ex.expense_date).slice(0, 7) : false;
    out.push({
      target_type: ex.recurring_vendor ? "card_expense" : "expense",
      target_id: ex.id,
      target_company_id: ex.company_id,
      target_label: `${vendor} — ${ex.category}${ex.remark ? ` (${ex.remark})` : ""}`,
      matched_amount: ex.amount_inr,
      match_method: exact ? "amount_month" : "party_name",
      match_score: exact && sameMonth ? 90 : exact ? 70 : sameMonth ? 45 : 35,
      confidence: exact && sameMonth ? "exact" : exact ? "high" : "fuzzy",
    });
    break;
  }
  // 4. bill payment by party name + amount (no UTR stored)
  for (const bp of index.billPayments) {
    if (bp.company_id !== line.company_id) continue;
    if (!bp.party_name || !nameInNarration(narr, bp.party_name)) continue;
    if (!amountWithin(line.amount, bp.amount)) continue;
    // skip if already matched via ref above (bestBill)
    if (ref && includesRef(bp.reference_no, ref)) continue;
    out.push({
      target_type: "bill_payment",
      target_id: bp.bill_id,
      target_company_id: bp.company_id,
      target_label: `${bp.invoice_type ?? "Bill"} ${bp.vendor_invoice_no ?? ""} — ${bp.party_name}`,
      matched_amount: bp.amount,
      match_method: "party_name",
      match_score: 75,
      confidence: "high",
    });
    break;
  }
  // 5. party-only weak suggestion
  if (!out.length) {
    for (const p of index.parties) {
      if (p.company_id !== line.company_id) continue;
      if (nameInNarration(narr, p.name)) {
        out.push({
          target_type: "bill_payment",
          target_id: `party:${p.id}`,
          target_company_id: p.company_id,
          target_label: `Party: ${p.name} (no bill payment found for this amount)`,
          matched_amount: line.amount,
          match_method: "party_name",
          match_score: 35,
          confidence: "fuzzy",
        });
        break;
      }
    }
  }
  return dedupe(out);
}

function dedupe(cands: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  return cands.filter((c) => {
    const k = `${c.target_type}:${c.target_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// The one-line summary the UI shows per suggestion.
export function confidenceLabel(c: MatchCandidate): string {
  switch (c.confidence) {
    case "exact":
      return "✓ Exact match";
    case "high":
      return "● Strong match";
    case "fuzzy":
      return "◌ Possible match";
    case "heuristic":
      return "◌ Similar expense";
  }
}
