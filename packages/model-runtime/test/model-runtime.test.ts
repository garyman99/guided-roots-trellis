import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Text, sha256File } from "../src/hash.ts";
import { addUsage, totalTokens, type NormalizedModelUsage } from "../src/usage.ts";
import { newInvocationId, newRunId, type ModelInvocationRecord } from "../src/invocation.ts";
import { RunArtifactWriter, type RunManifest } from "../src/manifest.ts";
import { estimateCostUSD, loadPricingTable } from "../src/pricing.ts";
import { KNOWN_PROMPTS, promptVersionMap, resolvePromptArtifact } from "../src/prompts.ts";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

// ── usage ──────────────────────────────────────────────────────────────────

test("addUsage sums field-wise and never invents unreported fields", () => {
  const a: NormalizedModelUsage = { inputTokens: 100, outputTokens: 20 };
  const b: NormalizedModelUsage = { inputTokens: 50, cacheReadTokens: 400 };
  const sum = addUsage(a, b);
  assert.deepEqual(sum, { inputTokens: 150, outputTokens: 20, cacheReadTokens: 400 });
  assert.ok(!("reasoningTokens" in sum), "unreported fields stay absent");
});

test("totalTokens prefers the provider total, else sums parts", () => {
  assert.equal(totalTokens({ totalTokens: 999, inputTokens: 1 }), 999);
  assert.equal(totalTokens({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }), 115);
  assert.equal(totalTokens({}), 0);
});

// ── ids ────────────────────────────────────────────────────────────────────

test("run and invocation ids are unique and prefixed", () => {
  const a = newRunId("exp");
  const b = newRunId("exp");
  assert.notEqual(a, b);
  assert.match(a, /^exp-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  assert.match(newInvocationId(), /^inv-[0-9a-f-]{36}$/);
});

// ── pricing ────────────────────────────────────────────────────────────────

test("bundled pricing table loads and validates", () => {
  const table = loadPricingTable();
  assert.equal(table.currency, "USD");
  assert.ok(table.version >= 1);
  assert.ok(table.models["mock-instructor"], "mock provider priced at zero keeps pipeline exercised");
});

test("estimateCostUSD computes from reported fields only; unknown model is undefined", () => {
  const table = {
    version: 1,
    pricedAt: "2026-07-13",
    currency: "USD" as const,
    models: {
      "test-model": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
    },
  };
  const cost = estimateCostUSD(
    { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000 },
    "test-model",
    table,
  );
  assert.equal(cost, 2 + 1 + 0.1);
  assert.equal(estimateCostUSD({ inputTokens: 5 }, "no-such-model", table), undefined);
  // Reported cacheWrite with no configured rate contributes 0, not NaN.
  assert.equal(estimateCostUSD({ cacheWriteTokens: 1_000_000 }, "test-model", table), 0);
});

test("loadPricingTable rejects malformed tables with actionable errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-pricing-"));
  const bad = join(dir, "pricing.json");
  writeFileSync(bad, JSON.stringify({ version: 1, pricedAt: "x", currency: "USD", models: { m: { inputPerMTok: "a" } } }));
  assert.throws(() => loadPricingTable(bad), /model "m"/);
  assert.throws(() => loadPricingTable(join(dir, "missing.json")), /not readable/);
});

// ── manifests + invocations ────────────────────────────────────────────────

function sampleManifest(runId: string): RunManifest {
  return {
    runId,
    createdAt: new Date().toISOString(),
    productCommit: "abc1234",
    scenarioId: "improve-delayed-order-reply",
    promptVersions: { "guide.instructor": "v2@deadbeef0123" },
    models: { guide: { provider: "mock", model: "mock-instructor" } },
    evidence: [
      {
        kind: "event-log",
        logicalPath: "runs/x/session-export.json",
        sha256: sha256Text("{}"),
        schemaVersion: "session-events@current",
        redaction: "none",
        retention: "local",
      },
    ],
  };
}

test("manifests are write-once and round-trip", () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-artifacts-"));
  const writer = new RunArtifactWriter(root);
  const runId = newRunId("test");
  const manifest = sampleManifest(runId);
  writer.writeManifest(manifest);
  assert.deepEqual(writer.readManifest(runId), manifest);
  assert.throws(() => writer.writeManifest(manifest), /immutable/);
});

test("invocation records append as JSONL and round-trip", () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-artifacts-"));
  const writer = new RunArtifactWriter(root);
  const runId = newRunId("test");
  assert.deepEqual(writer.readInvocations(runId), []);
  const rec = (n: number): ModelInvocationRecord => ({
    invocationId: newInvocationId(),
    runId,
    role: "guide",
    provider: "mock",
    model: "mock-instructor",
    promptVersion: "v2",
    startedAt: new Date().toISOString(),
    usage: { inputTokens: n, outputTokens: n * 2 },
    estimatedCostUSD: 0,
    pricingVersion: 1,
    status: "ok",
  });
  writer.appendInvocation(rec(1));
  writer.appendInvocation(rec(2));
  const back = writer.readInvocations(runId);
  assert.equal(back.length, 2);
  assert.equal(back[1].usage.outputTokens, 4);
});

// ── prompt registry ────────────────────────────────────────────────────────

test("sha256 hashing is stable and matches file contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-prompt-"));
  const f = join(dir, "p.md");
  writeFileSync(f, "hello prompt");
  assert.equal(sha256File(f), sha256Text("hello prompt"));
});

test("every KNOWN_PROMPT resolves against the repo with a real hash", () => {
  for (const reg of KNOWN_PROMPTS) {
    const art = resolvePromptArtifact(reg, REPO_ROOT);
    assert.match(art.sha256, /^[0-9a-f]{64}$/, `${reg.id} hashes`);
    assert.ok(art.bytes > 0, `${reg.id} is non-empty`);
  }
  const map = promptVersionMap(REPO_ROOT);
  assert.match(map["guide.instructor"], /^v2@[0-9a-f]{12}$/);
});
