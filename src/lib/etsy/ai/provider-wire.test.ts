// 2026-11-18 — Wire-format tests for the two real provider classes.
//
// These are NOT provider mocks: OpenRouterProvider and GeminiProvider run for
// real (including the @google/genai SDK), with only the HTTP transport stubbed.
// That is the part a live call would otherwise be the first to exercise —
// request URL, auth headers, JSON body shape, image inlining, and parsing of
// the vendor payload into {text, usage, latency}. A wrong field name or a
// missing system instruction would fail here instead of in production.
//
// What this cannot prove: that the vendor accepts our key and that model
// quality is good. That needs a real key, and is reported as unverified.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterProvider } from "./openrouter.provider";
import { GeminiProvider } from "./gemini.provider";
import { ProviderError } from "./types";

const realFetch = globalThis.fetch;

type Captured = { url: string; method: string; headers: Record<string, string>; body: string };

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_MODEL_ID;
  delete process.env.OPENROUTER_MODEL_ID;
});

function stubFetch(reply: (call: Captured) => Response | Promise<Response>): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const addHeaders = (value: unknown) => {
      if (!value) return;
      if (value instanceof Headers) value.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else if (Array.isArray(value)) for (const [k, v] of value as Array<[string, string]>) headers[String(k).toLowerCase()] = String(v);
      else if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) headers[k.toLowerCase()] = String(v);
    };
    addHeaders((input as Request | undefined)?.headers);
    addHeaders(init?.headers);

    let body = init?.body;
    if (input instanceof Request) {
      try {
        body = await input.clone().text();
      } catch {
        /* body already consumed / none */
      }
    }
    const call: Captured = {
      url: typeof input === "string" ? input : String((input as Request).url),
      method: init?.method ?? (input as Request)?.method ?? "GET",
      headers,
      body: typeof body === "string" ? body : body ? String(body) : "",
    };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  return calls;
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

test("OpenRouter sends the documented chat-completions request and parses usage", async () => {
  let calls: Captured[] = [];
  calls = stubFetch(() =>
    json({
      id: "gen-1",
      model: "meta-llama/llama-3.1-8b-instruct",
      choices: [{ message: { role: "assistant", content: '{"title":"Katoenen vloerkleed"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 512, completion_tokens: 64, total_tokens: 576 },
    })
  );

  const provider = new OpenRouterProvider({ apiKey: "or-test-key", models: ["meta-llama/llama-3.1-8b-instruct"], appUrl: "https://oms.example" });
  const result = await provider.generateStructured({
    system: "You are a localizer.",
    prompt: "Write the Dutch listing.",
    images: [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
    temperature: 0.4,
    maxOutputTokens: 300,
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, "Bearer or-test-key");
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.headers["http-referer"], "https://oms.example");

  const body = JSON.parse(call.body);
  assert.equal(body.model, "meta-llama/llama-3.1-8b-instruct");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[0].content, "You are a localizer.");
  assert.equal(body.messages[1].role, "user");
  assert.equal(body.messages[1].content[0].type, "text");
  assert.equal(body.messages[1].content[0].text, "Write the Dutch listing.");
  assert.equal(body.messages[1].content[1].type, "image_url");
  assert.equal(body.messages[1].content[1].image_url.url, "data:image/jpeg;base64,QUJD");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.plugins, [{ id: "response-healing" }]);
  assert.equal(body.temperature, 0.4);
  assert.equal(body.max_tokens, 300);

  assert.equal(result.text, '{"title":"Katoenen vloerkleed"}');
  assert.equal(result.provider, "openrouter");
  assert.deepEqual(result.usage, { inputTokens: 512, outputTokens: 64 });
  assert.ok(result.latencyMs >= 0);
});

test("OpenRouter 429 becomes a retryable ProviderError, an empty reply becomes kind=empty", async () => {
  stubFetch(() => json({ error: { message: "rate limited" } }, 429));
  const limited = new OpenRouterProvider({ apiKey: "k", models: ["m"] });
  await assert.rejects(
    () => limited.generateStructured({ system: "s", prompt: "p" }),
    (error: unknown) => error instanceof ProviderError && error.retryable === true && error.options.status === 429 && error.options.kind === "rate_limit"
  );

  stubFetch(() => json({ choices: [{ message: { content: "   " } }] }));
  const empty = new OpenRouterProvider({ apiKey: "k", models: ["m"] });
  await assert.rejects(
    () => empty.generateStructured({ system: "s", prompt: "p" }),
    (error: unknown) => error instanceof ProviderError && error.options.kind === "empty"
  );
});

test("OpenRouter finish_reason=length is reported as a truncated reply", async () => {
  stubFetch(() =>
    json({
      choices: [{ message: { role: "assistant", content: '{"title":"Katoenen vloerkleed","description":"Ein halb' }, finish_reason: "length" }],
      usage: { prompt_tokens: 400, completion_tokens: 8192 },
    })
  );
  const provider = new OpenRouterProvider({ apiKey: "k", models: ["free/model"] });
  const result = await provider.generateStructured({ system: "s", prompt: "p", maxOutputTokens: 8192 });
  assert.equal(result.truncated, true);
  assert.match(result.text, /"description"/);
});

test("OpenRouter content parts are joined into one text", async () => {
  stubFetch(() =>
    json({
      choices: [
        {
          message: { role: "assistant", content: [{ type: "text", text: '{"title":"Teppich"}' }] },
          finish_reason: "stop",
        },
      ],
    })
  );
  const provider = new OpenRouterProvider({ apiKey: "k", models: ["m"] });
  const result = await provider.generateStructured({ system: "s", prompt: "p" });
  assert.equal(result.text, '{"title":"Teppich"}');
  assert.equal(result.truncated, false);
});

test("a key without a model id is not configured (never a guessed model)", async () => {
  delete process.env.OPENROUTER_MODEL_ID;
  const provider = new OpenRouterProvider({ apiKey: "k" });
  assert.equal(provider.isConfigured(), false);
  assert.deepEqual(provider.models(), []);
  await assert.rejects(
    () => provider.generateStructured({ system: "s", prompt: "p" }),
    (error: unknown) => error instanceof ProviderError && error.options.kind === "auth"
  );
});

// ---------------------------------------------------------------------------
// Gemini (real @google/genai SDK)
// ---------------------------------------------------------------------------

test("Gemini SDK call carries the system instruction, JSON mode, model and inline image", async () => {
  const calls = stubFetch(() =>
    json({
      candidates: [{ content: { role: "model", parts: [{ text: '{"title":"Baumwollteppich"}' }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 45, totalTokenCount: 366 },
      modelVersion: "gemini-flash-latest",
    })
  );

  const provider = new GeminiProvider({ apiKey: "gemini-test-key", models: ["gemini-flash-latest"] });
  const result = await provider.generateStructured({
    model: "gemini-flash-latest",
    system: "You are a localizer.",
    prompt: "Write the German listing.",
    images: [{ mimeType: "image/png", dataBase64: "QUJD" }],
    temperature: 0.3,
    maxOutputTokens: 512,
  });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.match(call.url, /generativelanguage\.googleapis\.com/);
  assert.match(call.url, /models\/gemini-flash-latest:generateContent/);
  // The SDK authenticates with a header, not a ?key= query parameter.
  assert.equal(call.headers["x-goog-api-key"], "gemini-test-key");
  assert.equal(call.method, "POST");

  const body = JSON.parse(call.body);
  assert.equal(body.systemInstruction.parts[0].text, "You are a localizer.");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0.3);
  assert.equal(body.generationConfig.maxOutputTokens, 512);
  assert.equal(body.contents[0].role, "user");
  assert.equal(body.contents[0].parts[0].text, "Write the German listing.");
  assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: "image/png", data: "QUJD" });

  assert.equal(result.text, '{"title":"Baumwollteppich"}');
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-flash-latest");
  assert.deepEqual(result.usage, { inputTokens: 321, outputTokens: 45 });
});

test("Gemini finishReason MAX_TOKENS is reported as a truncated reply", async () => {
  stubFetch(() =>
    json({
      candidates: [
        { content: { role: "model", parts: [{ text: '{"title":"Baumwollteppich","description":"Halb' }] }, finishReason: "MAX_TOKENS", index: 0 },
      ],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 8192, totalTokenCount: 8492 },
    })
  );
  const provider = new GeminiProvider({ apiKey: "k", models: ["gemini-flash-latest"] });
  const result = await provider.generateStructured({ system: "s", prompt: "p", maxOutputTokens: 8192 });
  assert.equal(result.truncated, true);
});

test("Gemini 401/403 is classified as an auth error the manager will not retry", async () => {
  stubFetch(() =>
    json(
      {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
        },
      },
      400
    )
  );
  const provider = new GeminiProvider({ apiKey: "bad", models: ["gemini-flash-latest"] });
  await assert.rejects(
    () => provider.generateStructured({ system: "s", prompt: "p" }),
    (error: unknown) => error instanceof ProviderError && /API key not valid/.test(error.message)
  );
});

test("Gemini with no key fails as auth, not as an empty listing", async () => {
  const provider = new GeminiProvider({ apiKey: null, models: ["gemini-flash-latest"] });
  assert.equal(provider.isConfigured(), false);
  await assert.rejects(
    () => provider.generateStructured({ system: "s", prompt: "p" }),
    (error: unknown) => error instanceof ProviderError && error.options.kind === "auth"
  );
});
