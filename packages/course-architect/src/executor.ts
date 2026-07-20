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
import type { CourseRun, LiveActivity, PhaseContext, PhaseExecutor } from "./types.ts";
import type { CourseGenRole, RoleDelta, RoleInvoker, RolePrompt } from "./roles.ts";
import {
  ValidationError,
  camelizeKeys,
  parseJson,
  validateWithUnwrap,
  validateBlueprint,
  validateCourseRequest,
  validateImprovementPlan,
  validateLessonPlan,
  validateRevisionGoal,
  type Blueprint,
  type CourseRequestDoc,
  type Level,
  type LessonInventoryEntry,
  type LessonPlanDoc,
} from "./schemas.ts";
import { computeCapabilityGaps, lessonsBlockedByGaps, type CapabilityGapReport } from "./gaps.ts";
import { personaPromptView } from "./personas.ts";
import {
  critiqueInstruction,
  critiqueLoop,
  critiqueRounds,
  validateCritiqueVerdict,
  type CritiqueLoopResult,
  type CritiqueSummaryEntry,
} from "./critique.ts";
import type { CourseRunRequest } from "./types.ts";
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
  /** Real-time view: the current model call's streaming thinking/text (or null
   *  to clear). Held in memory by the host and polled by the UI. */
  onActivity?: (runId: string, activity: LiveActivity | null) => void;
  /** Total attempts per model call before a phase interrupts (default 3). Each
   *  retry re-sends the prompt with the validation errors appended. */
  maxAttempts?: number;
}

/** ExecutorDeps with the run's provider resolved — what phase functions receive. */
type RunDeps = Omit<ExecutorDeps, "rolesFor"> & { roles: RoleInvoker };

const JSON_ONLY =
  " Return ONLY a single JSON object — no markdown, no code fences, no commentary — using EXACTLY the field names given. Do NOT wrap it in another key, do NOT add comments, and do NOT leave trailing commas.";
const SYSTEM: Record<CourseGenRole, string> = {
  architect: "You are the Course Architect. Design a cohesive technology course." + JSON_ONLY,
  "domain-analyst": "You map the technology into teachable capabilities." + JSON_ONLY,
  "learner-advocate":
    "You are the learner advocate — the critic every generated artifact must satisfy before a human sees it. " +
    "You represent the target persona's prior knowledge and cognitive load, and you judge exactly two things: " +
    "(1) persona-fit — every technical term and direction stays within their anticipated knowledge and capability levels; " +
    "(2) goal-fit — the artifact will actually achieve its stated, scoped goal. " +
    "Be specific and unsentimental; demand concrete changes, not vibes. Do not invent requirements beyond the persona and the goal." +
    JSON_ONLY,
  "lesson-author": "You expand one lesson brief into a complete, active-learning lesson plan." + JSON_ONLY,
  "technical-reviewer": "You verify technical correctness and currency." + JSON_ONLY,
  "pedagogy-reviewer": "You score pedagogy 1–5 across the rubric." + JSON_ONLY,
  "cohesion-editor": "You review the course as one authored journey." + JSON_ONLY,
};

/**
 * The EXACT JSON shape each task must return. Real models need the schema
 * spelled out (the mock reads prompt.context and ignores this); without it a
 * model invents its own field names and every validation fails.
 */
function taskInstruction(task: string): string {
  if (task === "course-request") {
    return [
      'Produce the course-request. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "title": string,',
      '  "technology": string,',
      '  "targetLearner": string,',
      '  "startingPoint": string,          // where the learner is before the course',
      '  "endingCapability": string,       // what they can do after',
      '  "assumptions": string[],',
      '  "outOfScope": string[]',
      '}',
    ].join("\n");
  }
  if (task === "blueprint") {
    return [
      'Produce the course blueprint. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "domainMap": string,              // markdown',
      '  "progressionSpine": string,       // markdown',
      '  "conventions": string,            // markdown',
      '  "planReview": string,             // markdown',
      '  "prerequisiteGraph": { "concepts": string[], "edges": [{ "from": string, "to": string }] },',
      '  "lessonInventory": [ {',
      '    "lessonId": string,             // kebab-case, e.g. "git-101"; unique',
      '    "level": "intro" | "beginner" | "intermediate" | "advanced" | "expert",',
      '    "sequence": number,             // 1-based, in order',
      '    "title": string,',
      '    "purpose": string,',
      '    "primaryCapability": string,',
      '    "conceptsIntroduced": string[],',
      '    "conceptsReinforced": string[],',
      '    "prerequisites": string[],      // lessonIds appearing EARLIER in this inventory',
      '    "requiredCapabilities": string[] // ids from CONTEXT.availableCapabilities; any id NOT there becomes a capability gap',
      '  } ]',
      '}',
      'The prerequisiteGraph MUST be acyclic. Every prerequisites entry MUST reference a lessonId in this inventory. Prefer capabilities from CONTEXT.availableCapabilities; only introduce a new (gap) capability when a lesson genuinely needs it.',
    ].join("\n");
  }
  if (task.startsWith("lesson:")) {
    return [
      'Produce the lesson plan for CONTEXT.lesson. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "lessonId": string,               // MUST equal CONTEXT.lesson.lessonId',
      '  "markdown": string,               // the full lesson plan as markdown (why it matters, objective, demonstration, guided + independent practice, failure/diagnosis, mastery evidence)',
      '  "lab": { "objective": string, "primaryAuto": string } // primaryAuto is one of CONTEXT.lesson.requiredCapabilities',
      '}',
      'CRITICAL: "markdown" is a JSON STRING value — it may include code blocks, but you MUST escape newlines as \\n and double-quotes as \\", so the whole reply is one valid JSON object. Do not put raw line breaks inside the string.',
    ].join("\n");
  }
  if (task.startsWith("review:pedagogy:")) {
    return [
      'Score the lesson on pedagogy. Return a JSON object with EXACTLY these keys:',
      '{ "scores": { "priorKnowledge": 1-5, "mentalModel": 1-5, "activeLearning": 1-5, "feedback": 1-5, "mastery": 1-5 }, "verdict": "approved" | "revise", "justifications"?: { <category>: string } }',
      'Score 1–5 (integers). If a category is below 4, either the verdict is "revise" or add a justifications entry for it.',
    ].join("\n");
  }
  if (task.startsWith("review:")) {
    return 'Review the lesson. Return a JSON object with EXACTLY these keys: { "verdict": "approved" | "revise", "issues": string[] }.';
  }
  if (task.startsWith("critique:")) return critiqueInstruction();
  if (task === "revision-goal") {
    return [
      'This is a LESSON REVISION run: CONTEXT carries the experience report, operator notes, and the lesson as shipped.',
      'State what this revision must fix. Return a JSON object with EXACTLY these keys:',
      '{ "goal": string, "successCriteria": string[] }',
      'Ground the goal in the report findings (content/lab-design only — never platform issues) and the operator notes.',
    ].join("\n");
  }
  if (task === "improvement-plan") {
    return [
      'Produce the improvement plan for the ONE lesson being revised. Return a JSON object with EXACTLY these keys:',
      '{',
      '  "changePlan": string,             // markdown: WHAT changes (instructions/lab/verifier) and WHY, citing report findings',
      '  "lesson": {',
      '    "lessonId": string,             // MUST equal CONTEXT.family',
      '    "level": "intro" | "beginner" | "intermediate" | "advanced" | "expert", // keep CONTEXT.level unless the plan argues otherwise',
      '    "sequence": 1,',
      '    "title": string,',
      '    "purpose": string,',
      '    "primaryCapability": string,',
      '    "conceptsIntroduced": string[],',
      '    "conceptsReinforced": string[],',
      '    "prerequisites": [],',
      '    "requiredCapabilities": string[] // ids from CONTEXT.availableCapabilities; any id NOT there becomes a capability gap',
      '  }',
      '}',
    ].join("\n");
  }
  return `Produce the "${task}" artifact as strict JSON.`;
}

/** Standing rule appended whenever the context carries a persona (Phase 1). */
const PERSONA_NOTE = [
  "CONTEXT.persona is the target-user persona this course serves. Every",
  "technical term and every direction MUST stay within their",
  "anticipatedKnowledgeLevel and anticipatedCapabilityLevel; define anything",
  "outside their vocabularyComfort before first use. Pace and scope toward",
  "their goals, and design around their frustrations.",
  "",
  "",
].join("\n");

/** Build a role prompt carrying structured context (mock reads it directly). */
function prompt(task: string, context: Record<string, unknown>, extra = ""): RolePrompt {
  const personaNote = context.persona ? PERSONA_NOTE : "";
  return { task, context, system: "", user: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\n${extra}${personaNote}${taskInstruction(task)}` };
}

/** The request as prompt context: persona lifted out as a bounded view (the raw
 *  embedded snapshot carries ids/timestamps the model has no use for). */
function requestContext(req: CourseRunRequest): { request: Record<string, unknown>; persona?: Record<string, unknown> } {
  const { persona, ...rest } = req;
  return { request: rest as Record<string, unknown>, ...(persona ? { persona: personaPromptView(persona.profile) } : {}) };
}

/** Invoke a role, retrying ONCE with the validation errors appended (plan §4).
 *  Streams the model's thinking/text into the live buffer while it runs. */
async function invokeValidated<T>(
  deps: RunDeps,
  ctx: PhaseContext,
  role: CourseGenRole,
  p: RolePrompt,
  validate: (parsed: unknown) => T,
): Promise<T> {
  let lastErr: unknown;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sys = SYSTEM[role];
    // Accumulate streaming deltas into the run's live activity (if the host is
    // watching). Fresh buffer per call; the UI polls the latest.
    let thinking = "";
    let text = "";
    const onDelta: RoleDelta | undefined = deps.onActivity
      ? (d) => {
          if (d.kind === "thinking") thinking += d.chunk;
          else text += d.chunk;
          deps.onActivity!(ctx.run.runId, { runId: ctx.run.runId, phase: ctx.phase, role, task: p.task, thinking, text, updatedAt: new Date().toISOString() });
        }
      : undefined;
    const res = await deps.roles.invoke(role, { ...p, system: sys }, onDelta);
    ctx.emit("model.invoked", { role, task: p.task, attempt, outputTokens: res.usage.outputTokens ?? 0 });
    try {
      // camelizeKeys tolerates snake_case; validateWithUnwrap tolerates a
      // single-key wrapper object.
      return validateWithUnwrap(camelizeKeys(parseJson<unknown>(res.text)), validate);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const errors = err instanceof ValidationError ? err.errors : [String(err)];
      p = { ...p, user: `${p.user}\n\nYour previous output was INVALID:\n- ${errors.join("\n- ")}\nReturn corrected JSON.` };
      ctx.emit("model.retry", { role, task: p.task, errors });
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

/* ── critique/refine (quality-rework Phase 2) ── */

/** Upsert this phase's entries into critiques/summary.json (the gate rollup). */
function recordCritiqueSummary(arts: RunArtifacts, entries: CritiqueSummaryEntry[]): void {
  let existing: CritiqueSummaryEntry[] = [];
  try {
    existing = parseJson<CritiqueSummaryEntry[]>(arts.read("critiques/summary.json") ?? "[]");
  } catch { /* rebuild from scratch */ }
  const replaced = new Set(entries.map((e) => e.subject));
  arts.write("critiques/summary.json", JSON.stringify([...existing.filter((e) => !replaced.has(e.subject)), ...entries], null, 2));
}

/**
 * Produce an artifact under the learner-advocate's critique loop: produce →
 * judge persona-fit + goal-fit → feed requiredChanges back → refine, up to the
 * round cap. Each round's verdict is written to critiques/<subject>.roundN.json
 * and emitted for the activity feed. Unsatisfied-after-cap keeps the last
 * output — the human gate (or needs-revision) decides from the recorded trail.
 */
async function runCritiqued<T>(
  deps: RunDeps,
  ctx: PhaseContext,
  arts: RunArtifacts,
  subject: string, // artifact-safe: "frame" | "blueprint" | `lesson-<id>`
  goal: string,
  produce: (critiqueFeedback: string[] | null, round: number) => Promise<T>,
  render: (value: T) => string,
): Promise<CritiqueLoopResult<T>> {
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;
  const result = await critiqueLoop<T>({
    maxRounds: critiqueRounds(),
    produce,
    critique: (value, round) =>
      invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { subject, round, goal, persona, content: render(value) }),
        validateCritiqueVerdict,
      ),
    onRound: (round, verdict) => {
      arts.write(`critiques/${subject}.round${round}.json`, JSON.stringify(verdict, null, 2));
      ctx.emit("critique.round", {
        subject,
        round,
        satisfied: verdict.satisfied,
        personaFitOk: verdict.personaFit.ok,
        goalFitOk: verdict.goalFit.ok,
        requiredChanges: verdict.requiredChanges.length,
      });
    },
  });
  if (!result.satisfied) ctx.emit("critique.unsatisfied", { subject, rounds: result.rounds });
  return result;
}

/** Persist the embedded persona snapshot for gate review (framing phases). */
function writePersonaArtifact(ctx: PhaseContext, arts: RunArtifacts): void {
  if (!ctx.run.request.persona) return;
  arts.write("persona.json", JSON.stringify(ctx.run.request.persona, null, 2));
  ctx.emit("artifact.written", { path: "persona.json" });
}

async function runFraming(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  writePersonaArtifact(ctx, arts);
  const req = ctx.run.request;
  const goal = [
    `Frame a ${req.technology} course the target persona can complete.`,
    req.outcome ? `Stated outcome: ${req.outcome}` : "Derive an outcome appropriate to the persona.",
    req.inScope ? `In scope: ${req.inScope}` : "",
    req.outOfScope ? `Out of scope: ${req.outOfScope}` : "",
  ].filter(Boolean).join(" ");
  const { value: doc, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "frame",
    goal,
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("course-request", {
          ...requestContext(req),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        validateCourseRequest,
      ),
    renderCourseRequestMd,
  );
  arts.write("course-request.md", renderCourseRequestMd(doc));
  recordCritiqueSummary(arts, [{ subject: "frame", rounds, satisfied }]);
  ctx.emit("artifact.written", { path: "course-request.md" });
}

/* ── lesson-revision variants (versioning plan Phase D): the same machine,
 *    scoped to ONE lesson. framing = the revision goal the operator approves at
 *    G1; designing = the improvement plan (G2 approves WHAT changes before
 *    authoring spends tokens); authoring/materializing reuse the normal paths
 *    over the 1-entry inventory. ─────────────────────────────────────────── */

async function runRevisionFraming(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const rev = ctx.run.request.revision!;
  writePersonaArtifact(ctx, arts);
  const { value: doc, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "frame",
    `State a revision goal for lesson "${rev.family}" that fixes what the experience report and operator notes describe.`,
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("revision-goal", {
          family: rev.family,
          fromVersion: rev.fromVersion,
          level: rev.level,
          notes: rev.notes ?? "",
          report: rev.report ?? null,
          lessonContent: rev.lessonContent ?? "",
          ...(ctx.run.request.persona ? { persona: personaPromptView(ctx.run.request.persona.profile) } : {}),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        validateRevisionGoal,
      ),
    (d) => [`Revision goal: ${d.goal}`, ``, `Success criteria:`, ...d.successCriteria.map((s) => `- ${s}`)].join("\n"),
  );
  recordCritiqueSummary(arts, [{ subject: "frame", rounds, satisfied }]);
  arts.write(
    "course-request.md",
    [
      `# Revision: \`${rev.family}\` v${rev.fromVersion} → v${rev.fromVersion + 1}`,
      ``,
      `**Course:** ${rev.courseId}`,
      rev.reportFile ? `**Seeded by report:** \`${rev.reportFile}\`` : `**Seeded by operator notes**`,
      ``,
      `## Goal`,
      ``,
      doc.goal,
      ``,
      `## Success criteria`,
      ...doc.successCriteria.map((s) => `- ${s}`),
      ...(rev.notes ? [``, `## Operator notes`, ``, rev.notes] : []),
      ``,
    ].join("\n"),
  );
  ctx.emit("artifact.written", { path: "course-request.md" });
}

async function runRevisionDesigning(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const rev = ctx.run.request.revision!;
  const revisionGoal = arts.read("course-request.md") ?? "";
  const { value: plan, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "blueprint",
    `Deliver the approved revision goal:\n${revisionGoal}`,
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("improvement-plan", {
          family: rev.family,
          level: rev.level ?? "intro",
          revisionGoal,
          report: rev.report ?? null,
          notes: rev.notes ?? "",
          lessonContent: rev.lessonContent ?? "",
          ...(ctx.run.request.persona ? { persona: personaPromptView(ctx.run.request.persona.profile) } : {}),
          availableCapabilities: [...deps.availableCapabilities].sort(),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        (parsed) => validateImprovementPlan(parsed, rev.family),
      ),
    (p) => p.changePlan,
  );
  recordCritiqueSummary(arts, [{ subject: "blueprint", rounds, satisfied }]);
  arts.write("plan-review.md", plan.changePlan);
  arts.write("lesson-inventory.json", JSON.stringify([plan.lesson], null, 2));
  const report = computeCapabilityGaps([plan.lesson], deps.availableCapabilities);
  arts.write("capability-gaps.json", JSON.stringify(report, null, 2));
  if (report.gaps.length > 0) {
    ctx.emit("capability.gaps", { count: report.gaps.length, ids: report.gaps.map((g) => g.capabilityId) });
  }
  for (const path of ["plan-review.md", "lesson-inventory.json"]) ctx.emit("artifact.written", { path });
}

async function runDesigning(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const courseRequest = arts.read("course-request.md") ?? "";
  const { value: bp, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "blueprint",
    `Deliver the approved course frame:\n${courseRequest}`,
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("blueprint", {
          ...requestContext(ctx.run.request),
          courseRequest,
          availableCapabilities: [...deps.availableCapabilities].sort(),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        validateBlueprint,
      ),
    // The critic reads the learner-shaped parts: the spine + the inventory
    // (id/title/purpose/level/concepts), not the full internal graph.
    (b) =>
      [
        b.progressionSpine,
        "",
        "## Lesson inventory",
        ...b.lessonInventory.map(
          (l) => `- ${l.sequence}. [${l.level}] ${l.title} — ${l.purpose} (introduces: ${l.conceptsIntroduced.join(", ") || "—"})`,
        ),
      ].join("\n"),
  );
  writeBlueprint(arts, bp);
  recordCritiqueSummary(arts, [{ subject: "blueprint", rounds, satisfied }]);

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
  const critiqueEntries: CritiqueSummaryEntry[] = [];
  const maxRounds = critiqueRounds();
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;

  for (const lesson of inventory) {
    if (blocked.has(lesson.lessonId)) {
      ctx.emit("lesson.blocked", { lessonId: lesson.lessonId, reason: "capability-gap" });
      continue;
    }
    // Author → 4 reviews (technical, pedagogy, cohesion + the learner-advocate's
    // persona-fit/goal-fit critique) → on failure, re-author with the blocking
    // reviewers' feedback PLUS the advocate's advisory notes, up to the critique
    // round cap. Pass/fail belongs to the verdict reviewers; the advocate
    // advises and its reservations are recorded for the gate (see
    // evaluateReviews — an adversarial critic never says "done").
    const subject = `lesson-${lesson.lessonId}`;
    let outcome: ReviewOutcome | null = null;
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxRounds; attempt++) {
      attemptsUsed = attempt;
      const feedback = outcome ? [...outcome.blockers, ...(outcome.advisory ?? [])] : null;
      const plan = await invokeValidated(
        deps,
        ctx,
        "lesson-author",
        prompt(`lesson:${lesson.lessonId}`, { lesson, ...requestContext(ctx.run.request), reviewFeedback: feedback ?? undefined }),
        (parsed) => validateLessonPlan(parsed, lesson.lessonId),
      );
      arts.write(`lessons/${lesson.lessonId}/lesson.md`, plan.markdown);
      // The brief carries the inventory entry PLUS the authored lab spec, so
      // materializing knows which real lab (lab.kind) to build.
      arts.write(`briefs/${lesson.lessonId}.json`, JSON.stringify({ ...lesson, lab: plan.lab }, null, 2));

      const technical = await invokeValidated(deps, ctx, "technical-reviewer", prompt(`review:technical:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown }), validateTechnicalReview);
      const pedagogy = await invokeValidated(
        deps,
        ctx,
        "pedagogy-reviewer",
        prompt(`review:pedagogy:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown, persona }),
        validatePedagogyReview,
      );
      const cohesion = await invokeValidated(deps, ctx, "cohesion-editor", prompt(`review:cohesion:${lesson.lessonId}`, { lesson, lessonMarkdown: plan.markdown }), validateCohesionReview);
      const advocate = await invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { subject, round: attempt, goal: lesson.purpose, persona, content: plan.markdown }),
        validateCritiqueVerdict,
      );
      arts.write(`critiques/${subject}.round${attempt}.json`, JSON.stringify(advocate, null, 2));
      ctx.emit("critique.round", {
        subject,
        round: attempt,
        satisfied: advocate.satisfied,
        personaFitOk: advocate.personaFit.ok,
        goalFitOk: advocate.goalFit.ok,
        requiredChanges: advocate.requiredChanges.length,
      });

      outcome = evaluateReviews(lesson.lessonId, technical, pedagogy, cohesion, advocate);
      writeReviewArtifacts(arts, lesson.lessonId, outcome);
      ctx.emit("lesson.reviewed", { lessonId: lesson.lessonId, attempt, passed: outcome.passed, scores: pedagogy.scores, blockers: outcome.blockers });
      if (outcome.passed) break;
      if (attempt < maxRounds) ctx.emit("lesson.revising", { lessonId: lesson.lessonId, blockers: outcome.blockers });
    }

    summary.push(outcome!);
    critiqueEntries.push({ subject, rounds: attemptsUsed, satisfied: outcome!.advocate?.satisfied ?? true });
    if (outcome!.advocate && !outcome!.advocate.satisfied) ctx.emit("critique.unsatisfied", { subject, rounds: attemptsUsed });
    if (outcome!.passed) {
      authored.push(lesson.lessonId);
      ctx.emit("lesson.authored", { lessonId: lesson.lessonId });
    } else {
      needsRevision.push(lesson.lessonId);
      ctx.emit("lesson.needs-revision", { lessonId: lesson.lessonId, blockers: outcome!.blockers });
    }
  }

  if (critiqueEntries.length) recordCritiqueSummary(arts, critiqueEntries);
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
    try {
      const revision = !!ctx.run.request.revision;
      switch (ctx.phase) {
        case "framing":
          return await (revision ? runRevisionFraming(ctx, runDeps, arts) : runFraming(ctx, runDeps, arts));
        case "designing":
          return await (revision ? runRevisionDesigning(ctx, runDeps, arts) : runDesigning(ctx, runDeps, arts));
        case "authoring":
          return await runAuthoring(ctx, runDeps, arts); // 1-entry inventory for a revision
        case "materializing":
          return await runMaterializing(ctx, runDeps, arts); // the injected materializer is revision-aware
      }
    } finally {
      // The phase is done (or threw) — clear the live buffer.
      deps.onActivity?.(ctx.run.runId, null);
    }
  };
}
