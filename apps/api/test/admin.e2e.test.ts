/**
 * Admin surface e2e: boots the real API with TRELLIS_ADMIN_TOKEN set and
 * checks the operator views — agents (prompts included), users (activity +
 * per-model tokens + derived profile), usage (by-model totals + day series)
 * — plus the bearer-token gate itself. Uses the workspace lab so no shell or
 * container is needed; the mock provider's deterministic usage numbers feed
 * the accounting exactly like a real model's would.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager } from "../src/server.ts";

let base = "";

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

const admin = (path: string) => api("GET", path, undefined, "test-admin-token");

test("admin routes are gated by TRELLIS_ADMIN_TOKEN", async () => {
  assert.equal((await api("GET", "/api/admin/agents")).status, 401);
  assert.equal((await api("GET", "/api/admin/agents", undefined, "wrong")).status, 401);
  assert.equal((await admin("/api/admin/agents")).status, 200);
});

test("agents view lists configured agents with their prompts", async () => {
  const { status, body } = await admin("/api/admin/agents");
  assert.equal(status, 200);
  const agents = (body as { agents: Array<{ id: string; kind: string; prompts: Array<{ id: string; active: boolean; content: string }> }> }).agents;
  const ids = agents.map((a) => a.id);
  assert.deepEqual(ids, ["instructor", "intervention-engine", "reflection-narrative", "workspace-ai"]);

  const instructor = agents[0];
  assert.ok(instructor.prompts.length >= 2, "instructor should expose its versioned prompt files");
  const active = instructor.prompts.filter((p) => p.active);
  assert.equal(active.length, 1, "exactly one prompt version is active");
  assert.ok(active[0].content.includes("# Role"), "prompt content is the real file");
});

test("guide exchanges record token usage that surfaces in users and usage views", async () => {
  // learner + workspace session (no lab environment needed) — with the
  // display identity the web app now sends from the auth layer
  const learner = await api("POST", "/api/learners", { name: "Eva", email: "eva@localhost" });
  assert.equal(learner.status, 201);
  const { learnerId, learnerToken } = learner.body as { learnerId: string; learnerToken: string };

  const created = await api("POST", "/api/sessions", {
    labId: "improve-delayed-order-reply",
    learnerId,
    learnerToken,
  });
  assert.equal(created.status, 201);
  const session = created.body as { sessionId: string; token: string };

  const ask1 = await api("POST", `/api/sessions/${session.sessionId}/ask`, { text: "where do I start?" }, session.token);
  assert.equal(ask1.status, 200);
  const ask2 = await api("POST", `/api/sessions/${session.sessionId}/ask`, { text: "what should the reply include?", stuck: true }, session.token);
  assert.equal(ask2.status, 200);

  // users view: this learner appears with identity, activity, per-model
  // usage WITH cost, roll-up totals, and the derived profile
  const users = await admin("/api/admin/users");
  assert.equal(users.status, 200);
  const me = (users.body as { users: Array<{ learnerId: string; name: string | null; email: string | null; totals: { calls: number; totalTokens: number; estimatedCostUSD: number; unpricedCalls: number }; activity: { hintCalls: number; lastActiveAt: string }; usageByModel: Array<{ model: string; calls: number; totalTokens: number; estimatedCostUSD: number; unpricedCalls: number }>; profile: { skills: unknown[] } }> }).users.find(
    (u) => u.learnerId === learnerId,
  );
  assert.ok(me, "learner appears in the admin users view");
  assert.equal(me.name, "Eva", "display name from the auth layer surfaces");
  assert.equal(me.email, "eva@localhost");
  assert.equal(me.activity.hintCalls, 2);
  assert.equal(me.usageByModel.length, 1);
  assert.equal(me.usageByModel[0].model, "mock-instructor");
  assert.equal(me.usageByModel[0].calls, 2);
  assert.ok(me.usageByModel[0].totalTokens > 0, "mock provider reports non-zero tokens");
  assert.equal(me.usageByModel[0].estimatedCostUSD, 0, "mock is priced at $0 — the cost PIPELINE ran");
  assert.equal(me.usageByModel[0].unpricedCalls, 0, "mock has a pricing entry, so nothing is unpriced");
  assert.equal(me.totals.calls, 2);
  assert.equal(me.totals.totalTokens, me.usageByModel[0].totalTokens);
  assert.equal(me.totals.estimatedCostUSD, 0);
  assert.ok(Array.isArray(me.profile.skills), "derived profile rides along");

  // the drill-down's session list + replay: this user's session is on
  // record and its recording plays back the ask we just made
  const sessions = await admin("/api/admin/sessions");
  assert.equal(sessions.status, 200);
  const mine = (sessions.body as { sessions: Array<{ sessionId: string; learnerId: string }> }).sessions.filter((s) => s.learnerId === learnerId);
  assert.equal(mine.length, 1, "the user's session appears for the drill-down");
  const replay = await admin(`/api/admin/sessions/${session.sessionId}/replay`);
  assert.equal(replay.status, 200);
  const events = (replay.body as { events: Array<{ type: string }> }).events;
  assert.ok(events.some((e) => e.type === "learner.question"), "replay carries the recorded conversation");

  // usage view: totals by model (with cost) + a day-bucketed series
  const usage = await admin("/api/admin/usage");
  assert.equal(usage.status, 200);
  const u = usage.body as { calls: number; byModel: Array<{ model: string; totalTokens: number; estimatedCostUSD: number }>; series: Array<{ day: string; model: string; totalTokens: number }> };
  assert.ok(u.calls >= 2);
  assert.equal(u.byModel[0].model, "mock-instructor");
  assert.equal(typeof u.byModel[0].estimatedCostUSD, "number", "usage view carries cost");
  assert.ok(u.series.length >= 1);
  assert.match(u.series[0].day, /^\d{4}-\d{2}-\d{2}$/);
  const seriesTotal = u.series.reduce((s, r) => s + r.totalTokens, 0);
  const byModelTotal = u.byModel.reduce((s, r) => s + r.totalTokens, 0);
  assert.equal(seriesTotal, byModelTotal, "series and by-model totals agree");

  // erasure removes the learner's usage from the admin views (ADR-0002)
  const erased = await api("DELETE", `/api/learners/${learnerId}`, undefined, learnerToken);
  assert.equal(erased.status, 200);
  const usersAfter = await admin("/api/admin/users");
  const gone = (usersAfter.body as { users: Array<{ learnerId: string }> }).users.find((x) => x.learnerId === learnerId);
  assert.equal(gone, undefined, "erased learner leaves the users view");
  const usageAfter = await admin("/api/admin/usage");
  assert.equal((usageAfter.body as { calls: number }).calls, u.calls - 2, "erasure removes the learner's usage records");
});
