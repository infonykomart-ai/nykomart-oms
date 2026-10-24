// 2026-10-24 — "kitna paisa kitna purana pada hai": ONE ageing calculation,
// shared by the Ageing report page and the daily overdue digest, so the number
// on screen can never disagree with the number in the Telegram message.
//
// Source is bill_pass_register — same table Bill Payment and the Party Ledger
// read — and the only figure used is its generated balance_due > 0 (an unpaid
// or partly-paid bill). A bill's age is measured from its due_date (generated
// as invoice_recv_date + 7 days); a bill with no due_date yet (an old import)
// falls back to its invoice date rather than being dropped.
//
// Buckets follow the standard receivables/payables ladder:
//   not due → 1-30 → 31-60 → 61-90 → 90+ days past due.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type AgeingBuckets = {
  notDue: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
};

export type AgeingRow = AgeingBuckets & {
  partyId: string;
  partyName: string;
  companyId: string;
  companyName: string;
  bills: number;
  /** Total unpaid across every bucket. */
  total: number;
  /** Age (days past due) of the single oldest unpaid bill; 0 when nothing is overdue. */
  oldestDays: number;
  oldestDueDate: string | null;
  contactNo: string | null;
};

export type AgeingResult = {
  rows: AgeingRow[];
  totals: AgeingBuckets & { total: number; bills: number; parties: number };
  /** Highest single balance, used by the digest's "top parties" list. */
  top: AgeingRow[];
  error: string | null;
};

export const AGEING_EMPTY: AgeingResult = {
  rows: [],
  totals: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, bills: 0, parties: 0 },
  top: [],
  error: null,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole days between two YYYY-MM-DD dates (b − a), date-only. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

export function bucketKeyFor(daysPastDue: number): keyof AgeingBuckets {
  if (daysPastDue <= 0) return "notDue";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90plus";
}

/**
 * Loads every unpaid bill in `companyIds` (paged — PostgREST caps a response at
 * 1000 rows and silently truncating would understate the ageing) and rolls it
 * up per (party × company).
 */
export async function loadAgeing(supabase: Client, companyIds: string[], today: string): Promise<AgeingResult> {
  if (companyIds.length === 0) return AGEING_EMPTY;

  type BillRow = {
    party_id: string | null;
    company_id: string;
    invoice_date: string | null;
    due_date: string | null;
    balance_due: number;
  };
  const bills: BillRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await supabase
      .from("bill_pass_register")
      .select("party_id, company_id, invoice_date, due_date, balance_due")
      .in("company_id", companyIds)
      .gt("balance_due", 0)
      .order("due_date", { ascending: true, nullsFirst: true })
      .range(from, from + pageSize - 1);
    if (error) return { ...AGEING_EMPTY, error: error.message };
    for (const r of data ?? []) {
      bills.push({
        party_id: r.party_id,
        company_id: r.company_id,
        invoice_date: r.invoice_date,
        due_date: r.due_date,
        balance_due: Number(r.balance_due ?? 0),
      });
    }
    if (!data || data.length < pageSize) break;
  }

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", companyIds),
    // parties is global (not company-scoped) — one lookup for the names/phones.
    supabase.from("parties").select("id, name, contact_no"),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name] as const));
  const partyById = new Map((parties ?? []).map((p) => [p.id, p] as const));

  const grouped = new Map<string, AgeingRow>();
  for (const b of bills) {
    if (!b.party_id) continue; // salary/advance rows have no vendor party
    const key = `${b.party_id}::${b.company_id}`;
    const party = partyById.get(b.party_id);
    const row =
      grouped.get(key) ??
      ({
        partyId: b.party_id,
        partyName: party?.name ?? "Unknown party",
        companyId: b.company_id,
        companyName: companyName.get(b.company_id) ?? "—",
        contactNo: party?.contact_no ?? null,
        bills: 0,
        total: 0,
        notDue: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90plus: 0,
        oldestDays: 0,
        oldestDueDate: null,
      } satisfies AgeingRow);

    // Age reference: the bill's due date, else its invoice date (legacy rows).
    const ref = b.due_date ?? b.invoice_date;
    const daysPastDue = ref ? daysBetween(ref, today) : 0;
    row[bucketKeyFor(daysPastDue)] += b.balance_due;
    row.bills += 1;
    row.total += b.balance_due;
    if (daysPastDue > row.oldestDays) {
      row.oldestDays = daysPastDue;
      row.oldestDueDate = ref;
    }
    grouped.set(key, row);
  }

  const rows = Array.from(grouped.values())
    .map((r) => ({
      ...r,
      total: round2(r.total),
      notDue: round2(r.notDue),
      d1_30: round2(r.d1_30),
      d31_60: round2(r.d31_60),
      d61_90: round2(r.d61_90),
      d90plus: round2(r.d90plus),
    }))
    .sort((a, b) => b.d90plus - a.d90plus || b.total - a.total || a.partyName.localeCompare(b.partyName));

  const sum = (k: keyof AgeingBuckets) => round2(rows.reduce((s, r) => s + r[k], 0));
  const totals = {
    notDue: sum("notDue"),
    d1_30: sum("d1_30"),
    d31_60: sum("d31_60"),
    d61_90: sum("d61_90"),
    d90plus: sum("d90plus"),
    total: round2(rows.reduce((s, r) => s + r.total, 0)),
    bills: rows.reduce((s, r) => s + r.bills, 0),
    parties: rows.length,
  };

  return { rows, totals, top: [...rows].sort((a, b) => b.total - a.total).slice(0, 5), error: null };
}
