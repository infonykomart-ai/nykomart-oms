// 2026-10-17 — automatic customs/export exchange rates.
//
// User: "exchange rate abhi kaha se aari hai workflow dekho mere hisab se
// https://www.dgft.gov.in/CP/?opt=currency-list-exchange-rates is site se
// ana chahiye jo auto update rahe ... agar ye link kaam nahi kare to
// https://foservices.icegate.gov.in/#/services/viewExchangeRate yaha se
// agar yaha se bhi nahi mile to https://eximin.net/Customrates. lekin auto
// matic aani chahiye convert hokar export ki rate sabhi courency ki."
//
// Design:
//   * Provider chain, in exactly that order. Every provider is attempted;
//     the first one that returns usable rates wins and the UI names it.
//   * Same no-cron refresh pattern as src/lib/fx/rates.ts: any page that
//     needs rates calls loadCustomsRates(); if the stored snapshot is
//     missing/older than 12h it re-fetches and writes it back. A failed
//     refresh never breaks the page — the last saved rates are returned
//     with `stale: true`.
//   * The EXPORT rate is what gets stored into `exchange_rates`
//     (rate_to_inr), because that is the rate an exporter actually
//     invoices/values at, and exchange_rates is what every invoice and
//     valuation calculation in this app already reads. Rows written by this
//     job carry remark "AUTO — <provider> export rate" so a manually
//     entered CBIC notification is never overwritten with an API figure
//     unless it is the SAME currency+effective date.
//   * DGFT's public page sits behind a WAF that rejects server-side
//     requests with HTTP 403 (verified 2026-10-17 from this environment),
//     and ICEGATE's exchange-rate screen is an Angular app with no
//     server-rendered table. Both are still attempted first, exactly as
//     asked; EXIM India's public customs-rate endpoint is the one that
//     actually answers, and is the verified working fallback
//     (POST https://eximindiaonline.in:4000/customs/get_customs_website).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const CUSTOMS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
// Per-server-instance memo so a workspace that has not run the snapshot
// migration yet does not re-hit three external providers on every request
// (the DB cache takes over as soon as the table exists).
let memoryCache: { snapshot: CustomsRatesSnapshot; at: number } | null = null;
const MEMORY_TTL_MS = 10 * 60 * 1000;

export type CustomsRateRow = {
  code: string;
  name: string;
  /** ₹ per 1 unit on the customs IMPORT rate. */
  importRate: number | null;
  /** ₹ per 1 unit on the customs EXPORT rate — the one stored/used. */
  exportRate: number;
  effectiveDate: string | null;
  notificationNo: string | null;
};

export type CustomsRatesSnapshot = {
  rows: CustomsRateRow[];
  provider: string;
  sourceUrl: string;
  effectiveDate: string | null;
  notificationNo: string | null;
  fetchedAt: string | null;
  stale: boolean;
  warning: string | null;
};

export const EMPTY_CUSTOMS_RATES: CustomsRatesSnapshot = {
  rows: [],
  provider: "—",
  sourceUrl: "",
  effectiveDate: null,
  notificationNo: null,
  fetchedAt: null,
  stale: true,
  warning: "No customs exchange rates available yet — press Refresh rates.",
};

/** Currency display name → ISO code. Covers the names DGFT/ICEGATE/EXIMIN publish. */
const NAME_TO_CODE: Record<string, string> = {
  "us dollar": "USD", "us dollar (100)": "USD", "u.s.dollar": "USD", "u.s. dollar": "USD", "us$": "USD", dollar: "USD",
  "pound sterling": "GBP", "sterling pound": "GBP", "great britain pound": "GBP", "british pound": "GBP", pound: "GBP",
  euro: "EUR", "euro (100)": "EUR",
  "japanese yen": "JPY", "japanese yen (100)": "JPY",
  "australian dollar": "AUD", "canadian dollar": "CAD", "new zealand dollar": "NZD",
  "newzealand dollar": "NZD", "swiss franc": "CHF", "chinese yuan": "CNY", "chinese renminbi": "CNY",
  "hong kong dollar": "HKD", "singapore dollar": "SGD", "uae dirham": "AED", "u.a.e. dirham": "AED",
  "saudi riyal": "SAR", "saudi arabian riyal": "SAR", "qatari riyal": "QAR", "kuwaiti dinar": "KWD",
  "bahraini dinar": "BHD", "omani rial": "OMR", "danish kroner": "DKK", "danish krone": "DKK",
  "norwegian krone": "NOK", "norwegian kroner": "NOK", "swedish krona": "SEK", "swedish kroner": "SEK",
  "south african rand": "ZAR",
  "korean won": "KRW", "malaysian ringgit": "MYR", "thai baht": "THB", "turkish lira": "TRY",
  "russian ruble": "RUB", "russian rouble": "RUB", "brazilian real": "BRL", "sri lankan rupee": "LKR",
  "bangladesh taka": "BDT", "bangladeshi taka": "BDT", "nepalese rupee": "NPR", "pakistani rupee": "PKR",
  "indonesian rupiah": "IDR", "philippine peso": "PHP", "vietnamese dong": "VND", "israeli shekel": "ILS",
  "taiwan dollar": "TWD", "mexican peso": "MXN", "polish zloty": "PLN", "czech koruna": "CZK",
  "hungarian forint": "HUF", "egyptian pound": "EGP", "kenyan shilling": "KES", "nigerian naira": "NGN",
  "ghanaian cedi": "GHS", "zambian kwacha": "ZMW", "ethiopian birr": "ETB", "tanzanian shilling": "TZS",
  "ugandan shilling": "UGX", "moroccan dirham": "MAD", "tunisian dinar": "TND", "algerian dinar": "DZD",
  "kazakhstani tenge": "KZT", "uzbekistani som": "UZS", "argentine peso": "ARS", "chilean peso": "CLP",
  "colombian peso": "COP", "peruvian sol": "PEN", "icelandic krona": "ISK", "croatian kuna": "HRK",
  "bulgarian lev": "BGN", "romanian leu": "RON", "ukrainian hryvnia": "UAH", "afghan afghani": "AFN",
  "myanmar kyat": "MMK", "maldives rufiyaa": "MVR", "mauritius rupee": "MUR", "seychelles rupee": "SCR",
};

const CODE_RE = /^[A-Z]{3}$/;

function normalizeCode(rawName: string): string | null {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (CODE_RE.test(name.toUpperCase())) return name.toUpperCase();
  const key = name.toLowerCase();
  if (NAME_TO_CODE[key]) return NAME_TO_CODE[key];
  // "US Dollar (100)" / "Japanese Yen (100)" — the number is a quote unit.
  const base = key.replace(/\s*\(\d+\)\s*$/, "").trim();
  return NAME_TO_CODE[base] ?? null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
        Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return null; // network / timeout / TLS — caller moves to the next provider
  }
}

// ---------------------------------------------------------------------------
// Provider 1 — DGFT (asked for first). Its public page is a JS app behind a
// WAF; both the HTML table and the JSON endpoint shape it serves are tried.
// ---------------------------------------------------------------------------
async function fetchDgft(): Promise<CustomsRateRow[] | null> {
  const url = "https://www.dgft.gov.in/CP/?opt=currency-list-exchange-rates";
  const res = await fetchWithTimeout(url);
  if (!res?.ok) return null;
  const rows = parseRateTable(await res.text());
  return rows.length > 0 ? rows : null;
}

/**
 * Generic table parser for both DGFT's HTML and any JSON payload whose rows
 * carry a currency name plus import/export figures. It is deliberately
 * tolerant: the three providers all publish the same facts with different
 * field names, and the point is to keep working when one of them changes
 * markup rather than to depend on one exact shape.
 */
function parseRateTable(text: string): CustomsRateRow[] {
  const out = new Map<string, CustomsRateRow>();

  // JSON payloads: array(s) of objects with a currency-ish name and rates.
  try {
    const json = JSON.parse(text) as unknown;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      const nameRaw =
        (obj.currency as string) ??
        (obj.currency_name as string) ??
        (obj.currencyName as string) ??
        (obj.name as string) ??
        (obj.description as string);
      const expRaw =
        obj.export ??
        obj.export_rate ??
        obj.exportRate ??
        obj.exportrate ??
        obj.ex_rate ??
        obj.rate;
      const impRaw = obj.import ?? obj.import_rate ?? obj.importRate ?? obj.importrate;
      const code = nameRaw ? normalizeCode(String(nameRaw)) : null;
      const exportRate = toNumber(expRaw);
      if (code && exportRate) {
        out.set(code, {
          code,
          name: String(nameRaw),
          importRate: toNumber(impRaw),
          exportRate,
          effectiveDate: (obj.date as string) ?? (obj.effective_date as string) ?? (obj.effectiveDate as string) ?? null,
          notificationNo: (obj.notification_no as string) ?? (obj.notificationNo as string) ?? null,
        });
      }
      Object.values(obj).forEach(walk);
    };
    walk(json);
    if (out.size > 0) return Array.from(out.values());
  } catch {
    // not JSON — fall through to the HTML parser
  }

  // HTML: one <tr> per currency, e.g. <td>AUD</td><td>Australian Dollar</td>
  // <td>2.75</td><td>2.72</td><td>2026-10-16</td>. Cells are read by their
  // text content, and the row is accepted only when a currency code/name and
  // at least one positive rate are found.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text))) {
    const cells = Array.from(m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    );
    if (cells.length < 2) continue;
    const nameCell = cells.find((c) => !/^\d+(\.\d+)?$/.test(c) && !/^\d{4}-\d{2}-\d{2}$/.test(c) && c.length > 1);
    if (!nameCell) continue;
    const code = normalizeCode(nameCell);
    if (!code) continue;
    const nums = cells.map(toNumber).filter((n): n is number => n != null);
    if (nums.length === 0) continue;
    // Import is published first, export second when both exist.
    const importRate = nums.length >= 2 ? nums[0] : null;
    const exportRate = nums.length >= 2 ? nums[1] : nums[0];
    const dateCell = cells.find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) ?? null;
    out.set(code, { code, name: nameCell, importRate, exportRate, effectiveDate: dateCell, notificationNo: null });
  }
  return Array.from(out.values());
}

// ---------------------------------------------------------------------------
// Provider 2 — ICEGATE. Its exchange-rate screen is an Angular route whose
// data is fetched client-side; the page itself carries no table, so this
// adapter attempts the public JSON service and simply reports "no data"
// when that does not answer (the caller then uses EXIMIN).
// ---------------------------------------------------------------------------
async function fetchIcegate(): Promise<CustomsRateRow[] | null> {
  const res = await fetchWithTimeout("https://foservices.icegate.gov.in/icegate/api/exchange-rate");
  if (!res?.ok) return null;
  const text = await res.text();
  if (text.trim().startsWith("<")) return null;
  const rows = parseRateTable(text);
  return rows.length > 0 ? rows : null;
}

// ---------------------------------------------------------------------------
// Provider 3 — EXIM India (verified working; DGFT-equivalent customs rates).
// POST /customs/get_customs_website { date: null } returns the latest
// notification's rows: { currency, import, export, date, notification_no }.
// ---------------------------------------------------------------------------
async function fetchEximin(): Promise<CustomsRateRow[] | null> {
  const res = await fetchWithTimeout("https://eximindiaonline.in:4000/customs/get_customs_website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: null }),
  });
  if (!res?.ok) return null;
  const text = await res.text();
  let json: { data?: unknown } | null = null;
  try {
    json = JSON.parse(text) as { data?: unknown };
  } catch {
    return null;
  }
  const list = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
  const out = new Map<string, CustomsRateRow>();
  for (const item of list) {
    const rawName = String(item.currency ?? "").trim();
    const code = normalizeCode(rawName);
    const exportRate = toNumber(item.export);
    if (!code || !exportRate) continue;
    out.set(code, {
      code,
      name: rawName,
      importRate: toNumber(item.import),
      exportRate,
      effectiveDate: typeof item.date === "string" ? item.date.slice(0, 10) : null,
      notificationNo: item.notification_no ? String(item.notification_no).replace(/,\s*$/, "") : null,
    });
  }
  return out.size > 0 ? Array.from(out.values()) : null;
}

/**
 * Customs notifications quote a few currencies per 100 units ("Japanese Yen
 * (100)", "Korean Won (100)", ...). A rate published as 59.75 for 100 JPY is
 * ₹0.5975 per yen, not ₹59.75 — storing the raw figure would over-value those
 * currencies 100×. The provider's own name tells us the quote unit when it is
 * parenthesised; JPY is per-100 by long-standing customs convention even when
 * the name omits it (verified against eximin's live figures, 2026-10-17).
 */
function normalizeQuoteUnits(rows: CustomsRateRow[]): CustomsRateRow[] {
  return rows.map((r) => {
    const m = r.name.match(/\((\d+)\)/);
    // JPY and KRW are the two customs conventions quoted per 100 units
    // (eximin publishes "Japanese Yen (100)" and "Korean Won" at 6.85 —
    // ₹0.0685 per won, i.e. per 100).
    const divisor = m ? Number(m[1]) : r.code === "JPY" || r.code === "KRW" ? 100 : 1;
    if (!Number.isFinite(divisor) || divisor <= 1) return r;
    return {
      ...r,
      importRate: r.importRate == null ? null : Math.round((r.importRate / divisor) * 1e6) / 1e6,
      exportRate: Math.round((r.exportRate / divisor) * 1e6) / 1e6,
    };
  });
}

async function fetchFromProviders(): Promise<{
  rows: CustomsRateRow[];
  provider: string;
  sourceUrl: string;
} | null> {
  const dgft = await fetchDgft();
  if (dgft) {
    return { rows: normalizeQuoteUnits(dgft), provider: "DGFT", sourceUrl: "https://www.dgft.gov.in/CP/?opt=currency-list-exchange-rates" };
  }
  const icegate = await fetchIcegate();
  if (icegate) {
    return { rows: normalizeQuoteUnits(icegate), provider: "ICEGATE", sourceUrl: "https://foservices.icegate.gov.in/#/services/viewExchangeRate" };
  }
  const eximin = await fetchEximin();
  if (eximin) {
    return { rows: normalizeQuoteUnits(eximin), provider: "EXIM India (eximin.net)", sourceUrl: "https://eximin.net/Customrates" };
  }
  return null;
}

type StoredRow = {
  currency_code: string;
  currency_name: string | null;
  import_rate: number | null;
  export_rate: number;
  effective_date: string | null;
  notification_no: string | null;
  source: string;
  fetched_at: string;
};

/**
 * Live customs/export rates. Reads the saved snapshot, refreshes it from the
 * provider chain when older than 12 hours (or `force`), and never throws —
 * a provider outage degrades to the last saved rates.
 */
export async function loadCustomsRates(
  supabase: SupabaseClient<Database>,
  opts: { force?: boolean } = {}
): Promise<CustomsRatesSnapshot> {
  if (!opts.force && memoryCache && Date.now() - memoryCache.at < MEMORY_TTL_MS) {
    return memoryCache.snapshot;
  }
  // The migration may not have been run yet — treat a missing table exactly
  // like an empty one so the feature still works (live, uncached).
  const { data: storedRaw, error: readError } = await supabase
    .from("customs_exchange_rates")
    .select("currency_code, currency_name, import_rate, export_rate, effective_date, notification_no, source, fetched_at")
    .order("currency_code");

  const stored = (readError ? [] : (storedRaw ?? [])) as StoredRow[];
  const newest = stored.reduce<string | null>((acc, r) => (!acc || r.fetched_at > acc ? r.fetched_at : acc), null);
  const ageMs = newest ? Date.now() - new Date(newest).getTime() : Number.POSITIVE_INFINITY;
  const needsRefresh = opts.force === true || ageMs > CUSTOMS_MAX_AGE_MS || stored.length === 0;

  if (!needsRefresh) {
    const snapshot = snapshotFromStored(stored, false, null);
    memoryCache = { snapshot, at: Date.now() };
    return snapshot;
  }

  const live = await fetchFromProviders();
  if (!live) {
    if (stored.length > 0) {
      const snapshot = snapshotFromStored(stored, true, "Could not reach DGFT, ICEGATE or eximin.net just now — showing the last saved rates.");
      memoryCache = { snapshot, at: Date.now() };
      return snapshot;
    }
    return {
      ...EMPTY_CUSTOMS_RATES,
      warning:
        "Could not reach DGFT, ICEGATE or eximin.net just now. Check the server's outbound network access, then press Refresh rates.",
    };
  }

  const fetchedAt = new Date().toISOString();
  const effectiveDate = live.rows.find((r) => r.effectiveDate)?.effectiveDate ?? null;
  const notificationNo = live.rows.find((r) => r.notificationNo)?.notificationNo ?? null;

  // Every currency the master knows about, so exchange_rates' FK is always
  // satisfied — a rate for a code not in `currencies` is shown here but not
  // written into the legal master.
  const { data: currencyRows } = await supabase.from("currencies").select("code");
  const known = new Set((currencyRows ?? []).map((c) => c.code));

  const upserts = live.rows
    .filter((r) => known.has(r.code))
    .map((r) => ({
      currency_code: r.code,
      currency_name: r.name,
      import_rate: r.importRate,
      export_rate: r.exportRate,
      effective_date: r.effectiveDate ?? effectiveDate,
      notification_no: r.notificationNo ?? notificationNo,
      source: live.provider,
      source_url: live.sourceUrl,
      fetched_at: fetchedAt,
    }));

  let warning: string | null = null;
  if (readError) {
    warning =
      "Live rates loaded, but the saved snapshot table is missing — run db/2026-10-17-customs-exchange-rates.sql to keep them cached between visits.";
  }
  if (upserts.length > 0 && !readError) {
    const { error } = await supabase.from("customs_exchange_rates").upsert(upserts, { onConflict: "currency_code" });
    if (error) warning = `Live rates loaded, but saving the snapshot failed: ${error.message}`;
  }

  // Feed the legal master too: the EXPORT rate (what an exporter invoices
  // at) becomes that currency's rate for the notification's effective date.
  // Existing rows for the same currency+date are updated only when they were
  // themselves written by this job — a manually entered CBIC row is kept.
  if (upserts.length > 0) {
    const effective = effectiveDate ?? fetchedAt.slice(0, 10);
    const { data: existing } = await supabase
      .from("exchange_rates")
      .select("id, currency_code, remark")
      .in("currency_code", upserts.map((u) => u.currency_code))
      .eq("effective_from", effective);
    const existingByCode = new Map((existing ?? []).map((r) => [r.currency_code, r]));
    const inserts: Database["public"]["Tables"]["exchange_rates"]["Insert"][] = [];
    for (const u of upserts) {
      const remark = `AUTO — ${live.provider} export rate`;
      const found = existingByCode.get(u.currency_code);
      if (found && !(found.remark ?? "").startsWith("AUTO —")) continue;
      inserts.push({
        currency_code: u.currency_code,
        effective_from: effective,
        rate_to_inr: u.export_rate,
        notification_no: u.notification_no,
        remark,
      });
    }
    if (inserts.length > 0) {
      // Best-effort: exchange_rates may not exist yet on a brand-new
      // workspace, and this must never stop the rates being shown.
      await supabase.from("exchange_rates").upsert(inserts, { onConflict: "currency_code,effective_from" });
    }
  }

  const snapshot: CustomsRatesSnapshot = {
    rows: live.rows.sort((a, b) => a.code.localeCompare(b.code)),
    provider: live.provider,
    sourceUrl: live.sourceUrl,
    effectiveDate,
    notificationNo,
    fetchedAt,
    stale: false,
    warning,
  };
  memoryCache = { snapshot, at: Date.now() };
  return snapshot;
}

function snapshotFromStored(stored: StoredRow[], stale: boolean, warning: string | null): CustomsRatesSnapshot {
  const rows = stored
    .map((r) => ({
      code: r.currency_code,
      name: r.currency_name ?? r.currency_code,
      importRate: r.import_rate == null ? null : Number(r.import_rate),
      exportRate: Number(r.export_rate),
      effectiveDate: r.effective_date,
      notificationNo: r.notification_no,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    rows,
    provider: stored[0]?.source ?? "—",
    sourceUrl: "",
    effectiveDate: stored.find((r) => r.effective_date)?.effective_date ?? null,
    notificationNo: stored.find((r) => r.notification_no)?.notification_no ?? null,
    fetchedAt: stored.reduce<string | null>((acc, r) => (!acc || r.fetched_at > acc ? r.fetched_at : acc), null),
    stale,
    warning,
  };
}
