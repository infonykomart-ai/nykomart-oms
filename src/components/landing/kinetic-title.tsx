import { Fragment } from "react";

// 2026-10-16 — Kinetic title (the "stylish / super modern titles" idea):
// each word blur-shuffles in on its own delay. Deliberately NOT a client
// component — the animation is one CSS keyframe per word with a staggered
// inline animationDelay, so a Server Component can render it with zero
// JavaScript. Only used above the fold (the hero); anything further down the
// page uses Reveal, whose animation actually waits for the scroll.
export function KineticTitle({
  text,
  className = "",
  startDelayMs = 90,
  stepMs = 85,
  accentFrom,
}: {
  text: string;
  className?: string;
  startDelayMs?: number;
  stepMs?: number;
  /** Word index from which the accent gradient applies (rest stay white). */
  accentFrom?: number;
}) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, index) => (
        // The separating space sits BETWEEN the animated spans, not inside
        // them — a trailing space in an inline-block collapses, which would
        // run all the words together.
        <Fragment key={`${word}-${index}`}>
          <span className="landing-word" style={{ animationDelay: `${startDelayMs + index * stepMs}ms` }}>
            <span
              className={
                accentFrom !== undefined && index >= accentFrom
                  ? "bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] bg-clip-text text-transparent"
                  : undefined
              }
            >
              {word}
            </span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}
