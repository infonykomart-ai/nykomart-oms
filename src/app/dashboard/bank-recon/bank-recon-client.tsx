"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  importStatement,
  saveReconAccount,
  deactivateReconAccount,
  verifySuggestion,
  unlinkLine,
  rerunAutoMatch,
  type AccountFormState,
  type ImportState,
} from "./actions";

export type ReconAccount = {
  id: string;
  company_id: string;
  company_name: string;
  account_type: string;
  account_name: string;
  bank_name: string | null;
  account_number: string | null;
  card_label: string | null;
  statement_kind: string;
  company_share_pct: number | null;
  opening_balance: number | null;
  active: boolean;
  notes: string | null;
};

export type StatementRow = {
  id: string;
  txn_date: string | null;
  description: string | null;
  ref_no: string | null;
  txn_no: string | null;
  cheque_no: string | null;
  dr_amount: number | null;
  cr_amount: number | null;
  balance: number | null;
  recon_status: string;
  match_method: string | null;
  linked_reference: string | null;
  linked_at: string | null;
};

export type PartyOption = { id: string; name: string };
export type ExpenseOption = { id: string; label: string; company_id: string };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function BankReconClient({
  companies,
  accounts,
  selectedAccountId,
  rows,
  totals,
  parties,
  expenses,
}: {
  companies: { id: string; name: string }[];
  accounts: ReconAccount[];
  selectedAccountId: string | null;
  rows: StatementRow[];
  totals: { total: number; linked: number; suggested: number; unmatched: number; creditSum: number; debitSum: number };
  parties: PartyOption[];
  expenses: ExpenseOption[];
}) {
  const [accountId, setAccountId] = useState<string | null>(selectedAccountId);
  const selected = accounts.find((a) => a.id === accountId) ?? null;

  const [tab, setTab] = useState<"unlinked" | "suggested" | "linked" | "all">("unlinked");
  const [dialogRow, setDialogRow] = useState<StatementRow | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(accounts.length === 0);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    const want = tab === "unlinked" ? "unmatched" : tab === "suggested" ? "suggested" : "linked";
    return rows.filter((r) => r.recon_status === want);
  }, [rows, tab]);

  async function handleRerun() {
    if (!accountId) return;
    setRerunning(true);
    setRerunMsg(null);
    try {
      const res = await rerunAutoMatch(accountId);
      setRerunMsg(res.error ?? `✓ ${res.autoLinked} auto-linked, ${res.pending} suggestion(s) pending verify.`);
      if (!res.error) setTab("suggested");
    } finally {
      setRerunning(false);
    }
  }

  const statusBadge = (r: StatementRow) => {
    if (r.recon_status === "linked") return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">LINKED ✓</span>;
    if (r.recon_status === "suggested") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">SUGGESTED</span>;
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">UNLINKED</span>;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🏦 Bank &amp; Card Reconciliation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add every bank account and credit card, upload each statement (any bank&apos;s format auto-maps), and the system
          matches UTR / reference / invoice / party / store payout — old payments are never touched. Nothing gets
          double-counted: re-uploading the same statement is detected and skipped.
        </p>
      </div>

      {/* Accounts strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAccountId(a.id)}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
              a.id === accountId
                ? "border-amber-500 bg-amber-50 shadow-sm"
                : a.active
                  ? "border-slate-200 bg-white hover:border-slate-300"
                  : "border-slate-100 bg-slate-50 opacity-60"
            }`}
          >
            <div className="font-semibold text-slate-800">
              {a.account_type === "card" ? "💳" : "🏦"} {a.account_name}
            </div>
            <div className="text-slate-500">
              {a.company_name}
              {a.account_number ? ` · ··${a.account_number.slice(-4)}` : ""}
              {!a.active ? " · inactive" : ""}
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAccounts((v) => !v)}
          className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-amber-400 hover:text-amber-600"
        >
          {showAccounts ? "✕ Close" : "+ Add / manage account"}
        </button>
      </div>

      {showAccounts && (
        <AccountsPanel companies={companies} accounts={accounts} onDeactivate={deactivateReconAccount} />
      )}

      {selected && (
        <>
          {/* Totals */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Money in (credits)</div>
              <div className="text-lg font-semibold text-green-700">{inr(totals.creditSum)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Money out (debits)</div>
              <div className="text-lg font-semibold text-red-700">{inr(totals.debitSum)}</div>
            </div>
            {selected.account_type === "card" ? (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Card outstanding (spend − payments)</div>
                <div className={`text-lg font-semibold ${totals.debitSum - totals.creditSum > 0 ? "text-amber-700" : "text-green-700"}`}>
                  {inr(totals.debitSum - totals.creditSum)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Rows</div>
                <div className="text-lg font-semibold text-slate-800">{totals.total}</div>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Linked / suggested / unlinked</div>
              <div className="text-lg font-semibold text-slate-800">
                <span className="text-green-700">{totals.linked}</span> / <span className="text-amber-700">{totals.suggested}</span> /{" "}
                <span className="text-slate-500">{totals.unmatched}</span>
              </div>
            </div>
          </div>

          <UploadPanel accountId={selected.id} />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRerun}
              disabled={rerunning}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {rerunning ? "Matching..." : "🔁 Re-run auto match"}
            </button>
            {rerunMsg && <span className="text-xs text-slate-600">{rerunMsg}</span>}
          </div>

          {/* Tabs */}
          <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {(["unlinked", "suggested", "linked", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  tab === t ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t} {t === "unlinked" ? `(${totals.unmatched})` : t === "suggested" ? `(${totals.suggested})` : t === "linked" ? `(${totals.linked})` : `(${totals.total})`}
              </button>
            ))}
          </div>

          {/* Statement table */}
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Narration / UTR</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Matched to</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Nothing here — {tab === "unlinked" ? "every row is matched 🎉" : `no ${tab} rows.`}
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.txn_date ?? "—"}</td>
                    <td className="max-w-[320px] px-3 py-2">
                      <div className="truncate text-slate-800" title={r.description ?? ""}>
                        {r.description ?? "—"}
                      </div>
                      {(r.ref_no || r.txn_no) && (
                        <div className="truncate text-[10px] text-slate-400" title={r.ref_no ?? r.txn_no ?? ""}>
                          Ref: {r.ref_no ?? r.txn_no}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-red-700">
                      {r.dr_amount != null ? inr(Number(r.dr_amount)) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-green-700">
                      {r.cr_amount != null ? inr(Number(r.cr_amount)) : "—"}
                    </td>
                    <td className="px-3 py-2">{statusBadge(r)}</td>
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="truncate text-slate-600" title={r.linked_reference ?? ""}>
                        {r.linked_reference ?? (r.recon_status === "suggested" ? "Click Verify to see the suggestion" : "—")}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.recon_status === "linked" ? (
                        <form action={unlinkLine}>
                          <input type="hidden" name="line_id" value={r.id} />
                          <button type="submit" className="text-[11px] font-semibold text-slate-400 hover:text-red-600">
                            Unlink
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDialogRow(r)}
                          className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-600"
                        >
                          {r.recon_status === "suggested" ? "Verify ✓" : "Link"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length >= 600 && (
            <p className="mt-2 text-[11px] text-slate-400">Showing the latest 600 rows — use the tabs to narrow down.</p>
          )}

          {dialogRow && (
            <LinkDialog
              row={dialogRow}
              parties={parties}
              expenses={expenses}
              onClose={() => setDialogRow(null)}
            />
          )}
        </>
      )}

      {!selected && !showAccounts && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
          Add your first bank account or credit card above to begin.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts add/edit panel
// ---------------------------------------------------------------------------

function AccountsPanel({
  companies,
  accounts,
  onDeactivate,
}: {
  companies: { id: string; name: string }[];
  accounts: ReconAccount[];
  onDeactivate: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(saveReconAccount, { error: null, success: false } as AccountFormState);
  const [type, setType] = useState<"bank" | "card">("bank");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="space-y-3">
      {accounts.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Bank / Card</th>
                <th className="px-3 py-2">Company share %</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {a.account_name}
                    <span className="ml-1 text-slate-400">({a.company_name})</span>
                  </td>
                  <td className="px-3 py-2">{a.account_type === "card" ? "💳 Card" : "🏦 Bank"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {a.bank_name ?? a.card_label ?? "—"}
                    {a.account_number ? ` · ··${a.account_number.slice(-4)}` : ""}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{a.company_share_pct != null ? `${a.company_share_pct}%` : "100%"}</td>
                  <td className="px-3 py-2">{a.active ? "✅" : "— inactive"}</td>
                  <td className="px-3 py-2 text-right">
                    {a.active && (
                      <form action={onDeactivate}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="text-[11px] font-semibold text-slate-400 hover:text-red-600">
                          Deactivate
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-400">
          Add as many bank accounts and credit cards as you have — each keeps its own statements, its own column mapping and its
          own outstanding summary. Company share % splits a joint/personal account&apos;s money across companies (defaults to 100%).
        </p>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Account saved.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="account_company">Company *</label>
            <select id="account_company" name="company_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>Select company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="account_type">Type *</label>
            <select id="account_type" name="account_type" value={type} onChange={(e) => setType(e.target.value === "card" ? "card" : "bank")} className={inputClass}>
              <option value="bank">Bank account</option>
              <option value="card">Credit card</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="account_name">Account name *</label>
            <input id="account_name" name="account_name" required placeholder={type === "card" ? "e.g. HDFC Business Card" : "e.g. PNB Current A/c"} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="bank_name">{type === "card" ? "Card network / issuer" : "Bank name"}</label>
            <input id="bank_name" name="bank_name" placeholder={type === "card" ? "e.g. Visa / ICICI" : "e.g. PNB"} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="card_label">{type === "card" ? "Card label" : "Card label (if linked)"}</label>
            <input id="card_label" name="card_label" placeholder="e.g. Etsy-bill card" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="account_number">Account / card no. (last 4 is shown)</label>
            <input id="account_number" name="account_number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="company_share_pct">Company share % (0–100)</label>
            <input id="company_share_pct" name="company_share_pct" type="number" min="0" max="100" step="0.5" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="opening_balance">Opening balance (+ / −)</label>
            <input id="opening_balance" name="opening_balance" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="notes">Notes</label>
            <input id="notes" name="notes" className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save account"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload panel
// ---------------------------------------------------------------------------

const importInitial: ImportState = {
  error: null, success: false, imported: null, duplicates: null, skipped: null,
  accountEcho: null, newMappings: null, matchedExact: null, suggestions: null, batchId: null,
};

function UploadPanel({ accountId }: { accountId: string }) {
  const [state, formAction, pending] = useActionState(importStatement, importInitial);
  const formRef = useRef<HTMLFormElement>(null);
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);
  // the skipped-rows panel toggles only via its own button — a fresh upload
  // replaces the state object, so the old list simply stops being relevant.

  return (
    <div className="mt-4 space-y-2">
      <form ref={formRef} action={formAction} className="rounded-xl border border-slate-200 bg-white p-4">
        <input type="hidden" name="account_id" value={accountId} />
        <p className="mb-2 text-xs text-slate-400">
          Upload the bank/card&apos;s own CSV or Excel export — columns are detected automatically (Date / Narration / Ref-UTR /
          Debit / Credit / Balance, any naming). A single-amount card statement: pick which side the Amount column means.
          Re-uploading the same statement never double-counts.
        </p>
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            ✓ {state.imported ?? 0} row(s) imported
            {state.duplicates ? ` · ${state.duplicates} duplicate row(s) skipped` : ""}
            {state.matchedExact ? ` · ${state.matchedExact} auto-linked` : ""}
            {state.suggestions ? ` · ${state.suggestions} suggestion(s) need your Verify` : ""}
            {state.skipped && state.skipped.length > 0 && (
              <> · <button type="button" className="underline" onClick={() => setShowSkip((v) => !v)}>{state.skipped.length} row(s) could not be read</button></>
            )}
          </div>
        )}
        {showSkip && state.skipped && (
          <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {state.skipped.map((s) => (
              <p key={s.row}>Row {s.row}: {s.reason}</p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <select name="amount_direction" defaultValue="auto" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900">
            <option value="auto">Auto-detect Debit/Credit columns</option>
            <option value="deposit">Single Amount column = money IN</option>
            <option value="withdrawal">Single Amount column = money OUT (card spend)</option>
          </select>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Uploading & matching..." : "Upload statement"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verify / manual-link dialog
// ---------------------------------------------------------------------------

function LinkDialog({
  row,
  parties,
  expenses,
  onClose,
}: {
  row: StatementRow;
  parties: PartyOption[];
  expenses: ExpenseOption[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"party" | "expense">("party");
  const amount = Number(row.cr_amount ?? row.dr_amount ?? 0);
  const [partyQuery, setPartyQuery] = useState("");
  const partyMatches = useMemo(() => {
    const q = partyQuery.trim().toLowerCase();
    if (!q) return parties.slice(0, 30);
    return parties.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 30);
  }, [parties, partyQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Link this {row.cr_amount != null ? "credit" : "debit"}</h3>
            <p className="text-xs text-slate-500">
              {row.txn_date ?? "—"} · {amount ? inr(amount) : "—"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs">
          <p className="text-slate-700" title={row.description ?? ""}>
            <span className="font-semibold">Narration:</span> {row.description ?? "—"}
          </p>
          {(row.ref_no || row.txn_no) && (
            <p className="mt-1 text-slate-500"><span className="font-semibold">Ref/UTR:</span> {row.ref_no ?? row.txn_no}</p>
          )}
        </div>

        {row.recon_status === "suggested" && row.linked_reference && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">System suggestion:</p>
            <p className="mt-0.5">{row.linked_reference}</p>
            <form action={verifySuggestion} className="mt-2">
              <input type="hidden" name="line_id" value={row.id} />
              <input type="hidden" name="target_type" value={guessTargetType(row.match_method, row.linked_reference)} />
              <input type="hidden" name="target_id" value={guessTargetId(row.linked_reference)} />
              <input type="hidden" name="target_label" value={row.linked_reference} />
              <input type="hidden" name="matched_amount" value={amount} />
              <button type="submit" className="rounded-md bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-600">
                ✓ Verify &amp; link this
              </button>
            </form>
          </div>
        )}

        <div className="mb-2 flex gap-1">
          {(["party", "expense"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === m ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {m === "party" ? "Link to Party / Bill payment" : "Link to Office/Card expense"}
            </button>
          ))}
        </div>

        {mode === "party" ? (
          <div>
            <input
              value={partyQuery}
              onChange={(e) => setPartyQuery(e.target.value)}
              placeholder="Search party by name…"
              className={inputClass}
            />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {partyMatches.map((p) => (
                <form key={p.id} action={verifySuggestion}>
                  <input type="hidden" name="line_id" value={row.id} />
                  <input type="hidden" name="target_type" value="bill_payment" />
                  <input type="hidden" name="target_id" value={`party:${p.id}`} />
                  <input type="hidden" name="target_label" value={`Party: ${p.name}`} />
                  <input type="hidden" name="matched_amount" value={amount} />
                  <button type="submit" className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-left text-xs text-slate-700 hover:border-amber-400 hover:bg-amber-50">
                    🤝 {p.name}
                  </button>
                </form>
              ))}
              {partyMatches.length === 0 && <p className="text-xs text-slate-400">No party found — add it in Party Master first.</p>}
            </div>
          </div>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {expenses.map((e) => (
              <form key={e.id} action={verifySuggestion}>
                <input type="hidden" name="line_id" value={row.id} />
                <input type="hidden" name="target_type" value="card_expense" />
                <input type="hidden" name="target_id" value={e.id} />
                <input type="hidden" name="target_label" value={e.label} />
                <input type="hidden" name="matched_amount" value={amount} />
                <button type="submit" className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-left text-xs text-slate-700 hover:border-amber-400 hover:bg-amber-50">
                  🧾 {e.label}
                </button>
              </form>
            ))}
            {expenses.length === 0 && <p className="text-xs text-slate-400">No office expenses recorded yet.</p>}
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-400">
          Linking only marks THIS statement row — the party&apos;s ledger, bills and expenses stay exactly as they are.
        </p>
      </div>
    </div>
  );
}

// The suggestion row only carries a label + method on the line itself;
// derive the target type/id for the Verify submit from what the auto-run
// stored (match_method ':' score + label prefix).
function guessTargetType(matchMethod: string | null, label: string): string {
  if (matchMethod === "order_no" || label.startsWith("Order ")) return "order_sale";
  if (label.startsWith("Salary")) return "salary_payment";
  if (label.startsWith("Party:")) return "bill_payment";
  return "bill_payment";
}
function guessTargetId(label: string): string {
  // fallback when the suggestion came from the auto-run: labels starting
  // with "Party:" carry the party id inline as "Party: <name>" — those
  // resolve as a party-only link, others keep the label as the id.
  return label.startsWith("Party:") ? `party:${label.slice("Party: ".length)}` : label;
}
