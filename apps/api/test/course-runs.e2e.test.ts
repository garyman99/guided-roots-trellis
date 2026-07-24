/**
 * Course-generation run endpoints over the real API, driven by the Phase-B
 * placeholder executor: create → walk all four gates → approved, plus the
 * changes loop, artifact reads, and the 409s the state machine enforces.
 * Persistence off; runs dir isolated to a temp directory.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-e2e-"));
const PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-published-e2e-"));
process.env.TRELLIS_RUNS_DIR = RUNS_DIR;
process.env.TRELLIS_PUBLISHED_DIR = PUBLISHED_DIR;

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, courseRuns, store } from "../src/server.ts";

let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  // Good citizen under `npm test` (which runs against the real store): remove
  // every run + generated course/scenario this file created.
  for (const r of store.listCourseRuns()) store.deleteCourseRun(r.runId);
  for (const c of store.listCourses()) if (c.sourceRunId) store.deleteCourse(c.courseId);
  for (const s of store.listScenarioEntries()) store.deleteScenarioEntry(s.labId);
  await manager.destroyAll();
  server.close();
  for (const d of [RUNS_DIR, PUBLISHED_DIR]) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ }
});

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const admin = (method: string, path: string, body?: unknown) => api(method, path, body, "test-admin-token");

interface RunDetail {
  runId: string;
  status: string;
  technology: string;
  pendingGate: string | null;
  artifacts: string[];
  gates: Array<{ gateId: string; decision: string | null; decidedBy: string | null }>;
  events: Array<{ type: string }>;
}

test("course-runs are admin-gated", async () => {
  assert.equal((await api("GET", "/api/admin/course-runs")).status, 401);
  assert.equal((await api("POST", "/api/admin/course-runs", { technology: "Git" })).status, 401);
});

test("a run walks all six gates to approved, writing a marker artifact per phase", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git", title: "Git Fundamentals" });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: RunDetail }).run.runId;
  assert.match(runId, /^cg-git-/);
  await courseRuns.settle();

  const parked = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.equal(parked.status, "awaiting-frame");
  assert.equal(parked.pendingGate, "frame");
  assert.ok(parked.artifacts.includes("course-request.md"));

  // Read the framing artifact through the allowlisted route — a real course
  // request produced by the mock role pipeline.
  const art = await admin("GET", `/api/admin/course-runs/${runId}/artifacts/course-request.md`);
  assert.equal(art.status, 200);
  assert.match((art.body as { content: string }).content, /# Git Fundamentals[\s\S]*Technology:\*\* Git/);
  // A disallowed path is refused.
  assert.equal((await admin("GET", `/api/admin/course-runs/${runId}/artifacts/..%2Fsecret`)).status, 400);

  for (const [gate, next] of [
    ["frame", "awaiting-blueprint"],
    ["blueprint", "awaiting-reconcile"],
    ["reconcile", "awaiting-package"],
    ["package", "awaiting-rehearse"],
    ["rehearse", "awaiting-publish"],
    ["publish", "approved"],
  ] as const) {
    const r = await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "eva" });
    assert.equal(r.status, 200);
    await courseRuns.settle();
    const now = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
    assert.equal(now.status, next, `after approving ${gate}`);
  }

  const final = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.equal(final.gates.filter((g) => g.decision === "approved").length, 6);
  assert.ok(final.gates.every((g) => g.decidedBy === "eva"));

  // Materialization created a DRAFT course (hidden from the public shelf) plus
  // runtime scenario entries for its lessons.
  const publicCourses = (await api("GET", "/api/courses")).body as { courses: Array<{ sourceRunId?: string }> };
  assert.ok(!publicCourses.courses.some((c) => c.sourceRunId === runId), "draft course is not public until Go-live");
  const scenarios = (await api("GET", "/api/scenarios")).body as { scenarios: Array<{ labId: string; tag: string }> };
  const generated = scenarios.scenarios.filter((s) => /GENERATED/.test(s.tag));
  assert.ok(generated.length >= 2, "generated (auto-solved) lessons registered as scenarios");
  assert.ok(final.artifacts.includes("lesson-inventory.json"), "blueprint artifact present");
  assert.ok(final.artifacts.some((p) => p.startsWith("lessons/") && p.endsWith("lesson.md")), "authored lesson present");

  // The manifest records the auto-solve proof for every shipped lab.
  const manifest = JSON.parse(
    ((await admin("GET", `/api/admin/course-runs/${runId}/artifacts/manifest.json`)).body as { content: string }).content,
  ) as { autoSolve?: Array<{ labId: string; ok: boolean }> };
  assert.ok(manifest.autoSolve && manifest.autoSolve.length >= 2, "auto-solve ran per lab");
  assert.ok(manifest.autoSolve.every((p) => p.ok), "every shipped lab proved broken-as-shipped AND solvable");

  // A shipped generated lab is genuinely loadable/launchable (manifest resolves).
  const first = generated[0].labId;
  const started = await api("POST", "/api/sessions", { labId: first });
  assert.equal(started.status, 201, "a generated lab can start a session");
  const sess = started.body as { sessionId: string; token: string };

  // The generated lab's checkpoint EVALUATES for a real learner: broken as
  // shipped (not passed), and the "verify" requirement resolves to the
  // verifier's check by id (a real ok:false — not "did not report this check",
  // which is the id-mismatch bug Phase E surfaced).
  const evald = await api("POST", `/api/sessions/${sess.sessionId}/checkpoint/evaluate`, undefined, sess.token);
  assert.equal(evald.status, 200);
  const cp = evald.body as { passed: boolean; requirements: Array<{ id: string; ok: boolean; detail?: string }> };
  assert.equal(cp.passed, false, "broken as shipped");
  const req = cp.requirements[0];
  assert.equal(req.ok, false);
  assert.ok(!/did not report/i.test(req.detail ?? ""), `the verify requirement resolves to a real check (got: ${req.detail})`);
});

test("a run accepts a known Environment image and rejects an unknown one", async () => {
  // Part C of unblocking selenium-chrome-runtime: the operator selects the
  // baked toolchain, validated against images this build ships, so the bench
  // profile reaches the author on the next run.
  const listed = await admin("GET", "/api/admin/course-runs/environments");
  assert.equal(listed.status, 200);
  const envs = (listed.body as { environments: Array<{ id: string }> }).environments;
  assert.ok(envs.some((e) => e.id === "trellis-lab-python-selenium"), "the python-selenium image is offered");

  const ok = await admin("POST", "/api/admin/course-runs", { technology: "Selenium", environmentImage: "trellis-lab-python-selenium" });
  assert.equal(ok.status, 201);
  const runId = (ok.body as { run: RunDetail }).run.runId;
  await courseRuns.settle();
  type WithReq = RunDetail & { request: { environmentImage?: string } };
  const run = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: WithReq }).run;
  assert.equal(run.request.environmentImage, "trellis-lab-python-selenium", "stamped on the request");

  const bad = await admin("POST", "/api/admin/course-runs", { technology: "Git", environmentImage: "not-a-real-image" });
  assert.equal(bad.status, 400, "an unknown image is refused, not stamped as a dead tag");
  assert.match((bad.body as { error: string }).error, /unknown environmentImage/);
});

test("PATCH edits a parked run's targetPlatform and mirrors it to run.json", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git" });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle(); // parked at the frame gate

  type WithRequest = RunDetail & { request: { targetPlatform?: string }; events: Array<{ type: string }> };
  let run = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: WithRequest }).run;
  assert.equal(run.request.targetPlatform, "windows", "create stamps the default");

  assert.equal((await admin("PATCH", `/api/admin/course-runs/${runId}`, { targetPlatform: "linux" })).status, 400);

  const patched = await admin("PATCH", `/api/admin/course-runs/${runId}`, { targetPlatform: "mac" });
  assert.equal(patched.status, 200);
  assert.equal((patched.body as { run: WithRequest }).run.request.targetPlatform, "mac");

  run = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: WithRequest }).run;
  assert.equal(run.request.targetPlatform, "mac", "persisted");
  assert.ok(run.events.some((e) => e.type === "run.request-updated"), "audit event recorded");
  // The durable disk mirror carries the edit too (survives a lost DB).
  const mirrored = JSON.parse(readFileSync(join(RUNS_DIR, runId, "run.json"), "utf8")) as { request: { targetPlatform?: string } };
  assert.equal(mirrored.request.targetPlatform, "mac");
});

test("deleting a run cascades to its course, scenarios, and on-disk artifacts", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git", title: "Git Delete Demo" });
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package", "rehearse", "publish"] as const) {
    await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "eva" });
    await courseRuns.settle();
  }

  // It produced a draft course + generated scenarios + an artifacts dir.
  const course = store.listCourses().find((c) => c.sourceRunId === runId);
  assert.ok(course, "run materialized a course");
  const labIds = course.lessons.map((l) => l.labId);
  assert.ok(labIds.length >= 2);
  assert.ok(store.listScenarioEntries().some((s) => labIds.includes(s.labId)), "scenarios present before delete");
  assert.ok(existsSync(join(RUNS_DIR, runId)), "artifacts dir present before delete");

  // Delete cascades and reports what it removed.
  const del = await admin("DELETE", `/api/admin/course-runs/${runId}`);
  assert.equal(del.status, 200);
  const sum = del.body as { deleted: boolean; courseId: string; lessonsRemoved: number; scenariosRemoved: number };
  assert.equal(sum.deleted, true);
  assert.equal(sum.courseId, course.courseId);
  assert.equal(sum.lessonsRemoved, labIds.length);

  // Run, course, scenarios, and artifacts are all gone.
  assert.equal((await admin("GET", `/api/admin/course-runs/${runId}`)).status, 404, "run row removed");
  assert.ok(!store.listCourses().some((c) => c.courseId === course.courseId), "course removed");
  assert.ok(!store.listScenarioEntries().some((s) => labIds.includes(s.labId)), "scenarios removed");
  assert.ok(!existsSync(join(RUNS_DIR, runId)), "artifacts dir removed (run.json can't resurrect it)");

  // Deleting an unknown run → 404.
  assert.equal((await admin("DELETE", "/api/admin/course-runs/cg-nope-000")).status, 404);
});

test("changes requires notes; the state machine rejects out-of-order and unknown decisions", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Docker" });
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle();

  // changes with no notes → 400
  assert.equal((await admin("POST", `/api/admin/course-runs/${runId}/gates/frame/decision`, { decision: "changes" })).status, 400);
  // invalid decision → 400
  assert.equal((await admin("POST", `/api/admin/course-runs/${runId}/gates/frame/decision`, { decision: "maybe" })).status, 400);
  // deciding a gate that isn't pending → 409
  assert.equal(
    (await admin("POST", `/api/admin/course-runs/${runId}/gates/publish/decision`, { decision: "approved" })).status,
    409,
  );

  // A real changes decision loops back to awaiting-frame and revisions the artifact.
  const ch = await admin("POST", `/api/admin/course-runs/${runId}/gates/frame/decision`, {
    decision: "changes",
    notes: [{ path: "course-request.md", comment: "target backend engineers specifically" }],
  });
  assert.equal(ch.status, 200);
  await courseRuns.settle();
  const looped = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.equal(looped.status, "awaiting-frame");
  assert.ok(looped.artifacts.includes("course-request.v1.md"), "prior revision archived");

  // Unknown run → 404.
  assert.equal((await admin("GET", "/api/admin/course-runs/cg-nope-000")).status, 404);
});
