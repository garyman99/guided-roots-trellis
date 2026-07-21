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

const CAPS = new Set(["file-viewed", "file-edited", "tests-run", "diff-viewed", "code", "terminal", "any-command"]);

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

test("the Selenium pack authors a real node-deps setup lab through the pipeline", async () => {
  const h = harness();
  const runId = await driveToApproved(h, "Selenium");
  const arts = h.artifactsFor(runId);
  const inventory = JSON.parse(arts.read("lesson-inventory.json")!) as LessonInventoryEntry[];
  assert.deepEqual(inventory.map((l) => l.lessonId), ["selenium-setup"]);
  // The authored brief carries the real node-deps kind AND the structured
  // package list the verifier needs — not a prose stand-in.
  const lab = JSON.parse(arts.read("briefs/selenium-setup.json")!).lab;
  assert.equal(lab.kind, "node-deps");
  assert.deepEqual(lab.expectedPackages, ["selenium-webdriver", "typescript", "tsx", "@types/selenium-webdriver"]);
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["selenium-setup"]);
});

test("every role's summary is emitted as an agent.message event (the chat feed)", async () => {
  const h = harness();
  const runId = await driveToApproved(h, "Git");
  const msgs = h.store.courseRunEvents(runId).filter((e) => e.type === "agent.message");
  assert.ok(msgs.length >= 8, `expected a message per model call, got ${msgs.length}`);
  const byRole = new Set(msgs.map((e) => (e.payload as { role: string }).role));
  for (const role of ["architect", "lesson-author", "technical-reviewer", "pedagogy-reviewer", "cohesion-editor", "learner-advocate"]) {
    assert.ok(byRole.has(role), `${role} reported to the chat`);
  }
  for (const e of msgs) {
    const p = e.payload as { summary?: string; task?: string };
    assert.ok(typeof p.summary === "string" && p.summary.trim().length > 0, "every message carries a summary");
    assert.ok(typeof p.task === "string" && p.task.length > 0, "every message names its task");
  }
});

test("a persistently malformed role output interrupts after the configured attempts", async () => {
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
  assert.equal(calls, 3, "default of 3 attempts before interrupting");
  assert.ok(h.store.courseRunEvents(run.runId).some((e) => e.type === "model.retry"));
});

test("a model that self-corrects on a later attempt still completes the phase", async () => {
  let n = 0;
  const flaky: MockResponder = (role, prompt) => {
    if (prompt.task === "course-request") {
      n++;
      if (n < 3) return "not json"; // fail the first two attempts
      return JSON.stringify({ title: "T", technology: "Widgets", targetLearner: "x", startingPoint: "x", endingCapability: "x", assumptions: [], outOfScope: [] });
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(flaky);
  const run = h.sched.create({ technology: "Widgets" });
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame", "the retry recovered the phase");
  assert.equal(n, 3, "took three attempts");
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

test("a live model returning snake_case fields still validates (camelizeKeys)", async () => {
  // A responder that emits snake_case for the course-request (as a real model might).
  const snake: MockResponder = (role, prompt) => {
    if (prompt.task === "course-request") {
      return JSON.stringify({
        title: "Snake Course", technology: "Snake", target_learner: "devs",
        starting_point: "none", ending_capability: "fluent", assumptions: ["a"], out_of_scope: ["b"],
      });
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(snake);
  const run = h.sched.create({ technology: "Snake" });
  await h.sched.settle();
  // Framing did NOT interrupt — the snake_case course-request validated.
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-frame");
  assert.match(h.artifactsFor(run.runId).read("course-request.md")!, /Snake Course/);
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

test("blueprint validation reserves the -v<N> lesson-id namespace for versions (D11)", () => {
  const bp = (lessonId: string) => ({
    domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
    prerequisiteGraph: { concepts: [], edges: [] },
    lessonInventory: [{ lessonId, level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: [] }],
  });
  assert.throws(() => validateBlueprint(bp("orient-101-v2")), /reserved for lesson versions/);
  // ids that merely end in digits are fine
  assert.doesNotThrow(() => validateBlueprint(bp("orient-101")));
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
