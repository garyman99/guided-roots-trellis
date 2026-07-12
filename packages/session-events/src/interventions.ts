/**
 * Deterministic intervention rule engine.
 *
 * Rules read the reduced session state and propose InterventionTriggers —
 * a reason plus evidence plus a suggested hint level. They NEVER author the
 * teaching message; the instructor model turns a trigger into words.
 */
import type { LearningSessionState } from "./reducer.ts";

export interface InterventionTrigger {
  type:
    | "repeated_failure"
    | "tests_not_run"
    | "diff_not_viewed"
    | "inactivity"
    | "restricted_context_shared"
    | "unedited_ai_draft";
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
  /** How long an unedited AI draft must sit before nudging about reviewing it. */
  uneditedDraftGraceMs: number;
}

export const defaultInterventionConfig: InterventionConfig = {
  repeatedFailureThreshold: 3,
  inactivityMs: 4 * 60_000,
  minCommandsBeforeNudges: 3,
  testsNotRunGraceMs: 60_000,
  uneditedDraftGraceMs: 45_000,
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

  // 4. (Workspace) Restricted scenario content is sitting in the AI helper's
  // context RIGHT NOW. Teach judgment, don't block: the trigger fires so the
  // instructor can coach; the re-arm logic means recovery (a clean re-share)
  // resolves it. Immediate — no grace period; sharing is a discrete act.
  if (state.workspace.restrictedInLatestShare.length > 0) {
    triggers.push({
      type: "restricted_context_shared",
      evidence: {
        restrictedSpanIds: state.workspace.restrictedInLatestShare,
        shareCount: state.workspace.aiContextShares,
      },
      // A first privacy nudge should orient, not lecture: the learner just
      // acted in good faith. Escalation still happens if it persists.
      suggestedHintLevel: 1,
    });
  }

  // 5. (Workspace) An AI draft was inserted and has sat unedited: nudge the
  // learner to actually read it and make it their own — after a grace period,
  // and never once they've started editing or already submitted.
  if (
    state.workspace.draftInserted &&
    state.workspace.draftRevisions === 0 &&
    !state.workspace.submitted &&
    (state.msSinceLastActivity ?? 0) >= config.uneditedDraftGraceMs
  ) {
    triggers.push({
      type: "unedited_ai_draft",
      evidence: { draftsGenerated: state.workspace.aiDraftsGenerated },
      suggestedHintLevel: 1,
    });
  }

  // 6. Inactivity.
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
