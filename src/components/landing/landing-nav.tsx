"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#modules", label: "Modules" },
  { href: "#integration", label: "Integrations" },
  { href: "#workflow", label: "How it flows" },
  { href: "#security", label: "Security" },
  { href: "#companies", label: "Companies" },
];

// 2026-10-16 — Sticky landing nav. Becomes a denser, blurred bar once the
// page is scrolled (the "logo reveal / lower third" polish asked for), and
// collapses to a sheet under md. Plain anchors + CSS smooth scrolling — no
// routing involved, so nothing here can break navigation into the app.
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-all duration-500 ${
        scrolled ? "border-[var(--landing-line)] bg-[#04091a]/85 backdrop-blur-xl" : "border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8">
        <Link href="/" className="landing-logo-reveal flex items-center gap-3">
          <span className="relative block h-10 w-10 overflow-hidden rounded-xl border border-[var(--landing-line)] bg-white/95">
            <Image src="/logo.png" alt="Nyko Mart · Rugara · CASA ARRA" fill sizes="40px" className="object-contain p-1" priority />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-white">Order Management System</span>
            <span className="block text-[11px] tracking-[0.16em] text-[var(--landing-muted)] uppercase">
              Nyko Mart · Rugara · CASA ARRA
            </span>
          </span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm text-[var(--landing-muted)] transition hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="landing-cta-primary hidden rounded-xl bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] px-4 py-2 text-sm font-semibold text-[#1a1206] shadow-lg shadow-orange-500/20 transition hover:opacity-95 sm:block"
          >
            Sign in
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="rounded-xl border border-[var(--landing-line)] px-3 py-2 text-sm text-white lg:hidden"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-[var(--landing-line)] bg-[#04091a]/95 px-5 py-3 backdrop-blur-xl lg:hidden">
          <ul className="grid gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-[var(--landing-muted)] transition hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/login"
                className="mt-1 block rounded-lg bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] px-3 py-2 text-center text-sm font-semibold text-[#1a1206]"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
