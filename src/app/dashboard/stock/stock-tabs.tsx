"use client";

import { useMemo, useState, useTransition } from "react";
import { StockInForm, type EditableStockIn } from "./stock-in-form";
import { StockOutForm, type EditableStockOut } from "./stock-out-form";
import { deleteStockIn, deleteStockOut } from "./actions";

type Party = { id: string; name: string };
type StockInRow = EditableStockIn & { sourceName: string };
type StockOutRow = EditableStockOut & { sourceName: string };
type CurrentStockRow = {
  source_party_id: string;
  sourceName: string;
  sku_code: string;
  product_name: string | null;
  current_stock: number;
};

const TABS = [
  { key: "stock-in", label: "Stock In" },
  { key: "stock-out", label: "Stock Out" },
  { key: "current-stock", label: "Current Stock" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function StockTabs({
  parties,
  skuOptions,
  recentIn,
  recentOut,
  currentStock,
}: {
  parties: Party[];
  skuOptions: string[];
  recentIn: StockInRow[];
  recentOut: StockOutRow[];
  currentStock: CurrentStockRow[];
}) {
  const [tab, setTab] = useState<TabKey>("stock-in");

  const tabBar = (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTab(t.key)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            tab === t.key ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === "current-stock") {
    return (
      <div>
        {tabBar}
        <CurrentStockTable rows={currentStock} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        {tabBar}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {tab === "stock-in" && <StockInForm parties={parties} skuOptions={skuOptions} />}
          {tab === "stock-out" && <StockOutForm parties={parties} skuOptions={skuOptions} />}
        </div>
      </div>

      <div>
        {tab === "stock-in" && <StockInList rows={recentIn} parties={parties} skuOptions={skuOptions} />}
        {tab === "stock-out" && <StockOutList rows={recentOut} parties={parties} skuOptions={skuOptions} />}
      </div>
    </div>
  );
}

function StockInList({ rows, parties, skuOptions }: { rows: StockInRow[]; parties: Party[]; skuOptions: string[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete Stock In "${label}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteStockIn(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Stock In</h2>
      <div className="space-y-1.5">
        {rows.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <StockInForm parties={parties} skuOptions={skuOptions} row={r} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">{r.sku_code} <span className="font-normal text-slate-400">· {r.sourceName}</span></div>
                  <div className="text-slate-400">{r.product_name || "—"} · Chalan {r.chalan_no ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-700">Qty {r.quantity_in}</div>
                  <div className="text-slate-400">{r.in_date ?? "—"}</div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <p className="text-red-600">{deleteError[r.id]}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(r.id)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(r.id, `${r.sku_code} · ${r.sourceName}`)}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        )}
        {rows.length === 0 && <p className="text-xs text-slate-400">None entered yet.</p>}
      </div>
    </div>
  );
}

function StockOutList({ rows, parties, skuOptions }: { rows: StockOutRow[]; parties: Party[]; skuOptions: string[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete Stock Out "${label}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteStockOut(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Stock Out</h2>
      <div className="space-y-1.5">
        {rows.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <StockOutForm parties={parties} skuOptions={skuOptions} row={r} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">{r.sku_code} <span className="font-normal text-slate-400">· {r.sourceName}</span></div>
                  <div className="text-slate-400">{r.product_name || "—"} · Chalan {r.chalan_no ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-700">Qty {r.quantity_out}</div>
                  <div className="text-slate-400">{r.out_date ?? "—"}</div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <p className="text-red-600">{deleteError[r.id]}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(r.id)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(r.id, `${r.sku_code} · ${r.sourceName}`)}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        )}
        {rows.length === 0 && <p className="text-xs text-slate-400">None entered yet.</p>}
      </div>
    </div>
  );
}

// Old Stock Master's "CURRENT STOCK" — a live SUMIFS(Stock In) -
// SUMIFS(Stock Out), see db/schema.sql's stock_current_view comment. A
// negative number here is a real signal (more Stock Out logged than Stock
// In for that Source+SKU) and is deliberately shown as-is, not clamped —
// same as the old sheet's own formula.
function CurrentStockTable({ rows }: { rows: CurrentStockRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.sku_code.toLowerCase().includes(q) ||
        r.sourceName.toLowerCase().includes(q) ||
        (r.product_name ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <input
          type="text"
          placeholder="Search by SKU, source, product name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <p className="text-sm text-slate-500">
          {filtered.length} of {rows.length} item{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No stock items found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Source</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">SKU Code</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Product Name</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Current Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={`${r.source_party_id}-${r.sku_code}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.sourceName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{r.sku_code}</td>
                  <td className="px-3 py-2 text-slate-600">{r.product_name || "—"}</td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${
                      r.current_stock < 0 ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {r.current_stock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
