/**
 * Lesson-revision runs e2e (versioning plan Phase D): a mock revision run walks
 * all four gates to an approved, immutable v2 — course pointer moved (hidden),
 * audit trail appended, old version intact — then go-live swaps the catalog and
 * deleting the revision run reverts everything it produced.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-rev-"));
const PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-pub-rev-"));
const EXPERIENCE_DIR = mkdtempSync(join(tmpdir(), "trellis-exp-rev-"));
process.env.TRELLIS_RUNS_DIR = RUNS_DIR;
process.env.TRELLIS_PUBLISHED_DIR = PUBLISHED_DIR;
process.env.TRELLIS_EXPERIENCE_DIR = EXPERIENCE_DIR;
process.env.TRELLIS_LESSON_IMPROVEMENTS_DIR = mkdtempSync(join(tmpdir(), "trellis-imp-rev-"));

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
  for (const r of store.listCourseRuns()) store.deleteCourseRun(r.runId);
  for (const c of store.listCourses()) if (c.sourceRunId) store.deleteCourse(c.courseId);
  for (const s of store.listScenarioEntries()) store.deleteScenarioEntry(s.labId);
  await manager.destroyAll();
  server.close();
  for (const d of [RUNS_DIR, PUBLISHED_DIR, EXPERIENCE_DIR]) try { rmSync(d, { recursive: true, force: true }); } catch { /* win */ }
});

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

interface RunShape { runId: string; status: string; title?: string | null }

async function approveAllGates(runId: string, gates: Array<"frame" | "blueprint" | "package" | "publish">): Promise<void> {
  for (const gate of gates) {
    const r = await api("POST", `/api/admin/course-runs/${runId}/gates/${gate}/decision`, { decision: "approved", by: "eva" });
    assert.equal(r.status, 200, `approving ${gate}`);
    await courseRuns.settle();
  }
}

test("a revision run mints v2 through the gates; go-live swaps; delete reverts", async () => {
  // 1. A normal Git course exists (the revision's target).
  const created = await api("POST", "/api/admin/course-runs", { technology: "Git", title: "Git Fundamentals" });
  assert.equal(created.status, 201);
  const baseRunId = (created.body as { run: RunShape }).run.runId;
  await courseRuns.settle();
  await approveAllGates(baseRunId, ["frame", "blueprint", "package", "publish"]);
  const course = store.listCourses().find((c) => c.sourceRunId === baseRunId);
  assert.ok(course, "base course materialized");
  const slot = course.lessons[0];
  const family = slot.family ?? slot.labId;
  assert.equal(slot.version ?? 1, 1);
  assert.ok(existsSync(join(PUBLISHED_DIR, slot.labId, "lab.json")), "v1 lab on disk");

  // 2. A seeding report on disk.
  mkdirSync(join(EXPERIENCE_DIR, family), { recursive: true });
  writeFileSync(
    join(EXPERIENCE_DIR, family, "report-001.json"),
    JSON.stringify({
      family, version: 1, sessionsAnalyzed: 3, verdict: "revise", summary: "s",
      findings: [{ severity: "high", area: "content", description: "d", evidence: "e" }],
      recommendations: [{ findingIndex: 0, change: "c", rationale: "r" }],
    }),
  );

  // 3. Commission the revision (technology derived server-side; mock provider).
  const rev = await api("POST", "/api/admin/course-runs", {
    revision: { labId: slot.labId, reportFile: "report-001.json", notes: "tighten the intro" },
  });
  assert.equal(rev.status, 201, JSON.stringify(rev.body));
  const revRun = (rev.body as { run: RunShape }).run;
  assert.match(revRun.title ?? "", /^Revision: /);

  // D6: the report is stamped with the run that used it.
  const stamped = JSON.parse(readFileSync(join(EXPERIENCE_DIR, family, "report-001.json"), "utf8")) as { usedByRunId?: string };
  assert.equal(stamped.usedByRunId, revRun.runId);

  // D4: a second active revision for the family is refused.
  const dup = await api("POST", "/api/admin/course-runs", { revision: { labId: slot.labId } });
  assert.equal(dup.status, 400);
  assert.match((dup.body as { error: string }).error, /already in progress/);

  // Hand-authored lessons can't be revised by a run.
  const hand = await api("POST", "/api/admin/course-runs", { revision: { labId: "inspect-generated-changes" } });
  assert.equal(hand.status, 400);
  assert.match((hand.body as { error: string }).error, /hand-authored/);

  // 4. Walk the revision through its gates. After Package approval the
  //    materializer mints v2 and moves the pointer (hidden).
  await courseRuns.settle();
  await approveAllGates(revRun.runId, ["frame", "blueprint", "package"]);

  const v2LabId = `${family}-v2`;
  const afterMat = store.getCourse(course.courseId)!;
  const newSlot = afterMat.lessons[0];
  assert.equal(newSlot.labId, v2LabId, "pointer moved to v2");
  assert.equal(newSlot.version, 2);
  assert.equal(newSlot.published, false, "v2 ships hidden");
  assert.equal(afterMat.revisions?.length, 1, "audit trail appended");
  assert.equal(afterMat.revisions![0].fromLabId, slot.labId);
  assert.equal(afterMat.revisions![0].runId, revRun.runId);
  assert.ok(existsSync(join(PUBLISHED_DIR, v2LabId, "lab.json")), "v2 lab built + proven");
  assert.ok(existsSync(join(PUBLISHED_DIR, slot.labId, "lab.json")), "v1 lab UNTOUCHED (immutable versions)");
  assert.ok(store.listScenarioEntries().some((s) => s.labId === v2LabId), "v2 catalog entry present");
  assert.ok(store.listScenarioEntries().some((s) => s.labId === slot.labId), "v1 catalog entry still present pre-go-live");

  await approveAllGates(revRun.runId, ["publish"]);
  assert.equal(store.getCourseRun(revRun.runId)!.status, "approved");

  // 5. Go-live on v2 swaps the family's catalog entry.
  const flip = await api("POST", `/api/admin/courses/${course.courseId}/lessons/${v2LabId}/publish`);
  assert.equal(flip.status, 200);
  assert.ok(!store.listScenarioEntries().some((s) => s.labId === slot.labId), "v1 catalog entry swapped away");
  assert.ok(store.listScenarioEntries().some((s) => s.labId === v2LabId));

  // 6. Deleting the REVISION run reverts only what it produced (D5).
  const del = await api("DELETE", `/api/admin/course-runs/${revRun.runId}`);
  assert.equal(del.status, 200);
  assert.ok(!existsSync(join(PUBLISHED_DIR, v2LabId)), "v2 lab removed");
  assert.ok(!store.listScenarioEntries().some((s) => s.labId === v2LabId), "v2 catalog entry removed");
  const reverted = store.getCourse(course.courseId)!;
  assert.equal(reverted.lessons[0].labId, slot.labId, "pointer reverted to v1");
  assert.equal(reverted.lessons[0].version, 1);
  assert.ok(store.listScenarioEntries().some((s) => s.labId === slot.labId), "v1 catalog entry restored");
  assert.ok(existsSync(join(PUBLISHED_DIR, slot.labId, "lab.json")), "v1 lab still on disk");
  assert.ok(store.listCourses().some((c) => c.courseId === course.courseId), "the course itself survives");
});
