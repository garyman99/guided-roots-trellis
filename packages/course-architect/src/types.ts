/**
 * Course-generation run: the domain types and the state machine that governs a
 * run's life from a two-line request to an approved (draft) course.
 *
 * A run is executed IN-PROCESS (plan D1) by an injected PhaseExecutor; the
 * scheduler here owns sequencing, the four human gates, single-active-run
 * concurrency (D7), and interrupt/resume (D8). Persistence is a contract
 * (CourseRunStore) the API's store implements — this package never imports the
 * app. Artifact CONTENT lives on the filesystem (RunArtifacts); this state
 * lives in SQLite, mirroring the split the plan calls for.
 */

import type { CourseGenRole } from "./roles.ts";
import type { EmbeddedPersona } from "./personas.ts";

/** The work phases, in order. Exactly one gate follows each. */
export const PHASES = ["framing", "designing", "authoring", "materializing"] as const;
export type Phase = (typeof PHASES)[number];

/** The four human approval gates (plan D4). */
export const GATES = ["frame", "blueprint", "package", "publish"] as const;
export type GateId = (typeof GATES)[number];

export const GATE_OF_PHASE: Record<Phase, GateId> = {
  framing: "frame",
  designing: "blueprint",
  authoring: "package",
  materializing: "publish",
};
export const PHASE_OF_GATE: Record<GateId, Phase> = {
  frame: "framing",
  blueprint: "designing",
  package: "authoring",
  publish: "materializing",
};
/** On a gate APPROVAL, the phase the run advances to next (publish ends the run). */
export const NEXT_PHASE_AFTER_GATE: Record<GateId, Phase | null> = {
  frame: "designing",
  blueprint: "authoring",
  package: "materializing",
  publish: null,
};

/**
 * Run status. A run is "active" (counts against the single-active limit) only
 * while its status is one of the PHASES. Parked-at-a-gate and terminal states
 * are free (plan: "runs waiting at gates don't count").
 */
export type RunStatus =
  | "queued" //          waiting for an execution slot
  | Phase //             executing that phase (active)
  | "awaiting-frame"
  | "awaiting-blueprint"
  | "awaiting-package"
  | "awaiting-publish" // parked at a gate, awaiting a human decision
  | "approved" //        publish gate approved; the course exists as a draft
  | "interrupted" //     caught mid-phase on boot/crash — operator resumes (D8)
  | "archived" //        rejected or abandoned
  | "failed"; //         unrecoverable error

export function isActive(status: RunStatus): boolean {
  return (PHASES as readonly string[]).includes(status);
}
export function awaitingGate(gate: GateId): RunStatus {
  return `awaiting-${gate}` as RunStatus;
}
export function isTerminal(status: RunStatus): boolean {
  return status === "approved" || status === "archived" || status === "failed";
}

/** The model provider a run uses (chosen per-run in the UI). */
export interface RunProviderConfig {
  provider: "mock" | "anthropic" | "openai-compatible";
  /** Explicit run-wide model. Absent for anthropic ⇒ per-role tier defaults
   *  (ANTHROPIC_TIER_MODELS); still required for openai-compatible, where it
   *  also serves as the generative-tier model. */
  model?: string;
  /** openai-compatible only: judgment-tier model (falls back to `model`). */
  judgmentModel?: string;
  /** openai-compatible only: mechanical-tier model (falls back to
   *  `judgmentModel`, then `model`). */
  mechanicalModel?: string;
  /** Per-role model overrides from the advanced picker; wins over `model`. */
  roleModels?: Partial<Record<CourseGenRole, string>>;
  /** openai-compatible only (e.g. a local LM Studio / Ollama endpoint). */
  baseUrl?: string;
}

/**
 * A LESSON-REVISION run (versioning plan Phase D): the same 4-phase/4-gate
 * machine, scoped to ONE lesson of an existing course. Self-contained by
 * design — the report and current lesson content are EMBEDDED at create time
 * (they ride the run payload + run.json mirror), so the run survives restarts
 * and the deletion of whatever produced the original lesson.
 */
export interface RevisionRequest {
  courseId: string;
  /** The lesson family being revised (the version-less id). */
  family: string;
  /** The course's current pointer for that family. */
  fromLabId: string;
  fromVersion: number;
  /** The current lesson's level — the revision keeps its rung by default. */
  level?: string;
  /** The experience report seeding this revision (D6; optional — notes alone can seed). */
  reportFile?: string;
  report?: unknown; // the parsed ExperienceReport, embedded verbatim
  /** Operator notes ("what I want changed"), free text. */
  notes?: string;
  /** The lesson as currently shipped (bounded lab.json + README), for the prompts. */
  lessonContent?: string;
}

/** Phase-1 request form (plan §6.1) — sparse by design; the architect fills gaps. */
export interface CourseRunRequest {
  technology: string;
  title?: string;
  targetLearner?: string;
  learnerStartingExperience?: string;
  outcome?: string;
  inScope?: string;
  outOfScope?: string;
  breadth?: string;
  depth?: string;
  ecosystem?: string;
  /** Model provider for this run. Absent → the deployment default (env/mock). */
  providerConfig?: RunProviderConfig;
  /** The target-user persona, embedded as a full snapshot at create time so
   *  the run is self-contained across persona edits/deletes (Phase 1). */
  persona?: EmbeddedPersona;
  /** Who decides the gates: a human operator (default) or the gate-reviewer
   *  role (Autopilot §3.1). */
  gateMode?: "manual" | "auto";
  /** Autopilot only: publish the course + shipped lessons right after the
   *  publish gate approves and materialization succeeds. */
  autoPublish?: boolean;
  /** Present ⇒ this is a lesson-revision run, not a whole-course generation. */
  revision?: RevisionRequest;
  /** Budget guardrails (plan §3.2) — a run that exceeds either aborts its
   *  current phase and parks `interrupted` with a budget-exhausted reason
   *  (BudgetExceededError, enforced in budget.ts). Absent ⇒ unbounded. */
  maxModelCalls?: number;
  /** Rough estimated USD spend across every model.invoked event so far (see
   *  budget.ts's per-model $/output-token table). A guardrail, not accounting. */
  maxEstimatedCostUSD?: number;
}

/** Structured request-changes comment; the exact text an executor must address. */
export interface GateNote {
  /** Artifact path this comment targets, if any (e.g. "lesson-inventory.json"). */
  path?: string;
  /** Lesson id this comment targets, if any. */
  lessonId?: string;
  comment: string;
}

export type GateDecision = "approved" | "changes" | "rejected";

export interface CourseRunGate {
  runId: string;
  gateId: GateId;
  requestedAt: string;
  decidedAt: string | null;
  decision: GateDecision | null;
  decidedBy: string | null;
  notes: GateNote[] | null;
}

export interface CourseRunEvent {
  id?: number;
  runId: string;
  at: string;
  /** phase.started | phase.completed | artifact.written | gate.requested |
   *  gate.decided | run.queued | run.interrupted | run.resumed | run.archived |
   *  error — a free string so the executor can add its own beats. */
  type: string;
  payload?: Record<string, unknown>;
}

export interface CourseRun {
  runId: string;
  status: RunStatus;
  request: CourseRunRequest;
  /** What the scheduler runs next when a slot frees (null once terminal/parked). */
  pendingPhase: Phase | null;
  /** Change notes to hand the executor on the next (re-)run of pendingPhase. */
  pendingChangeNotes?: GateNote[] | null;
  /** Last error message when interrupted/failed. */
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Persistence contract the API's store implements. Dependency flows app → pkg. */
export interface CourseRunStore {
  createCourseRun(run: CourseRun): void;
  getCourseRun(runId: string): CourseRun | null;
  listCourseRuns(): CourseRun[];
  updateCourseRun(run: CourseRun): void;
  deleteCourseRun(runId: string): void;

  appendCourseRunEvent(event: CourseRunEvent): CourseRunEvent;
  courseRunEvents(runId: string): CourseRunEvent[];

  /** Insert a pending gate row (decision null). */
  requestCourseRunGate(runId: string, gateId: GateId, requestedAt: string): void;
  /** Decide the single pending row for (runId, gateId). */
  decideCourseRunGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    decidedBy: string | null,
    notes: GateNote[] | null,
    decidedAt: string,
  ): void;
  courseRunGates(runId: string): CourseRunGate[];
}

/** What an executor receives to do one phase's work. */
export interface PhaseContext {
  run: CourseRun;
  phase: Phase;
  /** Present only when this is a re-run after a changes-requested gate. */
  changeNotes: GateNote[] | null;
  /** Append a run event (activity feed). */
  emit: (type: string, payload?: Record<string, unknown>) => void;
  /** The run's full event log so far (every phase, not just this one) — the
   *  seam budget enforcement reads to tally cumulative model.invoked calls/cost
   *  without the executor needing a store reference (plan §3.2). */
  events: () => CourseRunEvent[];
}

/**
 * Executes one phase: reads/writes artifacts, records usage, emits events, then
 * resolves. Resolving means "phase done — request its gate". Throwing means the
 * phase failed; the scheduler interrupts the run with the error (D8). Injected
 * so Phase B tests use a fake and Phase C plugs in the real role pipeline.
 */
export type PhaseExecutor = (ctx: PhaseContext) => Promise<void>;

/**
 * Live activity for the current model call — the real-time view. Held in memory
 * (not the event log) and polled by the UI while a phase runs; cleared when the
 * phase parks. Surfaces the model's thinking as it streams.
 */
export interface LiveActivity {
  runId: string;
  /** A run phase — or a job label for non-run model work (e.g. "analyzing"). */
  phase: Phase | string;
  role: string;
  task: string;
  thinking: string;
  text: string;
  updatedAt: string;
}

/** Raised by the scheduler for an illegal transition (maps to HTTP 409). */
export class RunStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateError";
  }
}
