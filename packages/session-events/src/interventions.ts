/**
 * Deterministic intervention rule engine.
 *
 * Rules read the reduced session state and propose InterventionTriggers —
 * a reason plus evidence plus a suggested hint level. They NEVER author the
 * teaching message; the instructor model turns a trigger into words.
 */
import type { LearningSessionState } from "./reducer.ts";

export interface InterventionTrigger {
  type: "repeated_failure" | "tests_not_run" | "diff_not_viewed" | "inactivity";
  evidence: Record<string, unknown>;
  suggestedHintLevel: number;
}

export interface InterventionConfig {
  repeatedFailureThreshold: number;
  inactivityMs: number;
  /** Minimum learner activity (commands) before nudging about tests/diff. */
  minCommandsBeforeNudges: number;
  /** How long an untested edit must sit before nudging (don't nag mid-edit). */
  testsNotRunGraceMs: number;
}

export const defaultInterventionConfig: InterventionConfig = {
  repeatedFailureThreshold: 3,
  inactivityMs: 4 * 60_000,
  minCommandsBeforeNudges: 3,
  testsNotRunGraceMs: 60_000,
};

export function evaluateInterventions(
  state: LearningSessionState,
  config: InterventionConfig = defaultInterventionConfig,
): InterventionTrigger[] {
  const triggers: InterventionTrigger[] = [];

  // 1. Same failing command run repeatedly.
  const worst = state.repeatedFailures.find((f) => f.count >= config.repeatedFailureThreshold);
  if (worst) {
    triggers.push({
      type: "repeated_failure",
      evidence: { command: worst.command, count: worst.count },
      suggestedHintLevel: Math.min(3 + Math.floor((worst.count - config.repeatedFailureThreshold) / 2), 4),
    });
  }

  // 2. Code changed, but tests not run since — after a grace period, so a
  // learner mid-edit is not nagged seconds after saving.
  if (
    state.changedSinceLastTestRun &&
    state.filesChanged.length > 0 &&
    (state.msSinceLastFileChange ?? 0) >= config.testsNotRunGraceMs
  ) {
    triggers.push({
      type: "tests_not_run",
      evidence: { filesChanged: state.filesChanged, testsRunSoFar: state.testsRun },
      suggestedHintLevel: 2,
    });
  }

  // 3. Meaningful activity without ever viewing the diff.
  if (
    !state.viewedGitDiff &&
    state.recentCommands.length >= config.minCommandsBeforeNudges &&
    (state.filesChanged.length > 0 || state.testsRun > 0)
  ) {
    triggers.push({
      type: "diff_not_viewed",
      evidence: { commandsSoFar: state.recentCommands.length },
      suggestedHintLevel: 3,
    });
  }

  // 4. Inactivity.
  if (
    state.msSinceLastActivity !== undefined &&
    state.msSinceLastActivity >= config.inactivityMs &&
    state.completedCheckpoints.length === 0
  ) {
    triggers.push({
      type: "inactivity",
      evidence: { msSinceLastActivity: state.msSinceLastActivity },
      suggestedHintLevel: 0,
    });
  }

  return triggers;
}
