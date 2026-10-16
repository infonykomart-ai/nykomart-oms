"use client";

import { useEffect, useRef, useState } from "react";

// 2026-10-16 — Count-up stat for the landing hero strip. Counts once, when
// the number first scrolls into view, using requestAnimationFrame (never a
// timer per tick); renders the final value immediately under
// prefers-reduced-motion so the number is never mid-count for those users.
//
// 2026-10-17 — the state starts at the FINAL value, not 0. Starting at 0
// meant the server-rendered HTML (and any no-JS client) read "0 Companies on
// one login" — a real content bug, not just a cosmetic one. The animation
// now resets to 0 and counts up only once the number is actually in view.
export function CountUp({
  value,
  suffix = "",
  durationMs = 1400,
  className = "",
}: {
  value: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      // Already showing the final value from the initial state above — but
      // re-affirm it from a frame callback rather than synchronously, since
      // a setState in an effect body is a cascading render this repo's lint
      // config rejects (react-hooks/set-state-in-effect).
      const raf = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(raf);
    }

    let frameId = 0;
    let started = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started) return;
        started = true;
        observer.disconnect();
        setDisplay(0);
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          // Ease-out cubic — fast then settling, matching the page's own
          // easing curve (cubic-bezier(0.16, 1, 0.3, 1)).
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(Math.round(value * eased));
          if (progress < 1) frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      {display}
      {suffix}
    </span>
  );
}
