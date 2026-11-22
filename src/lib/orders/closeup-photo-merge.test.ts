import assert from "node:assert/strict";
import test from "node:test";
import {
  closeupFileNameFromUrl,
  dedupeCloseupPhotos,
  mergeCloseupPhotoSources,
  normalizeCloseupUrls,
  planAttachmentSync,
  type CloseupPhoto,
} from "./closeup-photo-merge";

// 2026-11-22d — Phase 3 follow-up: the pure merge / dedupe / sync-plan logic
// behind src/lib/orders/closeup-photos.ts (no DB, no Next, no React).

function photo(id: string, url: string, sortOrder = 0): CloseupPhoto {
  return { id, url, fileName: closeupFileNameFromUrl(url), sortOrder };
}

test("normalizeCloseupUrls trims, drops blanks and keeps the first of each URL", () => {
  assert.deepEqual(
    normalizeCloseupUrls([" a.jpg ", "", "b.jpg", "a.jpg", null, undefined, "  "]),
    ["a.jpg", "b.jpg"]
  );
  assert.deepEqual(normalizeCloseupUrls([]), []);
});

test("dedupeCloseupPhotos keeps one photo per URL, the earliest entry winning", () => {
  const deduped = dedupeCloseupPhotos([
    { id: "typed", url: "https://x/a.jpg", fileName: "a.jpg", sortOrder: 2 },
    { id: "legacy", url: "https://x/a.jpg", fileName: "a.jpg", sortOrder: 0 },
    { id: "blank", url: "   ", fileName: null, sortOrder: 3 },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, "typed");
  assert.equal(deduped[0].sortOrder, 2);
});

test("dedupeCloseupPhotos trims the stored URL", () => {
  const deduped = dedupeCloseupPhotos([{ id: "x", url: "  https://x/a.jpg  ", fileName: null, sortOrder: 0 }]);
  assert.equal(deduped[0].url, "https://x/a.jpg");
});

test("mergeCloseupPhotoSources: typed rows come first, legacy fill the gaps, URLs never repeat", () => {
  const typed = [photo("t1", "https://x/1.jpg", 0), photo("t2", "https://x/2.jpg", 1)];
  const legacy = [photo("l1", "https://x/2.jpg", 1), photo("l2", "https://x/3.jpg", 2)];

  const merged = mergeCloseupPhotoSources(typed, legacy);
  assert.deepEqual(
    merged.map((p) => p.url),
    ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"]
  );
  // The typed row's identity is the one kept for the overlapping URL.
  assert.equal(merged[1].id, "t2");
});

test("mergeCloseupPhotoSources: legacy-only database (migration pending) still shows every photo", () => {
  const merged = mergeCloseupPhotoSources([], [photo("l1", "https://x/1.jpg", 0)]);
  assert.deepEqual(merged.map((p) => p.id), ["l1"]);
});

test("mergeCloseupPhotoSources: two empty sources yield no photos", () => {
  assert.deepEqual(mergeCloseupPhotoSources([], []), []);
});

test("closeupFileNameFromUrl derives the name from the URL path", () => {
  assert.equal(closeupFileNameFromUrl("https://cdn.example.com/orders/abc/close%20up.jpg"), "close up.jpg");
  assert.equal(closeupFileNameFromUrl("https://cdn.example.com/a/b/photo.png?token=1"), "photo.png");
  assert.equal(closeupFileNameFromUrl("orders/abc.jpg"), "abc.jpg");
  assert.equal(closeupFileNameFromUrl("https://cdn.example.com/"), null);
  assert.equal(closeupFileNameFromUrl(""), null);
});

test("planAttachmentSync: an unchanged list plans nothing", () => {
  const plan = planAttachmentSync(
    [
      { id: "r1", file_url: "a.jpg", sort_order: 0 },
      { id: "r2", file_url: "b.jpg", sort_order: 1 },
    ],
    ["a.jpg", "b.jpg"]
  );
  assert.deepEqual(plan, { toDelete: [], toInsert: [], toReorder: [] });
});

test("planAttachmentSync: new URLs are inserted at their saved position", () => {
  const plan = planAttachmentSync(
    [{ id: "r1", file_url: "a.jpg", sort_order: 0 }],
    ["a.jpg", "b.jpg", "c.jpg"]
  );
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toReorder, []);
  assert.deepEqual(plan.toInsert, [
    { file_url: "b.jpg", file_name: "b.jpg", sort_order: 1 },
    { file_url: "c.jpg", file_name: "c.jpg", sort_order: 2 },
  ]);
});

test("planAttachmentSync: a URL no longer on the order is deleted, and survivors move", () => {
  const plan = planAttachmentSync(
    [
      { id: "r1", file_url: "a.jpg", sort_order: 0 },
      { id: "r2", file_url: "b.jpg", sort_order: 1 },
      { id: "r3", file_url: "c.jpg", sort_order: 2 },
    ],
    ["c.jpg", "a.jpg"]
  );
  assert.deepEqual(plan.toDelete, ["r2"]);
  assert.deepEqual(plan.toInsert, []);
  assert.deepEqual(plan.toReorder, [
    { id: "r1", sort_order: 1 },
    { id: "r3", sort_order: 0 },
  ]);
});

test("planAttachmentSync: duplicate rows for one URL keep the first and delete the rest", () => {
  const plan = planAttachmentSync(
    [
      { id: "r1", file_url: "a.jpg", sort_order: 0 },
      { id: "r2", file_url: "a.jpg", sort_order: 1 },
      { id: "r3", file_url: "b.jpg", sort_order: 2 },
    ],
    ["a.jpg", "b.jpg"]
  );
  assert.deepEqual(plan.toDelete, ["r2"]);
  assert.deepEqual(plan.toInsert, []);
  assert.deepEqual(plan.toReorder, [{ id: "r3", sort_order: 1 }]);
});

test("planAttachmentSync: the wanted list is trimmed/deduped before comparing", () => {
  const plan = planAttachmentSync(
    [{ id: "r1", file_url: "a.jpg", sort_order: 0 }],
    [" a.jpg ", "b.jpg", "b.jpg", ""]
  );
  assert.deepEqual(plan.toDelete, []);
  assert.deepEqual(plan.toReorder, []);
  assert.deepEqual(plan.toInsert, [{ file_url: "b.jpg", file_name: "b.jpg", sort_order: 1 }]);
});

test("planAttachmentSync: rows with no URL and a missing/unknown position are cleaned up", () => {
  const blank = planAttachmentSync([{ id: "r1", file_url: "  ", sort_order: 0 }], []);
  assert.deepEqual(blank, { toDelete: ["r1"], toInsert: [], toReorder: [] });

  // sort_order unknown (null) counts as "needs writing".
  const unknown = planAttachmentSync([{ id: "r1", file_url: "a.jpg", sort_order: null }], ["a.jpg"]);
  assert.deepEqual(unknown.toReorder, [{ id: "r1", sort_order: 0 }]);
});
