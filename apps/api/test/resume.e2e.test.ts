/**
 * Persistent lesson progress, end to end over the real HTTP API — WORKSPACE
 * LAB ONLY (simulated apps, no terminal, no pty):
 *
 *   learner + workspace session → ask a question, mutate the workspace →
 *   manager.releaseAll() (simulated server restart: live session gone from
 *   RAM, store rows + snapshot kept) → boot the lessons endpoint again and
 *   get the SAME session back, resumed, with a FRESH token → transcript and
 *   workspace content survived → abandon → a brand-new session is created →
 *   the admin surface shows the old session abandoned and the new one open,
 *   and its replay carries the session.abandoned event.
 *
 * IMPORTANT — env vs. ESM import ordering: apps/api/src/server.ts constructs
 * its EventStore at MODULE TOP LEVEL (`const store = createStore();`). ESM
 * evaluates every STATIC import's dependency graph before any of the
 * importing module's own top-level statements run — so `process.env.X = ...`
 * written above a `import { server } from "../src/server.ts"` line (the
 * pattern the other apps/api/test/*.e2e.test.ts files use) is NOT visible
 * yet when server.ts's own top-level code executes, and TRELLIS_DB_PATH
 * silently falls back to the real repo path "./data/trellis.db" instead of
 * this test's temp dir. (Confirmed empirically against this exact repo
 * during authoring — see the report for the precise repro; every other
 * apps/api/test/*.e2e.test.ts file that sets TRELLIS_PERSISTENCE="off" this
 * way is, in fact, hitting the real on-disk SQLite store, not memory.)
 *
 * This file avoids that hazard with a DYNAMIC import (`await import(...)`),
 * which defers module evaluation until the statement actually runs — i.e.
 * strictly after the process.env assignments above it.
 */
process.env.NODE_ENV = "test";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "resume-test-admin-token";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "trellis-resume-e2e-"));
process.env.TRELLIS_PERSISTENCE = "on";
process.env.TRELLIS_DB_PATH = join(tmpDir, "trellis.db");

// Dynamic — see the file header. Must run AFTER the env assignments above.
const { server, manager } = await import("../src/server.ts");

const LAB = "improve-delayed-order-reply";
const ADMIN_TOKEN = "resume-test-admin-token";

let base = "";
let learnerId = "";
let learnerToken = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await manager.destroyAll();
  server.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort — the sqlite handle inside server.ts is never exposed for
     * an explicit close() in tests, so a Windows file lock may outlive the
     * process; leaving the temp dir behind is harmless (OS temp cleanup). */
  }
});

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const admin = (path: string) => api("GET", path, undefined, ADMIN_TOKEN);

test("learner creation", async () => {
  const res = await api("POST", "/api/learners", {});
  assert.equal(res.status, 201);
  const body = res.body as { learnerId: string; learnerToken: string };
  learnerId = body.learnerId;
  learnerToken = body.learnerToken;
  assert.ok(learnerId && learnerToken);
});

let firstSessionId = "";
let firstToken = "";
let askedText = "";
let answeredText = "";

test("lessons endpoint creates a fresh session: 201, resumed:false", async () => {
  const res = await api("POST", `/api/learners/${learnerId}/lessons/${LAB}/session`, {}, learnerToken);
  assert.equal(res.status, 201);
  const body = res.body as {
    sessionId: string; token: string; learnerId: string; labId: string; resumed: boolean; driver: string; terminalUrl: string;
  };
  assert.equal(body.resumed, false);
  assert.equal(body.learnerId, learnerId);
  assert.equal(body.labId, LAB);
  assert.ok(body.sessionId && body.token);
  firstSessionId = body.sessionId;
  firstToken = body.token;
});

test("drive some progress: a question (mock answers) and a workspace mutation", async () => {
  askedText = "Where do I start with this reply?";
  const ask = await api("POST", `/api/sessions/${firstSessionId}/ask`, { text: askedText }, firstToken);
  assert.equal(ask.status, 200);
  const askedMsg = ask.body as { message: { role: string; text: string } };
  assert.equal(askedMsg.message.role, "instructor");
  answeredText = askedMsg.message.text;
  assert.ok(answeredText.length > 0);

  // Workspace mutation: open the seeded customer email (measured fact: read -> true).
  const before = await api("GET", `/api/sessions/${firstSessionId}/workspace`, undefined, firstToken);
  assert.equal((before.body as { email: { inbox: Array<{ read: boolean }> } }).email.inbox[0].read, false);
  const act = await api(
    "POST",
    `/api/sessions/${firstSessionId}/workspace/action`,
    { type: "open-artifact", appId: "email", artifactId: "customer-email" },
    firstToken,
  );
  assert.equal(act.status, 200);
  assert.equal((act.body as { email: { inbox: Array<{ read: boolean }> } }).email.inbox[0].read, true);
});

test("simulated restart: releaseAll tears down live resources but keeps the store rows", async () => {
  assert.ok(manager.get(firstSessionId), "session is live before the restart");
  await manager.releaseAll();
  assert.equal(manager.get(firstSessionId), null, "the live Session object is gone from RAM");
});

let resumedToken = "";

test("lessons endpoint again: 200, resumed:true, SAME sessionId, DIFFERENT token", async () => {
  const res = await api("POST", `/api/learners/${learnerId}/lessons/${LAB}/session`, {}, learnerToken);
  assert.equal(res.status, 200);
  const body = res.body as { sessionId: string; token: string; resumed: boolean };
  assert.equal(body.resumed, true);
  assert.equal(body.sessionId, firstSessionId, "the learner is handed back into the SAME session");
  assert.notEqual(body.token, firstToken, "the token is always freshly minted on resume");
  resumedToken = body.token;
});

test("resumed state: transcript carries the earlier Q&A; workspace carries the earlier mutation", async () => {
  const state = await api("GET", `/api/sessions/${firstSessionId}/state`, undefined, resumedToken);
  assert.equal(state.status, 200);
  const transcript = (state.body as { transcript: Array<{ role: string; text: string }> }).transcript;
  assert.ok(transcript.some((m) => m.role === "learner" && m.text === askedText), "the learner's question survived resume");
  assert.ok(transcript.some((m) => m.role === "instructor" && m.text === answeredText), "the instructor's answer survived resume");

  const ws = await api("GET", `/api/sessions/${firstSessionId}/workspace`, undefined, resumedToken);
  assert.equal(ws.status, 200);
  assert.equal((ws.body as { email: { inbox: Array<{ read: boolean }> } }).email.inbox[0].read, true, "the earlier workspace mutation survived resume");

  // The OLD token must no longer work — resume always mints a fresh one.
  const stale = await api("GET", `/api/sessions/${firstSessionId}/state`, undefined, firstToken);
  assert.equal(stale.status, 401);
});

let secondSessionId = "";

test("abandon, then lessons endpoint creates a BRAND NEW session", async () => {
  const abandon = await api("POST", `/api/sessions/${firstSessionId}/abandon`, {}, resumedToken);
  assert.equal(abandon.status, 200);
  assert.equal((abandon.body as { ok: boolean }).ok, true);

  const res = await api("POST", `/api/learners/${learnerId}/lessons/${LAB}/session`, {}, learnerToken);
  assert.equal(res.status, 201);
  const body = res.body as { sessionId: string; resumed: boolean };
  assert.equal(body.resumed, false);
  assert.notEqual(body.sessionId, firstSessionId, "abandoning the old attempt starts a genuinely new one");
  secondSessionId = body.sessionId;
});

test("admin: old session is abandoned, new one is open; replay carries session.abandoned", async () => {
  const sessions = await admin("/api/admin/sessions");
  assert.equal(sessions.status, 200);
  const list = (sessions.body as { sessions: Array<{ sessionId: string; status: string; endedAt: string | null }> }).sessions;
  const old = list.find((s) => s.sessionId === firstSessionId)!;
  const fresh = list.find((s) => s.sessionId === secondSessionId)!;
  assert.ok(old, "old session on record");
  assert.ok(fresh, "new session on record");
  assert.equal(old.status, "abandoned");
  assert.ok(old.endedAt, "abandoned session has an endedAt timestamp");
  assert.equal(fresh.status, "open");
  assert.equal(fresh.endedAt, null);

  const replay = await admin(`/api/admin/sessions/${firstSessionId}/replay`);
  assert.equal(replay.status, 200);
  const events = (replay.body as { events: Array<{ type: string }> }).events;
  assert.ok(events.some((e) => e.type === "session.abandoned"), "the abandonment itself is on the record");
  assert.ok(events.some((e) => e.type === "session.resumed"), "the earlier resume is also on the record");
});

test("negative: lessons endpoint rejects the wrong learner token", async () => {
  const res = await api("POST", `/api/learners/${learnerId}/lessons/${LAB}/session`, {}, "totally-wrong-token-000000");
  assert.equal(res.status, 401);
});
