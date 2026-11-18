// 2026-11-18 — Provider error → actionable diagnosis.
// These cases mirror the real failures an operator hits on Vercel: a revoked
// key, a key for a project without access to the model, a retired model id, an
// exhausted quota, and a missing env var. Each must name the var to fix.

import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "./types";
import { diagnosticBody, explainProviderError } from "./diagnostics";

function failure(provider: "gemini" | "openrouter", message: string, status?: number) {
  return { provider, message, status };
}

test("401 from Gemini is reported as a rejected API key", () => {
  const error = new ProviderError("Every AI provider failed.", {
    provider: "gemini",
    retryable: false,
    kind: "unavailable",
    failures: [failure("gemini", "Gemini (gemini-flash-latest) failed: Error: 401 UNAUTHENTICATED: API key not valid.", 401)],
  });
  const diagnostic = explainProviderError(error);
  assert.equal(diagnostic.code, "invalid_api_key");
  assert.equal(diagnostic.status, 503);
  assert.equal(diagnostic.provider, "gemini");
  assert.deepEqual(diagnostic.envVars, ["GEMINI_API_KEY"]);
  assert.match(diagnostic.fix, /GEMINI_API_KEY/);
  assert.match(diagnostic.fix, /redeploy/i);
  assert.doesNotMatch(diagnostic.message, /Every AI provider failed/);
  assert.match(diagnostic.detail ?? "", /API key not valid/);
});

test("403 PERMISSION_DENIED names the OpenRouter key, not the model", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "openrouter",
      retryable: false,
      failures: [failure("openrouter", "OpenRouter responded 403: {\"error\":\"Forbidden\"}", 403)],
    })
  );
  assert.equal(diagnostic.code, "invalid_api_key");
  assert.deepEqual(diagnostic.envVars, ["OPENROUTER_API_KEY"]);
  assert.match(diagnostic.fix, /OPENROUTER_API_KEY/);
  assert.match(diagnostic.fix, /company key|Settings/i);
});

test("a 404 points at the model id, not the key", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "gemini",
      retryable: false,
      failures: [failure("gemini", "Gemini (gemini-9-ultra) failed: Error: 404 NOT_FOUND: model not found", 404)],
    })
  );
  assert.equal(diagnostic.code, "model_not_found");
  assert.equal(diagnostic.status, 502);
  assert.deepEqual(diagnostic.envVars, ["GEMINI_MODEL_ID"]);
  assert.match(diagnostic.title, /gemini-9-ultra/);
});

test("OpenRouter 'no endpoints found' is a model problem", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "openrouter",
      retryable: false,
      failures: [failure("openrouter", "OpenRouter responded 404: No endpoints found for model", 404)],
    })
  );
  assert.equal(diagnostic.code, "model_not_found");
  assert.deepEqual(diagnostic.envVars, ["OPENROUTER_MODEL_ID"]);
  assert.match(diagnostic.fix, /openrouter\.ai\/models/);
});

test("429 / RESOURCE_EXHAUSTED is a quota problem and is retryable", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "gemini",
      retryable: false,
      failures: [failure("gemini", "Gemini (gemini-flash-latest) failed: Error: 429 RESOURCE_EXHAUSTED: Quota exceeded", 429)],
    })
  );
  assert.equal(diagnostic.code, "quota_exceeded");
  assert.equal(diagnostic.status, 429);
  assert.equal(diagnostic.retryable, true);
  assert.deepEqual(diagnostic.envVars, []);
  assert.match(diagnostic.fix, /quota|billing/i);
});

test("missing OPENROUTER_MODEL_ID is separated from a missing key", () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_MODEL_ID;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-present";
  delete process.env.OPENROUTER_MODEL_ID;
  try {
    const diagnostic = explainProviderError(
      new ProviderError("Every AI provider failed.", {
        provider: "openrouter",
        retryable: false,
        failures: [
          failure("gemini", "Gemini rejected: 401 UNAUTHENTICATED"),
          { provider: "openrouter", message: "OPENROUTER_MODEL_ID is not configured." },
        ],
      })
    );
    // The invalid key outranks the backup provider's missing model.
    assert.equal(diagnostic.code, "invalid_api_key");
    assert.equal(diagnostic.provider, "gemini");
  } finally {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENROUTER_MODEL_ID;
    else process.env.OPENROUTER_MODEL_ID = oldModel;
  }

  const onlyModel = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "openrouter",
      retryable: false,
      failures: [{ provider: "openrouter", message: "OPENROUTER_MODEL_ID is not configured." }],
    })
  );
  assert.equal(onlyModel.code, "model_not_configured");
  assert.deepEqual(onlyModel.envVars, ["OPENROUTER_MODEL_ID"]);
  assert.equal(onlyModel.status, 503);
});

test("missing GEMINI_API_KEY is a 503 with the env var named", () => {
  const diagnostic = explainProviderError(
    new ProviderError("GEMINI_API_KEY is not configured.", { provider: "gemini", retryable: false, kind: "auth" }),
    "gemini"
  );
  assert.equal(diagnostic.code, "provider_not_configured");
  assert.equal(diagnostic.status, 503);
  assert.deepEqual(diagnostic.envVars, ["GEMINI_API_KEY"]);
  assert.match(diagnostic.fix, /Vercel/);
});

test("5xx is reported as a vendor outage, not a configuration error", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "gemini",
      retryable: false,
      failures: [failure("gemini", "Gemini (gemini-flash-latest) failed: Error: 503 UNAVAILABLE: overloaded", 503)],
    })
  );
  assert.equal(diagnostic.code, "provider_unavailable");
  assert.equal(diagnostic.retryable, true);
  assert.deepEqual(diagnostic.envVars, []);
  assert.match(diagnostic.fix, /backup|OPENROUTER/i);
});

test("a schema failure after the repair pass says retry / stronger model", () => {
  const diagnostic = explainProviderError(
    new ProviderError("Every AI provider failed.", {
      provider: "gemini",
      retryable: false,
      failures: [failure("gemini", "The model's JSON did not pass validation: tags must be exactly 13")],
    })
  );
  assert.equal(diagnostic.code, "invalid_output");
  assert.equal(diagnostic.retryable, true);
  assert.match(diagnostic.fix, /Retry/i);
});

test("health-check strings (no ProviderError wrapper) still map", () => {
  assert.equal(explainProviderError("API key not valid. Please pass a valid API key.", "gemini").code, "invalid_api_key");
  assert.equal(explainProviderError("OPENROUTER_MODEL_ID is not set.", "openrouter").code, "model_not_configured");
  assert.equal(explainProviderError("fetch failed: ETIMEDOUT", "gemini").code, "timeout");
});

test("an unclassifiable failure keeps the raw detail and points at the test button", () => {
  const diagnostic = explainProviderError(new Error("something odd happened"), "gemini");
  assert.equal(diagnostic.code, "provider_failed");
  assert.equal(diagnostic.status, 502);
  assert.equal(diagnostic.detail, "something odd happened");
  assert.match(diagnostic.fix, /Test Gemini/);
});

test("the response body never contains a key or the raw aggregation prefix", () => {
  const body = diagnosticBody(
    explainProviderError(
      new ProviderError("Every AI provider failed. Gemini rejected sk-or-v1-secret", {
        provider: "gemini",
        retryable: false,
        failures: [failure("gemini", "Error: 401 UNAUTHENTICATED", 401)],
      })
    )
  );
  assert.equal(body.code, "invalid_api_key");
  assert.deepEqual(Object.keys(body).sort(), ["code", "detail", "envVars", "fix", "provider", "retryable", "title"]);
  assert.doesNotMatch(JSON.stringify(body), /sk-or-v1-secret/);
});
