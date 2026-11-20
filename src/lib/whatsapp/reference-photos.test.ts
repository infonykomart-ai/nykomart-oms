import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allOrderPhotoUrls,
  buildReferencePhotoCaption,
  deliveredPhotoUrls,
  extractCloseUpPhotoUrls,
  isReferencePhotoUrl,
  isSupportedImageMime,
  mainOrderPhotoUrl,
  manualReferencePhotoEventId,
  orderUpdateEventId,
  referencePhotoCaptionFor,
  referencePhotoFileName,
  shouldSkipDuplicate,
} from "./reference-photos";

// 2026-11-20 — "REF PHOTO <order no>" photo selection and duplicate rules.
// These are exactly the scenarios the automation has to get right:
// zero / one / many close-ups, unrelated documents only, mixed, dedupe,
// repeated webhook for the same update, and size units staying untouched.

const MAIN = "https://cdn.example.com/orders/PO-A1119-main.jpg";

test("order with zero close-up photos sends no attachments", () => {
  const urls = extractCloseUpPhotoUrls({ id: "o1", ref_no: "PO-A1119", photo_url: MAIN, photo_urls: [MAIN] });
  assert.deepEqual(urls, []);
});

test("order with no photos at all is safe", () => {
  assert.deepEqual(extractCloseUpPhotoUrls({ id: "o1", ref_no: "PO-A1119", photo_url: null, photo_urls: null }), []);
  assert.equal(mainOrderPhotoUrl({ id: "o1", ref_no: "PO-A1119" }), null);
});

test("order with one close-up photo sends exactly that photo", () => {
  const closeup = "https://cdn.example.com/orders/PO-A1119-ref-1.jpg";
  const urls = extractCloseUpPhotoUrls({
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [MAIN, closeup],
  });
  assert.deepEqual(urls, [closeup]);
});

test("order with multiple close-up photos sends every one, in saved order", () => {
  const urls = extractCloseUpPhotoUrls({
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [
      MAIN,
      "https://cdn.example.com/orders/ref-1.jpg",
      "https://cdn.example.com/orders/ref-2.png",
      "https://cdn.example.com/orders/ref-3.webp",
    ],
  });
  assert.deepEqual(urls, [
    "https://cdn.example.com/orders/ref-1.jpg",
    "https://cdn.example.com/orders/ref-2.png",
    "https://cdn.example.com/orders/ref-3.webp",
  ]);
});

test("unrelated images only (invoices, labels, documents) are excluded", () => {
  const urls = extractCloseUpPhotoUrls({
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [
      MAIN,
      "https://cdn.example.com/orders/PO-A1119-invoice.pdf",
      "https://cdn.example.com/orders/shipping-label.png",
      "https://cdn.example.com/orders/packing-slip.jpg",
      "https://cdn.example.com/orders/customs-document.webp",
      "https://cdn.example.com/orders/statement.pdf",
    ],
  });
  assert.deepEqual(urls, []);
});

test("mixed close-up and unrelated images keeps only real close-ups", () => {
  const urls = extractCloseUpPhotoUrls({
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [
      MAIN,
      "https://cdn.example.com/orders/ref-1.jpg",
      "https://cdn.example.com/orders/invoice-123.png",
      "https://cdn.example.com/orders/ref-2.jpeg?width=1200",
    ],
  });
  assert.deepEqual(urls, [
    "https://cdn.example.com/orders/ref-1.jpg",
    "https://cdn.example.com/orders/ref-2.jpeg?width=1200",
  ]);
});

test("duplicate URLs are attached only once and the main photo is never a close-up", () => {
  const closeup = "https://cdn.example.com/orders/ref-1.jpg";
  const urls = extractCloseUpPhotoUrls({
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [MAIN, closeup, closeup, "  " + closeup + "  "],
  });
  assert.deepEqual(urls, [closeup]);
  assert.deepEqual(allOrderPhotoUrls({ id: "o1", ref_no: "PO-A1119", photo_url: MAIN, photo_urls: [MAIN, closeup] }), [
    MAIN,
    closeup,
  ]);
});

test("URL validation accepts JPG/JPEG/PNG/WEBP and extensionless hosted images", () => {
  for (const url of [
    "https://x.test/a.jpg",
    "https://x.test/a.JPEG",
    "https://x.test/a.png",
    "https://x.test/a.webp",
    "https://x.test/storage/v1/object/public/order-photos/user/abc",
  ]) {
    assert.equal(isReferencePhotoUrl(url), true, url);
  }
  for (const url of ["ftp://x.test/a.jpg", "not a url", "https://x.test/a.pdf", "https://x.test/a.docx"]) {
    assert.equal(isReferencePhotoUrl(url), false, url);
  }
});

test("caption uses the order's own reference dynamically", () => {
  assert.equal(buildReferencePhotoCaption("PO-A1119"), "REF PHOTO PO-A1119");
  assert.equal(buildReferencePhotoCaption("PO-A1120"), "REF PHOTO PO-A1120");
  assert.equal(buildReferencePhotoCaption("PO-A1121"), "REF PHOTO PO-A1121");
  assert.equal(buildReferencePhotoCaption("  "), "REF PHOTO");
});

test("sequential image captions keep the same reference", () => {
  assert.equal(referencePhotoCaptionFor("PO-A1119", 0, 3), "REF PHOTO PO-A1119");
  assert.equal(referencePhotoCaptionFor("PO-A1119", 1, 3), "REF PHOTO PO-A1119 (2/3)");
  assert.equal(referencePhotoCaptionFor("PO-A1119", 2, 3), "REF PHOTO PO-A1119 (3/3)");
  assert.equal(referencePhotoCaptionFor("PO-A1119", 0, 1), "REF PHOTO PO-A1119");
});

test("event id is stable for the same order state (duplicate webhook is a no-op)", () => {
  const order = {
    id: "o1",
    ref_no: "PO-A1119",
    photo_url: MAIN,
    photo_urls: [MAIN, "https://cdn.example.com/orders/ref-1.jpg"],
    status: "Confirmed",
    qty: 10,
    size_label: "4x6 FT",
  };
  assert.equal(orderUpdateEventId(order), orderUpdateEventId({ ...order }));
  // A repeated webhook / double click for the same state must not resend.
  assert.equal(shouldSkipDuplicate({ delivery_status: "sent" }, false), true);
});

test("any real order change produces a new event id", () => {
  const base = { id: "o1", ref_no: "PO-A1119", photo_url: MAIN, photo_urls: [MAIN], status: "Confirmed", qty: 10 };
  const event = orderUpdateEventId(base);
  assert.notEqual(orderUpdateEventId({ ...base, status: "Dispatched" }), event);
  assert.notEqual(orderUpdateEventId({ ...base, qty: 11 }), event);
  assert.notEqual(orderUpdateEventId({ ...base, size_label: "5x7 FT" }), event);
  assert.notEqual(
    orderUpdateEventId({ ...base, photo_urls: [MAIN, "https://cdn.example.com/orders/ref-1.jpg"] }),
    event
  );
  assert.notEqual(orderUpdateEventId({ ...base, id: "o2" }), event);
});

test("manual send is a deliberate new event, so it may send again", () => {
  assert.notEqual(
    manualReferencePhotoEventId("o1", "first-click"),
    manualReferencePhotoEventId("o1", "second-click")
  );
  assert.equal(manualReferencePhotoEventId("o1", "same"), manualReferencePhotoEventId("o1", "same"));
});

test("failed and partial events are retryable; sent events are not", () => {
  assert.equal(shouldSkipDuplicate({ delivery_status: "failed" }, false), false);
  assert.equal(shouldSkipDuplicate({ delivery_status: "partial" }, false), false);
  assert.equal(shouldSkipDuplicate({ delivery_status: "pending" }, false), false);
  assert.equal(shouldSkipDuplicate({ delivery_status: "sent" }, true), false); // explicit retry
});

test("partial retry skips only the photos that already went out", () => {
  const delivered = deliveredPhotoUrls({
    delivery_status: "partial",
    attachment_photo_ids: ["a.jpg", "b.jpg", "c.jpg"],
    whatsapp_message_ids: ["wa-1", "", "wa-3"],
  });
  assert.equal(delivered.has("a.jpg"), true);
  assert.equal(delivered.has("b.jpg"), false);
  assert.equal(delivered.has("c.jpg"), true);
});

test("only JPG/JPEG/PNG/WEBP are accepted as image attachments", () => {
  assert.equal(isSupportedImageMime("image/jpeg"), true);
  assert.equal(isSupportedImageMime("image/jpg"), true);
  assert.equal(isSupportedImageMime("image/png"), true);
  assert.equal(isSupportedImageMime("image/webp"), true);
  assert.equal(isSupportedImageMime("image/gif"), false);
  assert.equal(isSupportedImageMime("application/pdf"), false);
  assert.equal(isSupportedImageMime(null), false);
});

test("file names follow the order reference and image type", () => {
  assert.equal(referencePhotoFileName("PO-A1119", 0, "image/jpeg"), "PO-A1119-ref-1.jpg");
  assert.equal(referencePhotoFileName("PO A1119", 1, "image/png"), "PO-A1119-ref-2.png");
  assert.equal(referencePhotoFileName("PO-A1119", 2, "image/webp"), "PO-A1119-ref-3.webp");
});
