/**
 * Provider adapters (plan Phase 3): fake provider, Anthropic + OpenAI-
 * compatible adapters against local stub servers (deterministic, offline),
 * env-driven selection, and a credential-gated LIVE integration test that
 * SKIPS loudly unless ANTHROPIC_API_KEY (+ ANTHROPIC_TEST_MODEL) is set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AnthropicInstructorProvider } from "../src/anthropic.ts";
import { OpenAICompatibleProvider } from "../src/openaiCompatible.ts";
import { FakeInstructorProvider } from "../src/fake.ts";
import { MockInstructorProvider } from "../src/mock.ts";
import { providerFromEnv } from "../src/index.ts";
import { initialState } from "../../session-events/src/reducer.ts";
import type { BuiltContext, HintRequest } from "../src/types.ts";

const lab = {
  id: "inspect-generated-changes",
  title: "Inspect AI-generated changes",
  objective: "Review, find the defect, fix it surgically.",
  tasks: [{ id: "t1", text: "Review the diff" }],
};

function req(overrides: Partial<HintRequest> = {}): HintRequest {
  return {
    state: initialState(lab.id, "learner-1"),
    lab,
    reason: { kind: "question", text: "help?", stuck: false },
    hintLevel: 2,
    promptVersion: "v2",
    ...overrides,
  };
}

const context: BuiltContext = { system: "SYSTEM", user: "USER", promptVersion: "v2" };

async function withStub(
  body: unknown,
  fn: (baseUrl: string, requests: Array<Record<string, unknown>>) => Promise<void>,
): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const server: Server = createServer((rq, rs) => {
    let data = "";
    rq.on("data", (c) => (data += c));
    rq.on("end", () => {
      requests.push(JSON.parse(data) as Record<string, unknown>);
      rs.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── fake provider ──────────────────────────────────────────────────────────

test("fake provider replays its script with exact usage and records calls", async () => {
  const fake = new FakeInstructorProvider([
    { message: "first", usage: { promptTokens: 11, completionTokens: 3 } },
    { message: "second" },
  ]);
  const first = await fake.generateHint(req(), context);
  assert.equal(first.message, "first");
  assert.deepEqual(first.usage, { promptTokens: 11, completionTokens: 3 });
  assert.equal(first.level, 2);
  assert.equal((await fake.generateHint(req({ hintLevel: 9 }), context)).level, 5, "level clamps to MAX");
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].context.system, "SYSTEM");
  await assert.rejects(fake.generateHint(req(), context), /script exhausted/);
});

test("fake provider without a script repeats a deterministic default", async () => {
  const fake = new FakeInstructorProvider();
  const a = await fake.generateHint(req(), context);
  const b = await fake.generateHint(req(), context);
  assert.equal(a.message, b.message);
  assert.equal(a.provider, "fake");
});

// ── anthropic adapter (stubbed) ────────────────────────────────────────────

test("anthropic adapter maps BuiltContext → /v1/messages and usage incl. cache tokens", async () => {
  await withStub(
    {
      content: [{ type: "text", text: "What does the failing test expect?" }],
      model: "resolved-model-id",
      stop_reason: "end_turn",
      usage: { input_tokens: 1500, output_tokens: 25, cache_read_input_tokens: 1200 },
    },
    async (baseUrl, requests) => {
      const provider = new AnthropicInstructorProvider({ baseUrl, apiKey: "k", model: "cfg-model" });
      const hint = await provider.generateHint(req(), context);
      assert.equal(requests[0].system, "SYSTEM");
      assert.deepEqual(requests[0].messages, [{ role: "user", content: "USER" }]);
      assert.equal(hint.provider, "anthropic");
      assert.equal(hint.model, "resolved-model-id");
      assert.equal(hint.strategy, "point-to-tool");
      assert.deepEqual(hint.usage, { promptTokens: 1500, completionTokens: 25, cacheReadTokens: 1200 });
    },
  );
});

// ── openai-compatible adapter (stubbed) ────────────────────────────────────

test("openai-compatible adapter works keyless against a local endpoint", async () => {
  await withStub(
    { choices: [{ message: { content: "Look at the last error line." } }], usage: { prompt_tokens: 700, completion_tokens: 12 } },
    async (baseUrl, requests) => {
      const provider = new OpenAICompatibleProvider({ baseUrl, model: "local-model" });
      const hint = await provider.generateHint(req(), context);
      assert.equal((requests[0].messages as Array<{ role: string }>)[0].role, "system");
      assert.equal(hint.message, "Look at the last error line.");
      assert.deepEqual(hint.usage, { promptTokens: 700, completionTokens: 12 });
    },
  );
});

// ── env-driven selection ───────────────────────────────────────────────────

test("providerFromEnv: mock default, legacy fallback, role-scoped anthropic, fake", () => {
  assert.ok(providerFromEnv({}) instanceof MockInstructorProvider);
  assert.ok(
    providerFromEnv({ INSTRUCTOR_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "m" }) instanceof
      OpenAICompatibleProvider,
  );
  assert.ok(
    providerFromEnv({ GUIDE_PROVIDER: "anthropic", GUIDE_MODEL: "m", ANTHROPIC_API_KEY: "k" }) instanceof
      AnthropicInstructorProvider,
  );
  assert.ok(providerFromEnv({ GUIDE_PROVIDER: "fake" }) instanceof FakeInstructorProvider);
  assert.throws(() => providerFromEnv({ GUIDE_PROVIDER: "anthropic" }), /GUIDE_MODEL/);
});

// ── live integration (credential-gated; skips loudly) ─────────────────────

const LIVE = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_TEST_MODEL);

test(
  "LIVE anthropic integration (set ANTHROPIC_API_KEY + ANTHROPIC_TEST_MODEL to run)",
  { skip: !LIVE ? "no ANTHROPIC_API_KEY/ANTHROPIC_TEST_MODEL in env — live path UNVERIFIED here" : false },
  async () => {
    const provider = new AnthropicInstructorProvider({
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      apiKey: process.env.ANTHROPIC_API_KEY as string,
      model: process.env.ANTHROPIC_TEST_MODEL as string,
    });
    const hint = await provider.generateHint(
      req(),
      {
        system: "You are a terse coding tutor. Reply in one short sentence.",
        user: "The learner asked: what does `git status` do?",
        promptVersion: "v2",
      },
    );
    assert.ok(hint.message.length > 0);
    assert.ok((hint.usage?.promptTokens ?? 0) > 0, "live usage reported");
  },
);

const LIVE_LOCAL = Boolean(process.env.LOCAL_OPENAI_BASE_URL && process.env.LOCAL_OPENAI_MODEL);

test(
  "LIVE local openai-compatible integration (set LOCAL_OPENAI_BASE_URL + LOCAL_OPENAI_MODEL to run)",
  { skip: !LIVE_LOCAL ? "no LOCAL_OPENAI_BASE_URL/LOCAL_OPENAI_MODEL in env — local path UNVERIFIED here" : false },
  async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: process.env.LOCAL_OPENAI_BASE_URL as string,
      model: process.env.LOCAL_OPENAI_MODEL as string,
      apiKey: process.env.LOCAL_OPENAI_API_KEY,
    });
    const hint = await provider.generateHint(req(), {
      system: "You are a terse coding tutor. Reply in one short sentence.",
      user: "The learner asked: what does `git status` do?",
      promptVersion: "v2",
    });
    assert.ok(hint.message.length > 0);
  },
);
