import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { anthropicGenerateText } from "../src/anthropicClient.ts";
import { openaiGenerateText } from "../src/openaiClient.ts";

interface Captured {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

async function withStub(
  reply: (captured: Captured) => { status?: number; body: unknown },
  fn: (baseUrl: string, captured: Captured[]) => Promise<void>,
): Promise<void> {
  const captured: Captured[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const cap = { url: req.url ?? "", headers: req.headers, body: JSON.parse(body) as Record<string, unknown> };
      captured.push(cap);
      const r = reply(cap);
      res.writeHead(r.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, captured);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── anthropic ──────────────────────────────────────────────────────────────

test("anthropic client: wire shape, headers, and usage normalization incl. cache tokens", async () => {
  await withStub(
    () => ({
      body: {
        content: [{ type: "text", text: "Try re-reading the failing assertion. " }],
        model: "server-reported-model",
        stop_reason: "end_turn",
        usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 },
      },
    }),
    async (baseUrl, captured) => {
      const res = await anthropicGenerateText({
        baseUrl,
        apiKey: "test-key",
        model: "requested-model",
        system: "SYSTEM PROMPT",
        user: "USER CONTEXT",
        maxTokens: 300,
      });
      const req = captured[0];
      assert.equal(req.url, "/v1/messages");
      assert.equal(req.headers["x-api-key"], "test-key");
      assert.equal(req.headers["anthropic-version"], "2023-06-01");
      assert.equal(req.body.model, "requested-model");
      assert.equal(req.body.max_tokens, 300);
      assert.equal(req.body.system, "SYSTEM PROMPT");
      assert.deepEqual(req.body.messages, [{ role: "user", content: "USER CONTEXT" }]);
      assert.ok(!("temperature" in req.body), "no sampling params on Anthropic requests");
      assert.equal(res.text, "Try re-reading the failing assertion.");
      assert.equal(res.model, "server-reported-model");
      assert.deepEqual(res.usage, { inputTokens: 1200, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 100 });
      assert.deepEqual(res.rawUsage, {
        input_tokens: 1200,
        output_tokens: 40,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 100,
      });
    },
  );
});

test("anthropic client: refusal stop_reason and empty content are errors, missing key is auth", async () => {
  await withStub(
    () => ({ body: { content: [], stop_reason: "refusal", usage: {} } }),
    async (baseUrl) => {
      await assert.rejects(
        anthropicGenerateText({ baseUrl, apiKey: "k", model: "m", system: "s", user: "u" }),
        /refusal/,
      );
    },
  );
  await withStub(
    () => ({ body: { content: [{ type: "text", text: "   " }], stop_reason: "end_turn" } }),
    async (baseUrl) => {
      await assert.rejects(
        anthropicGenerateText({ baseUrl, apiKey: "k", model: "m", system: "s", user: "u" }),
        /no text content/,
      );
    },
  );
  await assert.rejects(
    anthropicGenerateText({ baseUrl: "http://127.0.0.1:9", model: "m", system: "s", user: "u" }),
    /requires an apiKey/,
  );
});

// ── openai-compatible ──────────────────────────────────────────────────────

test("openai client: wire shape, optional auth, usage normalization", async () => {
  await withStub(
    () => ({
      body: {
        choices: [{ message: { content: " A gentle nudge. " }, finish_reason: "stop" }],
        model: "served-model",
        usage: { prompt_tokens: 800, completion_tokens: 30, total_tokens: 830 },
      },
    }),
    async (baseUrl, captured) => {
      const res = await openaiGenerateText({
        baseUrl: `${baseUrl}/v1/`,
        model: "local-model",
        system: "SYS",
        user: "USR",
        temperature: 0.3,
      });
      const req = captured[0];
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, undefined, "no auth header without a key (local endpoints)");
      assert.equal(req.body.temperature, 0.3);
      assert.deepEqual(req.body.messages, [
        { role: "system", content: "SYS" },
        { role: "user", content: "USR" },
      ]);
      assert.equal(res.text, "A gentle nudge.");
      assert.equal(res.model, "served-model");
      assert.deepEqual(res.usage, { inputTokens: 800, outputTokens: 30, totalTokens: 830 });
    },
  );
});

test("openai client: bearer auth when key given; empty completion is an error", async () => {
  await withStub(
    () => ({ body: { choices: [{ message: { content: "ok" } }] } }),
    async (baseUrl, captured) => {
      await openaiGenerateText({ baseUrl, apiKey: "sk-test", model: "m", system: "s", user: "u" });
      assert.equal(captured[0].headers.authorization, "Bearer sk-test");
    },
  );
  await withStub(
    () => ({ body: { choices: [] } }),
    async (baseUrl) => {
      await assert.rejects(openaiGenerateText({ baseUrl, model: "m", system: "s", user: "u" }), /empty completion/);
    },
  );
});
