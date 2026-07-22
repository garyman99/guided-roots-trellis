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
    const ctx = user.match(/CONTEXT:\n([\s\S]*?)\n\n/)?.[1];
    const context = ctx ? (JSON.parse(ctx) as Record<string, unknown>) : {};
    // Infer the task from the explicit schema instruction (or the older phrasing).
    const lessonId = (context.lesson as { lessonId?: string } | undefined)?.lessonId ?? "x";
    const task =
      user.match(/Produce the "([^"]+)" artifact/)?.[1] ??
      // The blueprint PANEL (2026-07-22) reviews the plan with its own rubric —
      // match these before the lesson variants, or "pedagogy" below swallows the
      // blueprint pedagogy review and answers it with the lesson's categories.
      (/Score the BLUEPRINT on pedagogy/.test(user) ? "review:pedagogy:blueprint"
        : /Review the BLUEPRINT for technical soundness/.test(user) ? "review:technical:blueprint"
        : /Review the BLUEPRINT as ONE authored journey/.test(user) ? "review:cohesion:blueprint"
        : /"personaFit"/.test(user) ? `critique:${lessonId}`
        : /course-request/.test(user) ? "course-request"
        : /course blueprint/.test(user) ? "blueprint"
        : /lesson plan for/.test(user) ? `lesson:${lessonId}`
        : /pedagogy/i.test(user) ? `review:pedagogy:${lessonId}`
        : /Review the lesson/.test(user) ? `review:technical:${lessonId}`
        : "");
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

test("streaming surfaces thinking + text deltas and assembles the final text (Claude SSE)", async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-4-8"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Rust is a systems language; "}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"I will frame it for backend devs."}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"technology\\":"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"\\"Rust\\"}"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
    "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
  ];
  const streamFetch = (async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;

  const inv = new LiveRoleInvoker({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk-fake", fetchImpl: streamFetch });
  const thinking: string[] = [];
  const textChunks: string[] = [];
  const res = await inv.invoke(
    "architect",
    { task: "course-request", context: {}, system: "s", user: "u" },
    (d) => (d.kind === "thinking" ? thinking.push(d.chunk) : textChunks.push(d.chunk)),
  );
  assert.equal(thinking.join(""), "Rust is a systems language; I will frame it for backend devs.");
  assert.equal(res.text, '{"technology":"Rust"}');
  assert.deepEqual(JSON.parse(res.text), { technology: "Rust" });
  assert.equal(res.usage.outputTokens, 42);
  assert.equal(res.model, "claude-opus-4-8");
});

test("streaming deltas flow into the live-activity buffer and clear when the phase parks", async () => {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-liveact-"));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  // An invoker that streams a thinking chunk then the answer.
  const streamingInvoker = {
    async invoke(role: Parameters<import("../src/roles.ts").RoleInvoker["invoke"]>[0], prompt: import("../src/roles.ts").RolePrompt, onDelta?: import("../src/roles.ts").RoleDelta) {
      const text = defaultMockResponder(role, prompt);
      onDelta?.({ kind: "thinking", chunk: "considering the request… " });
      onDelta?.({ kind: "text", chunk: text });
      return { text, model: "m", usage: { outputTokens: 5 } };
    },
  };
  const activity: Array<import("../src/types.ts").LiveActivity | null> = [];
  const sched = new CourseRunScheduler(
    store,
    createExecutor({
      rolesFor: () => streamingInvoker,
      artifactsFor: (id) => new RunArtifacts(join(runsDir, id)),
      availableCapabilities: new Set(["file-viewed", "tests-run", "diff-viewed", "code", "terminal", "any-command"]),
      materialize: async () => ({ courseId: "c", labIds: [], scenarioCount: 0 }),
      onActivity: (_runId, a) => activity.push(a),
    }),
    { now, idSuffix: () => "t0" },
  );
  const run = sched.create({ technology: "Git" });
  await sched.settle(); // framing runs
  // Some activity carried the streaming thinking + text…
  assert.ok(activity.some((a) => a && a.thinking.includes("considering") && a.text.length > 0), "thinking + text streamed into the buffer");
  // …and the buffer was cleared (null) once the phase parked.
  assert.equal(activity.at(-1), null, "live buffer cleared at phase end");
  store.close();
});

function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const OK_FRAMES = [
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\":true}"}}\n\n',
  "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
];

test("Claude streaming enables extended thinking by default (opt out with COURSE_GEN_THINKING=0)", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const capture = (async (_url: string, init?: { body?: string }) => { bodies.push(JSON.parse(init?.body ?? "{}")); return sseResponse(OK_FRAMES); }) as unknown as typeof fetch;

  delete process.env.COURSE_GEN_THINKING;
  await new LiveRoleInvoker({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk", fetchImpl: capture }).invoke("architect", { task: "t", context: {}, system: "s", user: "u" }, () => {});
  assert.ok((bodies.at(-1) as { thinking?: unknown }).thinking, "thinking on by default");

  process.env.COURSE_GEN_THINKING = "0";
  await new LiveRoleInvoker({ provider: "anthropic", model: "claude-opus-4-8", apiKey: "sk", fetchImpl: capture }).invoke("architect", { task: "t", context: {}, system: "s", user: "u" }, () => {});
  assert.equal((bodies.at(-1) as { thinking?: unknown }).thinking, undefined, "opted out");
  delete process.env.COURSE_GEN_THINKING;
});

test("a model rejecting the thinking param falls back to a normal streamed call", async () => {
  delete process.env.COURSE_GEN_THINKING;
  let call = 0;
  const flaky = (async (_url: string, init?: { body?: string }) => {
    call++;
    const b = JSON.parse(init?.body ?? "{}") as { thinking?: unknown };
    if (b.thinking) return new Response("model does not support the thinking parameter", { status: 400 });
    return sseResponse(OK_FRAMES);
  }) as unknown as typeof fetch;
  const res = await new LiveRoleInvoker({ provider: "anthropic", model: "old-model", apiKey: "sk", fetchImpl: flaky }).invoke("architect", { task: "t", context: {}, system: "s", user: "u" }, () => {});
  assert.equal(call, 2, "retried without thinking");
  assert.equal(res.text, '{"ok":true}');
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
