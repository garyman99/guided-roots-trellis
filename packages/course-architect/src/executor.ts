/**
 * The real PhaseExecutor: turns a course-generation run's phases into role
 * invocations, validated artifacts, and (at the end) a materialized draft
 * course. It replaces the Phase-B placeholder. Providers, capability set, and
 * the materializer are injected so the whole pipeline runs under node:test with
 * mock roles and no Docker (plan §7 Phase C).
 *
 * Choreography (kept deliberately lean for this slice — richer multi-role
 * batching and the full three-stage review can grow behind these seams):
 *   framing       → architect writes course-request.md
 *   designing     → architect writes the blueprint bundle; capability gaps are
 *                   diffed against the registry into capability-gaps.json
 *   authoring     → lesson-author + reviewers write each unblocked lesson;
 *                   quality-gates.json is assembled
 *   materializing → the injected materializer builds/persists the draft course;
 *                   manifest.json records the outcome
 */
import type { RunArtifacts } from "./artifacts.ts";
import type { CourseRun, PhaseContext, PhaseExecutor } from "./types.ts";
import type { CourseGenRole, RoleInvoker, RolePrompt } from "./roles.ts";
import {
  ValidationError,
  parseJson,
  validateBlueprint,
  validateCourseRequest,
  validateLessonPlan,
  type Blueprint,
  type CourseRequestDoc,
  type Level,
  type LessonInventoryEntry,
  type LessonPlanDoc,
} from "./schemas.ts";
import { computeCapabilityGaps, lessonsBlockedByGaps, type CapabilityGapReport } from "./gaps.ts";
import {
  evaluateReviews,
  validateTechnicalReview,
  validatePedagogyReview,
  validateCohesionReview,
  REVISION_THRESHOLD,
  type ReviewOutcome,
  type Verdict,
} from "./reviews.ts";

export interface MaterializeInput {
  run: CourseRun;
  courseRequestMarkdown: string;
  lessons: Array<{ lessonId: string; level: Level; title: string; lab: LessonPlanDoc["lab"] }>;
  artifacts: RunArtifacts;
}

interface Brief extends LessonInventoryEntry {
  lab?: LessonPlanDoc["lab"];
}
export interface MaterializeResult {
  courseId: string;
  labIds: string[];
  scenarioCount: number;
  /** Per-lab auto-solve proof (broken-as-shipped AND solvable), when run. */
  autoSolve?: Array<{ labId: string; ok: boolean; detail?: string }>;
}
/** Builds published labs, persists the draft course + scenario entries (injected). */
export type Materializer = (input: MaterializeInput) => Promise<MaterializeResult>;

export interface ExecutorDeps {
  /** Resolve the model provider for a run — selected per-run (mock/live). */
  rolesFor: (run: CourseRun) => RoleInvoker;
  artifactsFor: (runId: string) => RunArtifacts;
  /** Flat set of registry capability ids (apps, auto-rules, checkpoint kinds…). */
  availableCapabilities: Set<string>;
  materialize: Materializer;
}

/** ExecutorDeps with the run's provider resolved — what phase functions receive. */
type RunDeps = Omit<ExecutorDeps, "rolesFor"> & { roles: RoleInvoker };

const SYSTEM: Record<CourseGenRole, string> = {
  architect: "You are the Course Architect. Design a cohesive technology course; output strict JSON only.",
  "domain-analyst": "You map the technology into teachable capabilities; output strict JSON only.",
  "learner-advocate": "You represent the target learner's prior knowledge and cognitive load; output strict JSON only.",
  "lesson-author": "You expand one lesson brief into a complete, active-learning lesson plan; output strict JSON only.",
  "technical-reviewer": "You verify technical correctness and currency; output strict JSON only.",
  "pedagogy-reviewer": "You score pedagogy 1–5 across the rubric; output strict JSON only.",
  "cohesion-editor": "You review the course as one authored journey; output strict JSON only.",
};

/** Build a role prompt carrying structured context (mock reads it directly). */
function prompt(task: string, context: Record<string, unknown>, extra = ""): RolePrompt {
  return { task, context, system: "", user: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\n${extra}Produce the "${task}" artifact as strict JSON.` };
}

/** Invoke a role, retrying ONCE with the validation errors appended (plan §4). */
async function invokeValidated<T>(
  roles: RoleInvoker,
  role: CourseGenRole,
  p: RolePrompt,
  validate: (parsed: unknown) => T,
  emit: PhaseContext["emit"],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sys = SYSTEM[role];
    const res = await roles.invoke(role, { ...p, system: sys });
    emit("model.invoked", { role, task: p.task, attempt, outputTokens: res.usage.outputTokens ?? 0 });
    try {
      return validate(parseJson<unknown>(res.text));
    } catch (err) {
      lastErr = err;
      if (attempt === 2) break;
      const errors = err instanceof ValidationError ? err.errors : [String(err)];
      p = { ...p, user: `${p.user}\n\nYour previous output was INVALID:\n- ${errors.join("\n- ")}\nReturn corrected JSON.` };
      emit("model.retry", { role, task: p.task, errors });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function renderCourseRequestMd(doc: CourseRequestDoc): string {
  return [
    `# ${doc.title}`,
    ``,
    `**Technology:** ${doc.technology}`,
    `**Target learner:** ${doc.targetLearner}`,
    `**Starting point:** ${doc.startingPoint}`,
    `**Ending capability:** ${doc.endingCapability}`,
    ``,
    `## Assumptions`,
    ...doc.assumptions.map((a) => `- ${a}`),
    ``,
    `## Out of scope`,
    ...doc.outOfScope.map((o) => `- ${o}`),
    ``,
  ].join("\n");
}

/* ── the phases ── */

async function runFraming(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const doc = await invokeValidated(
    deps.roles,
    "architect",
    prompt("course-request", { request: ctx.run.request, changeNotes: ctx.changeNotes ?? undefined }),
    validateCourseRequest,
    ctx.emit,
  );
  arts.write("course-request.md", renderCourseRequestMd(doc));
  ctx.emit("artifact.written", { path: "course-request.md" });
}

async function runDesigning(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const bp = await invokeValidated(
    deps.roles,
    "architect",
    prompt("blueprint", { request: ctx.run.request, courseRequest: arts.read("course-request.md") ?? "", changeNotes: ctx.changeNotes ?? undefined }),
    validateBlueprint,
    ctx.emit,
  );
  writeBlueprint(arts, bp);

  // Capability gaps: diff the inventory's required capabilities vs the registry.
  const report = computeCapabilityGaps(bp.lessonInventory, deps.availableCapabilities);
  arts.write("capability-gaps.json", JSON.stringify(report, null, 2));
  if (report.gaps.length > 0) {
    ctx.emit("capability.gaps", { count: report.gaps.length, ids: report.gaps.map((g) => g.capabilityId) });
  }
  for (const path of ["domain-map.md", "progression-spine.md", "course-conventions.md", "plan-review.md", "prerequisite-graph.json", "lesson-inventory.json"]) {
    ctx.emit("artifact.written", { path });
  }
}

function writeBlueprint(arts: RunArtifacts, bp: Blueprint): void {
  arts.write("domain-map.md", bp.domainMap);
  arts.write("progression-spine.md", bp.progressionSpine);
  arts.write("course-conventions.md", bp.conventions);
  arts.write("plan-review.md", bp.planReview);
  arts.write("prerequisite-graph.json", JSON.stringify(bp.prerequisiteGraph, null, 2));
  arts.write("lesson-inventory.json", JSON.stringify(bp.lessonInventory, null, 2));
}

async function runAuthoring(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const inventory = parseJson<LessonInventoryEntry[]>(arts.read("lesson-inventory.json") ?? "[]");
  const report = parseJson<CapabilityGapReport>(arts.read("capability-gaps.json") ?? '{"available":[],"gaps":[]}');
  const blocked = lessonsBlockedByGaps(report);

  const authored: string[] = [];
  const needsRevision: string[] = [];
  const summary: ReviewOutcome[] = [];

  for (const lesson of inventory) {
    if (blocked.has(lesson.lessonId)) {
      ctx.emit("lesson.blocked", { lessonId: lesson.lessonId, reason: "capability-gap" });
      continue;
    }
    // Author → 3 reviews → if it fails the bar, re-author ONCE with the review
    // feedback, then re-review. A real lesson-author improves; the mock is
    // deterministic, so a genuinely failing lesson lands in needs-revision.
    let outcome: ReviewOutcome | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const feedback = outcome?.blockers ?? null;
      const plan = await invokeValidated(
        deps.roles,
        "lesson-author",
        prompt(`lesson:${lesson.lessonId}`, { lesson, request: ctx.run.request, reviewFeedback: feedback ?? undefined }),
        (parsed) => validateLessonPlan(parsed, lesson.lessonId),
        ctx.emit,
      );
      arts.write(`lessons/${lesson.lessonId}/lesson.md`, plan.markdown);
      // The brief carries the inventory entry PLUS the authored lab spec, so
      // materializing knows which real lab (lab.kind) to build.
      arts.write(`briefs/${lesson.lessonId}.json`, JSON.stringify({ ...lesson, lab: plan.lab }, null, 2));

      const technical = await invokeValidated(deps.roles, "technical-reviewer", prompt(`review:technical:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown }), validateTechnicalReview, ctx.emit);
      const pedagogy = await invokeValidated(deps.roles, "pedagogy-reviewer", prompt(`review:pedagogy:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown }), validatePedagogyReview, ctx.emit);
      const cohesion = await invokeValidated(deps.roles, "cohesion-editor", prompt(`review:cohesion:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown }), validateCohesionReview, ctx.emit);

      outcome = evaluateReviews(lesson.lessonId, technical, pedagogy, cohesion);
      writeReviewArtifacts(arts, lesson.lessonId, outcome);
      ctx.emit("lesson.reviewed", { lessonId: lesson.lessonId, attempt, passed: outcome.passed, scores: pedagogy.scores, blockers: outcome.blockers });
      if (outcome.passed) break;
      if (attempt < 2) ctx.emit("lesson.revising", { lessonId: lesson.lessonId, blockers: outcome.blockers });
    }

    summary.push(outcome!);
    if (outcome!.passed) {
      authored.push(lesson.lessonId);
      ctx.emit("lesson.authored", { lessonId: lesson.lessonId });
    } else {
      needsRevision.push(lesson.lessonId);
      ctx.emit("lesson.needs-revision", { lessonId: lesson.lessonId, blockers: outcome!.blockers });
    }
  }

  arts.write("reviews/summary.json", JSON.stringify(summary, null, 2));
  arts.write("reviews/quality-gates.json", JSON.stringify(qualityGates(inventory, authored, needsRevision, blocked, summary), null, 2));
  arts.write("reviews/coverage-matrix.md", coverageMatrix(inventory, authored, needsRevision, blocked));
  if (authored.length === 0) throw new ValidationError(["no lessons passed review — every lesson is blocked on a capability gap or needs revision"]);
}

function renderVerdictMd(title: string, verdict: Verdict, issues?: string[]): string {
  return [`# ${title}`, ``, `**Verdict:** ${verdict}`, ``, ...(issues && issues.length ? ["## Issues", ...issues.map((i) => `- ${i}`)] : ["_No issues raised._"]), ``].join("\n");
}

function writeReviewArtifacts(arts: RunArtifacts, lessonId: string, o: ReviewOutcome): void {
  arts.write(`reviews/${lessonId}.technical.md`, renderVerdictMd("Technical review", o.technical.verdict, o.technical.issues));
  arts.write(`reviews/${lessonId}.pedagogy.json`, JSON.stringify(o.pedagogy, null, 2));
  arts.write(`reviews/${lessonId}.cohesion.md`, renderVerdictMd("Cohesion review", o.cohesion.verdict, o.cohesion.issues));
}

async function runMaterializing(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const inventory = parseJson<LessonInventoryEntry[]>(arts.read("lesson-inventory.json") ?? "[]");
  // Only ship lessons that PASSED review — a needs-revision lesson has a
  // lessons/<id>/lesson.md too, but it must not reach learners.
  const summary = parseJson<ReviewOutcome[]>(arts.read("reviews/summary.json") ?? "[]");
  const passed = new Set(summary.filter((o) => o.passed).map((o) => o.lessonId));
  const lessons: MaterializeInput["lessons"] = [];
  for (const lesson of inventory) {
    if (!passed.has(lesson.lessonId)) continue; // blocked, unauthored, or needs-revision
    // Prefer the authored lab spec (carries lab.kind → a real lab); fall back to
    // a minimal stub spec derived from the inventory.
    const brief = parseJson<Brief>(arts.read(`briefs/${lesson.lessonId}.json`) ?? "{}");
    const lab = brief.lab ?? { objective: lesson.purpose, primaryAuto: lesson.requiredCapabilities[0] ?? "any-command" };
    lessons.push({ lessonId: lesson.lessonId, level: lesson.level, title: lesson.title, lab });
  }
  const result = await deps.materialize({ run: ctx.run, courseRequestMarkdown: arts.read("course-request.md") ?? "", lessons, artifacts: arts });
  arts.write("manifest.json", JSON.stringify({ ...result, generatedAt: null, lessons: lessons.map((l) => l.lessonId) }, null, 2));
  ctx.emit("materialized", { ...result });
}

function qualityGates(inventory: LessonInventoryEntry[], authored: string[], needsRevision: string[], blocked: Set<string>, summary: ReviewOutcome[]) {
  const passed = new Set(authored);
  return {
    // A representative subset of the strategy doc's course-level gates, scored
    // from the real review outcomes.
    coverage: inventory.length > 0,
    everyLevelPresent: new Set(inventory.map((l) => l.level)).size >= 1,
    everyLessonReviewed: summary.length === inventory.length - blocked.size,
    activeLearning: summary.every((o) => o.pedagogy.scores.activeLearning >= REVISION_THRESHOLD),
    allShippedPassedReview: authored.every((id) => passed.has(id)),
    authoredCount: authored.length,
    needsRevisionCount: needsRevision.length,
    blockedCount: blocked.size,
  };
}

function coverageMatrix(inventory: LessonInventoryEntry[], authored: string[], needsRevision: string[], blocked: Set<string>): string {
  const authoredSet = new Set(authored);
  const revisionSet = new Set(needsRevision);
  const rows = inventory.map((l) => {
    const state = authoredSet.has(l.lessonId) ? "authored" : revisionSet.has(l.lessonId) ? "needs-revision" : blocked.has(l.lessonId) ? "blocked" : "pending";
    return `| ${l.sequence} | ${l.level} | ${l.lessonId} | ${l.primaryCapability} | ${state} |`;
  });
  return ["# Coverage matrix", "", "| Seq | Level | Lesson | Capability | State |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}

/** Build the real executor. */
export function createExecutor(deps: ExecutorDeps): PhaseExecutor {
  return async (ctx: PhaseContext): Promise<void> => {
    const arts = deps.artifactsFor(ctx.run.runId);
    // Resolve the model provider for THIS run (mock or a live model the operator
    // picked). Phase functions read `deps.roles`, so hand them a resolved deps.
    const runDeps: RunDeps = { ...deps, roles: deps.rolesFor(ctx.run) };
    switch (ctx.phase) {
      case "framing":
        return runFraming(ctx, runDeps, arts);
      case "designing":
        return runDesigning(ctx, runDeps, arts);
      case "authoring":
        return runAuthoring(ctx, runDeps, arts);
      case "materializing":
        return runMaterializing(ctx, runDeps, arts);
    }
  };
}
