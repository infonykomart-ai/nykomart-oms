import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./landing.css";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { KineticTitle } from "@/components/landing/kinetic-title";
import { Reveal } from "@/components/landing/reveal";
import { TiltCard } from "@/components/landing/tilt-card";
import { CountUp } from "@/components/landing/count-up";
import {
  CHANNELS,
  COURIERS,
  HERO_STATS,
  MARKETPLACES,
  MODULE_GROUPS,
  SECURITY_PILLARS,
  STACK_FACTS,
  WORKFLOW,
  type LandingGroup,
} from "@/lib/landing-features";
import { landingImages } from "@/lib/landing-media";

// 2026-10-16 — the first public landing page for the OMS. Until now "/" was
// a bare redirect to /dashboard, so the ONLY page anyone saw before signing
// in was /login (see that page's own comment). This is the real front door:
// what the system does, every module it actually ships, how an order flows
// through it, and the way in.
//
// Motion (the transition/title list asked for) is delivered as CSS +
// IntersectionObserver primitives in components/landing/ — REVEAL variants
// for blur / shuffle / ink / flash & burn / strobe / glitch / graphic wipe,
// KineticTitle for the hero's word-by-word titles, a logo-reveal on the
// header mark, lower-third style kickers, a marquee, holographic card edges
// and a WebGL globe. All of it turns off under prefers-reduced-motion.
//
// Everything advertised here is a real screen of this product: module
// labels/hrefs come straight from the app's own capability registry
// (src/lib/capability-info.ts) and route tree — see lib/landing-features.ts.
export const metadata: Metadata = {
  title: "Order Management System — Nyko Mart · Rugara · CASA ARRA",
  description:
    "One OMS for every channel: orders and dispatch, real courier AWB and tracking, Etsy/eBay/Amazon statement reconciliation, ad-spend verification, inventory, B2B export ERP, attendance, payroll and a full P&L.",
};

const SECTION_KICKER = "landing-kicker";

function SectionHeading({
  kicker,
  title,
  body,
  align = "left",
}: {
  kicker: string;
  title: string;
  body?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <span className={SECTION_KICKER}>{kicker}</span>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-sm leading-relaxed text-[var(--landing-muted)] sm:text-base">{body}</p>}
    </div>
  );
}

const GROUP_ACCENT: Record<LandingGroup["tone"], string> = {
  blue: "from-blue-500/25 to-blue-500/0 text-blue-200",
  cyan: "from-cyan-500/25 to-cyan-500/0 text-cyan-200",
  amber: "from-amber-500/25 to-amber-500/0 text-amber-200",
  violet: "from-violet-500/25 to-violet-500/0 text-violet-200",
  emerald: "from-emerald-500/25 to-emerald-500/0 text-emerald-200",
  rose: "from-rose-500/25 to-rose-500/0 text-rose-200",
};

export default function LandingPage() {
  // Reads public/landing/ (if it exists) — see lib/landing-media.ts. The
  // section below renders only when the owner has dropped artwork in.
  const showcase = landingImages();

  return (
    <div className="landing-root relative min-h-screen overflow-x-hidden">
      {/* Older engines that don't understand the `scripting` media feature —
          the same no-JS rescue as the @media (scripting: none) block in
          landing.css, which the current-engine case uses. Without one of the
          two, every scroll-reveal block would stay invisible for a visitor
          browsing with JavaScript disabled. */}
      <noscript>
        <style>{`.landing-reveal{opacity:1 !important;filter:none !important;transform:none !important;clip-path:none !important;animation:none !important}`}</style>
      </noscript>

      {/* Ambient backdrop — CSS only (see the 2026-10-17 note in landing.css) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] landing-aurora" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] landing-grid-lines opacity-70" aria-hidden />

      <LandingNav />

      <main className="relative">
        {/* ------------------------------------------------------------------
            Hero
        ------------------------------------------------------------------ */}
        <section className="mx-auto max-w-7xl px-5 pb-10 pt-8 lg:px-8 lg:pt-14">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
            <div>
              <span className={SECTION_KICKER}>Multi-company export operations</span>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight text-white sm:text-5xl xl:text-[3.6rem]">
                <KineticTitle text="Every Order. Every Channel." />
                <br />
                <KineticTitle
                  text="One Powerful OMS."
                  startDelayMs={420}
                  accentFrom={0}
                  className="bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] bg-clip-text text-transparent"
                />
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--landing-muted)]">
                Orders, dispatch and courier tracking, Etsy · eBay · Amazon reconciliation, freight and duty bills,
                inventory, the full B2B export pipeline, attendance and payroll, and a P&amp;L that closes itself —
                across <strong className="font-semibold text-white">Nyko Mart, Rugara and CASA ARRA</strong> from one
                login.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="landing-cta-primary rounded-xl bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] px-6 py-3 text-sm font-semibold text-[#1a1206] shadow-xl shadow-orange-600/25 transition hover:opacity-95"
                >
                  Open the OMS →
                </Link>
                <a
                  href="#modules"
                  className="rounded-xl border border-[var(--landing-line)] bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/10"
                >
                  See every module
                </a>
              </div>

              <dl className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {HERO_STATS.map((stat) => (
                  <div key={stat.label} className="landing-card px-4 py-3.5">
                    <dd className="text-2xl font-semibold tabular-nums text-white">
                      <CountUp value={stat.value} suffix={stat.suffix} />
                    </dd>
                    <dt className="mt-1 text-[11px] leading-snug tracking-wide text-[var(--landing-muted)] uppercase">
                      {stat.label}
                    </dt>
                  </div>
                ))}
              </dl>
            </div>

            {/* 3D globe + floating module chips */}
            <div className="relative">
              <div className="relative mx-auto aspect-square w-full max-w-[580px]">
                <div
                  className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(56,189,248,0.28),transparent_64%)] blur-2xl"
                  aria-hidden
                />
                <div className="absolute inset-0">
                  <LandingHero />
                </div>

                {[
                  { label: "Marketplace sync", detail: "Etsy · eBay · Amazon", pos: "left-0 top-[10%]", delay: "0s" },
                  { label: "AWB + label", detail: "7 courier integrations", pos: "right-0 top-[24%]", delay: "1.2s" },
                  { label: "Statement match", detail: "fees vs real orders", pos: "left-[2%] bottom-[16%]", delay: "2.1s" },
                  { label: "Payroll ready", detail: "attendance → salary", pos: "right-[4%] bottom-[8%]", delay: "0.6s" },
                ].map((chip) => (
                  <div
                    key={chip.label}
                    className={`landing-card landing-float absolute hidden w-[190px] px-4 py-3 lg:block ${chip.pos}`}
                    style={{ animationDelay: chip.delay }}
                  >
                    <p className="text-xs font-semibold text-white">{chip.label}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--landing-muted)]">{chip.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Channel / courier marquee */}
          <div className="landing-marquee-wrap relative mt-14 overflow-hidden border-y border-[var(--landing-line)] py-5">
            <div className="landing-marquee gap-12">
              {[...MARKETPLACES, ...COURIERS, ...MARKETPLACES, ...COURIERS].map((name, index) => (
                <span
                  key={`${name}-${index}`}
                  className="text-xs font-medium tracking-[0.28em] whitespace-nowrap text-[var(--landing-muted)] uppercase"
                >
                  {name}
                </span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--landing-bg)] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--landing-bg)] to-transparent" />
          </div>
        </section>

        {/* ------------------------------------------------------------------
            Statement-verification spotlight (the newest capability)
        ------------------------------------------------------------------ */}
        <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal variant="shuffle">
              <SectionHeading
                kicker="Reconciliation, not guesswork"
                title="Your own entries, verified against the monthly statement"
                body="Etsy, eBay and Amazon fees are matched to the real orders they belong to, and the ad budget/spend you enter is checked against the platform's own monthly statement — with a tolerance, a difference and a direct link to the source. Amazon is tracked marketplace country by marketplace country, USA through UAE, because that is how its ad console budgets."
              />
              <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  "Amazon budget & spend split by 12 marketplace countries",
                  "Entered vs statement, with the exact difference shown",
                  "Missing statement = visible, never silently \"matched\"",
                  "Store expense report built from matched fees, not a 25% guess",
                ].map((point) => (
                  <li key={point} className="flex gap-2 text-xs leading-relaxed text-[var(--landing-muted)]">
                    <span className="text-[var(--landing-amber)]">◆</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal variant="blur" delay={120}>
              <TiltCard intensity={5}>
                <div className="landing-card overflow-hidden p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold tracking-[0.2em] text-[var(--landing-muted)] uppercase">
                      Store Ad Spend · Reconcile
                    </p>
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                      ✓ Matched
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {[
                      { store: "Amazon Rugara", country: "USA", budget: "$100.00", spend: "$43.00", verdict: "Match" },
                      { store: "Amazon Rugara", country: "UK", budget: "$60.00", spend: "$18.40", verdict: "Match" },
                      { store: "Amazon Arts of Jaipur", country: "Germany", budget: "$45.00", spend: "$21.10", verdict: "Recheck" },
                      { store: "Etsy The Rugara", country: "—", budget: "$15.00", spend: "$14.22", verdict: "Match" },
                    ].map((row) => (
                      <div
                        key={`${row.store}-${row.country}`}
                        className="flex items-center justify-between rounded-xl border border-[var(--landing-line)] bg-white/[0.03] px-3 py-2.5"
                      >
                        <span className="text-xs">
                          <span className="block font-medium text-white">{row.store}</span>
                          <span className="text-[11px] text-[var(--landing-muted)]">{row.country}</span>
                        </span>
                        <span className="text-right text-xs tabular-nums text-[var(--landing-muted)]">
                          <span className="block">
                            Budget <span className="text-white">{row.budget}</span>
                          </span>
                          <span>
                            Spend <span className="text-white">{row.spend}</span>
                          </span>
                        </span>
                        <span
                          className={`ml-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            row.verdict === "Match"
                              ? "bg-emerald-400/10 text-emerald-300"
                              : "bg-amber-400/15 text-amber-200"
                          }`}
                        >
                          {row.verdict === "Match" ? "✓ within 2%" : "⚠ difference"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-[11px] leading-relaxed text-[var(--landing-muted)]">
                    Illustrative layout of the real Reconcile tab — entered spend against the imported statement, one row
                    per store and Amazon country.
                  </p>
                </div>
              </TiltCard>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            All modules
        ------------------------------------------------------------------ */}
        <section id="modules" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="blur">
            <SectionHeading
              kicker="Everything included"
              title="Every module of the OMS, in one place"
              body="Not a brochure list — these are the screens the team works in every day. Pick a card to jump straight to that module (you'll be asked to sign in first)."
              align="center"
            />
          </Reveal>

          {MODULE_GROUPS.map((group, groupIndex) => (
            <div key={group.id} className="mt-14">
              <Reveal variant="ink">
                <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--landing-line)] bg-white/[0.03] px-5 py-4">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${GROUP_ACCENT[group.tone]}`}
                  >
                    {group.icon}
                  </span>
                  <div className="min-w-[240px] flex-1">
                    <h3 className="text-base font-semibold text-white">
                      {group.title}
                      <span className="ml-2 text-[11px] font-normal tracking-wide text-[var(--landing-muted)] uppercase">
                        {group.modules.length} modules
                      </span>
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--landing-muted)]">{group.summary}</p>
                  </div>
                </div>
              </Reveal>

              <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {group.modules.map((module, index) => (
                  <Reveal
                    as="li"
                    key={`${group.id}-${module.label}`}
                    variant={(["rise", "shuffle", "blur", "flash"] as const)[index % 4]}
                    delay={(index % 4) * 60 + (groupIndex % 2) * 40}
                  >
                    <TiltCard className="h-full">
                      <Link
                        href={module.href}
                        className="landing-card flex h-full flex-col gap-2 p-4 transition-transform duration-300"
                      >
                        <span className="text-xl">{module.icon}</span>
                        <span className="text-sm font-semibold text-white">{module.label}</span>
                        <span className="text-xs leading-relaxed text-[var(--landing-muted)]">{module.blurb}</span>
                      </Link>
                    </TiltCard>
                  </Reveal>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* ------------------------------------------------------------------
            Integrations
        ------------------------------------------------------------------ */}
        <section id="integration" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="strobe">
            <SectionHeading
              kicker="Integrations"
              title="Wired into the places your business already lives"
              body="Channels in, carriers out, and the notifications the team actually reads."
            />
          </Reveal>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <Reveal variant="rise">
              <div className="landing-card h-full p-6">
                <p className="text-xs font-semibold tracking-[0.2em] text-[var(--landing-muted)] uppercase">Channels</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {MARKETPLACES.map((name) => (
                    <span
                      key={name}
                      className="rounded-lg border border-[var(--landing-line)] bg-white/[0.04] px-3 py-1.5 text-xs text-white"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-relaxed text-[var(--landing-muted)]">
                  Statement imports and order matching per channel, including the PDF-only statements that have to be
                  entered by hand.
                </p>
              </div>
            </Reveal>

            <Reveal variant="rise" delay={90}>
              <div className="landing-card h-full p-6">
                <p className="text-xs font-semibold tracking-[0.2em] text-[var(--landing-muted)] uppercase">Carriers</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {COURIERS.map((name) => (
                    <span
                      key={name}
                      className="rounded-lg border border-[var(--landing-line)] bg-white/[0.04] px-3 py-1.5 text-xs text-white"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-relaxed text-[var(--landing-muted)]">
                  Bookings, AWB and printable labels where the carrier supports it; encrypted per-company API credentials.
                </p>
              </div>
            </Reveal>

            <Reveal variant="rise" delay={180}>
              <div className="landing-card h-full p-6">
                <p className="text-xs font-semibold tracking-[0.2em] text-[var(--landing-muted)] uppercase">
                  Notifications
                </p>
                <ul className="mt-4 space-y-3">
                  {CHANNELS.map((channel) => (
                    <li key={channel.title} className="flex gap-3">
                      <span className="text-base">{channel.icon}</span>
                      <span>
                        <span className="block text-xs font-semibold text-white">{channel.title}</span>
                        <span className="text-[11px] leading-relaxed text-[var(--landing-muted)]">{channel.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            Workflow timeline
        ------------------------------------------------------------------ */}
        <section id="workflow" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="ink">
            <SectionHeading
              kicker="How it flows"
              title="From an order landing to a closed month"
              body="One continuous path — no re-typing a number from a sheet into an invoice, and no month-end archaeology."
            />
          </Reveal>

          <ol className="mt-10 grid gap-4 lg:grid-cols-2">
            {WORKFLOW.map((item, index) => (
              <Reveal
                as="li"
                key={item.step}
                variant={index % 2 === 0 ? "rise" : "shuffle"}
                delay={(index % 2) * 80}
              >
                <div className="landing-card flex h-full gap-4 p-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--landing-line)] bg-white/[0.04] text-sm font-semibold text-[var(--landing-amber)]">
                    {item.step}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--landing-muted)]">{item.detail}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------------------------
            Security + stack
        ------------------------------------------------------------------ */}
        <section id="security" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="glitch">
            <SectionHeading
              kicker="Built to be trusted"
              title="Access control, audit and backup — not an afterthought"
              body="This system runs a real export business: salaries, bills and bank statements. Its guardrails are part of the design."
            />
          </Reveal>

          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY_PILLARS.map((pillar, index) => (
              <Reveal key={pillar.title} variant="blur" delay={(index % 3) * 80}>
                <div className="landing-card h-full p-5">
                  <span className="text-xl">{pillar.icon}</span>
                  <h3 className="mt-2 text-sm font-semibold text-white">{pillar.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--landing-muted)]">{pillar.detail}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal variant="rise" delay={120}>
            <div className="landing-card landing-scanline mt-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {STACK_FACTS.map((fact) => (
                <div key={fact.label}>
                  <p className="text-[11px] tracking-[0.2em] text-[var(--landing-muted)] uppercase">{fact.label}</p>
                  <p className="mt-1 text-xs font-medium text-white">{fact.value}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------------------
            Companies + owner artwork (only when files exist)
        ------------------------------------------------------------------ */}
        <section id="companies" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="flash">
            <SectionHeading
              kicker="The companies"
              title="Three businesses, one operations team"
              body="Nyko Mart, Rugara and CASA ARRA run side by side on the same system — company scoping keeps their data apart, one login keeps the team fast."
              align="center"
            />
          </Reveal>

          <div className="mt-9 grid gap-4 sm:grid-cols-3">
            {[
              { src: "/nykomartlogo.png", name: "Nyko Mart", detail: "Order entry, courier booking, stock & documents" },
              { src: "/rugaralogo.png", name: "Rugara", detail: "Marketplaces, ad spend & statement reconciliation" },
              { src: "/casaarralogo.png", name: "CASA ARRA", detail: "B2B export pipeline, production & shipments" },
            ].map((company, index) => (
              <Reveal key={company.name} variant="rise" delay={index * 90}>
                <div className="landing-card flex h-full flex-col items-center p-6 text-center">
                  <span className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-xl bg-white/95">
                    <Image
                      src={company.src}
                      alt={company.name}
                      width={160}
                      height={64}
                      className="h-14 w-auto object-contain"
                    />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-white">{company.name}</p>
                  <p className="mt-1 text-xs text-[var(--landing-muted)]">{company.detail}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {showcase.length > 0 && (
            <div className="mt-14">
              <Reveal variant="blur">
                <SectionHeading kicker="Showcase" title="Inside the operations" />
              </Reveal>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {showcase.map((image, index) => (
                  <Reveal key={image.src} variant={index % 2 === 0 ? "rise" : "shuffle"} delay={(index % 3) * 70}>
                    <figure className="landing-card overflow-hidden">
                      <div className="relative aspect-[4/3] w-full">
                        <Image
                          src={image.src}
                          alt={image.caption}
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover"
                        />
                      </div>
                      <figcaption className="px-4 py-3 text-xs text-[var(--landing-muted)]">{image.caption}</figcaption>
                    </figure>
                  </Reveal>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------------
            Closing CTA
        ------------------------------------------------------------------ */}
        <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal variant="flash">
            <div className="landing-card relative overflow-hidden px-6 py-12 text-center sm:px-12">
              <div
                className="pointer-events-none absolute inset-0 landing-aurora opacity-70"
                aria-hidden
              />
              <div className="relative">
                <span className={SECTION_KICKER}>Ready when you are</span>
                <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Sign in and run today&apos;s orders
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--landing-muted)]">
                  Your dashboard, your company, your queues — approvals waiting, orders in flight and the day&apos;s
                  numbers already computed.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/login"
                    className="landing-cta-primary rounded-xl bg-gradient-to-r from-[var(--landing-amber)] to-[var(--landing-orange)] px-7 py-3 text-sm font-semibold text-[#1a1206] shadow-xl shadow-orange-600/25 transition hover:opacity-95"
                  >
                    Sign in to the OMS →
                  </Link>
                  <Link
                    href="/login/verify-2fa"
                    className="rounded-xl border border-[var(--landing-line)] bg-white/5 px-7 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/10"
                  >
                    Two-factor challenge
                  </Link>
                </div>
                <p className="mt-5 text-[11px] text-[var(--landing-muted)]">
                  Access is granted per role. Ask an Admin or MD to grant your role the capabilities you need.
                </p>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="relative border-t border-[var(--landing-line)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <span className="relative block h-10 w-10 overflow-hidden rounded-xl border border-[var(--landing-line)] bg-white/95">
              <Image src="/logo.png" alt="OMS" fill sizes="40px" className="object-contain p-1" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Order Management System</span>
              <span className="block text-[11px] tracking-[0.16em] text-[var(--landing-muted)] uppercase">
                Nyko Mart · Rugara · CASA ARRA
              </span>
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--landing-muted)]">
            <a className="transition hover:text-white" href="#modules">
              Modules
            </a>
            <a className="transition hover:text-white" href="#integration">
              Integrations
            </a>
            <a className="transition hover:text-white" href="#workflow">
              How it flows
            </a>
            <a className="transition hover:text-white" href="#security">
              Security
            </a>
            <Link className="transition hover:text-white" href="/login">
              Sign in
            </Link>
          </nav>
          <p className="text-[11px] text-[var(--landing-muted)]">
            © {new Date().getFullYear()} Nyko Mart · Rugara · CASA ARRA. Internal operations system.
          </p>
        </div>
      </footer>
    </div>
  );
}
