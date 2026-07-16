/**
 * The LIVE provider path (Claude / OpenAI-compatible) over model-runtime's
 * fetch clients, exercised with an injected fake fetch — no network, no keys.
 * Proves that a real provider's response envelope is parsed into text + usage
 * and that the full pipeline runs on it. The fake reuses the deterministic mock
 * as the "model output", so we test the transport + parsing, not the content.
 */
process.env.TRELLIS_PERSISTENCE = "off";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type EventStore } from "../../../apps/api/src/store.ts";
import { CourseRunScheduler } from "../src/scheduler.ts";
import { RunArtifacts } from "../src/artifacts.ts";
import { createExecutor } from "../src/executor.ts";
import { LiveRoleInvoker } from "../src/roles.ts";
import { defaultMockResponder } from "../src/mockCourse.ts";

type Provider = "anthropic" | "openai-compatible";

/** A fetch that answers like a real provider, with the mock's content inside. */
function fakeFetch(provider: Provider): typeof fetch {
  return (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { model: string; messages: Array<{ role: string; content: string }> };
    const user = body.messages.find((m) => m.role === "user")!.content;
    const task = user.match(/Produce the "([^"]+)" artifact/)?.[1] ?? "";
    const ctx = user.match(/CONTEXT:\n([\s\S]*?)\n\n/)?.[1];
    const context = ctx ? (JSON.parse(ctx) as Record<string, unknown>) : {};
    const text = defaultMockResponder("architect", { task, context, system: "", user });
    const envelope =
      provider === "anthropic"
        ? { model: body.model, content: [{ type: "text", text }], usage: { input_tokens: 12, output_tokens: 34 } }
        : { model: body.model, choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json", "request-id": "fake" } });
  }) as unknown as typeof fetch;
}

test("LiveRoleInvoker parses a Claude response into text + usage", async () => {
  const inv = new LiveRoleInvoker({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk-fake", fetchImpl: fakeFetch("anthropic") });
  const res = await inv.invoke("architect", { task: "course-request", context: { request: { technology: "Rust" } }, system: "", user: 'CONTEXT:\n{"request":{"technology":"Rust"}}\n\nProduce the "course-request" artifact as strict JSON.' });
  assert.match(res.text, /"technology"/);
  assert.equal(res.usage.outputTokens, 34);
  assert.equal(res.model, "claude-opus-4-8");
});

test("LiveRoleInvoker parses an OpenAI-compatible response into text + usage", async () => {
  const inv = new LiveRoleInvoker({ provider: "openai-compatible", model: "local-model", baseUrl: "http://localhost:1234/v1", fetchImpl: fakeFetch("openai-compatible") });
  const res = await inv.invoke("architect", { task: "course-request", context: { request: { technology: "Rust" } }, system: "", user: 'CONTEXT:\n{"request":{"technology":"Rust"}}\n\nProduce the "course-request" artifact as strict JSON.' });
  assert.match(res.text, /"technology"/);
  assert.equal(res.usage.outputTokens, 34);
});

test("LiveRoleInvoker requires a model", () => {
  assert.throws(() => new LiveRoleInvoker({ provider: "anthropic", model: "" }), /requires a model/);
});

test("a full run completes over the live provider path (fake Claude)", async () => {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-live-"));
  const artifactsFor = (id: string) => new RunArtifacts(join(runsDir, id));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  const live = new LiveRoleInvoker({ provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-fake", fetchImpl: fakeFetch("anthropic") });

  const sched = new CourseRunScheduler(
    store,
    createExecutor({
      rolesFor: () => live,
      artifactsFor,
      availableCapabilities: new Set(["file-viewed", "tests-run", "diff-viewed", "code", "terminal", "any-command"]),
      materialize: async ({ lessons }) => ({ courseId: "cg-git", labIds: lessons.map((l) => l.lessonId), scenarioCount: lessons.length }),
    }),
    { now, idSuffix: () => "t0" },
  );

  const run = sched.create({ technology: "Git", providerConfig: { provider: "anthropic", model: "claude-sonnet-5" } });
  await sched.settle();
  for (const gate of ["frame", "blueprint", "package", "publish"] as const) {
    sched.decideGate(run.runId, gate, "approved", null, "op");
    await sched.settle();
  }
  assert.equal(store.getCourseRun(run.runId)!.status, "approved");
  const arts = artifactsFor(run.runId);
  assert.match(arts.read("course-request.md")!, /Git Fundamentals/);
  // Real usage from the (fake) provider flowed into the event feed.
  const invoked = store.courseRunEvents(run.runId).filter((e) => e.type === "model.invoked");
  assert.ok(invoked.length >= 6);
  assert.ok(invoked.every((e) => (e.payload as { outputTokens: number }).outputTokens === 34));
  store.close();
});
