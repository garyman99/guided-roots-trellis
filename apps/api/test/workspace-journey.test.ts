/**
 * Workspace-lab learner journey, end to end over the real HTTP API — the
 * "Improve a delayed-order reply" scenario played the way Marisol would:
 *
 *   create session (no container, no pty) → read the email → overshare with
 *   the AI helper (loyalty number) → get coached (deterministic intervention)
 *   → re-share trimmed context → draft → insert → edit into her own words →
 *   send simulated reply → checkpoint passes → reflection exists → reset
 *   restores the seeded scene.
 *
 * Runs anywhere node runs: workspace labs need no lab environment.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager } from "../src/server.ts";

const LAB = "improve-delayed-order-reply";
let base = "";
let sessionId = "";
let token = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await manager.destroyAll();
  server.close();
});

const api = async (method: string, path: string, body?: unknown, useToken = true) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(useToken && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const act = (action: Record<string, unknown>) => api("POST", `/api/sessions/${sessionId}/workspace/action`, action);
const state = async () => (await api("GET", `/api/sessions/${sessionId}/state`)).body;

const LOYALTY = "GRV-88231";
let fullEmailBody = "";
let aiDraft = "";
let draftId = "";

test("create a workspace session: no terminal, apps declared", async () => {
  const { status, body } = await api("POST", "/api/sessions", { labId: LAB, consentAnalytics: false }, false);
  assert.equal(status, 201);
  sessionId = body.sessionId;
  token = body.token;

  const st = await state();
  assert.deepEqual(
    st.lab.workspaceApps.map((a: { id: string }) => a.id),
    ["email", "ai-chat"],
  );
  assert.ok(st.tasks.every((t: { done: boolean }) => !t.done));

  // No pty exists: the terminal websocket is refused for workspace labs.
  const wsRefused = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(base.replace("http", "ws") + `/ws/terminal?session=${sessionId}&token=${token}`);
    ws.onerror = () => resolve(true);
    ws.onopen = () => resolve(false);
  });
  assert.equal(wsRefused, true);
});

test("workspace routes require the session token", async () => {
  const bare = await fetch(`${base}/api/sessions/${sessionId}/workspace`);
  assert.equal(bare.status, 401);
});

test("goal-first onboarding: the stated goal is measured and answered with orientation", async () => {
  const res = await api("POST", `/api/sessions/${sessionId}/ask`, {
    text: "I need to reply to a customer about a late order, with the AI helper",
    goal: true,
  });
  assert.equal(res.status, 200);
  assert.match(res.body.message.text, /start/i);

  const st = await state();
  assert.equal(st.state.statedGoal, "I need to reply to a customer about a late order, with the AI helper");
  const { body } = await api("GET", `/api/sessions/${sessionId}/export`);
  const goalEvents = body.events.filter((e: { type: string }) => e.type === "learner.goal.stated");
  assert.equal(goalEvents.length, 1);
  assert.equal(body.events.some((e: { type: string; text?: string }) => e.type === "learner.question" && e.text?.includes("late order")), false);
});

test("reading the customer email is measured and completes the first task", async () => {
  const view = (await api("GET", `/api/sessions/${sessionId}/workspace`)).body;
  assert.equal(view.email.inbox.length, 1);
  assert.equal(view.email.inbox[0].read, false);
  fullEmailBody = view.email.inbox[0].body;
  assert.ok(fullEmailBody.includes(LOYALTY), "seed includes the irrelevant loyalty number");

  const after = await act({ type: "open-artifact", appId: "email", artifactId: "customer-email" });
  assert.equal(after.body.email.inbox[0].read, true);
  const st = await state();
  assert.equal(st.tasks.find((t: { id: string }) => t.id === "open-email").done, true);
});

test("oversharing the full email triggers the privacy check-in, and the helper echoes the mistake", async () => {
  const res = await act({
    type: "chat-send",
    prompt: "Can you write a reply to this customer for me?",
    context: fullEmailBody,
  });
  const thread = res.body.aiChat.thread;
  const assistant = thread[thread.length - 1];
  assert.equal(assistant.role, "assistant");
  assert.ok(assistant.draftId, "a draft comes back");
  // The helper only knows what it was given — and it happily repeats it.
  assert.ok(assistant.text.includes(LOYALTY), "the echo makes the oversharing visible");

  const st = await state();
  assert.equal(st.state.workspace.restrictedInLatestShare.length, 1);
  assert.equal(st.tasks.find((t: { id: string }) => t.id === "context-clean").done, false);

  // Deterministic rule → parked intervention → the guide's check-in.
  const nudge = (await api("GET", `/api/sessions/${sessionId}/intervention`)).body.intervention;
  assert.ok(nudge, "expected a restricted-context intervention");
  assert.equal(nudge.type, "restricted_context_shared");
  assert.ok(nudge.hint?.message, "the instructor turned the trigger into words");
});

test("re-sharing trimmed context recovers: clean share, usable draft", async () => {
  const res = await act({
    type: "chat-send",
    prompt: "Thanks — please draft a warm reply using just these facts.",
    context:
      "Customer: Dana. Order GR-1042 (raised-bed planters) arrived late — confirmation said two days ago. " +
      "Tracking now says: out for delivery — expected tomorrow. Dana is planting this weekend and worried it's lost.",
  });
  const thread = res.body.aiChat.thread;
  const assistant = thread[thread.length - 1];
  aiDraft = assistant.text;
  draftId = assistant.draftId;
  assert.ok(!aiDraft.includes(LOYALTY), "clean context → clean draft");
  assert.ok(/GR[-\s]?1042/.test(aiDraft), "the draft uses the shared order number");

  const st = await state();
  assert.equal(st.state.workspace.restrictedInLatestShare.length, 0);
  assert.equal(st.tasks.find((t: { id: string }) => t.id === "context-clean").done, true);
  assert.equal(st.tasks.find((t: { id: string }) => t.id === "ai-consult").done, true);
});

test("inserting the draft, submitting it UNEDITED, the checkpoint refuses", async () => {
  await act({ type: "insert-draft", draftId });
  const view = (await api("GET", `/api/sessions/${sessionId}/workspace`)).body;
  assert.equal(view.reply.text, aiDraft);
  assert.equal(view.reply.hasAiBaseline, true);

  // The deliberately imperfect draft over-promises; submitting it as-is must fail gates.
  await act({ type: "submit-reply" });
  const evalr = (await api("POST", `/api/sessions/${sessionId}/checkpoint/evaluate`)).body;
  assert.equal(evalr.passed, false);
  const failed = new Set(evalr.incomplete);
  assert.ok(failed.has("reviewed-and-edited"), "unedited draft is not the learner's reply");
  assert.ok(failed.has("no-forbidden-promise"), "the helper's guarantee must be caught");
  // The failing detail teaches the CATEGORY in the lab author's words (live-sim
  // finding: a vague gate detail sent the learner asking "what part is it
  // reading as a promise?").
  const promiseReq = evalr.requirements.find((r: { id: string }) => r.id === "no-forbidden-promise");
  assert.match(promiseReq.detail, /unapproved promise or guarantee/);
  assert.match(promiseReq.detail, /outcome we can't control/);
});

test("editing into her own words and re-sending passes every gate", async () => {
  const own = [
    "Hi Dana,",
    "",
    "Thank you for reaching out, and I'm sorry about the delay — I completely understand that timing matters with your weekend planting.",
    "",
    "Here's where things stand: your order GR-1042 is out for delivery, and the tracking page currently shows it expected tomorrow. That's the most up-to-date information we have. I'll keep an eye on it from this end.",
    "",
    "If it hasn't arrived by tomorrow evening, reply here and I'll chase it down right away.",
    "",
    "Warmly,",
    "Marisol",
  ].join("\n");
  await act({ type: "update-draft", text: own });
  await act({ type: "submit-reply" });

  const st = await state();
  assert.ok(st.state.workspace.submitted, "submission recorded");
  assert.ok(st.state.workspace.submitted.similarityToGenerated < 0.9, "meaningfully edited");
  assert.ok(st.tasks.every((t: { done: boolean }) => t.done), JSON.stringify(st.tasks));
  assert.equal(st.checkpointReady, true);

  const evalr = (await api("POST", `/api/sessions/${sessionId}/checkpoint/evaluate`)).body;
  assert.equal(evalr.passed, true, JSON.stringify(evalr.requirements.filter((r: { ok: boolean }) => !r.ok)));

  const refl = await api("GET", `/api/sessions/${sessionId}/reflection`);
  assert.equal(refl.status, 200);
  // The reflection must describe THIS session truthfully — workspace
  // phrasing, and never terminal-lab vocabulary (live-sim finding, iter 3).
  const narrative: string = refl.body.narrative;
  for (const banned of ["diff", "surgical", "requested feature", "test suite"]) {
    assert.ok(!narrative.toLowerCase().includes(banned), `terminal phrasing leaked into reflection: ${narrative}`);
  }
  assert.match(narrative, /useful facts|AI draft/, narrative);
});

test("the event log stores classifications, never the learner's sensitive text", async () => {
  const { body } = await api("GET", `/api/sessions/${sessionId}/export`);
  const wsEvents = body.events.filter((e: { type: string }) => e.type.startsWith("aichat.") || e.type.startsWith("workspace."));
  assert.ok(wsEvents.length >= 8, "journey produced workspace events");
  const serialized = JSON.stringify(wsEvents);
  assert.ok(!serialized.includes(LOYALTY), "loyalty number never persists in events");
  assert.ok(!serialized.includes("raised-bed"), "email prose never persists in events");
  assert.ok(serialized.includes("loyalty-number"), "classified span IDs do persist");
});

test("reset is a scene change: seeded email back, conversation gone, tasks reopen", async () => {
  await api("POST", `/api/sessions/${sessionId}/reset`);
  const view = (await api("GET", `/api/sessions/${sessionId}/workspace`)).body;
  assert.equal(view.email.inbox[0].read, false);
  assert.equal(view.aiChat.thread.length, 0);
  assert.equal(view.reply.text, "");
  assert.equal(view.reply.submitted, false);
  const st = await state();
  assert.equal(st.state.workspace.aiContextShares, 0);
  assert.ok(st.tasks.every((t: { done: boolean }) => !t.done));
});

test("destroy tears the session down", async () => {
  const del = await api("DELETE", `/api/sessions/${sessionId}`);
  assert.equal(del.status, 200);
});
