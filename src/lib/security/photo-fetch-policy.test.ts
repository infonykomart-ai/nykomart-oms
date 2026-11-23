import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedPhotoHost,
  normalizePhotoHost,
  photoFetchAllowlist,
} from "./photo-fetch-policy";

// 2026-11-23 — the allowlist behind the server-side photo fetch used by the
// order / invoice / packing-list PDFs. The private-address guard lives in
// safe-external-fetch.ts; this is the host half of the rule.

test("normalizePhotoHost strips scheme, port, path and a trailing dot", () => {
  assert.equal(normalizePhotoHost("  https://CDN.Example.com:443/a/b.jpg "), "cdn.example.com");
  assert.equal(normalizePhotoHost("cdn.example.com/path"), "cdn.example.com");
  assert.equal(normalizePhotoHost("cdn.example.com."), "cdn.example.com");
  assert.equal(normalizePhotoHost(""), "");
  assert.equal(normalizePhotoHost(null), "");
});

test("the Supabase project host is always allowed", () => {
  const list = photoFetchAllowlist({ NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co" });
  assert.deepEqual(list, ["abc123.supabase.co"]);
  assert.equal(isAllowedPhotoHost("abc123.supabase.co", list), true);
  // A different Supabase project is not this deployment's storage.
  assert.equal(isAllowedPhotoHost("other456.supabase.co", list), false);
});

test("SUPABASE_URL is used when the public URL is absent", () => {
  const list = photoFetchAllowlist({ SUPABASE_URL: "https://fallback.supabase.co" });
  assert.equal(isAllowedPhotoHost("fallback.supabase.co", list), true);
});

test("an exact host in PHOTO_FETCH_ALLOWED_HOSTS is allowed, subdomains are not", () => {
  const list = photoFetchAllowlist({ PHOTO_FETCH_ALLOWED_HOSTS: "cdn.example.com" });
  assert.equal(isAllowedPhotoHost("cdn.example.com", list), true);
  assert.equal(isAllowedPhotoHost("evil.cdn.example.com", list), false);
  assert.equal(isAllowedPhotoHost("cdn.example.com.evil.net", list), false);
});

test("a leading dot allows the base host and its subdomains only", () => {
  const list = photoFetchAllowlist({ PHOTO_FETCH_ALLOWED_HOSTS: ".images.example.com" });
  assert.equal(isAllowedPhotoHost("images.example.com", list), true);
  assert.equal(isAllowedPhotoHost("a.b.images.example.com", list), true);
  assert.equal(isAllowedPhotoHost("images.example.com.evil.net", list), false);
  assert.equal(isAllowedPhotoHost("notimages.example.com", list), false);
});

test("host matching is case-insensitive and tolerates pasted URLs", () => {
  const list = photoFetchAllowlist({
    PHOTO_FETCH_ALLOWED_HOSTS: "https://CDN.Example.com/uploads, other.example.net:8443",
  });
  assert.equal(isAllowedPhotoHost("cdn.example.com", list), true);
  assert.equal(isAllowedPhotoHost("other.example.net", list), true);
  assert.equal(isAllowedPhotoHost("CDN.EXAMPLE.COM", list), true);
});

test("an empty allowlist allows nothing", () => {
  assert.deepEqual(photoFetchAllowlist({}), []);
  assert.equal(isAllowedPhotoHost("cdn.example.com", []), false);
  assert.equal(isAllowedPhotoHost("", ["cdn.example.com"]), false);
});

test("duplicate hosts collapse to one entry", () => {
  const list = photoFetchAllowlist({
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    SUPABASE_URL: "https://ABC.supabase.co/",
    PHOTO_FETCH_ALLOWED_HOSTS: "abc.supabase.co",
  });
  assert.deepEqual(list, ["abc.supabase.co"]);
});
