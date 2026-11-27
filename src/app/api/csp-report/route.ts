import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logEntryError } from "@/lib/error-log/log-entry-error";

// 2026-11-27 — CSP violation collector (audit 3.11).
//
// The app ships Content-Security-Policy-Report-Only from src/proxy.ts, so
// nothing is blocked yet; this route is where the browser says what WOULD have
// been. The reports land on Admin → Error Log (source=system, reference_type
// csp_report) so the policy can be tightened from real traffic before it is
// switched to enforcing.
//
// Deliberate properties:
//   • public by necessity — the browser posts these itself, often before sign-in;
//   • bounded — a hard body-size cap and at most a handful of rows per request,
//     because a report endpoint is a write path anyone can reach;
//   • never trusted content — every field is truncated and only used as text;
//   • always 204 (or a small 4xx for a nonsense body), never an error page: a
//     failing report endpoint makes the browser retry/drop reports, and a
//     report-only policy must never turn into visible breakage.
//
// The legacy `application/csp-report` shape, the Reporting API's
// `application/reports+json` array, and a plain single object are all accepted.

const MAX_BODY_BYTES = 8_000;
const MAX_REPORTS = 5;

type CspReportBody = {
  "document-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "blocked-uri"?: string;
  disposition?: string;
};

function pickReports(body: unknown): CspReportBody[] {
  if (Array.isArray(body)) {
    // Reporting API: [{ type: "csp-violation", body: { ... } }, ...]
    return body
      .map((entry) => (entry && typeof entry === "object" ? (entry as { body?: unknown }).body : null))
      .filter((entry): entry is CspReportBody => !!entry && typeof entry === "object");
  }
  if (body && typeof body === "object") {
    const legacy = (body as { "csp-report"?: unknown })["csp-report"];
    if (legacy && typeof legacy === "object") return [legacy as CspReportBody];
    return [body as CspReportBody];
  }
  return [];
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/csp-report") &&
    !contentType.includes("application/reports+json") &&
    !contentType.includes("application/json")
  ) {
    return new NextResponse(null, { status: 415 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const reports = pickReports(body).slice(0, MAX_REPORTS);
  if (reports.length === 0) return new NextResponse(null, { status: 204 });

  // One row per distinct violation per request — browsers repeat the same
  // report on every navigation, and five identical rows teach nobody anything.
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const report of reports) {
    const directive =
      text(report["effective-directive"], 80) || text(report["violated-directive"], 80) || "(unknown directive)";
    const blocked = text(report["blocked-uri"], 300) || "(unknown source)";
    const document = text(report["document-uri"], 300) || "(unknown page)";
    const disposition = text(report.disposition, 40) || "report";
    const reason = `CSP ${disposition}: ${directive} blocked ${blocked} on ${document}`;
    if (seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
  }

  try {
    const supabase = createServiceRoleClient();
    for (const reason of reasons) {
      await logEntryError(supabase, {
        companyId: null,
        source: "system",
        reason,
        referenceType: "csp_report",
        referenceLabel: "report-only",
        raisedByName: "CSP report (browser)",
      });
    }
  } catch (error) {
    // Missing service-role config or a transient DB failure must not turn a
    // report-only policy into a visible error — the server log is enough.
    console.warn("[csp-report] could not persist report:", error instanceof Error ? error.message : error);
  }

  return new NextResponse(null, { status: 204 });
}
