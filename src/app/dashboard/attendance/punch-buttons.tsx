"use client";

import { useActionState, startTransition, useState } from "react";
import { manualPunchIn, manualPunchOut, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };

// 2026-10-02 — TeamOffice parity: the punch buttons ask the browser for a
// one-shot geolocation fix (stored into attendance.punch_in/out_lat,lng →
// Location/GPS reports). Strictly best-effort by contract: denied
// permission, unsupported browser or a slow fix all resolve to null and
// the punch proceeds WITHOUT coordinates — GPS can never block a punch.
// maximumAge 60s lets a cached fix answer instantly (no prompt round-trip
// on every punch); timeout 5s caps the worst case.
async function geolocationBestEffort(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 }
      );
    } catch {
      resolve(null);
    }
  });
}

export function PunchButtons({ punchedIn, punchedOut }: { punchedIn: boolean; punchedOut: boolean }) {
  const [inState, inAction, inPending] = useActionState(manualPunchIn, initialState);
  const [outState, outAction, outPending] = useActionState(manualPunchOut, initialState);
  // "Waiting for location fix" — shown between the click and the action
  // dispatch so the button never looks dead while geolocation resolves.
  const [locating, setLocating] = useState<"in" | "out" | null>(null);

  async function fire(kind: "in" | "out") {
    setLocating(kind);
    try {
      const geo = await geolocationBestEffort();
      const fd = new FormData();
      if (geo) {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
      }
      startTransition(() => (kind === "in" ? inAction : outAction)(fd));
    } finally {
      setLocating(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={punchedIn || inPending || locating !== null}
        onClick={() => fire("in")}
        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {locating === "in" ? "📍 Locating..." : inPending ? "Punching In..." : punchedIn ? "✓ Punched In" : "▶ Punch In"}
      </button>
      <button
        type="button"
        disabled={!punchedIn || punchedOut || outPending || locating !== null}
        onClick={() => fire("out")}
        className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {locating === "out" ? "📍 Locating..." : outPending ? "Punching Out..." : punchedOut ? "✓ Punched Out" : "■ Punch Out"}
      </button>
      {inState.error && <p className="text-xs text-red-600">{inState.error}</p>}
      {outState.error && <p className="text-xs text-red-600">{outState.error}</p>}
    </div>
  );
}
