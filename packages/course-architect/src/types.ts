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
  /** Required for anthropic / openai-compatible; ignored for mock. */
  model?: string;
  /** openai-compatible only (e.g. a local LM Studio / Ollama endpoint). */
  baseUrl?: string;
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
  phase: Phase;
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
