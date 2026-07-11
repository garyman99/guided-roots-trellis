/**
 * Learner-model e2e (Phases 0–5 wired): boots the real API and plays the
 * long-term journey the roadmap promised:
 *
 *   create learner → session with learner creds (tier 1, agent timeline) →
 *   solve in the real shell → checkpoint → self-assessment → reflection →
 *   solve AGAIN → mastery claim appears WITH evidence + explanation →
 *   next session auto-promotes to tier 2 → contestation (fresh start) →
 *   analytics consent gates + k-suppression → erasure (delete + tombstone).
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager } from "../src/server.ts";

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

/** Drive a full solve through the REAL terminal, then evaluate the checkpoint. */
async function solveOnce(): Promise<{ sessionId: string; token: string; variantId: string | null }> {
  const created = await api("POST", "/api/sessions", {
    labId: "inspect-generated-changes",
    consentAnalytics: true,
    learnerId,
    learnerToken,
  });
  assert.equal(created.status, 201);
  const { sessionId, token, variantId } = created.body as { sessionId: string; token: string; variantId: string | null };

  const ws = new WebSocket(`${base.replace("http", "ws")}/ws/terminal?session=${sessionId}&token=${token}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("ws failed"));
  });
  const type = async (line: string, settleMs: number) => {
    ws.send(line + "\n");
    await new Promise((r) => setTimeout(r, settleMs));
    await manager.get(sessionId)!.instrumentation.drain();
  };

  await type("git diff", 1200);
  await type("npm test", 6000);
  // Tier 1 and tier 2 defects have different one-line fixes; issue both seds
  // (each is a no-op on the other variant).
  await type("sed -i 's/Math.floor(discounted)/Math.round(discounted)/' src/pricing.ts", 700);
  await type("sed -i 's/sum + item.unitPriceCents,/sum + item.unitPriceCents * item.quantity,/' src/pricing.ts", 700);
  await type("npm test", 6000);

  const evalRes = await api("POST", `/api/sessions/${sessionId}/checkpoint/evaluate`, {}, token);
  assert.equal(evalRes.status, 200);
  assert.equal((evalRes.body as { passed: boolean }).passed, true, `checkpoint must pass (${JSON.stringify(evalRes.body).slice(0, 300)})`);
  ws.close();
  return { sessionId, token, variantId };
}

test("learner creation issues persistent credentials with consent tiers", async () => {
  const res = await api("POST", "/api/learners", { consentCohortAggregate: true, consentResearch: true });
  assert.equal(res.status, 201);
  const body = res.body as { learnerId: string; learnerToken: string; consents: Record<string, boolean> };
  learnerId = body.learnerId;
  learnerToken = body.learnerToken;
  assert.ok(learnerId && learnerToken);
  assert.deepEqual(body.consents, { selfAnalytics: true, cohortAggregate: true, research: true });

  // Learner routes are token-gated.
  const noAuth = await api("GET", `/api/learners/${learnerId}/profile`);
  assert.equal(noAuth.status, 401);
});

test("first session: cold start is tier 1, the agent timeline replays, mastery is only 'emerging'", async () => {
  const { sessionId, token, variantId } = await solveOnce();
  assert.equal(variantId, "tier1:rounding-floor", "cold start selects the lowest tier");

  const state = await api("GET", `/api/sessions/${sessionId}/state`, undefined, token);
  const timeline = (state.body as { agentTimeline: Array<{ action: string; detail: string }> }).agentTimeline;
  assert.equal(timeline.length, 6, "authored agent beats land in the event log");
  assert.ok(
    timeline.some((b) => b.action === "ran-tests" && /judged them unrelated/.test(b.detail)),
    "the rationalized-failure beat is present — the whole point of the lab",
  );

  // Self-assessment: calibration signal (confident, and actually passed).
  const sa = await api("POST", `/api/sessions/${sessionId}/self-assessment`, { confidence: 5 }, token);
  assert.equal(sa.status, 201);

  // Reflection exists, is structured, and its narrative only restates digest facts.
  const refl = await api("GET", `/api/sessions/${sessionId}/reflection`, undefined, token);
  assert.equal(refl.status, 200);
  const r = refl.body as { reflection: { demonstrated: string[] }; narrative: string };
  assert.ok(r.reflection.demonstrated.length >= 2);
  assert.ok(r.narrative.length > 0);

  const prof = await api("GET", `/api/learners/${learnerId}/profile`, undefined, learnerToken);
  const profile = (prof.body as { profile: { skills: Array<{ conceptId: string; status: string }> } }).profile;
  assert.equal(profile.skills.find((s) => s.conceptId === "git.diff-first-review")?.status, "emerging", "one completion is evidence, not mastery");

  await api("DELETE", `/api/sessions/${sessionId}`, undefined, token);
});

test("second completion → mastery claim WITH evidence pointers and a human explanation", async () => {
  const { sessionId, token } = await solveOnce();
  await api("DELETE", `/api/sessions/${sessionId}`, undefined, token);

  const prof = await api("GET", `/api/learners/${learnerId}/profile`, undefined, learnerToken);
  assert.equal(prof.status, 200);
  const body = prof.body as {
    profile: {
      labsCompleted: number;
      skills: Array<{ conceptId: string; status: string; evidence: number[]; explanation: string; confidence: number }>;
    };
    evidence: Array<{ seq: number }>;
    recommendations: Array<{ conceptId: string }>;
  };
  assert.equal(body.profile.labsCompleted, 2);

  const diffSkill = body.profile.skills.find((s) => s.conceptId === "git.diff-first-review")!;
  assert.equal(diffSkill.status, "mastered");
  assert.ok(diffSkill.evidence.length >= 2, "the claim carries evidence pointers");
  assert.match(diffSkill.explanation, /Reviewed the agent's diff .* 2 lab session/);
  const seqs = new Set(body.evidence.map((e) => e.seq));
  assert.ok(diffSkill.evidence.every((seq) => seqs.has(seq)), "every pointer resolves in the learner's own export");
});

test("adaptive labs: the next session auto-promotes to tier 2 (hysteresis: promotion is immediate on mastery)", async () => {
  const created = await api("POST", "/api/sessions", {
    labId: "inspect-generated-changes",
    consentAnalytics: true,
    learnerId,
    learnerToken,
  });
  assert.equal(created.status, 201);
  const { sessionId, token, variantId } = created.body as { sessionId: string; token: string; variantId: string };
  assert.equal(variantId, "tier2:subtotal-accumulation", "mastered exercised concepts promote the tier");
  await api("DELETE", `/api/sessions/${sessionId}`, undefined, token);
});

test("contestation is first-class: a fresh-start assertion resets the concept, auditable in the stream", async () => {
  const res = await api(
    "POST",
    `/api/learners/${learnerId}/assertions`,
    { kind: "fresh-start", conceptId: "git.diff-first-review", note: "let me re-earn this" },
    learnerToken,
  );
  assert.equal(res.status, 201);
  const profile = (res.body as { profile: { skills: Array<{ conceptId: string; status: string }> } }).profile;
  assert.equal(profile.skills.find((s) => s.conceptId === "git.diff-first-review")?.status, "unknown");

  const exp = await api("GET", `/api/learners/${learnerId}/export`, undefined, learnerToken);
  const evidence = (exp.body as { evidence: Array<{ type: string; kind?: string }> }).evidence;
  assert.ok(evidence.some((e) => e.type === "learner.assertion" && e.kind === "fresh-start"), "the correction is itself evidence");
});

test("analytics: cohort is k-suppressed below threshold; research export honors consent", async () => {
  const cohort = await api("GET", "/api/analytics/cohort");
  assert.equal((cohort.body as { suppressed: boolean }).suppressed, true, "a cohort of one is never a window into a person");

  const research = await api("GET", "/api/analytics/research-export");
  const learners = (research.body as { learners: Array<{ learnerId: string; digests: unknown[] }> }).learners;
  assert.ok(learners.some((l) => l.learnerId === learnerId && l.digests.length === 2), "research consent was granted");
});

test("erasure: delete + tombstone; credentials die with the record", async () => {
  const del = await api("DELETE", `/api/learners/${learnerId}`, undefined, learnerToken);
  assert.equal(del.status, 200);

  const prof = await api("GET", `/api/learners/${learnerId}/profile`, undefined, learnerToken);
  assert.equal(prof.status, 410, "erased learners are gone, not 404-ambiguous");

  const created = await api("POST", "/api/sessions", { learnerId, learnerToken });
  assert.equal(created.status, 410, "erased credentials cannot open new sessions");

  const research = await api("GET", "/api/analytics/research-export");
  const learners = (research.body as { learners: Array<{ learnerId: string }> }).learners;
  assert.ok(!learners.some((l) => l.learnerId === learnerId), "erasure reaches analytics too");
});
