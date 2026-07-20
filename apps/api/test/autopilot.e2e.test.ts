/**
 * Autopilot — the auto-gate arbiter over the real API (autonomous-course-
 * pipeline plan §3.1/§6 acceptance test): with the mock provider, a
 * `gateMode: "auto"` + `autoPublish: true` run walks idea → published course
 * with ZERO further gate requests. Persistence off; runs/personas dirs
 * isolated to temp directories.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
process.env.TRELLIS_SKIP_AUTOSOLVE = "1";
delete process.env.COURSE_GEN_PROVIDER;
delete process.env.TRELLIS_REQUIRE_PERSONA;
delete process.env.COURSE_GEN_AUTOGATE_MAX_CHANGES;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-autopilot-runs-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-autopilot-pub-"));
process.env.TRELLIS_PERSONAS_DIR = mkdtempSync(join(tmpdir(), "trellis-autopilot-personas-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, store, autoGate, courseRuns } from "../src/server.ts";

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

interface RunDetail {
  runId: string;
  status: string;
  gateMode: string;
  autoPublish: boolean;
  lastError: string | null;
  gates: Array<{ gateId: string; decision: string | null; decidedBy: string | null }>;
  artifacts: string[];
}

/** Poke the arbiter and re-check the run, in a tight loop — much faster than
 *  waiting on the server's own 5s interval, and deterministic under CI load. */
async function pokeUntil(runId: string, done: (status: string) => boolean, timeoutMs = 30_000): Promise<RunDetail> {
  const start = Date.now();
  for (;;) {
    await autoGate.poke();
    const d = await admin("GET", `/api/admin/course-runs/${runId}`);
    const run = (d.body as { run: RunDetail }).run;
    if (done(run.status)) return run;
    if (Date.now() - start > timeoutMs) throw new Error(`autopilot run ${runId} never reached the expected status (stuck at "${run.status}")`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("autopilot: gateMode auto + autoPublish walks idea to a published course with zero gate requests", async () => {
  const personaId = await readyPersona("Priya");
  const created = await admin("POST", "/api/admin/course-runs", {
    technology: "Git",
    personaId,
    gateMode: "auto",
    autoPublish: true,
    providerConfig: { provider: "mock" },
  });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: RunDetail }).run.runId;
  assert.equal((created.body as { run: RunDetail }).run.gateMode, "auto");
  assert.equal((created.body as { run: RunDetail }).run.autoPublish, true);

  // ZERO further gate requests from here — only the arbiter acts.
  const run = await pokeUntil(runId, (s) => s === "approved" || s === "archived" || s === "failed" || s === "interrupted");
  assert.equal(run.status, "approved", `run ended in unexpected status; lastError context: ${JSON.stringify(run)}`);

  // All 4 gates decided by the gate-reviewer, none by a human.
  for (const gateId of ["frame", "blueprint", "package", "publish"]) {
    const decided = run.gates.filter((g) => g.gateId === gateId);
    assert.ok(decided.length >= 1, `gate ${gateId} was never decided`);
    const last = decided[decided.length - 1];
    assert.equal(last.decision, "approved", `gate ${gateId} was not approved`);
    assert.equal(last.decidedBy, "gate-reviewer", `gate ${gateId} was not decided by the arbiter`);
  }

  // Verdict artifacts recorded for every gate (the paper trail for the human).
  for (const gateId of ["frame", "blueprint", "package", "publish"]) {
    assert.ok(run.artifacts.includes(`gates/${gateId}.verdict.json`), `missing verdict artifact for ${gateId}`);
  }

  // autoPublish worked: the course exists, published, every lesson live.
  const courses = await admin("GET", "/api/admin/courses");
  const course = (courses.body as { courses: Array<{ sourceRunId?: string; status?: string; lessons: Array<{ published?: boolean }> }> }).courses.find(
    (c) => c.sourceRunId === runId,
  );
  assert.ok(course, "no course was materialized for this run");
  assert.equal(course!.status, "published");
  assert.ok(course!.lessons.length > 0, "published course has no lessons");
  assert.ok(course!.lessons.every((l) => l.published === true), "not every lesson went live");

  // Run detail surfaces the autopilot badges (plan §3.2 UI).
  assert.equal(run.gateMode, "auto");
  assert.equal(run.autoPublish, true);
});

test("autopilot: exhausted change budget force-approves with a reservation, forced:true on the verdict", async () => {
  const personaId = await readyPersona("Jordan");
  const created = await admin("POST", "/api/admin/course-runs", {
    technology: "Git",
    personaId,
    gateMode: "auto",
    providerConfig: { provider: "mock" },
  });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: RunDetail }).run.runId;

  // A budget of 0 forces the very FIRST verdict at the frame gate.
  process.env.COURSE_GEN_AUTOGATE_MAX_CHANGES = "0";
  try {
    await pokeUntil(runId, (s) => s !== "queued" && s !== "framing" && s !== "awaiting-frame", 30_000).catch(() => {
      /* it's fine if it raced past frame already; the artifact below is what we assert on */
    });
    // Give the frame verdict a moment to land on disk if the run raced ahead.
    for (let i = 0; i < 50; i++) {
      const a = await admin("GET", `/api/admin/course-runs/${runId}/artifacts/gates/frame.verdict.json`);
      if (a.status === 200) break;
      await autoGate.poke();
      await new Promise((r) => setTimeout(r, 100));
    }
    const artifact = await admin("GET", `/api/admin/course-runs/${runId}/artifacts/gates/frame.verdict.json`);
    assert.equal(artifact.status, 200);
    const verdict = JSON.parse((artifact.body as { content: string }).content) as {
      decision: string;
      forced?: boolean;
      reservations: string[];
    };
    assert.equal(verdict.decision, "approved");
    assert.equal(verdict.forced, true);
    assert.ok(verdict.reservations.length > 0);
    assert.match(verdict.reservations[0], /budget/i);
  } finally {
    delete process.env.COURSE_GEN_AUTOGATE_MAX_CHANGES;
  }
});

/* ── run budget enforcement (plan §3.2) ── */

test("run budget: an absurdly low maxModelCalls parks the run interrupted with a budget-exhausted reason", async () => {
  const personaId = await readyPersona("Budget");
  const created = await admin("POST", "/api/admin/course-runs", {
    technology: "Git",
    personaId,
    providerConfig: { provider: "mock" },
    maxModelCalls: 1, // the framing phase alone makes 2+ calls (architect + critique)
  });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: RunDetail }).run.runId;

  await courseRuns.settle();
  const detail = await admin("GET", `/api/admin/course-runs/${runId}`);
  const run = (detail.body as { run: RunDetail }).run;
  assert.equal(run.status, "interrupted", `expected the run to park interrupted on budget; got ${JSON.stringify(run)}`);
  assert.match(run.lastError ?? "", /budget/i);
  assert.match(run.lastError ?? "", /max 1/);
});

test("run budget: a generous maxModelCalls does not interfere with a normal run", async () => {
  const personaId = await readyPersona("Generous");
  const created = await admin("POST", "/api/admin/course-runs", {
    technology: "Git",
    personaId,
    providerConfig: { provider: "mock" },
    maxModelCalls: 10_000,
  });
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle();
  const detail = await admin("GET", `/api/admin/course-runs/${runId}`);
  const run = (detail.body as { run: RunDetail }).run;
  assert.equal(run.status, "awaiting-frame", `expected the run to reach the frame gate; got ${JSON.stringify(run)}`);
});

/* ── GET /api/health (plan §3.3) ── */

test("GET /api/health reports the active run and null when idle", async () => {
  const idle = await fetch(base + "/api/health").then((r) => r.json());
  assert.equal(idle.ok, true);
  assert.equal(idle.activeRun, null);
  assert.equal(idle.lastProgressAt, null);

  const personaId = await readyPersona("Health");
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Git", personaId, providerConfig: { provider: "mock" } });
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle(); // let the mock pipeline park it wherever it lands

  // Force the run mid-phase directly on the store — deterministic, no race
  // with the scheduler's own async pump (the mock pipeline runs too fast to
  // reliably observe "queued"/"framing" over HTTP otherwise).
  const existing = store.getCourseRun(runId)!;
  const forcedAt = "2026-01-01T00:00:00.000Z";
  store.updateCourseRun({ ...existing, status: "framing", pendingPhase: "framing", updatedAt: forcedAt });

  const active = await fetch(base + "/api/health").then((r) => r.json());
  assert.equal(active.ok, true);
  assert.equal(active.activeRun, runId);
  assert.equal(active.lastProgressAt, forcedAt);

  // Restore terminal state so this run doesn't confuse later assertions.
  store.updateCourseRun({ ...existing, status: "archived", pendingPhase: null });
});
