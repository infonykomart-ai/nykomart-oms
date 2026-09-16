// 2026-09-15 — "ek chij ho jaye agar invoice no par click kar ke uski puri
// entry dekhni ho to usme read only form open ho jaye jiska print kiya ja
// sake whatsapp bhej ja sake" — the Party Ledger's INVOICE NO. cell links
// here: a full-page READ-ONLY bill statement. All data loading and access
// checking now lives in loadBillStatement() (src/lib/bill-statement.ts) —
// the same single access gate behind /api/bill-statement/[billId] and the
// BillStatementDialog shared by Bill Payment / Documents — and the
// document + action bar are the shared components
// (BillStatementDocument / BillStatementActions in src/components/), so
// every surface renders byte-identical statements.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { loadBillStatement } from "@/lib/bill-statement";
import { BillStatementDocument } from "@/components/bill-statement-document";
import { BillStatementActions } from "@/components/bill-statement-actions";

export default async function LedgerBillStatementPage({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const { id: partyId, billId } = await params;
  await requireCapability("bill_payment");

  const result = await loadBillStatement(billId);
  // 404 covers both "no such bill" and "not this party's bill" (the ledger
  // page is per-party; the loader is per-bill — a mismatched id pair is a
  // wrong URL, same response either way, no data leak via status codes).
  if (!result.ok) notFound();
  const data = result.data;
  if (data.party.id !== partyId) notFound();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/parties/${partyId}/ledger`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← Back to Party Ledger
        </Link>
        <BillStatementActions data={data} />
      </div>

      <BillStatementDocument data={data} />
    </div>
  );
}
