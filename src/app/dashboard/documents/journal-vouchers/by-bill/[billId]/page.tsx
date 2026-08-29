import { redirect, notFound } from "next/navigation";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { ensureJournalVoucherForBill } from "../../../actions";

// 2026-08-29 (evening) — the "🖨 JV" link on Bill Payment rows (see
// bill-payment-list.tsx) points here rather than straight at a Journal
// Voucher id, because most Bill Payment rows don't carry a journal_voucher_
// id in their own query — this looks one up (or lazily creates one, for a
// bill that predates this feature, or where the eager auto-create at "send
// to Bill Pass Register" time somehow didn't run) and redirects straight
// to its report page. See actions.ts's ensureJournalVoucherForBill.
export default async function JournalVoucherByBillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  try {
    const jvId = await ensureJournalVoucherForBill(billId);
    if (!jvId) notFound();
    redirect(`/dashboard/documents/journal-vouchers/${jvId}/report`);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Access Denied</p>
          <p className="mt-1">{err.message}</p>
        </div>
      );
    }
    throw err;
  }
}
