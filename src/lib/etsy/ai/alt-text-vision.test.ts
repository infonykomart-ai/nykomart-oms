// 2026-11-18 — Alt-text vision path, offline but through the real code.
//
// The alt-text route is the only place the app sends a photo to the model, and
// it was the one branch a generation test never touched. These tests drive the
// real GeminiProvider (SDK included) via the real AIProviderManager, with only
// `fetch` stubbed, so the parts that would otherwise first fail in production
// are checked here:
//
//   * the image really is inlined into the Gemini request as inlineData,
//   * all ten language codes are in the prompt and in the parsed result,
//   * a reply missing a language triggers exactly one repair pass (and still
//     fails loudly if the second pass is also missing one),
//   * over-250-character text is cut at a word boundary and reported,
//   * fetchImageForVision rejects non-images and oversized photos.
//
// Not proven here: that the vendor accepts the key and that the model's
// description of a real photo is accurate. That needs GEMINI_API_KEY — see
// `npm run smoke:etsy-seo` and docs/etsy-seo-generator.md.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AIProviderManager } from "./ai-provider.manager";
import { GeminiProvider, fetchImageForVision } from "./gemini.provider";
import { OpenRouterProvider } from "./openrouter.provider";
import { ProviderError } from "./types";
import { parseAltTextBundle, mergeAltTextEntry, clampAltText } from "./alt-text";
import { altTextSystemPrompt } from "./prompts";
import { ETSY_LANGUAGES } from "../languages";
import { validateAltText, ALT_TEXT_MAX_CHARS } from "../validation";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_MODEL_ID;
});

type Captured = { url: string; body: string };

function stubFetch(reply: (call: Captured, index: number) => Response): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const body = init?.body;
    const call = {
      url: typeof input === "string" ? input : String((input as Request).url),
      body: typeof body === "string" ? body : body ? String(body) : "",
    };
    calls.push(call);
    return reply(call, calls.length - 1);
  }) as typeof fetch;
  return calls;
}

const geminiJson = (text: string, tokens = { input: 900, output: 210 }) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: tokens.input, candidatesTokenCount: tokens.output, totalTokenCount: tokens.input + tokens.output },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

const CODES = ETSY_LANGUAGES.map((l) => l.code);

/** One realistic vision reply: ten native-language description of one photo. */
const BUNDLE: Record<string, string> = {
  nl: "Handgeweven katoenen vloerkleed met floral blokprint, beige en indigo, plat op een lichte houten vloer.",
  fr: "Tapis en coton tissé main au motif floral imprimé, beige et indigo, posé à plat sur un parquet clair.",
  de: "Handgewebter Baumwollteppich mit floralem Blockdruck in Beige und Indigo, flach auf hellem Holzboden.",
  it: "Tappeto in cotone tessuto a mano con stampa floreale beige e indaco, steso su un pavimento in legno chiaro.",
  ja: "ベージュと藍色のフローラル柄がブロックプリントされた手織りコットンラグ。明るい木の床に平らに敷かれています。",
  pl: "Ręcznie tkany bawełniany dywan z kwiatowym nadrukiem w beżu i indygo, płasko ułożony na jasnej drewnianej podłodze.",
  pt: "Tapete de algodão tecido à mão com estampado floral bege e índigo, estendido num chão de madeira clara.",
  ru: "Хлопковый ковёр ручной работы с цветочным принтом бежевого и индиго цвета, лежит на светлом деревянном полу.",
  es: "Alfombra de algodón tejida a mano con estampado floral beige e índigo, extendida sobre un suelo de madera clara.",
  sv: "Handvävd bomullsmatta med floralt blocktryck i beige och indigo, utlagd plant på ett ljust trägolv.",
};

function bundleJson(codes: string[] = CODES, override: Record<string, string> = {}): string {
  const alt_texts = codes.map((code) => ({ language_code: code, text: override[code] ?? BUNDLE[code] }));
  return "```json\n" + JSON.stringify({ alt_texts }) + "\n```";
}

function manager() {
  const gemini = new GeminiProvider({ apiKey: "gemini-test-key", models: ["gemini-flash-latest"] });
  const openrouter = new OpenRouterProvider({ apiKey: null });
  return new AIProviderManager({ gemini, openrouter });
}

const PHOTO = { mimeType: "image/jpeg", dataBase64: "QUJDREVG" };

const request = {
  operation: "alt_text",
  system: altTextSystemPrompt(),
  prompt: `Generate the alt text for this product photo in ALL ten languages.\nLanguages: ${ETSY_LANGUAGES.map((l) => `${l.code} (${l.name})`).join(", ")}.`,
  images: [PHOTO],
  temperature: 0.3,
  config: { backupEnabled: false },
  attemptsPerModel: 1,
  baseDelayMs: 1,
  sleep: async () => {},
};

// ---------------------------------------------------------------------------
// The vision request and its ten-language reply
// ---------------------------------------------------------------------------

test("the vision request inlines the photo and the ten-language reply is parsed", async () => {
  const calls = stubFetch(() => geminiJson(bundleJson()));
  const result = await manager().generateStructured({
    ...request,
    parse: (text) => parseAltTextBundle(text, CODES),
  });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  // The photo travels with the prompt — without this the model is guessing.
  assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: "image/jpeg", data: "QUJDREVG" });
  assert.equal(body.contents[0].parts[0].text, request.prompt);
  assert.match(body.systemInstruction.parts[0].text, /alt text/i);
  assert.equal(body.generationConfig.responseMimeType, "application/json");

  for (const code of CODES) assert.ok(result.data.altTexts[code], `missing ${code}`);

  assert.equal(Object.keys(result.data.altTexts).length, 10);
  assert.deepEqual(result.data.truncated, []);
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-flash-latest");
  assert.deepEqual(result.usage, { inputTokens: 900, outputTokens: 210 });
  assert.equal(result.backupUsed, false);
});

test("over-250-character alt text is cut at a word boundary and reported", async () => {
  const long = `${BUNDLE.de} ${"Zusätzliche Beschreibung des sichtbaren Musters und der Webstruktur. ".repeat(6)}`.trim();
  assert.ok([...long].length > ALT_TEXT_MAX_CHARS);
  stubFetch(() => geminiJson(bundleJson(CODES, { de: long })));

  const result = await manager().generateStructured({
    ...request,
    parse: (text) => parseAltTextBundle(text, CODES),
  });

  const de = result.data.altTexts.de;
  assert.ok([...de].length <= ALT_TEXT_MAX_CHARS, `still ${[...de].length} characters`);
  // It is a prefix cut on a space — Etsy shows the text, so a chopped word is visible.
  assert.ok(long.startsWith(de));
  assert.equal(long.slice(de.length, de.length + 1), " ");
  assert.deepEqual(result.data.truncated, ["de"]);
  assert.equal(validateAltText(de).valid, true);
});

// ---------------------------------------------------------------------------
// Repair and failure behaviour
// ---------------------------------------------------------------------------

test("a reply missing one language gets exactly one repair pass, then succeeds", async () => {
  const calls = stubFetch((_, index) => geminiJson(index === 0 ? bundleJson(CODES.filter((c) => c !== "ja")) : bundleJson()));

  const result = await manager().generateStructured({
    ...request,
    parse: (text) => parseAltTextBundle(text, CODES),
  });

  assert.equal(calls.length, 2);
  const repair = JSON.parse(calls[1].body).contents[0].parts[0].text as string;
  assert.match(repair, /missing alt text for: ja/);
  assert.match(repair, /Return ONLY corrected JSON/);
  // The photo is still attached to the repair request — alt text is about the image.
  assert.deepEqual(JSON.parse(calls[1].body).contents[0].parts[1].inlineData, { mimeType: "image/jpeg", data: "QUJDREVG" });
  assert.equal(Object.keys(result.data.altTexts).length, 10);
});

test("never reports success when both passes are missing languages", async () => {
  stubFetch(() => geminiJson(bundleJson(CODES.filter((c) => c !== "ru"))));

  await assert.rejects(
    () => manager().generateStructured({ ...request, parse: (text) => parseAltTextBundle(text, CODES) }),
    (error: unknown) => error instanceof ProviderError && /Every AI provider failed/.test(error.message)
  );
});

test("an unknown language in the reply is dropped, not stored under a code nobody reads", () => {
  const reply = "```json\n" + JSON.stringify({ altTexts: [...CODES.map((code) => ({ code, text: BUNDLE[code] })), { code: "xx", text: "nonsense" }] }) + "\n```";
  const parsed = parseAltTextBundle(reply, CODES);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.altTexts.xx, undefined);
  assert.equal(Object.keys(parsed.data.altTexts).length, 10);
});

test("a reply that is not JSON is an issue, not an empty saved bundle", () => {
  const parsed = parseAltTextBundle("I cannot see the image, sorry.", CODES);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.issues[0], /missing alt text for/);
});

// ---------------------------------------------------------------------------
// fetchImageForVision — the real download path
// ---------------------------------------------------------------------------

test("fetchImageForVision inlines the downloaded bytes and normalises the mime type", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  stubFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg; charset=binary" } }));

  const image = await fetchImageForVision("https://cdn.example/product/rug-1.jpg");
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(Buffer.from(image.dataBase64, "base64").equals(bytes), true);
});

test("fetchImageForVision refuses a non-image and a 404", async () => {
  stubFetch(() => new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "text/html" } }));
  await assert.rejects(() => fetchImageForVision("https://cdn.example/page"), /Unsupported image type "text\/html"/);

  stubFetch(() => new Response("nope", { status: 404, headers: { "content-type": "image/jpeg" } }));
  await assert.rejects(() => fetchImageForVision("https://cdn.example/missing.jpg"), /HTTP 404/);
});

test("fetchImageForVision refuses a photo larger than 8 MB", async () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 1);
  stubFetch(() => new Response(big, { status: 200, headers: { "content-type": "image/png" } }));
  await assert.rejects(() => fetchImageForVision("https://cdn.example/huge.png"), /larger than 8 MB/);
});

// ---------------------------------------------------------------------------
// Merging one image's text into a listing
// ---------------------------------------------------------------------------

test("merging alt text replaces that image only and stays ordered", () => {
  const existing = [
    { image: 1, text: "Old image one" },
    { image: 3, text: "Image three" },
    { image: 2, text: "Old image two" },
  ];
  const merged = mergeAltTextEntry(existing, 2, BUNDLE.es);
  assert.deepEqual(
    merged.map((a) => a.image),
    [1, 2, 3]
  );
  assert.equal(merged[0].text, "Old image one");
  assert.equal(merged[1].text, BUNDLE.es);
  assert.equal(merged[2].text, "Image three");

  // text shorter than the limit is kept exactly as written
  assert.equal(clampAltText("  handgewebt  "), "handgewebt");
  // merge on an empty listing does not produce a phantom image 0
  assert.deepEqual(mergeAltTextEntry(null, 1, "only"), [{ image: 1, text: "only" }]);
});

