/**
 * Authoring is RESUMABLE (field finding, 2026-07-20): reviews/summary.json is
 * written after every lesson, so a re-entered authoring phase — resume after an
 * interrupt, or a changes-requested Package gate — skips lessons that already
 * passed instead of re-authoring the whole inventory from lesson 1. Only
 * needs-revision/unreached lessons are re-attempted; a gate note naming a
 * lesson re-opens it, a note with no lessonId re-opens everything.
 *
 * Also: targetPlatform is first-class — every prompt context carries it (the
 * virtual desktop mimics Windows only) and course-request.md records it.
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
import { createExecutor, type MaterializeResult } from "../src/executor.ts";
import { MockRoleInvoker, type MockResponder } from "../src/roles.ts";
import { defaultMockResponder } from "../src/mockCourse.ts";

const CAPS = new Set(["file-viewed", "file-edited", "tests-run", "diff-viewed", "code", "terminal", "any-command"]);

function harness(responder: MockResponder = defaultMockResponder) {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  let n = 0;
  const idSuffix = () => `t${(n++).toString().padStart(3, "0")}`;
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-resume-"));
  const artifactsFor = (runId: string) => new RunArtifacts(join(runsDir, runId));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  const materialized: MaterializeResult[] = [];
  const invoker = new MockRoleInvoker(responder);
  const executor = createExecutor({
    rolesFor: () => invoker,
    artifactsFor,
    availableCapabilities: CAPS,
    materialize: async ({ lessons }) => {
      const result = { courseId: "cg-course", labIds: lessons.map((l) => l.lessonId), scenarioCount: lessons.length };
      materialized.push(result);
      return result;
    },
  });
  const sched = new CourseRunScheduler(store, executor, { now, idSuffix });
  return { sched, store, artifactsFor, materialized };
}

/** Wrap a responder, counting invocations per task string. */
function counting(responder: MockResponder): { responder: MockResponder; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  return {
    calls,
    responder: (role, prompt) => {
      calls.set(prompt.task, (calls.get(prompt.task) ?? 0) + 1);
      return responder(role, prompt);
    },
  };
}

test("resume after a mid-authoring interrupt skips the already-authored lesson", async () => {
  // First pass: git-101 authors fine, then git-102's author fails every attempt
  // (invalid JSON) → the phase interrupts with git-101 already in the ledger.
  let failGit102 = true;
  const flaky: MockResponder = (role, prompt) => {
    if (prompt.task === "lesson:git-102" && failGit102) return "not json";
    return defaultMockResponder(role, prompt);
  };
  const { responder, calls } = counting(flaky);
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "interrupted");

  // The incremental ledger survived the crash with git-101's passing outcome.
  const ledger = JSON.parse(h.artifactsFor(run.runId).read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean }>;
  assert.deepEqual(ledger.map((o) => [o.lessonId, o.passed]), [["git-101", true]]);

  // Resume with the model healthy again: git-101 must NOT be re-authored.
  failGit102 = false;
  h.sched.resume(run.runId);
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");
  assert.equal(calls.get("lesson:git-101"), 1, "git-101 authored exactly once across both passes");
  const events = h.store.courseRunEvents(run.runId);
  assert.ok(
    events.some((e) => e.type === "lesson.skipped" && (e.payload as { lessonId: string }).lessonId === "git-101"),
    "the resumed pass recorded the skip",
  );
  // Both lessons ship at approval.
  h.sched.decideGate(run.runId, "package", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "rehearse", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "publish", "approved", null, "op");
  await h.sched.settle();
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["git-101", "git-102"]);
});

test("package-gate changes re-author ONLY the lesson the note targets", async () => {
  const { responder, calls } = counting(defaultMockResponder);
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");

  h.sched.decideGate(run.runId, "package", "changes", [{ lessonId: "git-102", comment: "tighten the failure-diagnosis section" }], "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");
  assert.equal(calls.get("lesson:git-101"), 1, "untargeted, already-passed lesson reused");
  assert.equal(calls.get("lesson:git-102"), 2, "the targeted lesson was re-authored");
});

test("re-author-dropped-lesson leg: a lesson-scoped 'changes' at the package gate re-enters authoring and skips already-passed lessons via the ledger", async () => {
  // Mirrors the plan §7 re-author path: build the missing capability, restart,
  // then re-author ONLY the previously-dropped lesson — a lesson-scoped
  // "changes" decision at the package gate is exactly that mechanism, already
  // proven generically above ("package-gate changes re-author ONLY the lesson
  // the note targets"). This leg additionally asserts the summary.json LEDGER
  // itself is what causes the skip (not merely the call count).
  const { responder, calls } = counting(defaultMockResponder);
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");

  const ledgerBefore = JSON.parse(h.artifactsFor(run.runId).read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean }>;
  assert.deepEqual(ledgerBefore.map((o) => o.lessonId), ["git-101", "git-102"], "both lessons already passed before the re-author request");

  h.sched.decideGate(run.runId, "package", "changes", [{ lessonId: "git-102", comment: "re-author: the missing capability now ships" }], "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package", "the run re-entered authoring and re-landed at G3");

  // The ledger is the mechanism: git-101's outcome object is BYTE-IDENTICAL
  // (never touched), while git-102's was overwritten by the re-author pass —
  // proving the skip comes from reading reviews/summary.json, not luck.
  const before101 = ledgerBefore.find((o) => o.lessonId === "git-101");
  assert.equal(before101?.passed, true);
  const ledgerAfter = JSON.parse(h.artifactsFor(run.runId).read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean }>;
  assert.deepEqual(ledgerAfter.find((o) => o.lessonId === "git-101"), before101, "git-101's ledger entry is untouched");
  assert.equal(calls.get("lesson:git-101"), 1, "git-101 was never re-invoked — the ledger skipped it");
  assert.equal(calls.get("lesson:git-102"), 2, "only the targeted lesson was re-authored");

  // Both lessons still ship at publish — the re-author was additive, not lossy.
  h.sched.decideGate(run.runId, "package", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "rehearse", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "publish", "approved", null, "op");
  await h.sched.settle();
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["git-101", "git-102"]);
});

test("a package-gate note with no lessonId re-opens every lesson", async () => {
  const { responder, calls } = counting(defaultMockResponder);
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();

  h.sched.decideGate(run.runId, "package", "changes", [{ comment: "use friendlier language throughout" }], "op");
  await h.sched.settle();
  assert.equal(calls.get("lesson:git-101"), 2);
  assert.equal(calls.get("lesson:git-102"), 2);
});

test("a needs-revision lesson IS re-attempted on re-entry (passed ones are not)", async () => {
  // git-102 persistently fails pedagogy → needs-revision after the round cap.
  let harsh = true;
  const reviewer: MockResponder = (role, prompt) => {
    if (prompt.task === "review:pedagogy:git-102" && harsh) {
      return JSON.stringify({ scores: { priorKnowledge: 5, mentalModel: 5, activeLearning: 2, feedback: 5, mastery: 5 }, verdict: "revise" });
    }
    return defaultMockResponder(role, prompt);
  };
  const { responder, calls } = counting(reviewer);
  const h = harness(responder);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  const firstPassAuthored102 = calls.get("lesson:git-102")!;
  assert.ok(firstPassAuthored102 >= 1);

  // Re-run the phase (changes with no notes): git-101 reused, git-102 retried.
  harsh = false;
  h.sched.decideGate(run.runId, "package", "changes", null, "op");
  await h.sched.settle();
  assert.equal(calls.get("lesson:git-101"), 1, "passed lesson untouched");
  assert.ok(calls.get("lesson:git-102")! > firstPassAuthored102, "failed lesson re-attempted");
  const ledger = JSON.parse(h.artifactsFor(run.runId).read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean }>;
  assert.deepEqual(ledger.map((o) => [o.lessonId, o.passed]), [["git-101", true], ["git-102", true]]);
});

test("targetPlatform rides every prompt context and course-request.md", async () => {
  const seen = new Map<string, string>();
  const spy: MockResponder = (role, prompt) => {
    seen.set(prompt.task, String((prompt.context as Record<string, unknown>).targetPlatform));
    return defaultMockResponder(role, prompt);
  };
  const h = harness(spy);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();

  // Author, all three reviewers, and the critic all saw the platform.
  for (const task of ["course-request", "blueprint", "lesson:git-101", "review:technical:git-101", "review:pedagogy:git-101", "review:cohesion:git-101", "critique:lesson-git-101"]) {
    assert.equal(seen.get(task), "windows", `${task} carries targetPlatform`);
  }
  assert.match(h.artifactsFor(run.runId).read("course-request.md")!, /\*\*Target platform:\*\* windows/);
});

test("a course's Environment image carries a bench profile to the author AND reviewers", async () => {
  // The unblock lever (2026-07-22): a browser lesson blocks unless the author is
  // TOLD the bench gained a browser. The signal rides request.environmentImage
  // and must reach the author and every reviewer, or one of them wrongly flags
  // the browser lab as impossible.
  const prompts = new Map<string, string>();
  const spy: MockResponder = (role, prompt) => {
    prompts.set(prompt.task, prompt.user);
    return defaultMockResponder(role, prompt);
  };
  const h = harness(spy);
  const run = h.sched.create({ technology: "Git", environmentImage: "trellis-lab-python-selenium" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();

  for (const task of ["lesson:git-101", "review:technical:git-101", "review:pedagogy:git-101", "review:cohesion:git-101", "critique:lesson-git-101"]) {
    assert.match(prompts.get(task) ?? "", /THIS COURSE'S BENCH HAS A REAL BROWSER/, `${task} carries the bench profile`);
    assert.match(prompts.get(task) ?? "", /NEVER declare lab\.blockedBy for lack of a browser/, `${task} is told not to block`);
  }
  // The blueprint reviewers see it too (a plan-level tech reviewer must not flag
  // browser lessons as un-hostable).
  assert.match(prompts.get("review:technical:blueprint") ?? "", /REAL BROWSER/);
});

test("an operator's revision prompt reaches the AUTHOR, not only the architect", async () => {
  // Goal 2026-07-22: revise any lesson with a free-text prompt that drives the
  // author directly (the review loop then self-revises). Before this the notes
  // only reached the architect's goal/plan; now the author gets them verbatim.
  const prompts = new Map<string, string>();
  const spy: MockResponder = (role, prompt) => {
    prompts.set(prompt.task, prompt.user);
    return defaultMockResponder(role, prompt);
  };
  const h = harness(spy);
  const run = h.sched.create({
    technology: "Git",
    revision: {
      courseId: "c1", family: "git-101", fromLabId: "git-101", fromVersion: 1,
      notes: "Add a troubleshooting table for the execution-policy error",
      lessonContent: "the lesson as it currently ships",
    },
  });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();

  const authorPrompt = prompts.get("lesson:git-101") ?? "";
  assert.match(authorPrompt, /OPERATOR'S REVISION REQUEST/, "the operator's prompt reaches the author as the primary instruction");
  assert.match(authorPrompt, /troubleshooting table for the execution-policy error/, "the operator's exact words are threaded through");
  assert.match(authorPrompt, /OPERATOR-COMMISSIONED REVISION/, "the author is told it is editing an existing lesson");
});

test("no Environment image → the default browserless bench, unchanged", async () => {
  const prompts = new Map<string, string>();
  const spy: MockResponder = (role, prompt) => {
    prompts.set(prompt.task, prompt.user);
    return defaultMockResponder(role, prompt);
  };
  const h = harness(spy);
  const run = h.sched.create({ technology: "Git" }); // no environmentImage
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();

  for (const task of ["lesson:git-101", "review:technical:git-101"]) {
    assert.doesNotMatch(prompts.get(task) ?? "", /REAL BROWSER/, `${task} must not gain a browser bench it doesn't have`);
  }
});
