"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import type { CelebrationPayload } from "./celebration-context";

const DURATION_MS = 7000;

// Full-screen fireworks — repeated random-position bursts (the classic
// "canvas-confetti fireworks" recipe from its own docs, tuned down in
// particle count so it stays smooth without a dedicated GPU) over a
// dimmed backdrop, with the celebrating person's name (and photo, if on
// file) shown center-stage. Auto-dismisses after DURATION_MS; also
// click-to-dismiss for anyone who wants to get back to work sooner.
export function FireworksOverlay({ celebration, onDone }: { celebration: CelebrationPayload; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
    let cancelled = false;
    const end = Date.now() + DURATION_MS;

    (function frame() {
      if (cancelled) return;
      myConfetti({
        particleCount: 3,
        angle: 60,
        spread: 65,
        origin: { x: 0, y: 0.6 },
        colors: ["#f59e0b", "#ec4899", "#22c55e", "#3b82f6", "#facc15"],
      });
      myConfetti({
        particleCount: 3,
        angle: 120,
        spread: 65,
        origin: { x: 1, y: 0.6 },
        colors: ["#f59e0b", "#ec4899", "#22c55e", "#3b82f6", "#facc15"],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();

    const timer = setTimeout(onDone, DURATION_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBirthday = celebration.kind === "birthday";

  return (
    <div
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-black/70"
      onClick={onDone}
      role="dialog"
      aria-label="Celebration"
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
        {celebration.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={celebration.photoUrl}
            alt={celebration.name}
            className="h-28 w-28 rounded-full border-4 border-amber-400 object-cover shadow-lg"
          />
        )}
        <div className="text-5xl">{isBirthday ? "🎉🎂🎉" : "🎊💍🎊"}</div>
        <h1 className="text-3xl font-bold text-white drop-shadow-lg sm:text-4xl">
          {celebration.name}
        </h1>
        <p className="text-xl font-semibold text-amber-300 drop-shadow sm:text-2xl">
          {isBirthday ? "Happy Birthday!" : "Happy Anniversary!"}
        </p>
        <p className="mt-2 text-xs text-white/60">(Band karne ke liye kahin bhi click karo)</p>
      </div>
    </div>
  );
}
