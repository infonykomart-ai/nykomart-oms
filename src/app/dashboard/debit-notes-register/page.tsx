import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { NoteRegisterExportBar } from "@/components/note-register-export-bar";
import { formatISTShort } from "@/lib/format-ist";
import { fyOptions, fyStartYear } from "@/lib/fy-date";
import { inFy, matchesQuery, parseFyParam, selectionLabel } from "@/lib/notes/register-filter";

// Debit Note Register — 2026-10-29b.
//
// "Full list of every Debit Note ... KAHA SE PRINT HONGE LIST BHI SHOW NAHI HO
// RAHI" — Debit Notes existed only as a flat "Recent Debit Notes" list inside
// Document Entry: no register, no per-party total, no way to print the list.
// Credit Notes got a register in September; Debit Notes never did, so the two
// sides of the same CN/DN story were visible in completely different places.
//
// This page mirrors the Credit Note Register exactly:
//   1. One block per party with every debit note of the selected company(ies)
//      and its own total, grand total on top;
//   2. The whole page prints as an A4 list (PrintArea/PrintButton) — a register
//      is something Finance files, not something you screenshot;
//   3. Each DN number opens that note's own printed sheet (the full letterhead
//      one in documents/debit-notes/[id]/report).
export default async function DebitNotesRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  // Same company-select pattern as Bill Payment / Credit Note Register: the
  // top-nav switcher by default, ?company= (including an explicit blank = all
  // my companies) overrides.
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyParam ? [companyParam] : companyParamPresent ? employee.companyIds : [employee.currentCompanyId];

  const [{ data: companies }, { data: notes }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("debit_notes")
      .select("id, company_id, debit_note_no, debit_note_date, party_id, against_invoice_bill_no, bill_no, total_amount, remark, created_at, bill_pass_register_id")
      .in("company_id", effectiveCompanyIds)
      .order("debit_note_date", { ascending: false }),
    supabase.from("parties").select("id, name"),
  ]);

  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  // 2026-10-29j — FY + search (mirrors the Credit Note Register). Everything
  // below — groups, totals, print, downloads — reads `filteredNotes`, so one
  // selection describes them all.
  const fyParam = typeof sp.fy === "string" ? sp.fy : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const fy = parseFyParam(fyParam);
  const filteredNotes = (notes ?? []).filter(
    (n) =>
      inFy(n.debit_note_date, fy) &&
      matchesQuery(
        [
          n.debit_note_no,
          n.against_invoice_bill_no,
          n.bill_no,
          n.remark,
          n.party_id ? partyName.get(n.party_id) : null,
        ],
        q
      )
  );
  const fyChoices = fyOptions(
    (notes ?? []).map((n) => fyStartYear(n.debit_note_date)).sort((a, b) => a - b)[0] ?? null
  );
  const companyName = companyParam && companies ? companies.find((c) => c.id === companyParam)?.name ?? null : null;
  const selection = selectionLabel({ companyName, fy, q });

  // Which finance-ledger invoice each note was raised against — the note table
  // only carries bill_pass_register_id, so the invoice number is one batched
  // lookup rather than a per-row query.
  const billIds = Array.from(new Set((notes ?? []).map((n) => n.bill_pass_register_id).filter((v): v is string => !!v)));
  const { data: billRows } = billIds.length
    ? await supabase.from("bill_pass_register").select("id, invoice_no, vendor_invoice_no").in("id", billIds)
    : { data: [] as { id: string; invoice_no: string | null; vendor_invoice_no: string | null }[] };
  const invoiceByBillId = new Map((billRows ?? []).map((b) => [b.id, b.vendor_invoice_no ?? b.invoice_no ?? "—"]));

  type NoteRow = {
    id: string;
    debit_note_no: string | null;
    debit_note_date: string;
    against_invoice_bill_no: string | null;
    bill_no: string | null;
    linkedInvoice: string | null;
    total_amount: number;
    remark: string | null;
    created_at: string;
  };
  const groups = new Map<string, { partyId: string | null; partyName: string; notes: NoteRow[]; total: number }>();
  for (const n of filteredNotes) {
    const key = n.party_id ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        partyId: n.party_id,
        partyName: n.party_id ? partyName.get(n.party_id) ?? "—" : "(No party)",
        notes: [],
        total: 0,
      });
    }
    const g = groups.get(key)!;
    const total = Number(n.total_amount ?? 0);
    g.notes.push({
      id: n.id,
      debit_note_no: n.debit_note_no,
      debit_note_date: n.debit_note_date,
      against_invoice_bill_no: n.against_invoice_bill_no,
      bill_no: n.bill_no,
      linkedInvoice: n.bill_pass_register_id ? invoiceByBillId.get(n.bill_pass_register_id) ?? null : null,
      total_amount: total,
      remark: n.remark,
      created_at: n.created_at,
    });
    g.total += total;
  }
  const groupList = Array.from(groups.values()).sort((a, b) => b.total - a.total);
  const grandTotal = groupList.reduce((s, g) => s + g.total, 0);
  const noteCount = groupList.reduce((s, g) => s + g.notes.length, 0);
  const exportRows = groupList.flatMap((g) =>
    g.notes.map((n) => ({
      party: g.partyName,
      note_no: n.debit_note_no ?? "",
      kind: "Debit Note",
      date: n.debit_note_date,
      invoice: n.against_invoice_bill_no ?? n.bill_no ?? n.linkedInvoice ?? "",
      orders: "",
      remark: n.remark ?? "",
      amount: n.total_amount,
    }))
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📉 Debit Note Register</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every debit note we raised, party by party, with its total — and the sheet it prints from.{" "}
            <Link href="/dashboard/credit-notes-register" className="font-medium text-teal-700 underline hover:text-teal-800">
              🧾 Credit Note Register →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <NoteRegisterExportBar
            title={`Debit Note Register — ${selection}`}
            filenameBase={`debit-notes-register${fy ? `-fy-${fy.label}` : ""}`}
            rows={exportRows}
            printAreaId="debit-notes-register-area"
          />
          <PrintButton label="🖨 Print / PDF list" />
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">
                Company
              </label>
              <select
                id="company"
                name="company"
                defaultValue={companyParamPresent ? companyParam : employee.currentCompanyId}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
              >
                <option value="">All</option>
                {(companies ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fy">
                Financial year
              </label>
              <select
                id="fy"
                name="fy"
                defaultValue={fy?.label ?? ""}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
              >
                <option value="">All</option>
                {fyChoices.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
                Search
              </label>
              <input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="party / DN no. / invoice"
                className="w-48 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
              />
            </div>
            <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
              Filter
            </button>
            {(fy || q) && (
              <Link
                href={`/dashboard/debit-notes-register?company=${companyParam}`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </Link>
            )}
          </form>
        </div>
      </div>

      <PrintArea id="debit-notes-register-area">
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          Total debit raised: ₹{grandTotal.toFixed(2)} — {noteCount} note{noteCount === 1 ? "" : "s"} across {groupList.length} part
          {groupList.length === 1 ? "y" : "ies"}
          {/* Which selection this printed sheet covers — FY / search / company. */}
          <span className="mt-0.5 block text-[11px] font-normal text-rose-700">{selection}</span>
        </div>

        <div className="space-y-4">
          {groupList.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
              No debit notes yet for this selection.
            </div>
          )}
          {groupList.map((g) => (
            // always open — a closed <details> prints nothing, and this page
            // exists to be printed as one list
            <details key={g.partyId ?? "__none__"} className="rounded-xl border border-slate-200 bg-white" open>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-semibold text-slate-800">
                  {g.partyName}{" "}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    ({g.notes.length} note{g.notes.length === 1 ? "" : "s"})
                  </span>
                </span>
                <span className="text-sm font-bold text-rose-700">₹{g.total.toFixed(2)}</span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="min-w-full divide-y divide-slate-100 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">DN No.</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Entered</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Against Invoice</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Bill in Finance</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-500">Remark</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500">Amount</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-500 print:hidden">Print</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.notes.map((n) => (
                      <tr key={n.id}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{n.debit_note_no ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.debit_note_date}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-slate-400">{formatISTShort(n.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                          {n.against_invoice_bill_no ?? n.bill_no ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.linkedInvoice ?? "—"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{n.remark ?? ""}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-slate-800">
                          ₹{n.total_amount.toFixed(2)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right print:hidden">
                          <Link
                            href={`/dashboard/documents/debit-notes/${n.id}/report`}
                            target="_blank"
                            className="rounded border border-rose-300 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-50"
                          >
                            🖨 Sheet
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-slate-800" colSpan={6}>
                        Total — {g.partyName}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-800">₹{g.total.toFixed(2)}</td>
                      <td className="print:hidden" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          ))}
        </div>

        {groupList.length > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
            <span>Grand total — {noteCount} debit note{noteCount === 1 ? "" : "s"}</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>
        )}
      </PrintArea>
    </div>
  );
}
