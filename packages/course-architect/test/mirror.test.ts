/**
 * Disk mirroring of run STATE: run.json is written next to the content on every
 * change, and reconcileRunsFromDisk rebuilds a lost/wiped index from it. This is
 * the durability guarantee — shut down mid-run, lose the DB, and the run still
 * comes back at its last point of progress.
 */
process.env.TRELLIS_PERSISTENCE = "off";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type EventStore } from "../../../apps/api/src/store.ts";
import { CourseRunScheduler } from "../src/scheduler.ts";
import { RunArtifacts } from "../src/artifacts.ts";
import { DiskMirroredCourseRunStore, readRunRecord, reconcileRunsFromDisk, RUN_RECORD_FILE } from "../src/mirror.ts";
import type { CourseRun, PhaseContext, PhaseExecutor } from "../src/types.ts";

function freshStore(): EventStore {
  return createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
}
function tmpRuns(): string {
  return mkdtempSync(join(tmpdir(), "trellis-mirror-"));
}
function dirsIn(runsDir: string, runIds: string[]) {
  return runIds.map((runId) => ({ runId, runDir: join(runsDir, runId) }));
}

const noopExecutor: PhaseExecutor = async (ctx: PhaseContext) => {
  // Write the phase's marker so the run can walk forward, then park at the gate.
  ctx.emit("fake.produced", { phase: ctx.phase });
};

test("the mirrored store writes run.json on create and update", () => {
  const runsDir = tmpRuns();
  const store = new DiskMirroredCourseRunStore(freshStore(), (id) => join(runsDir, id));
  const at = new Date(0).toISOString();
  const run: CourseRun = {
    runId: "cg-git-abc123",
    status: "queued",
    request: { technology: "Git" },
    pendingPhase: "framing",
    pendingChangeNotes: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  };

  store.createCourseRun(run);
  assert.ok(existsSync(join(runsDir, run.runId, RUN_RECORD_FILE)), "run.json written on create");
  assert.equal(readRunRecord(join(runsDir, run.runId))!.status, "queued");

  store.updateCourseRun({ ...run, status: "awaiting-frame", pendingPhase: null });
  assert.equal(readRunRecord(join(runsDir, run.runId))!.status, "awaiting-frame", "run.json follows updates");
});

test("reconcile re-inserts a run whose DB row was lost but whose run.json survives", () => {
  const runsDir = tmpRuns();
  // First "process life": write the run to disk via the mirror.
  const mirrored = new DiskMirroredCourseRunStore(freshStore(), (id) => join(runsDir, id));
  const at = new Date(0).toISOString();
  const run: CourseRun = {
    runId: "cg-selenium-xyz",
    status: "awaiting-publish",
    request: { technology: "Selenium" },
    pendingPhase: null,
    pendingChangeNotes: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  };
  mirrored.createCourseRun(run);

  // Second "process life": a brand-new (empty) DB — the index was wiped.
  const rebuilt = freshStore();
  assert.equal(rebuilt.listCourseRuns().length, 0);

  const { recovered } = reconcileRunsFromDisk(rebuilt, dirsIn(runsDir, [run.runId]));
  assert.deepEqual(recovered, [run.runId]);
  const back = rebuilt.getCourseRun(run.runId);
  assert.equal(back!.status, "awaiting-publish");
  assert.equal(back!.request.technology, "Selenium");

  // Idempotent: a second reconcile recovers nothing (the row now exists).
  assert.deepEqual(reconcileRunsFromDisk(rebuilt, dirsIn(runsDir, [run.runId])).recovered, []);
});

test("a scheduler-driven run survives a full DB loss and returns at its gate", async () => {
  const runsDir = tmpRuns();
  const store = freshStore();
  const mirrored = new DiskMirroredCourseRunStore(store, (id) => join(runsDir, id));
  const sched = new CourseRunScheduler(mirrored, noopExecutor);

  const run = sched.create({ technology: "Git" });
  await sched.settle();
  assert.equal(store.getCourseRun(run.runId)!.status, "awaiting-frame");
  assert.ok(readRunRecord(join(runsDir, run.runId)), "run.json exists after the phase");

  // Simulate a wiped database and rebuild the index from disk.
  const rebuilt = freshStore();
  const { recovered } = reconcileRunsFromDisk(rebuilt, dirsIn(runsDir, [run.runId]));
  assert.deepEqual(recovered, [run.runId]);
  assert.equal(rebuilt.getCourseRun(run.runId)!.status, "awaiting-frame");
});
