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
import { DEFAULT_TARGET_PLATFORM } from "./types.ts";
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
import { enforceBudget } from "./budget.ts";
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

/** Builds ONE lesson's authored lab in a throwaway workspace and auto-solves it,
 *  returning whether it proved (and why not). Injected so the executor stays
 *  free of the api-side lab builders + driver. */
export type LessonProver = (input: {
  run: CourseRun;
  lessonId: string;
  lab: LessonPlanDoc["lab"];
}) => Promise<{ ok: boolean; detail?: string }>;

/** Runs a simulated learner on ONE finalized lesson's lab (the shift-left
 *  EXPERIENCE gate, plan L9), classifies the trace, and returns whether it's
 *  usable. `ok:false` blocks the lesson; `blockers` are the content/lab-design
 *  findings (+ can't-complete / over-friction) fed to the re-author. Injected
 *  and OPTIONAL — when absent, or when the sim can't run (no live model / app),
 *  the gate is skipped and authoring proceeds. */
export type LessonSimulator = (input: {
  run: CourseRun;
  lessonId: string;
  lab: LessonPlanDoc["lab"];
  title: string;
  /** Concepts EARLIER lessons introduced — the persona's cumulative memory. */
  concepts: string[];
}) => Promise<{ ok: boolean; detail?: string; blockers?: string[] }>;

export interface ExecutorDeps {
  /** Resolve the model provider for a run — selected per-run (mock/live). */
  rolesFor: (run: CourseRun) => RoleInvoker;
  artifactsFor: (runId: string) => RunArtifacts;
  /** Flat set of registry capability ids (apps, auto-rules, checkpoint kinds…). */
  availableCapabilities: Set<string>;
  materialize: Materializer;
  /**
   * Shift-left machine gate (plan L8/L9): build a single lesson's authored lab
   * and prove it (broken-as-shipped AND solvable) DURING authoring, so an
   * unprovable lab drives a re-author here instead of being silently dropped at
   * materialize. Optional — when absent (e.g. unit harnesses), the prove gate is
   * skipped and authoring behaves as before.
   */
  proveLesson?: LessonProver;
  /**
   * Shift-left EXPERIENCE gate (plan L9): after a lesson proves, run a simulated
   * learner on its lab and classify the trace, so friction is caught DURING
   * authoring and drives a re-author. Optional — absent, or a sim that can't run
   * (no live model/app), skips the gate.
   */
  simLesson?: LessonSimulator;
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
      '  "lab": {',
      '    "objective": string,             // what the lab has the learner DO',
      '    "primaryAuto": string,           // one of CONTEXT.lesson.requiredCapabilities',
      '    "kind": "stub" | "node-deps",    // REQUIRED unless you provide "files". "stub" = a conceptual / no-code lesson with no gradable action. "node-deps" = a project-setup lab where the learner declares dependencies in package.json (offline-checkable).',
      '    "expectedPackages"?: string[],   // REQUIRED when kind is "node-deps": the exact npm packages package.json must declare',
      '    "files"?: { [path]: string }     // ADVANCED alternative to "kind": author the FULL lab yourself — lab.json + template/… + verify/checkpoint.mjs + blueprint.json (with an authored solution). Used verbatim; MUST pass auto-solve (ship the template broken, the verifier strict).',
      '  }',
      '}',
      'EVERY lesson MUST pick a lab: "kind":"stub" for a conceptual lesson, "kind":"node-deps" (+expectedPackages) for a dependency-setup lesson, or author "files" for a full hands-on lab. A lab with neither a kind nor files is rejected.',
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

/** Standing rule appended to EVERY prompt: alongside the exact task fields,
 *  each role reports a 1–2 sentence human-readable summary. It rides the run's
 *  event log as `agent.message` and feeds the Course studio chat panel — the
 *  operator's high-level view of the agents talking, without the full output. */
const SUMMARY_NOTE = [
  "",
  "IN ADDITION to the exact fields above, include ONE extra top-level field in",
  'the same JSON object: "summary" — 1–2 plain-English sentences addressed to',
  "the human operator, saying what you produced or decided and your most",
  "important finding or concern (e.g. the blockers if you rejected something).",
  "It is shown in a chat feed; be concrete and brief, not a field-by-field recap.",
].join("\n");

/** Pull the operator-facing summary off a role's raw parsed output (top level,
 *  or inside a single-key wrapper object — mirroring validateWithUnwrap). */
function extractSummary(parsed: unknown): string | null {
  const top = (parsed ?? {}) as Record<string, unknown>;
  let s: unknown = top.summary;
  if (typeof s !== "string" && !Array.isArray(parsed) && parsed && typeof parsed === "object") {
    const values = Object.values(top);
    if (values.length === 1 && values[0] && typeof values[0] === "object") {
      s = (values[0] as Record<string, unknown>).summary;
    }
  }
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 600) : null;
}

/** Standing rule appended to EVERY prompt: the one desktop this course ships
 *  in. Keeps authors writing for the platform the virtual desktop actually
 *  mimics, and stops reviewers/critics flagging missing support for other
 *  platforms (the field finding that prompted first-class targetPlatform). */
function platformNote(platform: string): string {
  const bench =
    platform === "windows"
      ? [
          "THE BENCH IS EXACT: the lab terminal runs PowerShell 7 (pwsh) — not",
          "cmd.exe and not Windows PowerShell 5.1. Write every command, prompt",
          "illustration, and error-message quote for pwsh 7 specifically (e.g.",
          '"Get-ChildItem: Cannot find path …" — cmdlet name, no space before the',
          "colon). The project workspace is /workspace with forward-slash paths;",
          "never instruct C:\\ paths or cmd.exe-only commands.",
        ]
      : [];
  return [
    `CONTEXT.targetPlatform ("${platform}") is the ONLY desktop environment this`,
    "course ships in: labs run inside the product's virtual desktop, which mimics",
    "that operating system (currently Windows only; macOS is a future variant).",
    "Author and judge everything for that platform — its conventions, shortcuts,",
    "and terminology — and NEVER raise missing support for any other platform as",
    "an issue or required change: cross-platform coverage is out of scope by design.",
    ...bench,
    "",
    "",
  ].join("\n");
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

/** Build a role prompt carrying structured context (mock reads it directly).
 *  targetPlatform is injected into every context (from the request when the
 *  caller passed one, else the default) so ALL roles — authors, reviewers,
 *  critics — see the same platform ground truth. */
function prompt(task: string, context: Record<string, unknown>, extra = ""): RolePrompt {
  const fromRequest = (context.request as Record<string, unknown> | undefined)?.targetPlatform;
  const targetPlatform = String(context.targetPlatform ?? fromRequest ?? DEFAULT_TARGET_PLATFORM);
  const ctx = { targetPlatform, ...context };
  const personaNote = context.persona ? PERSONA_NOTE : "";
  return { task, context: ctx, system: "", user: `CONTEXT:\n${JSON.stringify(ctx, null, 2)}\n\n${extra}${personaNote}${platformNote(targetPlatform)}${taskInstruction(task)}${SUMMARY_NOTE}` };
}

/** The request as prompt context: persona lifted out as a bounded view (the raw
 *  embedded snapshot carries ids/timestamps the model has no use for), and
 *  targetPlatform made explicit (defaulted) rather than sometimes-absent. */
function requestContext(req: CourseRunRequest): { request: Record<string, unknown>; persona?: Record<string, unknown> } {
  const { persona, ...rest } = req;
  return {
    request: { targetPlatform: DEFAULT_TARGET_PLATFORM, ...(rest as Record<string, unknown>) },
    ...(persona ? { persona: personaPromptView(persona.profile) } : {}),
  };
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
    ctx.emit("model.invoked", { role, task: p.task, attempt, outputTokens: res.usage.outputTokens ?? 0, model: res.model });
    // Budget guardrail (plan §3.2): checked right after the call is recorded,
    // so cumulative usage includes it. Throws BudgetExceededError, which the
    // scheduler treats like any other phase failure — the run parks
    // `interrupted` with a clear, resumable reason.
    enforceBudget(ctx.run.request, ctx.events());
    try {
      // camelizeKeys tolerates snake_case; validateWithUnwrap tolerates a
      // single-key wrapper object.
      const parsed = camelizeKeys(parseJson<unknown>(res.text));
      const value = validateWithUnwrap(parsed, validate);
      // The role's operator-facing summary → the run's chat feed. Optional:
      // a model that omits it still validates; there's just no chat line.
      const summary = extractSummary(parsed);
      if (summary) ctx.emit("agent.message", { role, task: p.task, summary });
      return value;
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

function renderCourseRequestMd(doc: CourseRequestDoc, targetPlatform: string): string {
  return [
    `# ${doc.title}`,
    ``,
    `**Technology:** ${doc.technology}`,
    `**Target platform:** ${targetPlatform}`,
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
  const targetPlatform = ctx.run.request.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
  const result = await critiqueLoop<T>({
    maxRounds: critiqueRounds(),
    produce,
    critique: (value, round) =>
      invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { targetPlatform, subject, round, goal, persona, content: render(value) }),
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
  const platform = req.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
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
    (d) => renderCourseRequestMd(d, platform),
  );
  arts.write("course-request.md", renderCourseRequestMd(doc, platform));
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
  resetAuthoringLedger(arts);
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
  resetAuthoringLedger(arts);
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

/** A fresh blueprint invalidates any prior authoring ledger — lessons authored
 *  against the OLD inventory must not be "already authored" on the next pass. */
function resetAuthoringLedger(arts: RunArtifacts): void {
  if (arts.exists("reviews/summary.json")) arts.write("reviews/summary.json", "[]", { archive: false });
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

  // Prior-pass ledger (interrupt/resume, or a changes-requested re-run):
  // reviews/summary.json is rewritten after EVERY lesson below, so a re-entered
  // phase picks up where it failed — a lesson that already PASSED is reused,
  // not re-authored; only needs-revision/unreached lessons are (re)attempted.
  // Gate notes override: a note naming a lesson re-opens it, a note with no
  // lessonId re-opens every lesson. Designing resets this ledger (a new
  // inventory invalidates outcomes authored against the old one).
  let prior = new Map<string, ReviewOutcome>();
  try {
    prior = new Map(parseJson<ReviewOutcome[]>(arts.read("reviews/summary.json") ?? "[]").map((o) => [o.lessonId, o]));
  } catch { /* unreadable ledger — author everything */ }
  const notes = ctx.changeNotes ?? [];
  const reopenAll = notes.some((n) => !n.lessonId);
  const reopened = new Set(notes.map((n) => n.lessonId).filter((id): id is string => !!id));

  // Seeded with prior outcomes so a crash mid-pass never forgets lessons the
  // walk hasn't reached yet; each (re)processed lesson overwrites its entry.
  const outcomes = new Map<string, ReviewOutcome>();
  for (const lesson of inventory) {
    const p = prior.get(lesson.lessonId);
    if (p) outcomes.set(lesson.lessonId, p);
  }
  const writeLedger = () => {
    const rows = inventory.map((l) => outcomes.get(l.lessonId)).filter((o): o is ReviewOutcome => !!o);
    arts.write("reviews/summary.json", JSON.stringify(rows, null, 2), { archive: false });
  };

  const critiqueEntries: CritiqueSummaryEntry[] = [];
  const maxRounds = critiqueRounds();
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;
  const targetPlatform = ctx.run.request.targetPlatform ?? DEFAULT_TARGET_PLATFORM;

  for (const lesson of inventory) {
    if (blocked.has(lesson.lessonId)) {
      outcomes.delete(lesson.lessonId);
      ctx.emit("lesson.blocked", { lessonId: lesson.lessonId, reason: "capability-gap" });
      continue;
    }
    const previous = prior.get(lesson.lessonId);
    const mustRedo = reopenAll || reopened.has(lesson.lessonId);
    if (previous?.passed && !mustRedo) {
      ctx.emit("lesson.skipped", { lessonId: lesson.lessonId, reason: "already-authored" });
      continue;
    }
    // Author → 4 reviews (technical, pedagogy, cohesion + the learner-advocate's
    // persona-fit/goal-fit critique) → on failure, re-author with the blocking
    // reviewers' feedback PLUS the advocate's advisory notes, up to the critique
    // round cap. Pass/fail belongs to the verdict reviewers; the advocate
    // advises and its reservations are recorded for the gate (see
    // evaluateReviews — an adversarial critic never says "done").
    const subject = `lesson-${lesson.lessonId}`;
    // First-attempt feedback: gate notes aimed at this lesson (or phase-wide),
    // plus — when re-attempting a lesson a prior pass left needs-revision —
    // that pass's blockers, so the re-author doesn't start blind.
    const seedFeedback = [
      ...notes.filter((n) => !n.lessonId || n.lessonId === lesson.lessonId).map((n) => n.comment),
      ...(previous && !previous.passed ? [...previous.blockers, ...(previous.advisory ?? [])] : []),
    ];
    let outcome: ReviewOutcome | null = null;
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxRounds; attempt++) {
      attemptsUsed = attempt;
      const feedback = outcome ? [...outcome.blockers, ...(outcome.advisory ?? [])] : seedFeedback.length ? seedFeedback : null;
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

      const technical = await invokeValidated(deps, ctx, "technical-reviewer", prompt(`review:technical:${lesson.lessonId}`, { targetPlatform, lesson, lessonMarkdown: plan.markdown }), validateTechnicalReview);
      const pedagogy = await invokeValidated(
        deps,
        ctx,
        "pedagogy-reviewer",
        prompt(`review:pedagogy:${lesson.lessonId}`, { targetPlatform, lesson, lessonMarkdown: plan.markdown, persona }),
        validatePedagogyReview,
      );
      const cohesion = await invokeValidated(deps, ctx, "cohesion-editor", prompt(`review:cohesion:${lesson.lessonId}`, { targetPlatform, lesson, lessonMarkdown: plan.markdown }), validateCohesionReview);
      const advocate = await invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { targetPlatform, subject, round: attempt, goal: lesson.purpose, persona, content: plan.markdown }),
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
      // Shift-left prove gate: a review-passing lesson must ALSO prove its lab
      // (broken-as-shipped AND solvable) before it counts as authored. An
      // auto-solve failure becomes a blocker that drives the SAME re-author loop
      // — caught here, mid-authoring, not silently dropped at materialize.
      if (outcome.passed && deps.proveLesson) {
        const proof = await deps.proveLesson({ run: ctx.run, lessonId: lesson.lessonId, lab: plan.lab });
        ctx.emit("lesson.proved", { lessonId: lesson.lessonId, attempt, ok: proof.ok, ...(proof.detail ? { detail: proof.detail } : {}) });
        if (!proof.ok) {
          outcome = {
            ...outcome,
            passed: false,
            blockers: [
              ...outcome.blockers,
              `The lab did not prove (auto-solve): ${proof.detail ?? "broken-as-shipped or solvable check failed"}. Fix the lab so its verifier fails on the shipped template and passes after a correct solution.`,
            ],
          };
        }
      }
      // Shift-left EXPERIENCE gate: a proven lesson is played by a simulated
      // learner; a persona that can't complete, blows the friction budget, or
      // surfaces content/lab-design findings blocks the lesson and feeds the
      // SAME re-author loop. Skipped when no simulator is wired or it can't run.
      if (outcome.passed && deps.simLesson) {
        const earlierConcepts = [
          ...new Set(inventory.slice(0, inventory.indexOf(lesson)).flatMap((l) => l.conceptsIntroduced ?? [])),
        ];
        const sim = await deps.simLesson({ run: ctx.run, lessonId: lesson.lessonId, lab: plan.lab, title: lesson.title, concepts: earlierConcepts });
        ctx.emit("lesson.simulated", { lessonId: lesson.lessonId, attempt, ok: sim.ok, ...(sim.detail ? { detail: sim.detail } : {}) });
        if (!sim.ok) {
          outcome = {
            ...outcome,
            passed: false,
            blockers: [
              ...outcome.blockers,
              `A simulated learner could not complete this lesson comfortably: ${sim.detail ?? "friction over budget"}.`,
              ...(sim.blockers ?? []),
            ],
          };
        }
      }
      writeReviewArtifacts(arts, lesson.lessonId, outcome);
      ctx.emit("lesson.reviewed", { lessonId: lesson.lessonId, attempt, passed: outcome.passed, scores: pedagogy.scores, blockers: outcome.blockers });
      if (outcome.passed) break;
      if (attempt < maxRounds) ctx.emit("lesson.revising", { lessonId: lesson.lessonId, blockers: outcome.blockers });
    }

    outcomes.set(lesson.lessonId, outcome!);
    writeLedger();
    critiqueEntries.push({ subject, rounds: attemptsUsed, satisfied: outcome!.advocate?.satisfied ?? true });
    if (outcome!.advocate && !outcome!.advocate.satisfied) ctx.emit("critique.unsatisfied", { subject, rounds: attemptsUsed });
    if (outcome!.passed) {
      ctx.emit("lesson.authored", { lessonId: lesson.lessonId });
    } else {
      ctx.emit("lesson.needs-revision", { lessonId: lesson.lessonId, blockers: outcome!.blockers });
    }
  }

  // Final rollups over reused + freshly-processed outcomes alike.
  const summary = inventory.map((l) => outcomes.get(l.lessonId)).filter((o): o is ReviewOutcome => !!o);
  const authored = summary.filter((o) => o.passed).map((o) => o.lessonId);
  const needsRevision = summary.filter((o) => !o.passed).map((o) => o.lessonId);

  if (critiqueEntries.length) recordCritiqueSummary(arts, critiqueEntries);
  writeLedger();
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
    // Missing brief → an explicit no-code stub (the stub is never a silent default).
    const lab = brief.lab ?? { objective: lesson.purpose, primaryAuto: lesson.requiredCapabilities[0] ?? "any-command", kind: "stub" };
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
