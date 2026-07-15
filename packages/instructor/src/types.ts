import type { LearningSessionState } from "../../session-events/src/reducer.ts";
import type { InterventionTrigger } from "../../session-events/src/interventions.ts";

export interface HintRequest {
  state: LearningSessionState;
  lab: {
    id: string;
    title: string;
    objective: string;
    /** The lesson's narrative framing ("You're a manual QA engineer…"). */
    scenario?: string;
    /** The guide's display name (lab.json chat.botName) for first-person phrasing. */
    botName?: string;
    tasks: Array<{ id: string; title?: string; text: string; done?: boolean }>;
    /** Trusted curriculum guidance (from lab.json), incl. reveal policy. */
    instructorNotes?: string;
    /**
     * Which kind of lab this is: a terminal/repo lab or a simulated-apps
     * workspace lab. Drives which coaching vocabulary providers may use —
     * "diff"/"tests" language must never reach a workspace learner.
     */
    surface?: "terminal" | "workspace";
    /**
     * True when the lab is about reviewing a (simulated) agent's change —
     * the diff-first coaching ladder only makes sense there. Terminal labs
     * WITHOUT an agent change (e.g. manual test authoring) get task-focused
     * coaching instead.
     */
    agentReview?: boolean;
    /**
     * Authored answers to predictable clarifying questions (from lab.json
     * chat.faq). A matched question gets ITS answer — a learner asking
     * "which file do I edit?" must never receive a generic recipe. Answers
     * are curriculum content: vocabulary and concepts, never the solution.
     */
    faq?: Array<{ match: string; answer: string }>;
  };
  /** Why the instructor is speaking. */
  reason:
    | { kind: "question"; text: string; stuck: boolean }
    | { kind: "goal"; text: string }
    // The session-opening message: no learner input yet — the guide speaks
    // first, welcoming the learner into THIS lesson (goal-first onboarding).
    | { kind: "greeting" }
    // Instrumentation measured task(s) complete: check them off and hand
    // over the next step (ids validated against the manifest by the session).
    | { kind: "progress"; completedTaskIds: string[] }
    // The learner is RETURNING to a session already in progress: welcome them
    // back and restate where they are, rather than re-onboarding from scratch.
    // `completed`: the lesson's checkpoint has already passed — congratulate
    // instead of handing over a next step.
    | { kind: "resume"; completedTaskIds: string[]; completed: boolean }
    | { kind: "intervention"; trigger: InterventionTrigger };
  /**
   * What the learner's client says is on screen right now (UNTRUSTED,
   * self-reported; sanitized + capped by the session before it gets here).
   * Informs how guidance is phrased — e.g. "the file you already have open"
   * — never what the platform believes about the learner.
   */
  screen?: {
    activeApp: string | null;
    openWindows: string[];
    editorFile: string | null;
    editorDirty: boolean;
  };
  hintLevel: number;
  promptVersion: string;
}

export interface HintResponse {
  message: string;
  level: number;
  strategy: string;
  promptVersion: string;
  provider: string;
  /** The model that produced this hint (LLM providers) or a stable stand-in id. */
  model?: string;
  /**
   * The model the adapter REQUESTED (its configured id). Servers may echo a
   * resolved/dated id in `model`; cost estimation falls back to this when
   * the served id has no pricing entry.
   */
  modelRequested?: string;
  /**
   * Token accounting, when the provider reports it; feeds the admin usage
   * views and the normalized invocation records. Cache fields only when the
   * provider actually reports them — never zero-filled.
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface InstructorProvider {
  readonly name: string;
  generateHint(req: HintRequest, context: BuiltContext): Promise<HintResponse>;
}

export interface BuiltContext {
  system: string;
  user: string;
  promptVersion: string;
}

export { choosePolicy, STRATEGIES as STRATEGY_BY_LEVEL, MAX_LEVEL } from "./policy.ts";
