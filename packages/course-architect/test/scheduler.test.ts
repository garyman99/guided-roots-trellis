/**
 * The run scheduler: state machine, five gates, single-active concurrency (D7),
 * interrupt/resume (D8), and artifact revisioning across a changes loop. Driven
 * with a fake executor and an in-memory store — no model, no network.
 */
process.env.TRELLIS_PERSISTENCE = "off";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type EventStore } from "../../../apps/api/src/store.ts";
import { CourseRunScheduler } from "../src/scheduler.ts";
import { RunArtifacts } from "../src/artifacts.ts";
import { RunStateError, type GateId, type Phase, type PhaseContext, type PhaseExecutor } from "../src/types.ts";

const ARTIFACT_OF_PHASE: Record<Phase, string> = {
  framing: "course-request.md",
  designing: "lesson-inventory.json",
  reconciling: "capability-gaps.json",
  authoring: "reviews/coverage-matrix.md",
  materializing: "manifest.json",
  rehearsing: "rehearsal/summary.json",
};

/** A deterministic monotonic clock + id source so queue ordering is stable. */
function harness() {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  let n = 0;
  const idSuffix = () => `t${(n++).toString().padStart(3, "0")}`;
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-runs-"));
  const artifactsFor = (runId: string) => new RunArtifacts(join(runsDir, runId));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  return { now, idSuffix, runsDir, artifactsFor, store };
}

/** Fake executor: writes the phase's artifact (noting any change notes). */
function fakeExecutor(artifactsFor: (id: string) => RunArtifacts): PhaseExecutor {
  return async (ctx: PhaseContext) => {
    const body = ctx.changeNotes ? `revised: ${JSON.stringify(ctx.changeNotes)}` : "v1";
    artifactsFor(ctx.run.runId).write(ARTIFACT_OF_PHASE[ctx.phase], `# ${ctx.phase}\n${body}\n`);
    ctx.emit("fake.produced", { phase: ctx.phase });
  };
}

test("happy path: a run walks all six gates to approved, writing an artifact per phase", async () => {
  const h = harness();
  const sched = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });

  const run = sched.create({ technology: "Git" });
  assert.match(run.runId, /^cg-git-t\d+$/);
  await sched.settle();

  // Parked at the first gate; framing's artifact exists.
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");
  assert.ok(h.artifactsFor(run.runId).exists("course-request.md"));

  const gates: Array<[GateId, string]> = [
    ["frame", "awaiting-blueprint"],
    ["blueprint", "awaiting-reconcile"],
    ["reconcile", "awaiting-package"],
    ["package", "awaiting-rehearse"],
    ["rehearse", "awaiting-publish"],
    ["publish", "approved"],
  ];
  for (const [gate, nextStatus] of gates) {
    sched.decideGate(run.runId, gate, "approved", null, "operator@local");
    await sched.settle();
    assert.equal(h.store.getCourseRun(run.runId)!.status, nextStatus, `after approving ${gate}`);
  }

  // Every phase artifact was written; every gate row is decided approved.
  for (const p of Object.values(ARTIFACT_OF_PHASE)) assert.ok(h.artifactsFor(run.runId).exists(p), `${p} written`);
  const decided = h.store.courseRunGates(run.runId);
  assert.equal(decided.length, 6);
  assert.ok(decided.every((g) => g.decision === "approved" && g.decidedBy === "operator@local"));
});

test("changes loop: re-runs the phase with the notes and revisions the artifact", async () => {
  const h = harness();
  const sched = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });
  const run = sched.create({ technology: "Docker" });
  await sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");

  const notes = [{ path: "course-request.md", comment: "narrow the audience to backend devs" }];
  sched.decideGate(run.runId, "frame", "changes", notes, "operator@local");
  await sched.settle();

  // Back at the frame gate after a re-run; the prior version was kept as v1.
  const arts = h.artifactsFor(run.runId);
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");
  assert.deepEqual(arts.revisions("course-request.md"), ["course-request.v1.md"]);
  assert.match(arts.read("course-request.md")!, /revised:/);
  assert.match(arts.read("course-request.v1.md")!, /v1/);

  // The gate history shows the changes decision then a fresh pending request.
  const gates = h.store.courseRunGates(run.runId);
  assert.equal(gates.filter((g) => g.gateId === "frame").length, 2);
  assert.equal(gates.find((g) => g.decision === "changes")!.notes![0].comment, notes[0].comment);
});

test("approving package or rehearse with lessonIds sets pendingLessonScope; other gates ignore it", async () => {
  const h = harness();
  const sched = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });
  const run = sched.create({ technology: "Git" });
  await sched.settle();

  // frame/blueprint approvals: a scope argument is accepted but ignored — only
  // package and rehearse understand one (rehearsal-phase §1, §3).
  sched.decideGate(run.runId, "frame", "approved", null, "op", ["git-101"]);
  await sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.pendingLessonScope, null, "frame ignores a lesson scope");

  sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await sched.settle();
  sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");

  // Approving package WITH a scope carries it onto materializing.
  sched.decideGate(run.runId, "package", "approved", null, "op", ["git-101"]);
  await sched.settle();
  // materializing consumed the scope, then cleared it before parking at rehearse.
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse");
  assert.equal(h.store.getCourseRun(run.runId)!.pendingLessonScope, null, "the scope is cleared once the phase it was meant for has run");
});

test("reject archives the run and no further gate can be decided", async () => {
  const h = harness();
  const sched = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });
  const run = sched.create({ technology: "Kubernetes" });
  await sched.settle();

  sched.decideGate(run.runId, "frame", "rejected", null, "operator@local");
  assert.equal(h.store.getCourseRun(run.runId)!.status, "archived");
  // Deciding a gate on an archived run is illegal.
  assert.throws(() => sched.decideGate(run.runId, "frame", "approved", null, null), RunStateError);
});

test("single active run (D7): a second run waits in queued until the first parks", async () => {
  const h = harness();
  // Blocking executor: framing hangs until released, so we can observe the queue.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const executor: PhaseExecutor = async (ctx) => {
    if (ctx.phase === "framing") await gate;
    h.artifactsFor(ctx.run.runId).write(ARTIFACT_OF_PHASE[ctx.phase], "x");
  };
  const sched = new CourseRunScheduler(h.store, executor, { now: h.now, idSuffix: h.idSuffix });

  const a = sched.create({ technology: "React" });
  const b = sched.create({ technology: "Vue" });
  // A is mid-framing (active); B is queued behind it.
  assert.equal(h.store.getCourseRun(a.runId)!.status, "framing");
  assert.equal(h.store.getCourseRun(b.runId)!.status, "queued");

  release();
  await sched.settle();
  // Both eventually park at their first gate; the slot was shared, not doubled.
  assert.equal(h.store.getCourseRun(a.runId)!.status, "awaiting-frame");
  assert.equal(h.store.getCourseRun(b.runId)!.status, "awaiting-frame");
});

test("interrupt/resume (D8): a run left mid-phase recovers on a fresh scheduler", async () => {
  const h = harness();
  // First scheduler: hang in framing so the run is 'framing' when we drop it.
  const hang = new Promise<void>(() => {});
  const stuck: PhaseExecutor = async (ctx) => {
    if (ctx.phase === "framing") await hang;
  };
  const sched1 = new CourseRunScheduler(h.store, stuck, { now: h.now, idSuffix: h.idSuffix });
  const run = sched1.create({ technology: "SQL" });
  assert.equal(h.store.getCourseRun(run.runId)!.status, "framing");

  // Simulate a restart: a new scheduler over the same store recovers the run.
  const sched2 = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });
  const recovered = h.store.getCourseRun(run.runId)!;
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.pendingPhase, "framing");

  // Resume: it re-enters the queue, runs framing, and parks at the frame gate.
  sched2.resume(run.runId);
  await sched2.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");
  assert.ok(h.artifactsFor(run.runId).exists("course-request.md"));
});

test("an executor that throws interrupts the run at its phase, resumable", async () => {
  const h = harness();
  let fail = true;
  const flaky: PhaseExecutor = async (ctx) => {
    if (ctx.phase === "framing" && fail) throw new Error("boom in framing");
    h.artifactsFor(ctx.run.runId).write(ARTIFACT_OF_PHASE[ctx.phase], "ok");
  };
  const sched = new CourseRunScheduler(h.store, flaky, { now: h.now, idSuffix: h.idSuffix });
  const run = sched.create({ technology: "Rust" });
  await sched.settle();

  const interrupted = h.store.getCourseRun(run.runId)!;
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.lastError, "boom in framing");
  assert.ok(h.store.courseRunEvents(run.runId).some((e) => e.type === "error"));

  fail = false; // fix the condition, then resume
  sched.resume(run.runId);
  await sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");
});

test("guards: unknown run, empty technology, and non-pending gate decisions throw", async () => {
  const h = harness();
  const sched = new CourseRunScheduler(h.store, fakeExecutor(h.artifactsFor), { now: h.now, idSuffix: h.idSuffix });
  assert.throws(() => sched.create({ technology: "  " }), RunStateError);
  assert.throws(() => sched.decideGate("nope", "frame", "approved", null, null), RunStateError);

  const run = sched.create({ technology: "Go" });
  await sched.settle();
  // The blueprint gate isn't pending yet (still at frame).
  assert.throws(() => sched.decideGate(run.runId, "blueprint", "approved", null, null), RunStateError);
});
