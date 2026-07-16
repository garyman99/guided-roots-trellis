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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-e2e-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-published-e2e-"));

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

test("a run walks all four gates to approved, writing a marker artifact per phase", async () => {
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
    ["blueprint", "awaiting-package"],
    ["package", "awaiting-publish"],
    ["publish", "approved"],
  ] as const) {
    const r = await admin("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "eva" });
    assert.equal(r.status, 200);
    await courseRuns.settle();
    const now = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
    assert.equal(now.status, next, `after approving ${gate}`);
  }

  const final = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.equal(final.gates.filter((g) => g.decision === "approved").length, 4);
  assert.ok(final.gates.every((g) => g.decidedBy === "eva"));

  // Materialization created a DRAFT course (hidden from the public shelf) plus
  // runtime scenario entries for its lessons.
  const publicCourses = (await api("GET", "/api/courses")).body as { courses: Array<{ sourceRunId?: string }> };
  assert.ok(!publicCourses.courses.some((c) => c.sourceRunId === runId), "draft course is not public until Go-live");
  const scenarios = (await api("GET", "/api/scenarios")).body as { scenarios: Array<{ labId: string; tag: string }> };
  const generated = scenarios.scenarios.filter((s) => /GENERATED/.test(s.tag));
  assert.ok(generated.length >= 2, "generated lessons registered as scenarios");
  assert.ok(final.artifacts.includes("lesson-inventory.json"), "blueprint artifact present");
  assert.ok(final.artifacts.some((p) => p.startsWith("lessons/") && p.endsWith("lesson.md")), "authored lesson present");
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
