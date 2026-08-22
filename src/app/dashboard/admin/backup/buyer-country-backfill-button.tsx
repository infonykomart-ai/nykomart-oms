"use client";

import { useState, useTransition } from "react";
import { backfillBuyerCountry } from "./actions";

// Buyer Country Backfill (2026-08-22) — see actions.ts's header comment.
// One click drives the whole backlog: each click of "run the batch" loop
// below fires one bounded server-side batch and, if `remaining` is still
// > 0, immediately fires the next one — so from here it still reads as a
// single button, even though the server does it in safe chunks.
export function BuyerCountryBackfillButton() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function run() {
    setDone(false);
    setStatus(null);
    startTransition(async () => {
      let totalProcessed = 0;
      let totalMatched = 0;
      for (;;) {
        const result = await backfillBuyerCountry();
        if (result.error) {
          setStatus(`Stopped after an error: ${result.error}`);
          return;
        }
        totalProcessed += result.processedThisBatch;
        totalMatched += result.matchedThisBatch;
        setStatus(`${totalProcessed} order(s) processed so far (${totalMatched} matched to a country)…`);
        if (result.processedThisBatch === 0 || result.remaining === 0) {
          setDone(true);
          setStatus(
            totalProcessed === 0
              ? "Nothing to backfill — every order with an address already has a country."
              : `Done — ${totalProcessed} order(s) processed, ${totalMatched} matched to a country (${totalProcessed - totalMatched} had no confidently-resolvable country in their address).`
          );
          return;
        }
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Backfilling…" : done ? "🌍 Run Again" : "🌍 Backfill Buyer Country"}
      </button>
      {status && <p className="mt-2 text-xs text-slate-500">{status}</p>}
    </div>
  );
}
