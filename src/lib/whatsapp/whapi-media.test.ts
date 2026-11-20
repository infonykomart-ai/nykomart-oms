import assert from "node:assert/strict";
import { test } from "node:test";
import { extractWhapiMediaReference } from "./whapi-media";

// 2026-11-20 — live bug: Whapi answered the /media upload successfully but our
// parser found no id, so the photo was dropped. These tests pin every response
// shape we now accept, and prove that "nothing usable" is distinguishable so the
// caller can fall back to the data URI instead of failing the send.

test("reads the documented { id } response", () => {
  assert.deepEqual(extractWhapiMediaReference({ id: "abc-123" }), { id: "abc-123", url: null });
});

test("reads wrapped media/data/result/file ids", () => {
  assert.deepEqual(extractWhapiMediaReference({ media: { id: "m-1" } }), { id: "m-1", url: null });
  assert.deepEqual(extractWhapiMediaReference({ data: { id: "d-1" } }), { id: "d-1", url: null });
  assert.deepEqual(extractWhapiMediaReference({ result: { id: "r-1" } }), { id: "r-1", url: null });
  assert.deepEqual(extractWhapiMediaReference({ file: { id: "f-1" } }), { id: "f-1", url: null });
  assert.deepEqual(extractWhapiMediaReference({ files: [{ id: "a-1" }] }), { id: "a-1", url: null });
});

test("reads numeric ids and aliases", () => {
  assert.deepEqual(extractWhapiMediaReference({ id: 12345 }), { id: "12345", url: null });
  assert.deepEqual(extractWhapiMediaReference({ media_id: "mid-9" }), { id: "mid-9", url: null });
  assert.deepEqual(extractWhapiMediaReference({ mediaId: "mid-10" }), { id: "mid-10", url: null });
});

test("reads a hosted media URL when that is all Whapi returned", () => {
  assert.deepEqual(extractWhapiMediaReference({ url: "https://files.example/a.jpg" }), {
    id: null,
    url: "https://files.example/a.jpg",
  });
  assert.deepEqual(extractWhapiMediaReference({ media: { url: "https://files.example/b.jpg" } }), {
    id: null,
    url: "https://files.example/b.jpg",
  });
});

test("returns nothing usable for an unrecognised body", () => {
  assert.deepEqual(extractWhapiMediaReference(null), { id: null, url: null });
  assert.deepEqual(extractWhapiMediaReference({}), { id: null, url: null });
  assert.deepEqual(extractWhapiMediaReference({ ok: true }), { id: null, url: null });
  assert.deepEqual(extractWhapiMediaReference({ id: "" }), { id: null, url: null });
});
