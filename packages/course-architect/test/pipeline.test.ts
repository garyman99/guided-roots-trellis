/**
 * The generation pipeline driven by mock roles: the default mock produces a
 * coherent gap-free course through all four phases; a malformed role output is
 * retried once then interrupts; capability gaps block their lessons; and the
 * prerequisite-graph acyclicity + inventory validation are enforced.
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
import { computeCapabilityGaps, lessonsBlockedByGaps, applyDispositions, commissionedGaps, allGapsDispositioned } from "../src/gaps.ts";
import { validateBlueprint, findCycle, ValidationError, type LessonInventoryEntry } from "../src/schemas.ts";

const CAPS = new Set(["file-viewed", "tests-run", "diff-viewed", "code", "terminal", "any-command"]);

function harness(responder: MockResponder = defaultMockResponder) {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  let n = 0;
  const idSuffix = () => `t${(n++).toString().padStart(3, "0")}`;
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-pipe-"));
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

async function driveToApproved(h: ReturnType<typeof harness>, technology: string) {
  const run = h.sched.create({ technology });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "package", "publish"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }
  return run.runId;
}

test("default mock: a run produces a validated, gap-free course across all five levels", async () => {
  const h = harness();
  const runId = await driveToApproved(h, "Widgets"); // a non-pack tech → the generic mock
  assert.equal(h.store.getCourseRun(runId)!.status, "approved");

  const arts = h.artifactsFor(runId);
  const inventory = JSON.parse(arts.read("lesson-inventory.json")!) as LessonInventoryEntry[];
  assert.equal(inventory.length, 6, "a full course, not a two-lesson stub");
  assert.deepEqual([...new Set(inventory.map((l) => l.level))], ["intro", "beginner", "intermediate", "advanced", "expert"], "every level represented");
  // capability-gaps.json is present and empty (mock uses base capabilities only).
  assert.deepEqual(JSON.parse(arts.read("capability-gaps.json")!).gaps, []);
  // Lessons authored + reviewed; materializer invoked with all of them.
  assert.ok(arts.exists("lessons/widgets-101/lesson.md"));
  assert.ok(arts.exists("reviews/widgets-101.pedagogy.json"));
  assert.ok(arts.exists("reviews/quality-gates.json"));
  assert.equal(h.materialized.at(-1)!.labIds.length, 6);
});

test("the Git pack yields a real, playable Git course through the pipeline", async () => {
  const h = harness();
  const runId = await driveToApproved(h, "Git");
  const arts = h.artifactsFor(runId);
  const request = arts.read("course-request.md")!;
  assert.match(request, /Git Fundamentals/);
  const inventory = JSON.parse(arts.read("lesson-inventory.json")!) as LessonInventoryEntry[];
  assert.deepEqual(inventory.map((l) => l.lessonId), ["git-101", "git-102"]);
  // The authored briefs carry the real lab kinds the materializer will build.
  assert.equal(JSON.parse(arts.read("briefs/git-101.json")!).lab.kind, "git-commit");
  assert.equal(JSON.parse(arts.read("briefs/git-102.json")!).lab.kind, "git-discard");
  // Both passed review and were handed to the materializer.
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["git-101", "git-102"]);
});

test("a malformed role output is retried once, then interrupts the run", async () => {
  let calls = 0;
  const badFraming: MockResponder = (role, prompt) => {
    if (prompt.task === "course-request") {
      calls++;
      return "{ not valid json at all";
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(badFraming);
  const run = h.sched.create({ technology: "Docker" });
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "interrupted");
  assert.equal(calls, 2, "one initial attempt + one retry");
  assert.ok(h.store.courseRunEvents(run.runId).some((e) => e.type === "model.retry"));
});

test("a capability gap blocks its lessons from authoring", async () => {
  // A blueprint whose second lesson needs an app the build lacks.
  const withGap: MockResponder = (role, prompt) => {
    if (prompt.task !== "blueprint") return defaultMockResponder(role, prompt);
    const inv: LessonInventoryEntry[] = [
      { lessonId: "x-101", level: "intro", sequence: 1, title: "A", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["a"], conceptsReinforced: [], prerequisites: [], requiredCapabilities: ["file-viewed"] },
      { lessonId: "x-201", level: "advanced", sequence: 2, title: "B", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["b"], conceptsReinforced: ["a"], prerequisites: ["x-101"], requiredCapabilities: ["http-client"] },
    ];
    return JSON.stringify({
      domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
      prerequisiteGraph: { concepts: ["a", "b"], edges: [{ from: "a", to: "b" }] },
      lessonInventory: inv,
    });
  };
  const h = harness(withGap);
  const runId = await driveToApproved(h, "Postman");

  const arts = h.artifactsFor(runId);
  const report = JSON.parse(arts.read("capability-gaps.json")!);
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].capabilityId, "http-client");
  assert.deepEqual(report.gaps[0].lessons, ["x-201"]);
  // The gapped lesson was NOT authored; the other was.
  assert.ok(arts.exists("lessons/x-101/lesson.md"));
  assert.ok(!arts.exists("lessons/x-201/lesson.md"));
  assert.equal(h.materialized.at(-1)!.labIds.length, 1);
});

test("a lesson that fails pedagogy review lands in needs-revision and is not shipped", async () => {
  // The pedagogy reviewer scores the SECOND lesson below threshold, unjustified.
  const harshReviewer: MockResponder = (role, prompt) => {
    if (prompt.task === "review:pedagogy:git-102") {
      return JSON.stringify({ scores: { priorKnowledge: 5, mentalModel: 5, activeLearning: 2, feedback: 5, mastery: 5 }, verdict: "revise" });
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(harshReviewer);
  const runId = await driveToApproved(h, "Git");

  const arts = h.artifactsFor(runId);
  const summary = JSON.parse(arts.read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean; failingCategories: string[] }>;
  const l102 = summary.find((o) => o.lessonId === "git-102")!;
  assert.equal(l102.passed, false);
  assert.deepEqual(l102.failingCategories, ["activeLearning"]);
  // git-101 passed and shipped; git-102 did NOT (only one lab materialized).
  assert.equal(h.materialized.at(-1)!.labIds.length, 1);
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["git-101"]);
  // The pedagogy scores are on disk for the lesson board's heat strip.
  const ped = JSON.parse(arts.read("reviews/git-102.pedagogy.json")!);
  assert.equal(ped.scores.activeLearning, 2);
});

test("blueprint validation rejects a cyclic prerequisite graph and unknown prereqs", () => {
  assert.throws(
    () =>
      validateBlueprint({
        domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
        prerequisiteGraph: { concepts: ["a", "b"], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] },
        lessonInventory: [{ lessonId: "l-1", level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: [] }],
      }),
    ValidationError,
  );
  // findCycle directly
  assert.ok(findCycle({ concepts: ["a", "b", "c"], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }] }));
  assert.equal(findCycle({ concepts: ["a", "b"], edges: [{ from: "a", to: "b" }] }), null);
});

test("computeCapabilityGaps blocks a lesson whose capability is missing, whatever the disposition", () => {
  const inv: LessonInventoryEntry[] = [
    { lessonId: "a", level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: ["file-viewed", "db-browser"] },
  ];
  const report = computeCapabilityGaps(inv, CAPS);
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].capabilityId, "db-browser");
  assert.ok(lessonsBlockedByGaps(report).has("a"), "undecided gap blocks its lesson");
  // A disposition records the PLAN; it doesn't make the capability appear, so
  // the lesson stays blocked until the requiredCapability is removed or ships.
  const commissioned = applyDispositions(report, { "db-browser": "commission" });
  assert.ok(lessonsBlockedByGaps(commissioned).has("a"), "commission still blocks (capability not yet built)");
  assert.equal(commissionedGaps(commissioned).length, 1);
  assert.ok(allGapsDispositioned(commissioned));
});
