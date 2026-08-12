"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteParty } from "./actions";
import { PartyForm, type EditableParty } from "./party-form";

export function PartyList({ parties }: { parties: EditableParty[] }) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.party_type ?? "").toLowerCase().includes(q) ||
        (p.contact_no ?? "").toLowerCase().includes(q) ||
        (p.gst ?? "").toLowerCase().includes(q)
    );
  }, [parties, search]);

  function handleDelete(partyId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [partyId]: "" }));
    startTransition(async () => {
      const result = await deleteParty(partyId);
      if (result.error) {
        setDeleteError((prev) => ({ ...prev, [partyId]: result.error! }));
      }
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <input
          type="text"
          placeholder="Search by name, type, contact, GST..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <p className="text-sm text-slate-500">
          {filtered.length} of {parties.length} part{parties.length === 1 ? "y" : "ies"}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No parties found.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {editingId === p.id ? (
                <div className="p-2">
                  <PartyForm party={p} onDone={() => setEditingId(null)} />
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[p.party_type, p.payment_type, p.invoice_type].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {(p.contact_no || p.email) && (
                      <p className="mt-0.5 text-xs text-slate-500">{[p.contact_no, p.email].filter(Boolean).join(" · ")}</p>
                    )}
                    {p.gst && <p className="mt-0.5 text-xs text-slate-400">GST: {p.gst}</p>}
                    {(p.bank_name || p.account_no) && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        🏦 {[p.bank_name, p.account_no, p.ifsc_code].filter(Boolean).join(" · ")}
                        {p.account_holder_name ? ` (${p.account_holder_name})` : ""}
                      </p>
                    )}
                    {deleteError[p.id] && <p className="mt-1 text-xs text-red-600">{deleteError[p.id]}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(p.id)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDelete(p.id, p.name)}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
