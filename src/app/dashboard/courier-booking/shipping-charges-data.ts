// 2026-10-24 — loader for the Courier Ops "Charges" tab.
//
// Tolerant by design, same convention as the rest of the app's newest
// migrations: the table is optional, so if db/2026-10-24-shipment-charge-
// lines.sql has not been run yet the tab shows a "run this SQL" notice
// instead of a 500. Nothing else in the app depends on this table, so a
// missing migration degrades exactly one new screen.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type ChargeLine = {
  id: string;
  chargeHead: string;
  amount: number;
  gstPct: number;
  gst: number;
  total: number;
  billNo: string | null;
  billDate: string | null;
  remark: string | null;
  createdAt: string;
  enteredBy: string | null;
};

export type ChargeGroup = {
  key: string;
  orderId: string;
  refNo: string;
  awbNo: string | null;
  courier: string;
  direction: string;
  lines: ChargeLine[];
  amount: number;
  gst: number;
  total: number;
};

export type ShippingChargeData = {
  available: boolean;
  /** Set when the table exists but the read still failed. */
  error: string | null;
  groups: ChargeGroup[];
  totals: { amount: number; gst: number; total: number; count: number };
};

type RawLine = {
  id: string;
  order_id: string;
  awb_no: string | null;
  courier_name: string;
  direction: string;
  charge_head: string;
  amount: number;
  gst_pct: number;
  gst_amt: number | null;
  total_amt: number | null;
  bill_no: string | null;
  bill_date: string | null;
  remark: string | null;
  created_at: string;
  entered_by_name: string | null;
  orders: { ref_no: string; company_id: string } | null;
};

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find the table");
}

export async function getShippingChargeData(supabase: Client, companyIds: string[]): Promise<ShippingChargeData> {
  const empty: ShippingChargeData = {
    available: true,
    error: null,
    groups: [],
    totals: { amount: 0, gst: 0, total: 0, count: 0 },
  };
  if (companyIds.length === 0) return empty;

  const { data, error } = await supabase
    .from("shipment_charge_lines")
    .select(
      "id, order_id, awb_no, courier_name, direction, charge_head, amount, gst_pct, gst_amt, total_amt, bill_no, bill_date, remark, created_at, entered_by_name, orders!inner(ref_no, company_id)"
    )
    .in("orders.company_id", companyIds)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    if (isMissingTable(error.message)) return { ...empty, available: false };
    return { ...empty, error: error.message };
  }

  const rows = (data ?? []) as unknown as RawLine[];
  const groups = new Map<string, ChargeGroup>();
  let amountTotal = 0;
  let gstTotal = 0;
  let grossTotal = 0;

  for (const r of rows) {
    // Group by shipment: same order + AWB + direction is one shipment's own
    // cost sheet. A charge recorded before an AWB existed (no AWB) still
    // groups per order, so nothing appears twice.
    const key = `${r.order_id}::${r.awb_no ?? "no-awb"}::${r.direction}`;
    const group =
      groups.get(key) ??
      ({
        key,
        orderId: r.order_id,
        refNo: r.orders?.ref_no ?? "—",
        awbNo: r.awb_no,
        courier: r.courier_name,
        direction: r.direction,
        lines: [],
        amount: 0,
        gst: 0,
        total: 0,
      } satisfies ChargeGroup);

    const amount = Number(r.amount ?? 0);
    const gst = Number(r.gst_amt ?? 0);
    const total = Number(r.total_amt ?? amount + gst);
    group.lines.push({
      id: r.id,
      chargeHead: r.charge_head,
      amount,
      gstPct: Number(r.gst_pct ?? 0),
      gst,
      total,
      billNo: r.bill_no,
      billDate: r.bill_date,
      remark: r.remark,
      createdAt: r.created_at,
      enteredBy: r.entered_by_name,
    });
    group.amount += amount;
    group.gst += gst;
    group.total += total;
    groups.set(key, group);

    amountTotal += amount;
    gstTotal += gst;
    grossTotal += total;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const list = Array.from(groups.values())
    .map((g) => ({ ...g, amount: round(g.amount), gst: round(g.gst), total: round(g.total) }))
    .sort((a, b) => (a.refNo === b.refNo ? (a.awbNo ?? "").localeCompare(b.awbNo ?? "") : a.refNo.localeCompare(b.refNo, undefined, { numeric: true })));

  return {
    available: true,
    error: null,
    groups: list,
    totals: { amount: round(amountTotal), gst: round(gstTotal), total: round(grossTotal), count: rows.length },
  };
}
