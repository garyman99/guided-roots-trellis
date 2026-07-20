/**
 * Course idea intake — the pipeline's front door (autonomous-course-pipeline
 * plan §3.2): POST /api/admin/course-intake with the mock provider, then the
 * full offline path idea → published course via a gateMode:"auto" run.
 * Persistence off; runs/personas dirs isolated to temp directories.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
process.env.TRELLIS_SKIP_AUTOSOLVE = "1";
delete process.env.COURSE_GEN_PROVIDER;
delete process.env.TRELLIS_REQUIRE_PERSONA;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-intake-runs-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-intake-pub-"));
process.env.TRELLIS_PERSONAS_DIR = mkdtempSync(join(tmpdir(), "trellis-intake-personas-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, store, autoGate } from "../src/server.ts";

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

interface Suggestion {
  technology: string;
  match: "existing" | "new";
  personaId: string | null;
  profile: Record<string, unknown> | null;
  rationale: string;
}

async function readyPersona(name: string): Promise<string> {
  const created = await admin("POST", "/api/admin/personas", { name });
  const id = (created.body as { persona: { personaId: string } }).persona.personaId;
  for (const m of ["A junior dev learning Git", "Knows editors, never used version control", "Asks for help fast"]) {
    await admin("POST", `/api/admin/personas/${id}/interview`, { message: m, providerConfig: { provider: "mock" } });
  }
  await admin("PUT", `/api/admin/personas/${id}`, { status: "ready" });
  return id;
}

test("course-intake: 400 when idea is missing", async () => {
  const res = await admin("POST", "/api/admin/course-intake", {});
  assert.equal(res.status, 400);
  assert.match((res.body as { error: string }).error, /idea/i);
});

test("course-intake: with a ready persona in the library, the mock suggester matches existing", async () => {
  const personaId = await readyPersona("Priya");
  const res = await admin("POST", "/api/admin/course-intake", { idea: "Git for a junior dev", providerConfig: { provider: "mock" } });
  assert.equal(res.status, 200);
  const suggestion = (res.body as { suggestion: Suggestion }).suggestion;
  assert.equal(suggestion.match, "existing");
  assert.equal(suggestion.personaId, personaId);
  assert.equal(suggestion.profile, null);
  assert.ok(suggestion.technology);
  assert.ok(suggestion.rationale);
});

test("course-intake: empty persona library forces the mock's 'new' branch with a ready-able profile", async () => {
  // Isolate this assertion with its own personas dir so no ready persona exists.
  const dir = mkdtempSync(join(tmpdir(), "trellis-intake-empty-personas-"));
  const prev = process.env.TRELLIS_PERSONAS_DIR;
  process.env.TRELLIS_PERSONAS_DIR = dir;
  try {
    const res = await admin("POST", "/api/admin/course-intake", { idea: "Kubernetes for platform engineers", providerConfig: { provider: "mock" } });
    assert.equal(res.status, 200);
    const suggestion = (res.body as { suggestion: Suggestion }).suggestion;
    assert.equal(suggestion.match, "new");
    assert.equal(suggestion.personaId, null);
    assert.ok(suggestion.profile);
    const profile = suggestion.profile as {
      name: string;
      anticipatedKnowledgeLevel: string;
      anticipatedCapabilityLevel: string;
      narrative: string;
      goals: string[];
      frustrations: string[];
      toolFamiliarity: string[];
    };
    assert.ok(profile.name.trim());
    assert.ok(profile.anticipatedKnowledgeLevel.trim());
    assert.ok(profile.anticipatedCapabilityLevel.trim());
    assert.ok(profile.narrative.trim());
    assert.ok(Array.isArray(profile.goals));
    assert.ok(Array.isArray(profile.frustrations));
    assert.ok(Array.isArray(profile.toolFamiliarity));
  } finally {
    process.env.TRELLIS_PERSONAS_DIR = prev;
  }
});

/** Poke the arbiter and re-check the run, in a tight loop. */
async function pokeUntil(
  runId: string,
  done: (status: string) => boolean,
  timeoutMs = 30_000,
): Promise<{ runId: string; status: string; lastError: string | null }> {
  const start = Date.now();
  for (;;) {
    await autoGate.poke();
    const d = await admin("GET", `/api/admin/course-runs/${runId}`);
    const run = (d.body as { run: { status: string; lastError: string | null } }).run;
    if (done(run.status)) return { runId, ...run };
    if (Date.now() - start > timeoutMs) throw new Error(`run ${runId} never reached the expected status (stuck at "${run.status}")`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("course-intake: idea → new persona → autopilot run → published course, entirely offline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-intake-e2e-personas-"));
  const prev = process.env.TRELLIS_PERSONAS_DIR;
  process.env.TRELLIS_PERSONAS_DIR = dir;
  try {
    // 1. Suggest — empty library forces "new".
    const suggested = await admin("POST", "/api/admin/course-intake", { idea: "Postman for QA engineers new to API testing", providerConfig: { provider: "mock" } });
    assert.equal(suggested.status, 200);
    const suggestion = (suggested.body as { suggestion: Suggestion }).suggestion;
    assert.equal(suggestion.match, "new");
    assert.ok(suggestion.profile);

    // 2. Operator confirms: create + ready the persona via the existing endpoints.
    const created = await admin("POST", "/api/admin/personas", { name: (suggestion.profile as { name: string }).name });
    const personaId = (created.body as { persona: { personaId: string } }).persona.personaId;
    const readied = await admin("PUT", `/api/admin/personas/${personaId}`, { profile: suggestion.profile, status: "ready" });
    assert.equal(readied.status, 200);
    assert.equal((readied.body as { persona: { status: string } }).persona.status, "ready");

    // 3. Start a gateMode:"auto" + autoPublish run with the confirmed persona.
    const run = await admin("POST", "/api/admin/course-runs", {
      technology: suggestion.technology,
      personaId,
      gateMode: "auto",
      autoPublish: true,
      providerConfig: { provider: "mock" },
    });
    assert.equal(run.status, 201);
    const runId = (run.body as { run: { runId: string } }).run.runId;

    // 4. Poke the arbiter until it reaches a terminal state — zero further gate requests.
    const final = await pokeUntil(runId, (s) => s === "approved" || s === "archived" || s === "failed" || s === "interrupted");
    assert.equal(final.status, "approved", `run ended in unexpected status: ${JSON.stringify(final)}`);

    // 5. The course was materialized and published.
    const courses = await admin("GET", "/api/admin/courses");
    const course = (courses.body as { courses: Array<{ sourceRunId?: string; status?: string; lessons: Array<{ published?: boolean }> }> }).courses.find(
      (c) => c.sourceRunId === runId,
    );
    assert.ok(course, "no course was materialized for this run");
    assert.equal(course!.status, "published");
    assert.ok(course!.lessons.length > 0, "published course has no lessons");
    assert.ok(course!.lessons.every((l) => l.published === true), "not every lesson went live");
  } finally {
    process.env.TRELLIS_PERSONAS_DIR = prev;
  }
});
