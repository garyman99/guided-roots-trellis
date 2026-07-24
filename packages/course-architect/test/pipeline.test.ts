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
import { createExecutor, type MaterializeResult, type MaterializeInput, type LessonRehearser } from "../src/executor.ts";
import { MockRoleInvoker, type MockResponder } from "../src/roles.ts";
import { defaultMockResponder } from "../src/mockCourse.ts";
import { computeCapabilityGaps, lessonsBlockedByGaps, applyDispositions, commissionedGaps, allGapsDispositioned } from "../src/gaps.ts";
import { validateBlueprint, findCycle, ValidationError, type LessonInventoryEntry } from "../src/schemas.ts";

const CAPS = new Set(["file-viewed", "file-edited", "tests-run", "diff-viewed", "code", "terminal", "any-command"]);

function harness(
  responder: MockResponder = defaultMockResponder,
  proveLesson?: (input: { lessonId: string }) => Promise<{ ok: boolean; detail?: string }>,
  commissioned?: Array<{ capability: string; why: string; lessonId: string }>,
  rehearseLesson?: LessonRehearser,
) {
  let tick = 0;
  const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();
  let n = 0;
  const idSuffix = () => `t${(n++).toString().padStart(3, "0")}`;
  const runsDir = mkdtempSync(join(tmpdir(), "trellis-pipe-"));
  const artifactsFor = (runId: string) => new RunArtifacts(join(runsDir, runId));
  const store = createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv) as EventStore;
  const materialized: MaterializeResult[] = [];
  // Captures the full input of every materialize() call — including the
  // scope, if any — so scoped-rebuild tests can assert on it directly.
  const materializeCalls: MaterializeInput[] = [];
  const invoker = new MockRoleInvoker(responder);
  const executor = createExecutor({
    rolesFor: () => invoker,
    artifactsFor,
    availableCapabilities: CAPS,
    materialize: async (input) => {
      materializeCalls.push(input);
      const { lessons } = input;
      const result = { courseId: "cg-course", labIds: lessons.map((l) => l.lessonId), scenarioCount: lessons.length };
      materialized.push(result);
      return result;
    },
    ...(proveLesson ? { proveLesson: (i: { lessonId: string }) => proveLesson(i) } : {}),
    ...(commissioned ? { onCapabilityGapsFound: (_runId: string, gaps: Array<{ capability: string; why: string; lessonId: string }>) => commissioned.push(...gaps) } : {}),
    ...(rehearseLesson ? { rehearseLesson } : {}),
  });
  const sched = new CourseRunScheduler(store, executor, { now, idSuffix });
  return { sched, store, artifactsFor, materialized, materializeCalls };
}

async function driveToApproved(h: ReturnType<typeof harness>, technology: string) {
  const run = h.sched.create({ technology });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package", "rehearse", "publish"] as const) {
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
  // Every lesson ships a REAL lab. The generic "edit solution.txt" stub was
  // deleted (2026-07-22), so there is no shape a lesson can take that measures
  // something other than what it teaches.
  const lab = JSON.parse(arts.read("briefs/widgets-101.json")!).lab;
  assert.equal(lab.kind, "node-deps");
  assert.deepEqual(lab.expectedPackages, ["left-pad"]);
});

test("the blueprint faces a full review panel, and its blockers re-plan the course", async () => {
  // Before 2026-07-22 the plan met only the learner-advocate, so sequencing
  // defects reached authoring where no lesson could fix them. The panel votes
  // on the plan itself and its blockers drive a re-plan.
  let pedagogyRounds = 0;
  const responder: MockResponder = (role, prompt) => {
    if (prompt.task === "review:pedagogy:blueprint") {
      pedagogyRounds++;
      // Round 1: the plan has a forward reference. Round 2+: fixed.
      return pedagogyRounds === 1
        ? JSON.stringify({
            scores: { progression: 4, prerequisiteIntegrity: 2, loadBalance: 4, outcomeCoverage: 4, levelCalibration: 4 },
            verdict: "revise",
            summary: "Lesson 4 assumes lists, which nothing introduces.",
          })
        : defaultMockResponder(role, prompt);
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(responder);
  const runId = await driveToApproved(h, "Widgets");
  const arts = h.artifactsFor(runId);

  assert.equal(pedagogyRounds, 2, "an unjustified low plan score re-plans, then converges");
  // The panel's verdicts are recorded next to the lesson reviews.
  assert.ok(arts.exists("reviews/blueprint.pedagogy.json"), "plan pedagogy is scored and kept");
  assert.ok(arts.exists("reviews/blueprint.technical.md"));
  assert.ok(arts.exists("reviews/blueprint.cohesion.md"));
  const summary = JSON.parse(arts.read("reviews/blueprint.summary.json")!) as { passed: boolean; blockers: string[] };
  assert.equal(summary.passed, true, "the shipped plan is one that passed the panel");
  assert.deepEqual(summary.blockers, []);
  assert.equal(h.store.getCourseRun(runId)!.status, "approved");
});

test("a lesson the bench can't lab is withdrawn, not shipped with a fake lab", async () => {
  // The author declares lab.blockedBy for ONE lesson: it must be blocked (never
  // materialized), recorded as a capability gap, and commissioned — while the
  // rest of the course ships normally. Before 2026-07-22 this lesson would have
  // shipped a "edit solution.txt" lab that measured nothing it taught.
  const WHY = "The bench is a Linux container, so a Windows GUI installer cannot be run or observed by any verifier.";
  const commissioned: Array<{ capability: string; why: string; lessonId: string }> = [];
  const responder: MockResponder = (role, prompt) => {
    if (prompt.task === "lesson:widgets-102") {
      const lesson = (prompt.context?.lesson ?? {}) as LessonInventoryEntry;
      return JSON.stringify({
        lessonId: lesson.lessonId,
        markdown: `# ${lesson.title}\n\nInstall the toolchain.`,
        lab: { objective: lesson.purpose, primaryAuto: "any-command", blockedBy: { capability: "windows-installer", why: WHY } },
      });
    }
    return defaultMockResponder(role, prompt);
  };
  const h = harness(responder, undefined, commissioned);
  const runId = await driveToApproved(h, "Widgets");
  const arts = h.artifactsFor(runId);

  // Withdrawn: not materialized, no review outcome, no lab.
  const labIds = h.materialized.at(-1)!.labIds;
  assert.ok(!labIds.includes("widgets-102"), "a lesson with no possible lab must not be materialized");
  assert.equal(labIds.length, 5, "the other five lessons still ship");
  const summary = JSON.parse(arts.read("reviews/summary.json")!) as Array<{ lessonId: string }>;
  assert.ok(!summary.some((o) => o.lessonId === "widgets-102"), "a withdrawn lesson is blocked, not needs-revision");

  // Recorded as a gap carrying the author's reason, and commissioned.
  const gaps = JSON.parse(arts.read("capability-gaps.json")!).gaps as Array<{ capabilityId: string; lessons: string[]; discoveredWhileAuthoring?: { why: string }[] }>;
  const gap = gaps.find((g) => g.capabilityId === "windows-installer");
  assert.ok(gap, "the authoring-phase gap reaches capability-gaps.json");
  assert.deepEqual(gap!.lessons, ["widgets-102"]);
  assert.equal(gap!.discoveredWhileAuthoring?.[0]?.why, WHY);
  assert.deepEqual(commissioned, [{ lessonId: "widgets-102", capability: "windows-installer", why: WHY }]);
  assert.equal(h.store.getCourseRun(runId)!.status, "approved", "the run still completes on its labbable lessons");
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

test("shift-left prove gate: a lab that can't prove itself is blocked, not shipped", async () => {
  // Prove fails for git-102 only. It passes review but its lab never proves, so
  // it must land needs-revision and NOT ship — while git-101 (which proves)
  // ships normally. This is the L8 gate catching an unprovable lab in authoring.
  const proveLesson = async ({ lessonId }: { lessonId: string }) =>
    lessonId === "git-102" ? { ok: false, detail: "verifier passes on the broken template" } : { ok: true };
  const h = harness(defaultMockResponder, proveLesson);
  const runId = await driveToApproved(h, "Git");
  const arts = h.artifactsFor(runId);
  const ledger = JSON.parse(arts.read("reviews/summary.json")!) as Array<{ lessonId: string; passed: boolean; blockers: string[] }>;
  const g102 = ledger.find((o) => o.lessonId === "git-102")!;
  assert.equal(g102.passed, false, "git-102 did not prove → needs-revision");
  assert.ok(g102.blockers.some((b) => b.includes("did not prove")), "the auto-solve failure is a blocker fed to the re-author");
  // Only the provable lesson shipped.
  assert.deepEqual(h.materialized.at(-1)!.labIds, ["git-101"]);
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
      { lessonId: "x-101", level: "intro", sequence: 1, title: "A", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["a"], conceptsReinforced: [], prerequisites: [], requiredCapabilities: ["file-viewed"], observableAction: "Views the provided file end to end." },
      { lessonId: "x-201", level: "advanced", sequence: 2, title: "B", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["b"], conceptsReinforced: ["a"], prerequisites: ["x-101"], requiredCapabilities: ["http-client"], observableAction: "Sends an HTTP request and inspects the response." },
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
        lessonInventory: [{ lessonId: "l-1", level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: [], observableAction: "Does the thing." }],
      }),
    ValidationError,
  );
  // findCycle directly
  assert.ok(findCycle({ concepts: ["a", "b", "c"], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }] }));
  assert.equal(findCycle({ concepts: ["a", "b"], edges: [{ from: "a", to: "b" }] }), null);
});

test("blueprint validation enforces concept continuity (the free half of plan pedagogy)", () => {
  const lesson = (lessonId: string, sequence: number, introduced: string[], reinforced: string[]) => ({
    lessonId, level: "intro" as const, sequence, title: "t", purpose: "p", primaryCapability: "c",
    conceptsIntroduced: introduced, conceptsReinforced: reinforced, prerequisites: [], requiredCapabilities: [],
    observableAction: "Does the thing.",
  });
  const bp = (inventory: ReturnType<typeof lesson>[]) => ({
    domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
    prerequisiteGraph: { concepts: [], edges: [] },
    lessonInventory: inventory,
  });

  // Introduce then reinforce — the sound shape.
  assert.doesNotThrow(() => validateBlueprint(bp([lesson("l-1", 1, ["variables"], []), lesson("l-2", 2, ["lists"], ["variables"])])));

  // Reinforcing something no earlier lesson introduced — the defect that used to
  // surface as a per-LESSON pedagogy score, blaming the lesson for a plan bug.
  assert.throws(
    () => validateBlueprint(bp([lesson("l-1", 1, ["variables"], []), lesson("l-2", 2, ["lists"], ["f-strings"])])),
    /lesson "l-2" reinforces the concept "f-strings" but no EARLIER lesson introduces it \(no lesson introduces it at all\)/,
  );
  // Introduced, but LATER — still a forward reference.
  assert.throws(
    () => validateBlueprint(bp([lesson("l-1", 1, [], ["lists"]), lesson("l-2", 2, ["lists"], [])])),
    /lesson "l-1" reinforces the concept "lists" but no EARLIER lesson introduces it/,
  );
  // Two lessons both claiming first contact.
  assert.throws(
    () => validateBlueprint(bp([lesson("l-1", 1, ["loops"], []), lesson("l-2", 2, ["loops"], [])])),
    /concept "loops" is introduced twice — by "l-1" and again by "l-2"/,
  );
  // Casing/whitespace drift in hand-written concept names is not a defect.
  assert.doesNotThrow(() => validateBlueprint(bp([lesson("l-1", 1, ["F-Strings"], []), lesson("l-2", 2, [], ["f-strings"])])));
});

test("blueprint validation reserves the -v<N> lesson-id namespace for versions (D11)", () => {
  const bp = (lessonId: string) => ({
    domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
    prerequisiteGraph: { concepts: [], edges: [] },
    lessonInventory: [{ lessonId, level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: [], observableAction: "Does the thing." }],
  });
  assert.throws(() => validateBlueprint(bp("orient-101-v2")), /reserved for lesson versions/);
  // ids that merely end in digits are fine
  assert.doesNotThrow(() => validateBlueprint(bp("orient-101")));
});

test("computeCapabilityGaps blocks a lesson whose capability is missing, whatever the disposition", () => {
  const inv: LessonInventoryEntry[] = [
    { lessonId: "a", level: "intro", sequence: 1, title: "t", purpose: "p", primaryCapability: "c", conceptsIntroduced: [], conceptsReinforced: [], prerequisites: [], requiredCapabilities: ["file-viewed", "db-browser"], observableAction: "Browses a database table and reads a row." },
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

/** A blueprint responder whose second lesson needs a capability the build
 *  lacks — shared by the reconcile-leg and redesign-reopen-leg tests below. */
const withHttpClientGap: MockResponder = (role, prompt) => {
  if (prompt.task !== "blueprint") return defaultMockResponder(role, prompt);
  const inv: LessonInventoryEntry[] = [
    { lessonId: "x-101", level: "intro", sequence: 1, title: "A", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["a"], conceptsReinforced: [], prerequisites: [], requiredCapabilities: ["file-viewed"], observableAction: "Views the provided file end to end." },
    { lessonId: "x-201", level: "advanced", sequence: 2, title: "B", purpose: "p", primaryCapability: "c", conceptsIntroduced: ["b"], conceptsReinforced: ["a"], prerequisites: ["x-101"], requiredCapabilities: ["http-client"], observableAction: "Sends an HTTP request and inspects the response." },
  ];
  return JSON.stringify({
    domainMap: "d", progressionSpine: "s", conventions: "c", planReview: "r",
    prerequisiteGraph: { concepts: ["a", "b"], edges: [{ from: "a", to: "b" }] },
    lessonInventory: inv,
  });
};

test("reconcile leg: designing's gap parks at reconcile with a re-diffed report + brief; approving advances to authoring and onward to approved", async () => {
  const h = harness(withHttpClientGap);
  const run = h.sched.create({ technology: "Postman" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-reconcile", "designing's gap parks the run at the reconcile gate");

  const arts = h.artifactsFor(run.runId);
  // The architect authored a scenario-grounded brief for the gap BEFORE G2.
  assert.ok(arts.exists("capability-briefs/http-client.md"), "a brief was authored for the gap");
  assert.match(arts.read("capability-briefs/http-client.md")!, /http-client/);

  // capability-gaps.json was RE-DIFFED by the deterministic `reconciling` phase
  // (not merely carried over from designing) and the undecided gap defaulted to
  // "commission" (gap-reconciliation-pause §3's commission-by-default).
  const reconciled = JSON.parse(arts.read("capability-gaps.json")!);
  assert.equal(reconciled.gaps.length, 1);
  assert.equal(reconciled.gaps[0].capabilityId, "http-client");
  assert.deepEqual(reconciled.gaps[0].lessons, ["x-201"]);
  assert.equal(reconciled.gaps[0].disposition, "commission");
  assert.ok(h.store.courseRunEvents(run.runId).some((e) => e.type === "reconciled"), "the reconciling phase emitted its re-diff event");

  // Approving the reconcile gate (this package does not hard-block on
  // commissioned gaps — that policy lives in apps/api/src/server.ts) advances
  // the run to authoring, which blocks x-201 as before and ships x-101.
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");
  assert.ok(arts.exists("lessons/x-101/lesson.md"));
  assert.ok(!arts.exists("lessons/x-201/lesson.md"), "the still-gapped lesson is not authored");

  h.sched.decideGate(run.runId, "package", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse", "materializing now parks at the rehearse gate");
  h.sched.decideGate(run.runId, "rehearse", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "publish", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "approved");
  assert.equal(h.materialized.at(-1)!.labIds.length, 1);
});

test("redesign-reopen leg: rerunPhaseFromGate at reconcile sends the run back to designing, which re-lands at awaiting-blueprint", async () => {
  const h = harness(withHttpClientGap);
  const run = h.sched.create({ technology: "Postman" });
  await h.sched.settle();
  h.sched.decideGate(run.runId, "frame", "approved", null, "op");
  await h.sched.settle();
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-reconcile");

  h.sched.rerunPhaseFromGate(run.runId, "reconcile", "designing", [{ comment: "design this so it does not need capability http-client" }], "operator");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-blueprint", "designing re-ran wholesale and re-landed at G2");

  // The reconcile gate got a "changes" decision recorded (no stale pending row).
  const gates = h.store.courseRunGates(run.runId);
  const reconcileGate = gates.filter((g) => g.gateId === "reconcile").at(-1)!;
  assert.equal(reconcileGate.decision, "changes");
  assert.ok(reconcileGate.notes?.some((n) => n.comment.includes("http-client")));

  // Designing re-ran with the change note reaching the architect prompt, and
  // re-emitted a (still-gapped, in this fixed responder) blueprint + brief.
  const arts = h.artifactsFor(run.runId);
  assert.ok(arts.exists("lesson-inventory.json"));
  assert.ok(arts.exists("capability-briefs/http-client.md"));

  // The run still flows forward normally from here: blueprint → reconcile → …
  h.sched.decideGate(run.runId, "blueprint", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-reconcile");
  h.sched.decideGate(run.runId, "reconcile", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-package");
});

test("materializing is scoped and idempotent: a scoped rebuild is additive, not destructive", async () => {
  // rehearsal-phase §2: a gate decision can scope the next materialize run to
  // one lesson. Rebuilding it must not erase the other lessons' ledger rows.
  const h = harness();
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse", "package approval ran materializing unscoped");

  const arts = h.artifactsFor(run.runId);
  type LedgerEntry = { state: string; at: string; labId: string };
  const firstLedger = JSON.parse(arts.read("lessons/state.json")!) as Record<string, LedgerEntry>;
  assert.deepEqual(Object.keys(firstLedger).sort(), ["git-101", "git-102"], "every shipped lesson gets a ledger entry");
  assert.equal(firstLedger["git-101"].state, "materialized");
  assert.equal(h.materializeCalls.at(-1)!.lessonIds, undefined, "the unscoped call carries no lessonIds");
  const priorGit102 = firstLedger["git-102"];

  // Scope the next materialize run to git-101 only, then re-run the phase
  // directly (mirroring what the rehearse-gate "changes" wiring will do).
  const stored = h.store.getCourseRun(run.runId)!;
  h.store.updateCourseRun({ ...stored, pendingLessonScope: ["git-101"] });
  h.sched.rerunPhaseFromGate(run.runId, "rehearse", "materializing", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse");

  // The materializer was told to scope to just git-101...
  assert.deepEqual(h.materializeCalls.at(-1)!.lessonIds, ["git-101"]);
  // ...but still received the full lesson list, since it must know the whole
  // course to keep manifest.json correct.
  assert.deepEqual(h.materializeCalls.at(-1)!.lessons.map((l) => l.lessonId), ["git-101", "git-102"]);

  // The ledger updated git-101's entry and left git-102's untouched.
  const secondLedger = JSON.parse(arts.read("lessons/state.json")!) as Record<string, LedgerEntry>;
  assert.deepEqual(Object.keys(secondLedger).sort(), ["git-101", "git-102"]);
  assert.deepEqual(secondLedger["git-102"], priorGit102, "the unscoped lesson's ledger entry is untouched by the scoped rebuild");
  assert.equal(secondLedger["git-101"].state, "materialized");
});

test("rehearsing: a wired simulator rehearses each materialized lesson and records a per-lesson verdict", async () => {
  // rehearsal-phase §4: git-102 bounces (the fake sim reports it failed), git-101
  // passes. The phase must not decide anything — it just records verdicts.
  const rehearseLesson: LessonRehearser = async ({ lessonId }) =>
    lessonId === "git-102" ? { ok: false, detail: "the persona got stuck on the checkpoint" } : { ok: true };
  const h = harness(defaultMockResponder, undefined, undefined, rehearseLesson);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse", "package approval ran materializing unscoped");

  h.sched.decideGate(run.runId, "rehearse", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-publish", "rehearsing recorded verdicts and parked at publish");

  const arts = h.artifactsFor(run.runId);
  const summary = JSON.parse(arts.read("rehearsal/summary.json")!) as {
    lessons: Array<{ lessonId: string; labId: string; ok: boolean; detail?: string }>;
    rehearsed: number;
    bounced: number;
    simulatorWired: boolean;
  };
  assert.equal(summary.simulatorWired, true);
  assert.equal(summary.rehearsed, 1);
  assert.equal(summary.bounced, 1);
  const g101 = summary.lessons.find((l) => l.lessonId === "git-101")!;
  const g102 = summary.lessons.find((l) => l.lessonId === "git-102")!;
  assert.equal(g101.ok, true);
  assert.equal(g102.ok, false);
  assert.equal(g102.detail, "the persona got stuck on the checkpoint");

  type LedgerEntry = { state: string; at: string; labId: string };
  const ledger = JSON.parse(arts.read("lessons/state.json")!) as Record<string, LedgerEntry>;
  assert.equal(ledger["git-101"].state, "rehearsed");
  assert.equal(ledger["git-102"].state, "bounced");

  assert.ok(arts.exists("rehearsal/git-102/result.json"), "the failing lesson's per-lesson result is recorded");
});

test("rehearsing: a settled course (nothing bounced) gets a single course-wide cohesion sweep that can bounce a named lesson", async () => {
  // rehearsal-phase §6: both git lessons rehearse clean, so the sweep runs.
  // A custom responder returns a course-cohesion blocker naming git-102 —
  // every OTHER task falls through to the default mock responder.
  const rehearseLesson: LessonRehearser = async () => ({ ok: true });
  const responder: MockResponder = (role, p) => {
    if (p.task === "review:cohesion:course") {
      return JSON.stringify({
        verdict: "revise",
        issues: [{ severity: "blocker", text: "git-102 restores config.txt, but no earlier lesson ever creates it.", lessonId: "git-102" }],
      });
    }
    return defaultMockResponder(role, p);
  };
  const h = harness(responder, undefined, undefined, rehearseLesson);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-rehearse");

  h.sched.decideGate(run.runId, "rehearse", "approved", null, "op");
  await h.sched.settle();
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-publish");

  const arts = h.artifactsFor(run.runId);
  assert.ok(arts.exists("reviews/course.cohesion.md"), "the sweep's verdict is written to the allowlisted course.cohesion.md path");

  type LedgerEntry = { state: string; at: string; labId: string };
  const ledger = JSON.parse(arts.read("lessons/state.json")!) as Record<string, LedgerEntry>;
  assert.equal(ledger["git-102"].state, "bounced", "the blocker named git-102, so the sweep flips its ledger state to bounced");
  assert.equal(ledger["git-101"].state, "rehearsed", "git-101 was not named by any blocker and stays rehearsed");

  const summary = JSON.parse(arts.read("rehearsal/summary.json")!) as {
    cohesion: { ran: boolean; verdict?: string; blockers: Array<{ lessonId?: string; text: string }> };
  };
  assert.equal(summary.cohesion.ran, true);
  assert.equal(summary.cohesion.verdict, "revise");
  assert.equal(summary.cohesion.blockers.length, 1);
  assert.equal(summary.cohesion.blockers[0].lessonId, "git-102");
});

test("bounce chain: a lesson-scoped 'changes' at publish re-authors, re-materializes and re-rehearses ONLY that lesson", async () => {
  // rehearsal-phase §5. The operator makes ONE decision — "fix git-102" — and
  // the run must do three phases of work without stopping to ask them to
  // re-approve the package and rehearse gates it passes through on the way.
  let sims = 0;
  const rehearseLesson: LessonRehearser = async ({ lessonId }) => {
    sims++;
    return lessonId === "git-102" ? { ok: false, detail: "the persona got stuck" } : { ok: true };
  };
  const h = harness(defaultMockResponder, undefined, undefined, rehearseLesson);
  const run = h.sched.create({ technology: "Git" });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package", "rehearse"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-publish");
  assert.equal(sims, 2, "both lessons rehearsed on the first pass");
  const materializeCallsBefore = h.materializeCalls.length;

  // The bounce.
  h.sched.decideGate(run.runId, "publish", "changes", [{ lessonId: "git-102", comment: "the checkpoint is unreachable" }], "op");
  await h.sched.settle();

  // It walked authoring → materializing → rehearsing and landed back at publish,
  // never parking at the package or rehearse gates in between.
  const after = h.store.getCourseRun(run.runId)!;
  assert.equal(after.status, "awaiting-publish", "the chain ran to completion and re-parked at publish");
  assert.equal(after.pendingLessonScope ?? null, null, "the scope is cleared once the chain is consumed");
  assert.equal(after.pendingChain ?? null, null);

  // Only the bounced lesson was rebuilt and replayed.
  const scopedCall = h.materializeCalls.at(-1)!;
  assert.deepEqual(scopedCall.lessonIds, ["git-102"], "materializing was scoped to the bounced lesson");
  assert.equal(scopedCall.lessons.length, 2, "but the materializer still sees the whole course");
  assert.ok(h.materializeCalls.length > materializeCallsBefore);
  assert.equal(sims, 3, "only the bounced lesson was re-rehearsed, not the whole course");

  const events = h.store.courseRunEvents(run.runId);
  assert.ok(events.some((e) => e.type === "lesson.bounced" && (e.payload as { lessonId?: string }).lessonId === "git-102"));
  const gateStops = events.filter((e) => e.type === "gate.requested").map((e) => (e.payload as { gateId: string }).gateId);
  assert.equal(gateStops.filter((g) => g === "package").length, 1, "the bounce did not re-open the package gate");
});

test("bounce cap: a lesson that keeps failing stops the loop and hands the decision back", async () => {
  // The one cycle that spends BOTH tokens and browser time. Without a cap an
  // unattended run would re-author the same unfixable lesson forever.
  const rehearseLesson: LessonRehearser = async ({ lessonId }) =>
    lessonId === "git-102" ? { ok: false, detail: "still stuck" } : { ok: true };
  const h = harness(defaultMockResponder, undefined, undefined, rehearseLesson);
  const run = h.sched.create({ technology: "Git", rehearsalBounces: 2 });
  await h.sched.settle();
  for (const gate of ["frame", "blueprint", "reconcile", "package", "rehearse"] as const) {
    h.sched.decideGate(run.runId, gate, "approved", null, "op");
    await h.sched.settle();
  }

  const bounce = async () => {
    h.sched.decideGate(run.runId, "publish", "changes", [{ lessonId: "git-102", comment: "still broken" }], "op");
    await h.sched.settle();
  };
  await bounce(); // 1 of 2
  await bounce(); // 2 of 2
  assert.equal(h.store.getCourseRun(run.runId)!.status, "awaiting-publish");

  await bounce(); // over cap — nothing is queued
  const after = h.store.getCourseRun(run.runId)!;
  assert.equal(after.status, "awaiting-publish", "the run stays parked for a human rather than looping");
  assert.equal(after.pendingPhase, null, "no phase was queued");

  const events = h.store.courseRunEvents(run.runId);
  assert.equal(events.filter((e) => e.type === "lesson.bounced").length, 2, "exactly `cap` bounces were spent");
  assert.ok(events.some((e) => e.type === "lesson.bounce-capped"));
  assert.ok(events.some((e) => e.type === "rehearsal.bounce-cap-reached"));
});
