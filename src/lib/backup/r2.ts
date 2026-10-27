// Cloudflare R2 storage for the automated backups (2026-10-23).
//
// WHY A HAND-ROLLED S3 CLIENT: R2 is S3-compatible, and the "official" way to
// talk to it is @aws-sdk/client-s3 — a large dependency this app doesn't
// otherwise need. The backup has exactly three operations (PUT an object, GET
// an object, LIST a prefix), and SigV4 signing for those is ~60 lines of
// node:crypto. Keeping it dependency-free means the weekly backup cannot
// break because an SDK major version changed, and it adds nothing to the
// client bundle (this file is only ever imported from server code).
//
// Credentials come from the deployment's environment (Settings → Environment),
// never from the database — one bucket for every company, exactly like the
// Supabase service-role key:
//   R2_ACCOUNT_ID        Cloudflare account id (the R2 dashboard shows it)
//   R2_ACCESS_KEY_ID     R2 API token's Access Key ID
//   R2_SECRET_ACCESS_KEY R2 API token's Secret Access Key
//   R2_BUCKET            bucket name, e.g. "nyko-backups"
//   R2_PREFIX            optional key prefix (default "backups")
//
// The R2 account endpoint is path-style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>.
// R2's SigV4 region is the literal string "auto".
import { createHash, createHmac } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix: string;
};

/** The exact env var names the deployment must define. */
export const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/**
 * Reads R2 settings from the environment. Returns null when the deployment
 * hasn't been configured yet — callers show a setup message instead of
 * throwing on every page load. An INCOMPLETE configuration is reported as
 * null too, with the missing names available via `missingR2EnvVars()`.
 */
export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const prefix = (process.env.R2_PREFIX?.trim() || "backups").replace(/^\/+|\/+$/g, "");
  return { accountId, accessKeyId, secretAccessKey, bucket, prefix };
}

export function missingR2EnvVars(): string[] {
  return R2_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

// ---------------------------------------------------------------------------
// SigV4
// ---------------------------------------------------------------------------

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding — the only encoding SigV4 canonicalization accepts. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** S3 canonical URI: each path segment encoded once (never double-encoded). */
function canonicalUriFor(bucket: string, key: string): string {
  const segments = key.split("/").map(encodeRfc3986);
  return `/${encodeRfc3986(bucket)}/${segments.join("/")}`;
}

function canonicalQueryFor(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join("&");
}

function headerValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export type SigV4Input = {
  method: string;
  host: string;
  /** Already-encoded absolute path, e.g. "/my-bucket/backups/a.json". */
  canonicalUri: string;
  /** Raw (un-encoded) query parameters. */
  query?: Record<string, string>;
  /** Headers to sign; must include host. Names are case-insensitive. */
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for Cloudflare R2, "us-east-1" for AWS. */
  region: string;
  service: string;
  /** ISO-8601 basic timestamp, e.g. "20261023T101500Z". */
  amzDate: string;
};

/**
 * Pure SigV4 (header-based) signer, exported so it can be checked against
 * AWS's published test vectors without touching the network. Returns the
 * `Authorization` header value plus the signed-header list.
 */
export function signAwsV4(input: SigV4Input): { authorization: string; signature: string; signedHeaders: string } {
  const query = canonicalQueryFor(input.query ?? {});
  const lower: Array<[string, string]> = Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), headerValue(v)]);
  lower.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(";");
  const canonicalHeaders = lower.map(([k, v]) => `${k}:${v}\n`).join("");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders };
}

// ---------------------------------------------------------------------------
// R2 operations
// ---------------------------------------------------------------------------

function amzDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function r2Endpoint(config: R2Config): string {
  return `${config.accountId}.r2.cloudflarestorage.com`;
}

function r2FetchUrl(config: R2Config, key: string, query?: Record<string, string>): string {
  const qs = query ? canonicalQueryFor(query) : "";
  return `https://${r2Endpoint(config)}${canonicalUriFor(config.bucket, key)}${qs ? `?${qs}` : ""}`;
}

/**
 * Builds the headers of one signed request. `host` is signed but deliberately
 * NOT sent — Node's fetch sets it from the URL (and the values are identical),
 * while undici may reject an explicitly-supplied forbidden header.
 */
async function signedHeaders(
  config: R2Config,
  method: string,
  key: string,
  payload: Uint8Array | string | null,
  extraHeaders: Record<string, string>,
  query?: Record<string, string>,
  canonicalUriOverride?: string
): Promise<Record<string, string>> {
  const amzDate = amzDateNow();
  const payloadHash = sha256Hex(payload ?? "");
  const headersToSign: Record<string, string> = {
    host: r2Endpoint(config),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders,
  };
  const signed = signAwsV4({
    method,
    host: headersToSign.host,
    canonicalUri: canonicalUriOverride ?? canonicalUriFor(config.bucket, key),
    query,
    headers: headersToSign,
    payloadHash,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
    amzDate,
  });
  const headers: Record<string, string> = {
    Authorization: signed.authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders,
  };
  return headers;
}

/** Uploads one object. Overwrites silently, same as S3 PUT. */
export async function r2PutObject(
  config: R2Config,
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<void> {
  const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const headers = await signedHeaders(config, "PUT", key, bytes, {
    "content-type": contentType,
  });
  const res = await fetch(r2FetchUrl(config, key), { method: "PUT", headers, body: new Uint8Array(bytes) });
  if (!res.ok) {
    throw new Error(`R2 upload failed for ${key} (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
}

/** Downloads one object. Throws on any non-2xx response. */
export async function r2GetObject(config: R2Config, key: string): Promise<Buffer> {
  const headers = await signedHeaders(config, "GET", key, null, {});
  const res = await fetch(r2FetchUrl(config, key), { method: "GET", headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`R2 download failed for ${key} (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export type R2ObjectInfo = { key: string; size: number; lastModified: string | null };

type ListBucketResult = {
  ListBucketResult?: {
    Contents?: Array<{ Key?: string; Size?: number | string; LastModified?: string }> | { Key?: string; Size?: number | string; LastModified?: string };
    IsTruncated?: boolean | string;
    NextContinuationToken?: string;
  };
};

/**
 * Lists every object under `prefix` (paging through ListObjectsV2
 * continuation tokens — R2 returns at most 1000 keys per call).
 */
export async function r2ListObjects(config: R2Config, prefix: string): Promise<R2ObjectInfo[]> {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
  const out: R2ObjectInfo[] = [];
  let continuationToken: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (continuationToken) query["continuation-token"] = continuationToken;
    // ListObjectsV2 is a BUCKET-level call: canonical URI is "/<bucket>" with
    // no trailing segment at all, which canonicalUriFor would add for an empty
    // key — hence the explicit override here and in the URL below.
    const headers = await signedHeaders(config, "GET", "", null, {}, query, `/${encodeRfc3986(config.bucket)}`);
    const url = `https://${r2Endpoint(config)}/${encodeRfc3986(config.bucket)}?${canonicalQueryFor(query)}`;
    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    if (!res.ok) {
      throw new Error(`R2 list failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    }
    const parsed = parser.parse(await res.text()) as ListBucketResult;
    const result = parsed.ListBucketResult;
    const contents = result?.Contents;
    const entries = Array.isArray(contents) ? contents : contents ? [contents] : [];
    for (const entry of entries) {
      if (!entry.Key) continue;
      out.push({
        key: entry.Key,
        size: Number(entry.Size ?? 0),
        lastModified: entry.LastModified ?? null,
      });
    }
    const truncated = result?.IsTruncated === true || result?.IsTruncated === "true";
    if (!truncated || !result?.NextContinuationToken) break;
    continuationToken = result.NextContinuationToken;
  }
  return out;
}
