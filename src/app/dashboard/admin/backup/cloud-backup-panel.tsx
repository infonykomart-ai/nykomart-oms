"use client";

import { useState, useTransition } from "react";
import { runBackupNow } from "./actions";

// "Run a backup now" (2026-10-23) — the manual twin of the weekly GitHub
// Actions job, for the week it didn't run (scheduler hiccup, deploy down) or
// before a risky change. Calls the exact same server pipeline as the cron
// route, so a manual run and a scheduled run are byte-for-byte the same kind
// of snapshot.
export function CloudBackupButton({ disabled }: { disabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function run() {
    setNotice("Building the snapshot — this can take up to a minute for a full history…");
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await runBackupNow();
        setFailed(!result.ok);
        setNotice(result.message);
      } catch (err) {
        setFailed(true);
        setNotice(err instanceof Error ? err.message : "Backup failed — please try again.");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={isPending || disabled}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Backing up…" : "☁️ Run backup now"}
      </button>
      {notice && (
        <p className={`mt-2 text-xs ${failed ? "text-red-600" : "text-slate-500"}`}>{notice}</p>
      )}
    </div>
  );
}
