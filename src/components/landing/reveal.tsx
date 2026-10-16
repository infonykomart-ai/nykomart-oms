"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type RevealVariant = "rise" | "blur" | "shuffle" | "ink" | "flash" | "strobe" | "glitch";

// 2026-10-16 — Scroll-reveal primitive for the landing page. Each variant
// maps to one of the transition styles asked for (blur, shuffle, ink, flash
// & burn, strobe, glitch, graphic wipe) and is implemented as pure CSS in
// landing.css — this component only flips a data attribute once, via
// IntersectionObserver, then disconnects. No scroll listeners, no per-frame
// JS, and everything degrades to "already visible" when
// prefers-reduced-motion is set (see landing.css).
export function Reveal({
  children,
  variant = "rise",
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer at all (ancient/embedded browser): reveal on the next
      // frame. Deliberately NOT a synchronous setState here — that forces a
      // cascading render inside the effect (react-hooks/set-state-in-effect,
      // which this repo's lint config treats as an error).
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // The ref type differs per tag; the cast keeps this component a single
      // implementation instead of three near-identical ones.
      ref={ref as never}
      data-shown={shown ? "true" : "false"}
      style={delay ? { transitionDelay: `${delay}ms`, animationDelay: `${delay}ms` } : undefined}
      className={`landing-reveal landing-reveal--${variant} ${className}`}
    >
      {children}
    </Tag>
  );
}
