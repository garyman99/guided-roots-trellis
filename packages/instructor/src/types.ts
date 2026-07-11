import type { LearningSessionState } from "../../session-events/src/reducer.ts";
import type { InterventionTrigger } from "../../session-events/src/interventions.ts";

export interface HintRequest {
  state: LearningSessionState;
  lab: {
    id: string;
    title: string;
    objective: string;
    tasks: Array<{ id: string; text: string }>;
    /** Trusted curriculum guidance (from lab.json), incl. reveal policy. */
    instructorNotes?: string;
  };
  /** Why the instructor is speaking. */
  reason:
    | { kind: "question"; text: string; stuck: boolean }
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
