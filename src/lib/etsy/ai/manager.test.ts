import { test } from "node:test";
import assert from "node:assert/strict";
import { AIProviderManager, type AttemptLog } from "./ai-provider.manager";
import { ProviderError, type AIProvider, type ProviderHealth, type ProviderResponse, type StructuredRequest } from "./types";

type Mode = "ok" | "timeout" | "rate_limit" | "invalid_json" | "auth";

class FakeProvider implements AIProvider {
  calls: Array<{ model: string; prompt: string }> = [];
  constructor(
    readonly name: "gemini" | "openrouter",
    private modes: Record<string, Mode>,
    private configured = true
  ) {}

  isConfigured() {
    return this.configured;
  }

  models() {
    return Object.keys(this.modes);
  }

  async generateStructured(request: StructuredRequest): Promise<ProviderResponse> {
    const model = request.model ?? this.models()[0];
    this.calls.push({ model, prompt: request.prompt });
    const mode = this.modes[model] ?? "ok";
    if (mode === "timeout") {
      throw new ProviderError("timeout", { provider: this.name, model, retryable: true, kind: "timeout" });
    }
    if (mode === "rate_limit") {
      throw new ProviderError("429 rate limit", { provider: this.name, model, retryable: true, status: 429, kind: "rate_limit" });
    }
    if (mode === "auth") {
      throw new ProviderError("401 invalid key", { provider: this.name, model, retryable: false, status: 401, kind: "auth" });
    }
    if (mode === "invalid_json") {
      return { provider: this.name, model, text: "this is not json", usage: { inputTokens: 10, outputTokens: 2 }, latencyMs: 5 };
    }
    return {
      provider: this.name,
      model,
      text: JSON.stringify({ title: "Juteteppich", tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`) }),
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 7,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    return { ok: this.configured, provider: this.name, model: this.models()[0] ?? null };
  }
}

const noSleep = async () => {};

function parse(text: string) {
  try {
    const data = JSON.parse(text) as { title: string; tags: string[] };
    if (!data.title || data.tags.length !== 13) return { ok: false as const, issues: ["schema mismatch"] };
    return { ok: true as const, data };
  } catch {
    return { ok: false as const, issues: ["not JSON"] };
  }
}

function options(gemini: AIProvider, openrouter: AIProvider, logs: AttemptLog[] = [], backupEnabled = true) {
  return {
    operation: "listing",
    system: "sys",
    prompt: "prompt",
    parse,
    config: { backupEnabled },
    gemini,
    openrouter,
    baseDelayMs: 1,
    attemptsPerModel: 2,
    sleep: noSleep,
    onAttempt: (log: AttemptLog) => {
      logs.push(log);
    },
  };
}

test("Gemini success uses the primary provider and records usage", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-flash-latest": "ok" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" }, false);
  const logs: AttemptLog[] = [];
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter, logs));
  assert.equal(result.provider, "gemini");
  assert.equal(result.backupUsed, false);
  assert.equal(result.data.title, "Juteteppich");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, "success");
  assert.equal(logs[0].usage?.inputTokens, 100);
});

test("a timeout is retried on the same model, then succeeded", async () => {
  let attempt = 0;
  class Flaky extends FakeProvider {
    async generateStructured(request: StructuredRequest) {
      attempt += 1;
      if (attempt === 1) {
        throw new ProviderError("timeout", { provider: "gemini", model: request.model, retryable: true, kind: "timeout" });
      }
      return super.generateStructured(request);
    }
  }
  const gemini = new Flaky("gemini", { "gemini-flash-latest": "ok" });
  const openrouter = new FakeProvider("openrouter", {}, false);
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter));
  assert.equal(attempt, 2);
  assert.equal(result.provider, "gemini");
});

test("Gemini rate limit falls back to OpenRouter and flags backup usage", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "rate_limit", "gemini-2": "timeout" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" });
  const logs: AttemptLog[] = [];
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter, logs));
  assert.equal(result.provider, "openrouter");
  assert.equal(result.backupUsed, true);
  assert.ok(logs.some((l) => l.provider === "gemini" && l.status === "error"));
  assert.ok(logs.some((l) => l.provider === "openrouter" && l.status === "success" && l.backupUsed));
});

test("without OpenRouter the alternate Gemini model is tried", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "rate_limit", "gemini-2": "ok" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" }, false);
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter));
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-2");
  assert.equal(result.backupUsed, false);
});

test("invalid JSON triggers a repair prompt and then succeeds", async () => {
  let call = 0;
  class Repair extends FakeProvider {
    async generateStructured(request: StructuredRequest) {
      call += 1;
      if (call === 1) {
        this.calls.push({ model: request.model ?? "m", prompt: request.prompt });
        return { provider: "gemini" as const, model: request.model ?? "m", text: "not json", usage: null, latencyMs: 1 };
      }
      return super.generateStructured(request);
    }
  }
  const gemini = new Repair("gemini", { "gemini-1": "ok" });
  const openrouter = new FakeProvider("openrouter", {}, false);
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter));
  assert.equal(result.provider, "gemini");
  assert.equal(call, 2);
  assert.ok(gemini.calls[1].prompt.includes("failed validation"));
});

test("a truncated reply is retried with a compact request and the second pass is accepted", async () => {
  let call = 0;
  class Truncating extends FakeProvider {
    async generateStructured(request: StructuredRequest) {
      call += 1;
      this.calls.push({ model: request.model ?? "m", prompt: request.prompt });
      if (call === 1) {
        return { provider: "gemini" as const, model: request.model ?? "m", text: '{"title":"Juteteppich","desc', usage: null, latencyMs: 1, truncated: true };
      }
      return super.generateStructured(request);
    }
  }
  const gemini = new Truncating("gemini", { "gemini-1": "ok" });
  const openrouter = new FakeProvider("openrouter", {}, false);
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter));
  assert.equal(result.provider, "gemini");
  assert.equal(call, 2);
  // The repair pass must ask for a compact reply, not just repeat the schema.
  assert.match(gemini.calls[1].prompt, /COMPACT/);
  assert.match(gemini.calls[1].prompt, /output-token limit/i);
});

test("truncated on both passes fails as a truncation, not as generic invalid JSON", async () => {
  class AlwaysTruncating extends FakeProvider {
    async generateStructured(request: StructuredRequest) {
      this.calls.push({ model: request.model ?? "m", prompt: request.prompt });
      return { provider: "gemini" as const, model: request.model ?? "m", text: '{"title":"Jut', usage: null, latencyMs: 1, truncated: true };
    }
  }
  const gemini = new AlwaysTruncating("gemini", { "gemini-1": "ok" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "timeout" });
  const manager = new AIProviderManager({ gemini, openrouter });

  await assert.rejects(
    () => manager.generateStructured(options(gemini, openrouter)),
    (error: unknown) => {
      if (!(error instanceof ProviderError)) return false;
      assert.match(error.message, /truncated/i);
      const failure = error.options.failures?.find((f) => f.provider === "gemini");
      assert.equal(failure?.kind, "truncated");
      return true;
    }
  );
});

test("provider failure on both providers throws — never a fake success", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "timeout", "gemini-2": "timeout" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "timeout" });
  const manager = new AIProviderManager({ gemini, openrouter });

  await assert.rejects(
    () => manager.generateStructured(options(gemini, openrouter)),
    (error: unknown) => error instanceof ProviderError && /Every AI provider failed/.test(error.message)
  );
});

test("backup disabled means OpenRouter is never called", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "timeout", "gemini-2": "timeout" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" });
  const manager = new AIProviderManager({ gemini, openrouter });

  await assert.rejects(() => manager.generateStructured(options(gemini, openrouter, [], false)));
  assert.equal(openrouter.calls.length, 0);
});

test("an auth error stops trying further Gemini models", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "auth", "gemini-2": "ok" });
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" });
  const manager = new AIProviderManager({ gemini, openrouter });

  const result = await manager.generateStructured(options(gemini, openrouter));
  assert.equal(result.provider, "openrouter");
  assert.equal(gemini.calls.filter((c) => c.model === "gemini-2").length, 0);
});

test("no configured provider at all is an error, not empty output", async () => {
  const gemini = new FakeProvider("gemini", { "gemini-1": "ok" }, false);
  const openrouter = new FakeProvider("openrouter", { "backup-model": "ok" }, false);
  const manager = new AIProviderManager({ gemini, openrouter });

  await assert.rejects(() => manager.generateStructured(options(gemini, openrouter)));
});
