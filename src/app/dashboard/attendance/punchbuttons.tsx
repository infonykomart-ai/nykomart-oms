"use client";

import { useActionState } from "react";
import { manualPunchIn, manualPunchOut, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };

export function PunchButtons({ punchedIn, punchedOut }: { punchedIn: boolean; punchedOut: boolean }) {
  const [inState, inAction, inPending] = useActionState(manualPunchIn, initialState);
  const [outState, outAction, outPending] = useActionState(manualPunchOut, initialState);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={inAction}>
        <button
          type="submit"
          disabled={punchedIn || inPending}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {inPending ? "Punching In..." : punchedIn ? "✓ Punched In" : "▶ Punch In"}
        </button>
      </form>
      <form action={outAction}>
        <button
          type="submit"
          disabled={!punchedIn || punchedOut || outPending}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {outPending ? "Punching Out..." : punchedOut ? "✓ Punched Out" : "■ Punch Out"}
        </button>
      </form>
      {inState.error && <p className="text-xs text-red-600">{inState.error}</p>}
      {outState.error && <p className="text-xs text-red-600">{outState.error}</p>}
    </div>
  );
}
