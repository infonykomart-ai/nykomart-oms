"use client";

// 2026-09-15 — show/hide wrapper for the 💳 Wallet panel on Bill Payment.
// Client-side toggle (not a route param) so opening it never loses the
// page's bill filters.

import { useState } from "react";
import { WalletPanel } from "./wallet-panel";
import type { WalletOverview } from "./wallet-actions";

export function WalletSection({ overview, companies }: { overview: WalletOverview; companies: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          open
            ? "rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-300"
            : "rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-500"
        }
      >
        {open ? "✕ Close Wallets" : "💳 Courier Wallets"}
      </button>
      {open && <div className="mt-3"><WalletPanel overview={overview} companies={companies} /></div>}
    </div>
  );
}
