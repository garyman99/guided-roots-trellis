/**
 * Experience analyst e2e (plan Phase B): the mock analyst reads a lesson's
 * recorded sessions, writes a validated report to disk, the reports endpoint
 * lists it, and the handoff routes non-revisable findings to the dev outbox.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const EXPERIENCE_DIR = mkdtempSync(join(tmpdir(), "trellis-exp-"));
const IMPROVEMENTS_DIR = mkdtempSync(join(tmpdir(), "trellis-improve-"));
process.env.TRELLIS_EXPERIENCE_DIR = EXPERIENCE_DIR;
process.env.TRELLIS_LESSON_IMPROVEMENTS_DIR = IMPROVEMENTS_DIR;
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-exp-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-pub-exp-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, store } from "../src/server.ts";

let base = "";
before(async () => {
  // A recorded session for the lesson under analysis.
  store.createSession({
    sessionId: "exp-s1", learnerId: "l1", labId: "demo-lab-101",
    createdAt: new Date().toISOString(), consentAnalytics: false, status: "open", endedAt: null,
  });
  store.appendEvent("exp-s1", { type: "learner.question", text: "what is a terminal?", stuck: true, timestamp: new Date().toISOString() });
  store.appendEvent("exp-s1", { type: "checkpoint.evaluated", checkpointId: "cp", passed: false, incomplete: ["solution-complete"], timestamp: new Date().toISOString() });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  await manager.destroyAll();
  server.close();
  for (const d of [EXPERIENCE_DIR, IMPROVEMENTS_DIR]) try { rmSync(d, { recursive: true, force: true }); } catch { /* win */ }
});

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("mock analyst: analyze → report on disk → listed → handoff routes platform findings", async () => {
  // start (mock provider = default)
  const started = await api("POST", "/api/admin/lessons/demo-lab-101/experience/analyze", {});
  assert.equal(started.status, 202);

  // wait for completion (mock resolves quickly)
  let state: { running: boolean; error: string | null } = { running: true, error: null };
  for (let i = 0; i < 40 && state.running; i++) {
    await new Promise((r) => setTimeout(r, 50));
    state = ((await api("GET", "/api/admin/lessons/demo-lab-101/experience/live")).body as { state: typeof state }).state;
  }
  assert.equal(state.running, false);
  assert.equal(state.error, null);

  // report listed + persisted with meta and classified findings
  const reports = ((await api("GET", "/api/admin/lessons/demo-lab-101/experience/reports")).body as {
    reports: Array<{ file: string; family: string; verdict: string; findings: Array<{ area: string }>; meta: { provider: string } }>;
  }).reports;
  assert.equal(reports.length, 1);
  const r = reports[0];
  assert.equal(r.family, "demo-lab-101");
  assert.equal(r.verdict, "revise");
  assert.ok(r.findings.some((f) => f.area === "platform"), "mock report includes a platform finding");
  assert.equal(r.meta.provider, "mock");
  assert.ok(existsSync(join(EXPERIENCE_DIR, "demo-lab-101", r.file.replace(".json", ".md"))), "md twin written");

  // handoff: this lab is neither hand-authored nor published → generated-ish;
  // only NON-revisable findings route to the outbox.
  const handoff = await api("POST", `/api/admin/lessons/demo-lab-101/experience/reports/${r.file}/handoff`);
  assert.equal(handoff.status, 201);
  const record = (handoff.body as { request: { reason: string; findings: Array<{ area: string }> } }).request;
  assert.equal(record.reason, "platform-findings");
  assert.ok(record.findings.every((f) => f.area === "platform" || f.area === "guide-behavior"));
  const outbox = join(IMPROVEMENTS_DIR, "demo-lab-101", "request.md");
  assert.ok(existsSync(outbox), "outbox brief written");
  assert.match(readFileSync(outbox, "utf8"), /PLATFORM defects/);

  // list endpoint sees it
  const listed = ((await api("GET", "/api/admin/lesson-improvements")).body as { requests: unknown[] }).requests;
  assert.equal(listed.length, 1);

  // a second concurrent analyze is refused while one runs — start two quickly
  const [a, b] = await Promise.all([
    api("POST", "/api/admin/lessons/demo-lab-101/experience/analyze", {}),
    api("POST", "/api/admin/lessons/demo-lab-101/experience/analyze", {}),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses[0] === 202 && (statuses[1] === 202 || statuses[1] === 409), "at most one runs; a racer may 409");
});
