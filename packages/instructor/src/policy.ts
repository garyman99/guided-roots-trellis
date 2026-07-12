/**
 * Instruction Policy (kernel): deterministic choice of strategy + level.
 *
 * Reflection-before-instruction is the DEFAULT opening move — but with a
 * measured escape hatch: Socratic method applied to someone on their third
 * identical failure is how you lose them, so frustration signals route past
 * elicitation to direct help. The model never chooses when or how much to
 * help; it only phrases the help this policy selects.
 */
import type { LearningSessionState } from "../../session-events/src/reducer.ts";
import type { InterventionTrigger } from "../../session-events/src/interventions.ts";

export const STRATEGIES = ["elicit", "orient", "point-to-tool", "point-to-location", "explain-concept", "walk-through"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const MAX_LEVEL = STRATEGIES.length - 1;

export interface PolicyDecision {
  level: number;
  strategy: Strategy;
  /** Human-readable rule trace for the transparency drawer. */
  because: string;
}

export type HintReason =
  | { kind: "question"; text: string; stuck: boolean }
  | { kind: "goal"; text: string }
  | { kind: "intervention"; trigger: InterventionTrigger };

export function choosePolicy(state: LearningSessionState, reason: HintReason): PolicyDecision {
  const lastGiven = state.hintsAlreadyGiven.at(-1)?.level ?? -1;
  const frustrated = state.repeatedFailures.some((f) => f.count >= 3);

  // A goal statement is onboarding, not a plea for help: orient warmly at
  // level 1 and NEVER count it toward the escalation ladder.
  if (reason.kind === "goal") {
    return { level: 1, strategy: STRATEGIES[1], because: "learner stated their goal — orient, no escalation" };
  }

  // After the checkpoint has passed, a casual (non-stuck) message is
  // conversation, not a plea for help: never escalate the ladder at someone
  // who just said thanks.
  if (state.completedCheckpoints.length > 0 && reason.kind === "question" && !reason.stuck) {
    return { level: 0, strategy: STRATEGIES[0], because: "checkpoint already passed — conversational reply, no escalation" };
  }

  let level = Math.min(lastGiven + 1, MAX_LEVEL);
  let because = lastGiven < 0 ? "first hint of the session" : `escalated one step from level ${lastGiven}`;

  if (reason.kind === "intervention") {
    level = Math.max(level, Math.min(reason.trigger.suggestedHintLevel, MAX_LEVEL));
    because = `intervention "${reason.trigger.type}" suggested level ${reason.trigger.suggestedHintLevel}`;
  } else if (reason.stuck) {
    level = Math.min(Math.max(level, 3), MAX_LEVEL);
    because = "learner pressed I'm stuck — floor at point-to-location";
  }

  if (frustrated && level < 3) {
    level = 3;
    because = "frustration override: a command has failed 3+ times — skipping elicitation for direct help";
  }

  return { level: Math.max(0, level), strategy: STRATEGIES[Math.max(0, level)], because };
}
