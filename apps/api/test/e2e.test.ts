/**
 * End-to-end test: boots the real API server (local driver, in-memory store)
 * and plays a full learner journey over HTTP + WebSocket:
 *
 *   create session → unauthorized probes rejected → terminal over WS →
 *   inspect/diff/test/fix in the real shell → instructor Q&A →
 *   checkpoint evaluate (fail → pass) → context preview → export → destroy
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager } from "../src/server.ts";

let base = "";
let sessionId = "";
let token = "";
let ws: WebSocket;
let terminalOutput = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  ws?.close();
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

async function typeAndSettle(line: string, settleMs: number): Promise<void> {
  ws.send(line + "\n");
  await new Promise((r) => setTimeout(r, settleMs));
  const session = manager.get(sessionId)!;
  await session.instrumentation.drain();
}

test("create session returns id + token", async () => {
  const { status, body } = await api("POST", "/api/sessions", { labId: "inspect-generated-changes", consentAnalytics: false }, false);
  assert.equal(status, 201);
  sessionId = body.sessionId;
  token = body.token;
  assert.ok(sessionId && token);
  assert.equal(body.driver, "local");
});

test("session routes reject missing/invalid tokens", async () => {
  const noToken = await fetch(`${base}/api/sessions/${sessionId}/state`);
  assert.equal(noToken.status, 401);
  const badToken = await fetch(`${base}/api/sessions/${sessionId}/state`, {
    headers: { authorization: "Bearer wrong-token-entirely-000000000000" },
  });
  assert.equal(badToken.status, 401);
});

test("websocket terminal rejects a bad token before handshake", async () => {
  const url = base.replace("http", "ws") + `/ws/terminal?session=${sessionId}&token=nope`;
  const failed = await new Promise<boolean>((resolve) => {
    const bad = new WebSocket(url);
    bad.onerror = () => resolve(true);
    bad.onopen = () => resolve(false);
  });
  assert.equal(failed, true);
});

test("websocket terminal connects with the token and reaches a real shell", async () => {
  const url = base.replace("http", "ws") + `/ws/terminal?session=${sessionId}&token=${token}`;
  ws = new WebSocket(url);
  ws.onmessage = async (ev) => {
    terminalOutput += typeof ev.data === "string" ? ev.data : Buffer.from(await (ev.data as Blob).arrayBuffer()).toString();
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws failed"));
  });
  await new Promise((r) => setTimeout(r, 900));
  await typeAndSettle("echo TRELLIS_$((20+3))", 700);
  assert.match(terminalOutput, /TRELLIS_23/, "shell executes and streams back");
});

test("learner journey: status → diff → failing tests → fix → passing tests", async () => {
  await typeAndSettle("git status", 700);

  // Live task checklist: 'inspect' observed, 'review-diff' not yet.
  let tasks = (await api("GET", `/api/sessions/${sessionId}/state`)).body.tasks;
  assert.equal(tasks.find((t: { id: string }) => t.id === "inspect").done, true);
  assert.equal(tasks.find((t: { id: string }) => t.id === "review-diff").done, false);

  await typeAndSettle("git diff", 1000);
  await typeAndSettle("npm test", 6000);
  await typeAndSettle("sed -i 's/Math.floor(discounted)/Math.round(discounted)/' src/pricing.ts", 700);
  await typeAndSettle("npm test", 6000);

  const { body } = await api("GET", `/api/sessions/${sessionId}/state`);
  const s = body.state;
  assert.equal(s.viewedGitDiff, true);
  assert.ok(s.testsRun >= 2, `testsRun=${s.testsRun}`);
  assert.deepEqual(s.latestTestResult, { passed: 6, failed: 0 });
  assert.ok(s.filesChanged.includes("src/pricing.ts"));

  // Every task auto-checked → the UI can suggest running the checkpoint.
  assert.equal(body.checkpointReady, true);
  assert.ok(body.lab.agentMessage.includes("bulkDiscountCents"), "agent's confident message is served");
});

test("terminal resize control frame changes the pty size", async () => {
  ws.send(Buffer.from(JSON.stringify({ type: "resize", cols: 97, rows: 41 })));
  await new Promise((r) => setTimeout(r, 600));
  terminalOutput = "";
  await typeAndSettle("stty size", 700);
  assert.match(terminalOutput, /41 97/, "pty reports the new size");
  // The resize command itself must not be captured as a learner command.
  const s = (await api("GET", `/api/sessions/${sessionId}/state`)).body.state;
  assert.ok(
    !s.recentCommands.some((c: { command: string }) => c.command.includes("stty cols 97")),
    "space-prefixed control commands stay out of the event stream",
  );
});

test("a second websocket replays scrollback (refresh is a non-event)", async () => {
  const url = base.replace("http", "ws") + `/ws/terminal?session=${sessionId}&token=${token}`;
  const ws2 = new WebSocket(url);
  let replay = "";
  ws2.onmessage = async (ev) => {
    replay += typeof ev.data === "string" ? ev.data : Buffer.from(await (ev.data as Blob).arrayBuffer()).toString();
  };
  await new Promise<void>((resolve, reject) => {
    ws2.onopen = () => resolve();
    ws2.onerror = () => reject(new Error("ws2 failed"));
  });
  await new Promise((r) => setTimeout(r, 500));
  assert.match(replay, /TRELLIS_23/, "history from before this connection is replayed");
  ws2.close();
});

test("instructor answers with evidence and hints escalate", async () => {
  const a = await api("POST", `/api/sessions/${sessionId}/ask`, { text: "How am I doing?", stuck: false });
  assert.equal(a.status, 200);
  assert.equal(a.body.message.role, "instructor");
  assert.equal(a.body.message.level, 0);
  const b = await api("POST", `/api/sessions/${sessionId}/ask`, { text: "And now?", stuck: false });
  assert.equal(b.body.message.level, 1);
});

test("context preview shows fenced untrusted content and measured facts", async () => {
  const { body } = await api("GET", `/api/sessions/${sessionId}/context-preview`);
  assert.match(body.user, /UNTRUSTED_CONTENT/);
  assert.match(body.user, /Viewed git diff: true/);
  assert.match(body.system, /hint level|Hint ladder/i);
});

test("checkpoint evaluation passes after the fix and records completion", async () => {
  const { body } = await api("POST", `/api/sessions/${sessionId}/checkpoint/evaluate`);
  assert.equal(body.passed, true, JSON.stringify(body.requirements));
  const state = (await api("GET", `/api/sessions/${sessionId}/state`)).body.state;
  assert.deepEqual(state.completedCheckpoints, ["inspect-fix-verify"]);
});

test("export returns the full append-only event log", async () => {
  const { body } = await api("GET", `/api/sessions/${sessionId}/export`);
  const types = new Set(body.events.map((e: { type: string }) => e.type));
  for (const expected of [
    "session.started",
    "terminal.command.started",
    "terminal.command.completed",
    "git.diff.viewed",
    "tests.completed",
    "file.changed",
    "learner.question",
    "instructor.hint",
    "checkpoint.evaluated",
    "checkpoint.completed",
  ]) {
    assert.ok(types.has(expected), `event log should contain ${expected}`);
  }
});

test("reset is a scene change: banner, broken lab restored, shell still live on the SAME socket", async () => {
  terminalOutput = "";
  const r = await api("POST", `/api/sessions/${sessionId}/reset`);
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 1500));
  assert.match(terminalOutput, /workspace reset — the agent's change is back/, "reset banner streamed to the existing socket");

  // The same WebSocket still drives a working shell — no reconnect needed.
  terminalOutput = "";
  await typeAndSettle("echo ALIVE_$((40+2))", 900);
  assert.match(terminalOutput, /ALIVE_42/, "shell is interactive again after reset");

  const evalAfterReset = await api("POST", `/api/sessions/${sessionId}/checkpoint/evaluate`);
  assert.equal(evalAfterReset.body.passed, false, "defect is back after reset");

  const d = await api("DELETE", `/api/sessions/${sessionId}`);
  assert.equal(d.status, 200);
  assert.equal((await api("GET", `/api/sessions/${sessionId}/state`)).status, 404);
});
