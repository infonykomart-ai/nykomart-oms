"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";

// 2026-10-16 — Same two-layer safety the /login hero established
// (login-hero-3d.tsx): three.js is ~600KB min and is pure decoration here,
// so it is loaded as its own lazy chunk AFTER the page renders (ssr:false —
// WebGL only exists in the browser), and wrapped in a class error boundary
// so a render-phase failure hides the scene instead of taking the landing
// page down. The scene itself also try/catches its own setup + loop.
const LandingHeroScene = dynamic(() => import("./landing-hero-scene").then((m) => m.LandingHeroScene), {
  ssr: false,
});

class LandingHeroBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("LandingHero: decorative 3D scene failed, hiding it:", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function LandingHero() {
  return (
    <LandingHeroBoundary>
      <LandingHeroScene />
    </LandingHeroBoundary>
  );
}
