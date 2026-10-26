# Security Policy

## Supported versions

This project is a **single hosted application**, not a versioned library. There
are no release tags and nothing for a user to pin or upgrade.

| Version | Supported |
|---|---|
| The deployment running `main` (https://www.nykoinfotech.com) | ✅ yes — patches and fixes land here |
| Any older commit, fork, or self-hosted copy | ❌ no — no backports, no support |

Security fixes are applied to `main` and deployed. There is no long-term
support branch and no compatibility promise for forks.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting** on this repository:
**Security → Report a vulnerability** (https://github.com/infonykomart-ai/nykomart-oms/security/advisories/new).

That opens a private channel visible only to the maintainers — do **not** file
a public issue, and do not disclose details publicly before a fix ships.

Include, as much as you can:

- what you did, and what you expected to happen;
- the exact endpoint, page, server action, or RLS policy involved;
- an ordered reproduction, or a proof-of-concept request/response;
- the impact you believe it has — especially **cross-company data access**
  (one company's orders, bills or ledger rows being readable from another);
- whether you tested against production, and whether any real data was touched.

**Please do not** run destructive tests against production, exfiltrate real
customer/employee records beyond what is needed to prove the issue, or test
denial-of-service.

### What we commit to

| Severity | First response | Target fix |
|---|---|---|
| Critical (auth bypass, cross-tenant data access, service-role key exposure) | 1 business day | 7 days |
| High (privilege escalation, PII exposure, RLS gap) | 2 business days | 14 days |
| Medium (broken access control on a single feature, CSRF) | 5 business days | 30 days |
| Low (information disclosure, hardening) | 10 business days | 90 days |

- **Acknowledge** every report, always — including ones we decline.
- **Triage** and reply with accept/reject plus reasoning within the windows above.
- **Credit** reporters who want it, unless they ask to stay anonymous.
- **Coordinated disclosure:** we ask for 90 days before public disclosure, or
  fewer if a fix ships sooner. If we miss a target we will say so and why.

## Scope notes specific to this application

The areas most worth testing, and how they are meant to work:

- **Company isolation.** NYKO MART, Rugara and CASA ARRA share one database.
  Separation is enforced by **Postgres RLS policies** in `db/schema.sql` plus
  capability checks in `src/lib/auth/require-capability.ts`. Anything that
  reads another company's rows — or lets a user switch into a company they do
  not belong to (`src/lib/auth/switch-company.ts`) — is in scope and high
  severity.
- **Service role key.** `createServiceRoleClient()` bypasses RLS entirely. It
  must only ever be used behind a capability check in a server action or route
  handler, never exposed to the browser.
- **Cron and webhook routes** under `src/app/api/cron/` and
  `src/app/api/webhooks/` are authenticated by bearer token / signature —
  unauthenticated access to them is in scope.
- **Stored secrets.** Courier and marketplace credentials are encrypted with
  AES-256-GCM (`src/lib/crypto/secret-box.ts`) before being written to
  `secrets_enc`, and are only ever read by
  `src/lib/couriers/credentials.ts`. Decrypting or logging them is in scope.
- **Uploaded documents** (invoices, bills, employee documents, attachments)
  are served through proxy routes — object-level authorization on those is in
  scope.

**Out of scope:** social engineering and phishing, physical attacks, denial of
service, volumetric load testing, and vulnerabilities in third-party services
(Supabase, Cloudflare, courier APIs) that we merely consume.

## Known gaps — not yet verified

Stated plainly, because this is **not** a complete security audit:

- **RLS and capability permissions have not been audited policy-by-policy.**
  `db/schema.sql` carries a large set of policies and several audit patches
  (`2026-08-08-enable-rls.sql`, `2026-08-13k-fix-missing-rls-policies.sql`,
  `2026-08-17-rls-policy-audit-fix.sql`), but no automated test asserts that a
  user of company A cannot read company B's rows.
- **No automated tests for authorization.** The suite (`npm test`) covers pure
  business logic only — finance/GST, payroll, area conversion, duplicate-buyer
  matching, punch import, financial-year validation. Access control, server
  actions and RLS are untested.
- **No runtime penetration test** of the live deployment, its Supabase
  policies, deployment secrets, or third-party API integrations.
- **Credential rotation and repository history cleanup are outstanding** — see
  "Open incident" below.

## Open incident — public exposure of production data

This repository was **public** and contained real business and financial
records committed as SQL (Etsy ledger lines, bank payment imports, vendor
bill-pass files, party bank details, employee emails).

**Status:**

- ✅ Removed from the working tree and from future commits (moved to a
  gitignored `.private-data/`); the full inventory is in
  [`db/MIGRATIONS.md`](db/MIGRATIONS.md#6-data-policy--no-production-records-in-db).
- ✅ No private keys, API keys or `.env` values were found committed; courier
  and marketplace secrets are stored encrypted, not in plaintext.
- ❌ **Still present in git history.** Deleting a file does not remove it from
  old commits. Erasing it requires a `git filter-repo` history rewrite plus a
  force-push — a destructive, coordinated operation that has deliberately not
  been performed.
- ❌ **Repository visibility** must be flipped to private.
- ❌ **Exposure assessment** for the period the data was public has not been
  done.

**Required follow-ups, in order:**

1. Make the repository private.
2. Rewrite history (or accept and document the exposure) and force-push.
3. Rotate any credential that was ever in the repository, and review Supabase
   data-access logs for the exposure window.
4. Complete the exposure assessment.

## Incident response

1. **Detect** — an alert, a report, or a maintainer noticing it.
2. **Contain** — revoke the affected credential or session, disable the
   affected route, or make the repository private. Prefer revocation over
   patching when both are possible.
3. **Assess** — which companies' data, which tables, which time window, and
   whether anything was read or exfiltrated.
4. **Eradicate & fix** — land the fix on `main`, deploy, and confirm with a
   reproduction that originally succeeded.
5. **Verify** — add a regression test where the failure was in logic; add an
   RLS/capability test where it was in access control.
6. **Review** — write down what happened, what was exposed, what was missed,
   and the concrete change that prevents recurrence. Notify affected parties
   where real data was accessed.
