/**
 * Persona library over the real API (quality-rework Phase 1): CRUD on disk,
 * the mock interviewer filling the profile across turns, ready-validation,
 * and the snapshot embedding that keeps runs/courses self-contained.
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
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-personas-runs-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-personas-pub-"));
process.env.TRELLIS_PERSONAS_DIR = mkdtempSync(join(tmpdir(), "trellis-personas-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { server, manager, store } from "../src/server.ts";

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

interface PersonaView {
  personaId: string;
  version: number;
  status: string;
  name: string;
  narrative: string;
  anticipatedKnowledgeLevel: string;
  anticipatedCapabilityLevel: string;
  background: string;
}

test("persona CRUD round-trips on disk", async () => {
  const created = await admin("POST", "/api/admin/personas", { name: "Priya — manual QA moving to automation" });
  assert.equal(created.status, 201);
  const p = (created.body as { persona: PersonaView }).persona;
  assert.equal(p.personaId, "priya-manual-qa-moving-to-automation");
  assert.equal(p.status, "draft");
  assert.ok(existsSync(join(process.env.TRELLIS_PERSONAS_DIR!, p.personaId, "persona.json")));

  const listed = await admin("GET", "/api/admin/personas");
  assert.equal(listed.status, 200);
  assert.ok((listed.body as { personas: PersonaView[] }).personas.some((x) => x.personaId === p.personaId));

  // Direct edit bumps the version.
  const put = await admin("PUT", `/api/admin/personas/${p.personaId}`, { profile: { background: "Five years of manual QA." } });
  assert.equal(put.status, 200);
  const edited = (put.body as { persona: PersonaView }).persona;
  assert.equal(edited.background, "Five years of manual QA.");
  assert.equal(edited.version, p.version + 1);

  // Marking an empty draft ready is refused with the missing anchors named.
  const notReady = await admin("PUT", `/api/admin/personas/${p.personaId}`, { status: "ready" });
  assert.equal(notReady.status, 400);
  assert.match((notReady.body as { error: string }).error, /anticipatedKnowledgeLevel/);

  const del = await admin("DELETE", `/api/admin/personas/${p.personaId}`);
  assert.equal(del.status, 200);
  assert.equal((await admin("GET", `/api/admin/personas/${p.personaId}`)).status, 404);
});

test("the mock interviewer fills the profile across turns and completes", async () => {
  const created = await admin("POST", "/api/admin/personas", { name: "Jordan" });
  const id = (created.body as { persona: PersonaView }).persona.personaId;

  const t1 = await admin("POST", `/api/admin/personas/${id}/interview`, {
    message: "A support engineer who wants to automate ticket triage",
    providerConfig: { provider: "mock" },
  });
  assert.equal(t1.status, 200);
  const r1 = t1.body as { persona: PersonaView; reply: string; complete: boolean };
  assert.equal(r1.complete, false);
  assert.match(r1.persona.background, /support engineer/);
  assert.match(r1.reply, /KNOW/);

  const t2 = await admin("POST", `/api/admin/personas/${id}/interview`, { message: "They know ITSM tooling but have never scripted", providerConfig: { provider: "mock" } });
  assert.equal((t2.body as { complete: boolean }).complete, false);
  assert.ok((t2.body as { persona: PersonaView }).persona.anticipatedKnowledgeLevel.length > 0);

  const t3 = await admin("POST", `/api/admin/personas/${id}/interview`, { message: "They ask a colleague after one retry", providerConfig: { provider: "mock" } });
  const r3 = t3.body as { persona: PersonaView; complete: boolean };
  assert.equal(r3.complete, true);
  assert.ok(r3.persona.narrative.length > 0);
  assert.ok(r3.persona.anticipatedCapabilityLevel.length > 0);

  // The transcript persisted: 3 admin + 3 interviewer messages.
  const got = await admin("GET", `/api/admin/personas/${id}`);
  const interview = (got.body as { interview: Array<{ role: string }> }).interview;
  assert.equal(interview.filter((m) => m.role === "admin").length, 3);
  assert.equal(interview.filter((m) => m.role === "interviewer").length, 3);

  // Now the anchors are filled, ready is accepted.
  const ready = await admin("PUT", `/api/admin/personas/${id}`, { status: "ready" });
  assert.equal(ready.status, 200);
  assert.equal((ready.body as { persona: PersonaView }).persona.status, "ready");
});

test("a run embeds the persona snapshot; the snapshot survives edits; the course and revision runs inherit it", async () => {
  // Build a ready persona via the mock interviewer.
  const created = await admin("POST", "/api/admin/personas", { name: "Sam" });
  const id = (created.body as { persona: PersonaView }).persona.personaId;
  for (const m of ["A junior dev learning Git", "Knows editors, never used version control", "Asks for help fast"]) {
    await admin("POST", `/api/admin/personas/${id}/interview`, { message: m, providerConfig: { provider: "mock" } });
  }
  await admin("PUT", `/api/admin/personas/${id}`, { status: "ready" });
  const persona = ((await admin("GET", `/api/admin/personas/${id}`)).body as { persona: PersonaView }).persona;

  // A draft persona cannot start a run.
  const draft = await admin("POST", "/api/admin/personas", { name: "Unready" });
  const draftId = (draft.body as { persona: PersonaView }).persona.personaId;
  const refused = await admin("POST", "/api/admin/course-runs", { technology: "Git", personaId: draftId, providerConfig: { provider: "mock" } });
  assert.equal(refused.status, 400);
  assert.match((refused.body as { error: string }).error, /not marked ready/);

  // Create a run with the ready persona (mock provider walks the Git pack).
  const createdRun = await admin("POST", "/api/admin/course-runs", { technology: "Git", personaId: id, providerConfig: { provider: "mock" } });
  assert.equal(createdRun.status, 201);
  const run = (createdRun.body as { run: { runId: string; request: Record<string, unknown> } }).run;
  const embedded = run.request.persona as { personaId: string; version: number; profile: PersonaView };
  assert.equal(embedded.personaId, id);
  assert.equal(embedded.version, persona.version);
  // The narrative doubled as the legacy targetLearner string.
  assert.equal(run.request.targetLearner, persona.narrative.slice(0, 300));

  // Editing the persona AFTER create does not disturb the run's snapshot.
  await admin("PUT", `/api/admin/personas/${id}`, { profile: { narrative: "Completely different person now." } });
  const detail = await admin("GET", `/api/admin/course-runs/${run.runId}`);
  const stillEmbedded = ((detail.body as { run: { request: Record<string, unknown> } }).run.request.persona as { profile: PersonaView }).profile;
  assert.equal(stillEmbedded.narrative, persona.narrative);

  // persona.json landed in the run artifacts once framing ran.
  const wait = async () => {
    for (let i = 0; i < 100; i++) {
      const d = await admin("GET", `/api/admin/course-runs/${run.runId}`);
      const r = (d.body as { run: { status: string; artifacts: string[] } }).run;
      if (r.status.startsWith("awaiting-") || r.status === "approved") return r;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("run never parked");
  };
  let parked = await wait();
  assert.ok(parked.artifacts.includes("persona.json"), `persona.json in ${parked.artifacts.join(",")}`);
  const art = readFileSync(join(process.env.TRELLIS_RUNS_DIR!, run.runId, "persona.json"), "utf8");
  assert.equal((JSON.parse(art) as { personaId: string }).personaId, id);

  // Walk the gates to approved; the materialized course carries the snapshot.
  for (const gate of ["frame", "blueprint", "package", "publish"]) {
    await admin("POST", `/api/admin/course-runs/${run.runId}/gates/${gate}/decision`, { decision: "approved", by: "test" });
    parked = await wait();
  }
  assert.equal(parked.status, "approved");
  const course = store.listCourses().find((c) => c.sourceRunId === run.runId);
  assert.ok(course, "course materialized");
  assert.equal(course!.persona?.personaId, id);

  // A revision run re-embeds the COURSE's snapshot (not the edited library copy).
  const rev = await admin("POST", "/api/admin/course-runs", {
    revision: { labId: course!.lessons[0].labId, notes: "tighten the intro" },
    providerConfig: { provider: "mock" },
  });
  assert.equal(rev.status, 201);
  const revRun = (rev.body as { run: { request: Record<string, unknown> } }).run;
  const revPersona = revRun.request.persona as { personaId: string; profile: PersonaView };
  assert.equal(revPersona.personaId, id);
  assert.equal(revPersona.profile.narrative, persona.narrative, "course snapshot, not the edited library copy");
});

test("TRELLIS_REQUIRE_PERSONA=1 refuses persona-less whole-course runs", async () => {
  process.env.TRELLIS_REQUIRE_PERSONA = "1";
  try {
    const refused = await admin("POST", "/api/admin/course-runs", { technology: "Rust", providerConfig: { provider: "mock" } });
    assert.equal(refused.status, 400);
    assert.match((refused.body as { error: string }).error, /persona is required/);
  } finally {
    delete process.env.TRELLIS_REQUIRE_PERSONA;
  }
});
