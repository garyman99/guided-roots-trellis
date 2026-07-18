/**
 * Pre-publish simulated user test over the real API (quality-rework Phase 4),
 * with the fake runner (TRELLIS_SIM_TEST_FAKE=1) — queue mechanics, disk
 * persistence, gating, the sim→revision adapter, and the metrics filter.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
process.env.TRELLIS_SKIP_AUTOSOLVE = "1";
process.env.TRELLIS_SIM_TEST_FAKE = "1";
delete process.env.COURSE_GEN_PROVIDER;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-simtest-runs-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-simtest-pub-"));
process.env.TRELLIS_PERSONAS_DIR = mkdtempSync(join(tmpdir(), "trellis-simtest-personas-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { server, manager, store } from "../src/server.ts";
import { lessonExperience } from "../src/lessonExperience.ts";

let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  for (const r of store.listCourseRuns()) store.deleteCourseRun(r.runId);
  for (const c of store.listCourses()) if (c.sourceRunId) store.deleteCourse(c.courseId);
  for (const s of store.listScenarioEntries()) store.deleteScenarioEntry(s.labId);
  await manager.destroyAll();
  server.close();
});
const admin = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

async function readyPersona(name: string): Promise<string> {
  const created = await admin("POST", "/api/admin/personas", { name });
  const id = (created.body as { persona: { personaId: string } }).persona.personaId;
  for (const m of ["A junior dev learning Git", "Knows editors, never used version control", "Asks for help fast"]) {
    await admin("POST", `/api/admin/personas/${id}/interview`, { message: m, providerConfig: { provider: "mock" } });
  }
  await admin("PUT", `/api/admin/personas/${id}`, { status: "ready" });
  return id;
}

async function approvedGitRun(personaId: string): Promise<string> {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git", personaId, providerConfig: { provider: "mock" } });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: { runId: string } }).run.runId;
  const wait = async () => {
    for (let i = 0; i < 100; i++) {
      const d = await admin("GET", `/api/admin/course-runs/${runId}`);
      const r = (d.body as { run: { status: string } }).run;
      if (r.status.startsWith("awaiting-") || r.status === "approved") return r.status;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("run never parked");
  };
  await wait();
  for (const gate of ["frame", "blueprint", "package", "publish"]) {
    await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "test" });
    await wait();
  }
  return runId;
}

test("sim-test refuses before the publish gate, runs every lesson after it, persists to disk", async () => {
  const personaId = await readyPersona("Sam");
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git", personaId, providerConfig: { provider: "mock" } });
  const runId = (created.body as { run: { runId: string } }).run.runId;

  // Not approved yet → 409.
  for (let i = 0; i < 100; i++) {
    const d = await admin("GET", `/api/admin/course-runs/${runId}`);
    if ((d.body as { run: { status: string } }).run.status.startsWith("awaiting-")) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  const early = await admin("POST", `/api/admin/course-runs/${runId}/sim-test`, {});
  assert.equal(early.status, 409);

  // Approve through publish, then enqueue.
  const wait = async () => {
    for (let i = 0; i < 100; i++) {
      const d = await admin("GET", `/api/admin/course-runs/${runId}`);
      const r = (d.body as { run: { status: string } }).run;
      if (r.status.startsWith("awaiting-") || r.status === "approved") return r.status;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("never parked");
  };
  for (const gate of ["frame", "blueprint", "package", "publish"]) {
    await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "test" });
    await wait();
  }

  const started = await admin("POST", `/api/admin/course-runs/${runId}/sim-test`, {});
  assert.equal(started.status, 202);

  // The fake runner completes both Git-pack lessons; results land on disk.
  let jobs: Array<{ labId: string; state: string; result?: { status: string; frictionScore?: number | null } }> = [];
  for (let i = 0; i < 100; i++) {
    const s = await admin("GET", `/api/admin/course-runs/${runId}/sim-test`);
    jobs = (s.body as { jobs: typeof jobs }).jobs;
    if (jobs.length === 2 && jobs.every((j) => j.state === "done")) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((j) => j.result?.status === "completed"));
  for (const labId of ["git-101", "git-102"]) {
    const path = join(process.env.TRELLIS_RUNS_DIR!, runId, "sim-tests", labId, "result.json");
    assert.ok(existsSync(path), `${path} persisted`);
    assert.equal((JSON.parse(readFileSync(path, "utf8")) as { status: string }).status, "completed");
  }

  // The sim→revision adapter: one click seeds a Phase D revision run.
  const rev = await admin("POST", `/api/admin/course-runs/${runId}/sim-test/git-101/start-revision`, { providerConfig: { provider: "mock" } });
  assert.equal(rev.status, 201);
  const revRun = (rev.body as { run: { request: { revision?: { family: string; report?: { summary: string; findings: unknown[] } }; persona?: { personaId: string } } } }).run;
  assert.equal(revRun.request.revision?.family, "git-101");
  assert.match(revRun.request.revision!.report!.summary, /simulated user test/i);
  assert.ok((revRun.request.revision!.report!.findings as unknown[]).length >= 1);
  assert.equal(revRun.request.persona?.personaId, personaId, "revision inherits the course persona");

  // One active revision per family — a second click refuses.
  const again = await admin("POST", `/api/admin/course-runs/${runId}/sim-test/git-101/start-revision`, {});
  assert.equal(again.status, 400);
  assert.match((again.body as { error: string }).error, /already in progress/);
});

test("a persona-less legacy run 422s, then backfills the course from personaId", async () => {
  // A run created WITHOUT a persona (legacy path).
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Docker", providerConfig: { provider: "mock" } });
  const runId = (created.body as { run: { runId: string } }).run.runId;
  const wait = async () => {
    for (let i = 0; i < 100; i++) {
      const d = await admin("GET", `/api/admin/course-runs/${runId}`);
      const r = (d.body as { run: { status: string } }).run;
      if (r.status.startsWith("awaiting-") || r.status === "approved") return r.status;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("never parked");
  };
  await wait();
  for (const gate of ["frame", "blueprint", "package", "publish"]) {
    await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "test", gaps: [] });
    await wait();
  }

  const bare = await admin("POST", `/api/admin/course-runs/${runId}/sim-test`, {});
  assert.equal(bare.status, 422);
  assert.equal((bare.body as { needPersona?: boolean }).needPersona, true);

  const personaId = await readyPersona("Backfill Pat");
  const withPersona = await admin("POST", `/api/admin/course-runs/${runId}/sim-test`, { personaId });
  assert.equal(withPersona.status, 202);
  // The course got the snapshot backfilled — from now on it behaves like a new one.
  const course = store.listCourses().find((c) => c.sourceRunId === runId);
  assert.equal(course?.persona?.personaId, personaId);
});

test("sim sessions are excluded from real-learner experience metrics", async () => {
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labId: "inspect-generated-changes", consentAnalytics: false }),
  });
  const s = (await res.json()) as { sessionId: string; token: string };
  const before = lessonExperience(store, "inspect-generated-changes").sessions.length;
  assert.ok(before >= 1, "the fresh session counts as a learner session");
  store.setSessionKind(s.sessionId, "sim");
  const afterTag = lessonExperience(store, "inspect-generated-changes").sessions.length;
  assert.equal(afterTag, before - 1, "tagged sim session no longer counts");
  await fetch(`${base}/api/sessions/${s.sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}` } });
});
