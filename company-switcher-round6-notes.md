# Company switcher — Round 6 (2026-09-12): real root cause, finally

## The complaint (verbatim, Hinglish)
"ek jo ye company selectore hai ye abhi bhi casa arra par atak jata hai dekhoge kya problm hai"
— the company selector still gets stuck on CASA ARRA. Follow-up: it happens with everyone, and
what actually happens is "company select to ho jati hai lekin menu vaps change ho jata hai" (the
company DOES get selected, but the [header] reverts back).

This is the SIXTH round on this exact bug (five earlier rounds: 2026-08-22, and three more on
2026-08-25 — see `claude/company-switcher-root-cause-2026-08-25.md`). Round 5's fix (the
`key={pending ? ... : currentCompanyId}` remount trick in `company-switcher.tsx`) is confirmed
live in production (verified via `git show origin/main`) — and the bug is still there. So this
round did NOT start by reading code and theorizing; it started by logging into the real
production site (`nykomart-oms-oohq.vercel.app`) as the owner's own "Gajanand" (Admin) login,
in the owner's own connected browser, and reproducing the bug live with instrumentation
(`window.fetch` interception + polling the live DOM), per this project's own standing lesson:
test live, not code-read.

## Two distinct, confirmed root causes

Both were caught live, with hard evidence (captured network responses, DOM state, console
errors) — not inferred from reading the source a sixth time.

### Bug A — the `<select>` shows the wrong company after a *successful* switch

Reproduced: switched to "Nyko Mart". The captured server response was a clean `200`, and the
header (`companyName`, from the fresh `currentCompanyId` prop) correctly showed "Nyko Mart".
But the `<select>` element itself — read directly via its DOM `.value` and
`.options[...].selected` — showed **"CASA ARRA"**: not the old company, not the new one, but
the *first* option in the (alphabetically ordered) list.

This is the browser's own documented fallback: when a `<select>`'s `value` doesn't match any of
its current `<option>`s at the exact moment the browser evaluates it, it silently selects
whichever option is first. Round 5's own code comment had already diagnosed this exact class of
DOM-ordering race (verified via raw server HTML at the time) and tried to dodge it by forcing
React to unmount/remount the `<select>` node on every settled value (a `key` trick) instead of
patching it live. It didn't work — this round proves the same race can happen on node
*creation*, not just on patching an existing node. Five rounds of ever more careful client-side
state/DOM tricks on this one native `<select>` have each found a new way into the same
browser-level race. That's a sign the approach — trust the browser to apply a controlled
`value` to a native `<select>` correctly on every company switch — is the wrong tool, not that
the trick was almost right.

**Fix:** stop trusting client-side reconciliation for this control. `company-switcher.tsx` now
does a real `window.location.reload()` the moment a switch is confirmed successful (`state.success`
via a `useEffect`, the same pattern already used for the existing "still switching" timer). A
freshly parsed HTML document has the correct `selected` attribute burned into the right
`<option>` server-side before any client JS runs — there is no DOM-ordering window left for the
browser's value-vs-options race to land in. This costs one extra full navigation per switch,
which is a rare, deliberate action (not a hot path) — a reasonable trade for eliminating the
entire bug class five rounds of rewrites couldn't close.

### Bug B — the switch occasionally 500s and takes the whole app down with it

Reproduced separately, same live session: one of the switch attempts came back as a bare HTTP
`500` on the POST to `/dashboard` (this is the same request `switchCompanyAction` responds on,
since Next.js bundles the action's result together with the revalidated `/dashboard` layout in
one round trip after `revalidatePath("/dashboard", "layout")`). The browser console showed
React's own minified error **#441**: "An error occurred in the Server Components render" (the
real message is stripped in production builds — see react.dev/errors/441). Because the crash
happened *inside* the layout's own re-render, it didn't fail gracefully into `state.error` like
a denied-access response does — there was no HTML for the browser to show at all, so Chrome fell
back to its own blank "This page couldn't load" interstitial, wiping the **entire app shell**,
not just the dropdown. This is almost certainly what produced some of the more bizarre-looking
"stuck" reports over the last month — a transient crash mid-switch, landing the client on
whatever half-updated state was on screen when it happened.

Root cause of the 500 itself: `dashboard/layout.tsx` runs ~9 Supabase queries in one
`Promise.all` on every dashboard load (unread counts, help articles, the companion widget's
image, theme prefs, etc.). None of them were defensively wrapped — if any single one's
underlying fetch rejects (a transient network blip, an RPC timeout — anything that makes the
promise reject rather than resolve with Supabase's normal `{data: null, error}` shape), the
`Promise.all` rejects, the entire layout render throws, and (since this app has **no
`error.tsx` anywhere** — confirmed by searching the whole repo) that exception has nowhere to
land except the raw browser-level failure page.

**Fix, two layers:**
1. `dashboard/layout.tsx` — every one of the 9 queries now has its own `.then(ok, err => safeFallback)`,
   so one query failing degrades that one badge/count to a safe default (0 / empty / off)
   instead of crashing the whole page. Each failure is still logged via `console.error` so it's
   visible in Vercel's function logs if it keeps happening.
2. `src/app/dashboard/error.tsx` — added the app's first-ever route-segment error boundary.
   Anything that still throws despite the hardening above (or any future bug like it) now shows
   a friendly "Something went wrong loading the dashboard" screen with a Try again / Reload
   button, instead of the blank browser interstitial. This is a safety net, not a substitute for
   fixing individual causes.

## Why this round is different from rounds 1–5
Every prior round changed `company-switcher.tsx`'s own internal state/DOM logic based on reading
the code and reasoning about it, then declared it fixed after a clean build. This round found
both root causes by literally logging into the production site, intercepting real network
traffic, and polling the live DOM after every action — which is how Bug A's "shows the FIRST
option, not the old or new one" detail and Bug B's actual 500 + React #441 were caught at all;
neither is visible from reading the source alone.

## What still needs a live check after this deploys
This fix was built and verified locally (clean `tsc`, `eslint`, and `next build`) but **not**
re-verified against the live production site, since deploying is the owner's own step (this
project never pushes to the repo or triggers a deploy directly). After this round is deployed,
the real test is: switch companies several times in a row (including fast, back-to-back
switches), on a fresh page load and without one, and confirm the header and the dropdown always
show the same company, every time, with no reload needed to "catch up." Bug B (the 500) was
intermittent even before this fix, so it may take a few tries to know for sure it's gone — the
`console.error` tags added in this round make it traceable in Vercel's logs if it recurs.
