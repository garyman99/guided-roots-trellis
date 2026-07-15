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
  | { kind: "greeting" }
  | { kind: "progress"; completedTaskIds: string[] }
  | { kind: "resume"; completedTaskIds: string[]; completed: boolean }
  | { kind: "intervention"; trigger: InterventionTrigger };

/**
 * A typed question can itself carry a plain "I'm stuck / show me" signal — the
 * learner needn't press the stuck button. Beginners especially ask straight
 * out ("I don't know what to write", "what does the code look like", "where do
 * I put this"); meeting that with a Socratic question loses them. Deterministic
 * keyword match (not the model) so the policy stays the one that decides.
 */
function wordsSignalStuck(text: string): boolean {
  return (
    /\b(stuck|lost|confused|unclear|no idea|not sure|help)\b/i.test(text) ||
    /\bdo(n'?t| not)\s+(know|understand|get)\b/i.test(text) ||
    /\bshow me\b/i.test(text) ||
    /\bwhat\b.{0,30}\b(look like|to (type|write|put|do)|goes? (in|here))\b/i.test(text) ||
    /\bwhere\b.{0,20}\b(do|should|to)?\s*i?\s*(write|type|put|start|go)\b/i.test(text)
  );
}

export function choosePolicy(state: LearningSessionState, reason: HintReason): PolicyDecision {
  const lastGiven = state.hintsAlreadyGiven.at(-1)?.level ?? -1;
  const frustrated = state.repeatedFailures.some((f) => f.count >= 3);

  // The session opening: the guide speaks first, before any learner input.
  // Pure welcome-and-orient — never part of the escalation ladder.
  if (reason.kind === "greeting") {
    return { level: 1, strategy: STRATEGIES[1], because: "session opening — welcome into the lesson, no escalation" };
  }

  // Measured task completion: acknowledge and hand over the next step.
  // Progress is good news, never a plea for help — no escalation.
  if (reason.kind === "progress") {
    return { level: 1, strategy: STRATEGIES[1], because: "measured task completion — mark it and orient to the next step" };
  }

  // Returning learner: a "welcome back — here's where you are" opening, in the
  // same welcome-and-orient register as the greeting. Never an escalation.
  if (reason.kind === "resume") {
    return { level: 1, strategy: STRATEGIES[1], because: "returning learner — welcome back and restate the current step" };
  }

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
  } else if (reason.kind === "question" && wordsSignalStuck(reason.text)) {
    // Floor at explain-concept (one past the stuck button): a learner who
    // writes "what does the code look like" wants to SEE the shape, and the
    // v3 prompt shows code PIECES at this level. Point-to-location (3) just
    // sent them back to read a file — the opposite of what they asked.
    level = Math.min(Math.max(level, 4), MAX_LEVEL);
    because = "learner's words ask to see the how — floor at explain-concept (guide shows a code piece)";
  }

  if (frustrated && level < 3) {
    level = 3;
    because = "frustration override: a command has failed 3+ times — skipping elicitation for direct help";
  }

  return { level: Math.max(0, level), strategy: STRATEGIES[Math.max(0, level)], because };
}
