/**
 * Critique/refine loops (quality-rework Phase 2): the generic loop's mechanics,
 * the verdict validator, and the pipeline integration — per-round artifacts,
 * feedback reaching the producer, the round cap, and a persona-unfit lesson
 * landing in needs-revision via the learner-advocate (4th reviewer).
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
import { createExecutor } from "../src/executor.ts";
import { MockRoleInvoker, type MockResponder, type RolePrompt, type CourseGenRole } from "../src/roles.ts";
import { defaultMockResponder } from "../src/mockCourse.ts";
import { critiqueLoop, critiqueRounds, validateCritiqueVerdict, type CritiqueVerdict, type CritiqueSummaryEntry } from "../src/critique.ts";
import { ValidationError } from "../src/schemas.ts";

const SATISFIED: CritiqueVerdict = { satisfied: true, personaFit: { ok: true, issues: [] }, goalFit: { ok: true, issues: [] }, requiredChanges: [] };
const UNSATISFIED: CritiqueVerdict = {
  satisfied: false,
  personaFit: { ok: false, issues: ["uses the term 'rebase' the persona has never met"] },
  goalFit: { ok: true, issues: [] },
  requiredChanges: ["define 'rebase' before first use"],
};

test("critiqueLoop stops on satisfied and reports rounds", async () => {
  const produced: Array<string[] | null> = [];
  const verdicts = [UNSATISFIED, SATISFIED];
  const res = await critiqueLoop<string>({
    maxRounds: 5,
    produce: async (feedback) => { produced.push(feedback); return "v"; },
    critique: async () => verdicts.shift()!,
  });
  assert.equal(res.rounds, 2);
  assert.equal(res.satisfied, true);
  // Round 1 had no feedback; round 2 received the changes AND the cited issues.
  assert.equal(produced[0], null);
  assert.deepEqual(produced[1], ["define 'rebase' before first use", "uses the term 'rebase' the persona has never met"]);
});

test("critiqueLoop caps at maxRounds and keeps the last output", async () => {
  let rounds = 0;
  const onRound: number[] = [];
  const res = await critiqueLoop<number>({
    maxRounds: 5,
    produce: async () => ++rounds,
    critique: async () => UNSATISFIED,
    onRound: (r) => onRound.push(r),
  });
  assert.equal(res.rounds, 5);
  assert.equal(res.satisfied, false);
  assert.equal(res.value, 5, "the LAST output survives");
  assert.deepEqual(onRound, [1, 2, 3, 4, 5]);
});

test("validateCritiqueVerdict rejects a dissatisfied verdict without requiredChanges", () => {
  assert.throws(
    () => validateCritiqueVerdict({ satisfied: false, personaFit: { ok: false, issues: ["x"] }, goalFit: { ok: true, issues: [] }, requiredChanges: [] }),
    ValidationError,
  );
  const ok = validateCritiqueVerdict(SATISFIED);
  assert.equal(ok.satisfied, true);
});

test("critiqueRounds is env-tunable and clamped", () => {
  assert.equal(critiqueRounds({}), 5);
  assert.equal(critiqueRounds({ COURSE_GEN_CRITIQUE_ROUNDS: "3" }), 3);
  assert.equal(critiqueRounds({ COURSE_GEN_CRITIQUE_ROUNDS: "99" }), 10);
  assert.equal(critiqueRounds({ COURSE_GEN_CRITIQUE_ROUNDS: "0" }), 1);
  assert.equal(critiqueRounds({ COURSE_GEN_CRITIQUE_ROUNDS: "bogus" }), 5);
});

/* ── pipeline integration ── */

const CAPS = new Set(["file-viewed", "tests-run", "diff-viewed", "code", "terminal", "any-command"]);

function harness(responder: MockResponder) {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  let n = 0;
  const idSuffix = () => `t${(n++).toString().padStart(3, "0")}`;
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-crit-"));
  const artifactsFor = (runId: string) => new RunArtifacts(join(runsDir, runId));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  const executor = createExecutor({
    rolesFor: () => new MockRoleInvoker(responder),
    artifactsFor,
    availableCapabilities: CAPS,
    materialize: async ({ lessons }) => ({ courseId: "cg-course", labIds: lessons.map((l) => l.lessonId), scenarioCount: lessons.length }),
  });
  const sched = new CourseRunScheduler(store, executor, { now, idSuffix });
  return { sched, store, artifactsFor };
}

test("frame critique: feedback reaches the architect and the round trail is on disk", async () => {
  const architectPrompts: RolePrompt[] = [];
  let frameCritiques = 0;
  const responder: MockResponder = (role: CourseGenRole, p: RolePrompt) => {
    if (role === "architect" && p.task === "course-request") architectPrompts.push(p);
    if (p.task === "critique:frame") {
      frameCritiques++;
      // Round 1 demands a change; round 2 is satisfied.
      return JSON.stringify(frameCritiques === 1 ? UNSATISFIED : SATISFIED);
    }
    return defaultMockResponder(role, p);
  };
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");

  // The architect was invoked twice; round 2 carried the critic's feedback.
  assert.equal(architectPrompts.length, 2);
  const ctx2 = architectPrompts[1].context as { critiqueFeedback?: string[] };
  assert.ok(ctx2.critiqueFeedback?.some((f) => /rebase/.test(f)), "requiredChanges reached the producer");

  const arts = h.artifactsFor(run.runId);
  assert.ok(arts.exists("critiques/frame.round1.json"));
  assert.ok(arts.exists("critiques/frame.round2.json"));
  const summary = JSON.parse(arts.read("critiques/summary.json")!) as CritiqueSummaryEntry[];
  assert.deepEqual(summary, [{ subject: "frame", rounds: 2, satisfied: true }]);
});

test("a persona-unfit lesson exhausts the cap, lands in needs-revision, and is excluded from the course", async () => {
  process.env.COURSE_GEN_CRITIQUE_ROUNDS = "2"; // keep the run small
  try {
    const responder: MockResponder = (role: CourseGenRole, p: RolePrompt) => {
      // The advocate condemns ONE lesson every round; everything else passes.
      if (p.task === "critique:lesson-git-101") return JSON.stringify(UNSATISFIED);
      return defaultMockResponder(role, p);
    };
    const h = harness(responder);
    const run = h.sched.create({ technology: "Git" });
    await h.sched.settle();
    for (const gate of ["frame", "blueprint", "package"] as const) {
      h.sched.decideGate(run.runId, gate, "approved", null, "op");
      await h.sched.settle();
    }
    // Materializing ran with only the passing lesson: git-101 was excluded.
    h.sched.decideGate(run.runId, "publish", "approved", null, "op");
    await h.sched.settle();
    assert.equal(h.store.getCourseRun(run.runId)!.status, "approved");

    const arts = h.artifactsFor(run.runId);
    const reviews = JSON.parse(arts.read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean; blockers: string[] }>;
    const failed = reviews.find((r) => r.lessonId === "git-101")!;
    assert.equal(failed.passed, false);
    assert.ok(failed.blockers.some((b) => b.startsWith("persona-fit:")), "advocate issues became blockers");
    assert.ok(reviews.find((r) => r.lessonId === "git-102")!.passed);

    // Two rounds of critique artifacts for the condemned lesson (the cap).
    assert.ok(arts.exists("critiques/lesson-git-101.round1.json"));
    assert.ok(arts.exists("critiques/lesson-git-101.round2.json"));
    assert.ok(!arts.exists("critiques/lesson-git-101.round3.json"));
    const summary = JSON.parse(arts.read("critiques/summary.json")!) as CritiqueSummaryEntry[];
    assert.deepEqual(summary.find((e) => e.subject === "lesson-git-101"), { subject: "lesson-git-101", rounds: 2, satisfied: false });

    // The events narrate the loop for the activity feed.
    const events = h.store.courseRunEvents(run.runId);
    assert.ok(events.some((e) => e.type === "critique.round"));
    assert.ok(events.some((e) => e.type === "critique.unsatisfied"));
    assert.ok(events.some((e) => e.type === "lesson.needs-revision"));
  } finally {
    delete process.env.COURSE_GEN_CRITIQUE_ROUNDS;
  }
});

test("revision runs critique the goal and the improvement plan too", async () => {
  const critiqued: string[] = [];
  const responder: MockResponder = (role: CourseGenRole, p: RolePrompt) => {
    if (p.task.startsWith("critique:")) critiqued.push(p.task);
    return defaultMockResponder(role, p);
  };
  const h = harness(responder);
  const run = h.sched.create({
    technology: "Git",
    revision: { courseId: "c1", family: "git-101", fromLabId: "git-101", fromVersion: 1, level: "beginner", notes: "tighten" },
  });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  assert.ok(critiqued.includes("critique:frame"), "revision goal critiqued");
  assert.ok(critiqued.includes("critique:blueprint"), "improvement plan critiqued");
  const arts = h.artifactsFor(run.runId);
  const summary = JSON.parse(arts.read("critiques/summary.json")!) as CritiqueSummaryEntry[];
  assert.equal(summary.length, 2);
});
