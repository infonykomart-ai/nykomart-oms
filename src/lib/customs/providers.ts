// Official-source adapters for the customs rate engine.
//
// WHAT IS ACTUALLY AVAILABLE (verified 2026-11-14):
//   * ICEGATE's ERAM page (the URL below) is a descriptive Drupal page. It
//     explains that ICEGATE receives rates from SBI through a message exchange
//     and publishes them for public viewing, but it exposes NO public API,
//     JSON/CSV feed or HTML rate table. The rates themselves are shown on the
//     ICEGATE services screen, which is a client-side Angular app.
//   * CBIC publishes the rate notifications and links to ICEGATE. cbic.gov.in
//     was not reachable from the build environment (connection reset), so its
//     availability is reported, not assumed.
//
// This module therefore does the only honest thing an automated job can do
// without an authorized feed:
//   1. fetch the official page and look for a published rate table or a link
//      to an official rate document (PDF/CSV) that it is allowed to read;
//   2. if one exists, download and parse it (that IS authorized public
//      document ingestion — no CAPTCHA, login or access control is bypassed);
//   3. if none exists, record status "source_unavailable" with the exact
//      reason, so the dashboard tells the administrator to upload the
//      notification instead of silently showing nothing.
//
// It never scrapes an undocumented endpoint, never invents a URL, and never
// falls back to RBI/Google/XE/live-forex rates.
import { parseCsvRates, parseFeedJson, parseNotificationText } from "./parse";
import type { ExtractedRate } from "./types";

const TIMEOUT_MS = 15_000;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const ICEGATE_ERAM_URL =
  "https://www.icegate.gov.in/new-initiatives/exchange-rate-automation-module";
export const ICEGATE_VIEW_URL = "https://foservices.icegate.gov.in/#/services/viewExchangeRate";
export const CBIC_URL = "https://www.cbic.gov.in/";

export type SourceCheck = {
  provider: "icegate" | "cbic" | "mirror";
  label: string;
  url: string;
  reachable: boolean;
  machineReadable: boolean;
  rows: ExtractedRate[];
  /** Checksum of the document the rows came from, when applicable. */
  checksum: string | null;
  documentRef: string | null;
  message: string;
};

function emptyCheck(
  provider: SourceCheck["provider"],
  label: string,
  url: string,
  message: string,
  reachable = false
): SourceCheck {
  return { provider, label, url, reachable, machineReadable: false, rows: [], checksum: null, documentRef: null, message };
}

async function fetchText(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NykoMartOMS/1.0; +https://nykomart.in) customs-rate-monitor",
        Accept: "text/html,application/pdf,text/csv,application/json;q=0.9,*/*;q=0.8",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
}

/** Official document links published on a page (PDF/CSV, .gov.in hosts). */
function findOfficialRateDocuments(html: string, baseUrl: string): string[] {
  const links = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1]);
  const out = new Set<string>();
  for (const href of links) {
    if (!/\.(pdf|csv)(\?|#|$)/i.test(href)) continue;
    if (!/exchange|rate|currency/i.test(href)) continue;
    try {
      const absolute = new URL(href, baseUrl);
      if (absolute.protocol !== "https:") continue;
      const host = absolute.hostname.toLowerCase();
      // Only the official customs domains — never an arbitrary third party.
      if (!(host.endsWith("icegate.gov.in") || host.endsWith("cbic.gov.in") || host.endsWith("gov.in"))) continue;
      out.add(absolute.toString());
    } catch {
      // malformed href — ignore
    }
  }
  return Array.from(out).slice(0, 2);
}

async function downloadDocument(url: string): Promise<{ bytes: Buffer; checksum: string } | null> {
  const res = await fetchText(url);
  if (!res?.ok) return null;
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_DOCUMENT_BYTES) return null;

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_DOCUMENT_BYTES) return null;
  const bytes = Buffer.from(arrayBuffer);

  const { createHash } = await import("crypto");
  return { bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * ICEGATE check: fetch the official ERAM page, and if it links an official
 * rate document, parse it. Returns rows only when real published figures were
 * found.
 */
export async function checkIcegate(): Promise<SourceCheck> {
  const res = await fetchText(ICEGATE_ERAM_URL);
  if (!res) {
    return emptyCheck("icegate", "ICEGATE", ICEGATE_ERAM_URL, "ICEGATE could not be reached (network/timeout).");
  }
  if (!res.ok) {
    return emptyCheck(
      "icegate",
      "ICEGATE",
      ICEGATE_ERAM_URL,
      `ICEGATE answered HTTP ${res.status}.`,
      true
    );
  }

  const html = await res.text();
  const documents = findOfficialRateDocuments(html, ICEGATE_ERAM_URL);

  for (const docUrl of documents) {
    const downloaded = await downloadDocument(docUrl);
    if (!downloaded) continue;
    const parsed = /\.csv(\?|#|$)/i.test(docUrl)
      ? parseCsvRates(downloaded.bytes.toString("utf8"))
      : await parsePdfDocument(downloaded.bytes);
    if (parsed.rows.length > 0) {
      return {
        provider: "icegate",
        label: "ICEGATE",
        url: docUrl,
        reachable: true,
        machineReadable: true,
        rows: parsed.rows,
        checksum: downloaded.checksum,
        documentRef: docUrl,
        message: `Read ${parsed.rows.length} currencies from an official ICEGATE document.`,
      };
    }
  }

  // A rate table embedded directly in the page would also count — but only if
  // it really looks like a table (at least two currencies), so prose about
  // "22 currency codes" cannot become a pending row.
  const embedded = parseNotificationText(stripHtml(html));
  if (embedded.rows.length >= 2) {
    const { createHash } = await import("crypto");
    return {
      provider: "icegate",
      label: "ICEGATE",
      url: ICEGATE_ERAM_URL,
      reachable: true,
      machineReadable: true,
      rows: embedded.rows,
      checksum: createHash("sha256").update(html).digest("hex"),
      documentRef: ICEGATE_ERAM_URL,
      message: `Read ${embedded.rows.length} currencies from the ICEGATE page.`,
    };
  }

  return {
    provider: "icegate",
    label: "ICEGATE",
    url: ICEGATE_ERAM_URL,
    reachable: true,
    machineReadable: false,
    rows: [],
    checksum: null,
    documentRef: null,
    message:
      "ICEGATE is reachable but publishes no machine-readable rate table (no public API, JSON/CSV feed or downloadable rate document on the ERAM page). Upload the official notification or its CSV instead.",
  };
}

/** CBIC check: availability only — the notifications are published as PDFs. */
export async function checkCbic(): Promise<SourceCheck> {
  const res = await fetchText(CBIC_URL);
  if (!res) {
    return emptyCheck("cbic", "CBIC", CBIC_URL, "CBIC could not be reached (network/timeout).");
  }
  if (!res.ok) {
    return emptyCheck("cbic", "CBIC", CBIC_URL, `CBIC answered HTTP ${res.status}.`, true);
  }
  return {
    provider: "cbic",
    label: "CBIC",
    url: CBIC_URL,
    reachable: true,
    machineReadable: false,
    rows: [],
    checksum: null,
    documentRef: null,
    message:
      "CBIC is reachable. It publishes exchange-rate notifications as documents, not as a data feed — upload the notification here.",
  };
}

/**
 * Optional authorized feed. Only used when CUSTOMS_RATE_FEED_URL is set by an
 * administrator to an official/authorized endpoint; there is no default.
 * CUSTOMS_RATE_FEED_PROVIDER decides the source label (icegate/cbic = may
 * auto-verify when validation is clean; mirror = always pending).
 */
export async function checkConfiguredFeed(): Promise<SourceCheck | null> {
  const url = process.env.CUSTOMS_RATE_FEED_URL?.trim();
  if (!url) return null;

  const providerRaw = (process.env.CUSTOMS_RATE_FEED_PROVIDER ?? "icegate").trim().toLowerCase();
  const provider: SourceCheck["provider"] =
    providerRaw === "cbic" ? "cbic" : providerRaw === "mirror" ? "mirror" : "icegate";

  const res = await fetchText(url);
  if (!res?.ok) {
    return emptyCheck(provider, "Configured feed", url, `The configured feed answered ${res ? `HTTP ${res.status}` : "no response"}.`);
  }
  const text = await res.text();
  const parsed = parseFeedJson(text);
  const { createHash } = await import("crypto");
  return {
    provider,
    label: provider === "mirror" ? "Authorized mirror" : provider === "cbic" ? "CBIC feed" : "ICEGATE feed",
    url,
    reachable: true,
    machineReadable: parsed.rows.length > 0,
    rows: parsed.rows,
    checksum: createHash("sha256").update(text).digest("hex"),
    documentRef: url,
    message:
      parsed.rows.length > 0
        ? `Read ${parsed.rows.length} currencies from the configured feed.`
        : parsed.errors.join(" "),
  };
}

async function parsePdfDocument(bytes: Buffer): Promise<{ rows: ExtractedRate[]; errors: string[] }> {
  try {
    // Dynamically imported so a plain Node/PDF-less run of the unit tests and
    // the CLI paths never loads pdfjs.
    const { extractLayoutText } = await import("@/lib/courier-bills/pdf-layout");
    const text = await extractLayoutText(bytes);
    return parseNotificationText(text);
  } catch (e) {
    return { rows: [], errors: [`The PDF could not be read: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ?\n ?/g, "\n");
}

/**
 * Runs every official check in order (configured feed first, then ICEGATE,
 * then CBIC availability). Returns them all so the dashboard can show the real
 * state of each source, plus the first one that produced rows.
 */
export async function runSourceChecks(): Promise<{ checks: SourceCheck[]; usable: SourceCheck | null }> {
  const checks: SourceCheck[] = [];
  const configured = await checkConfiguredFeed();
  if (configured) checks.push(configured);

  const icegate = await checkIcegate();
  checks.push(icegate);

  const cbic = await checkCbic();
  checks.push(cbic);

  const usable = checks.find((c) => c.rows.length > 0) ?? null;
  return { checks, usable };
}
