"use client";

import { useRef, type ReactNode } from "react";

// 2026-10-16 — 3D tilt card for the module grid. Pointer-only
// (e.pointerType === "mouse") so touch scrolling is never hijacked, and the
// tilt is reset the moment the pointer leaves. The transform is applied
// straight to the DOM node instead of through React state on purpose: a
// pointermove handler that re-renders 30 cards would be the single most
// expensive thing on this page.
export function TiltCard({
  children,
  className = "",
  intensity = 7,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    const node = ref.current;
    if (!node || event.pointerType !== "mouse") return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    node.style.transform = `perspective(900px) rotateY(${px * intensity}deg) rotateX(${-py * intensity}deg) translateY(-4px)`;
  }

  function handleLeave() {
    const node = ref.current;
    if (!node) return;
    node.style.transform = "";
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={`landing-tilt ${className}`}
    >
      {children}
    </div>
  );
}
