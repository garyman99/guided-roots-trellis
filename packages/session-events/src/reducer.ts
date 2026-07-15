/**
 * Deterministic session-state reducer.
 *
 * reduce(events) is a pure function: same events in, same state out. This is
 * the ONLY path by which session history reaches the instructor model — as a
 * small structured summary, never a raw transcript. Facts here are measured,
 * so the instructor can cite evidence without hallucinating learner actions.
 */
import type { SessionEvent } from "./events.ts";
import { isDiffViewingCommand } from "./events.ts";

export interface LearningSessionState {
  lessonId: string;
  learnerId: string;
  startedAt?: string;
  lastEventAt?: string;
  completedCheckpoints: string[];
  recentCommands: Array<{
    command: string;
    exitCode?: number;
    outputSummary?: string;
    at: string;
  }>;
  filesChanged: string[];
  /** Workspace files the learner opened in the GUI editor (platform-served reads). */
  viewedFiles: string[];
  viewedGitDiff: boolean;
  testsRun: number;
  latestTestResult?: { passed: number; failed: number };
  /** Commands that failed (exit != 0) more than once, with counts. */
  repeatedFailures: Array<{ command: string; count: number }>;
  learnerQuestions: string[];
  /** What the learner said they're here to accomplish (goal-first onboarding). */
  statedGoal?: string;
  hintsAlreadyGiven: Array<{ level: number; strategy: string }>;
  /** Milliseconds since the last learner-driven event (command/question/file). */
  msSinceLastActivity?: number;
  /** Milliseconds since the last observed file change (for nudge grace periods). */
  msSinceLastFileChange?: number;
  /** True if any file changed after the most recent test run. */
  changedSinceLastTestRun: boolean;
  /**
   * LLM correctness-gate results per task id (latest wins). A task that
   * declares a success criterion is "done" only when its coarse trigger fired
   * AND its entry here has passed === true. Empty = nothing checked yet.
   */
  taskValidations: Record<string, { passed: boolean; reason: string; contentHash: string }>;
  lastCheckpointEvaluation?: { checkpointId: string; passed: boolean; incomplete: string[] };
  /** Simulated-application facts (workspace labs). Absent fields = never happened. */
  workspace: WorkspaceState;
}

export interface WorkspaceState {
  openedApps: string[];
  openedArtifacts: string[];
  /** How many times context was explicitly shared with the AI helper. */
  aiContextShares: number;
  /** Restricted-span IDs EVER shared with the AI helper (for coaching history). */
  restrictedEverShared: string[];
  /** Restricted-span IDs in the MOST RECENT share (recovery is detectable). */
  restrictedInLatestShare: string[];
  /** Required-fact IDs present in the most recent share. */
  requiredFactsInLatestShare: string[];
  aiPrompts: number;
  aiDraftsGenerated: number;
  /** True once an AI draft was placed into the reply artifact. */
  draftInserted: boolean;
  /** Learner edits after inserting/starting the draft (insert itself is not an edit). */
  draftRevisions: number;
  latestDraft?: { revision: number; similarityToGenerated: number | null };
  submitted?: {
    artifactId: string;
    revision: number;
    similarityToGenerated: number | null;
    restrictedSpans: string[];
    forbiddenPhrases: string[];
    requiredFactsMissing: string[];
    acknowledgesInconvenience: boolean;
    at: string;
  };
}

function initialWorkspace(): WorkspaceState {
  return {
    openedApps: [],
    openedArtifacts: [],
    aiContextShares: 0,
    restrictedEverShared: [],
    restrictedInLatestShare: [],
    requiredFactsInLatestShare: [],
    aiPrompts: 0,
    aiDraftsGenerated: 0,
    draftInserted: false,
    draftRevisions: 0,
  };
}

export interface ReduceOptions {
  recentCommandLimit?: number;
  recentQuestionLimit?: number;
  /** "now" for msSinceLastActivity; injectable for deterministic tests. */
  nowMs?: number;
}

const LEARNER_ACTIVITY: ReadonlySet<SessionEvent["type"]> = new Set([
  "terminal.command.started",
  "terminal.command.completed",
  "file.changed",
  "file.viewed",
  "learner.question",
  "learner.goal.stated",
  "workspace.app.opened",
  "workspace.artifact.opened",
  "aichat.context.shared",
  "aichat.prompt.submitted",
  "workspace.draft.inserted",
  "workspace.draft.updated",
  "workspace.artifact.submitted",
]);

export function initialState(lessonId = "", learnerId = ""): LearningSessionState {
  return {
    lessonId,
    learnerId,
    completedCheckpoints: [],
    recentCommands: [],
    filesChanged: [],
    viewedFiles: [],
    viewedGitDiff: false,
    testsRun: 0,
    repeatedFailures: [],
    learnerQuestions: [],
    hintsAlreadyGiven: [],
    changedSinceLastTestRun: false,
    taskValidations: {},
    workspace: initialWorkspace(),
  };
}

export function reduce(events: SessionEvent[], opts: ReduceOptions = {}): LearningSessionState {
  const cmdLimit = opts.recentCommandLimit ?? 12;
  const qLimit = opts.recentQuestionLimit ?? 8;

  const state = initialState();
  const failureCounts = new Map<string, number>();
  const filesChanged = new Set<string>();
  let lastActivityAt: string | undefined;
  let lastFileChangeAt: string | undefined;

  for (const ev of events) {
    state.lastEventAt = ev.timestamp;
    if (LEARNER_ACTIVITY.has(ev.type)) lastActivityAt = ev.timestamp;

    switch (ev.type) {
      case "session.started":
        state.lessonId = ev.lessonId;
        state.learnerId = ev.learnerId;
        state.startedAt = ev.timestamp;
        break;

      case "session.reset": {
        // A reset returns the WORKSPACE to its start state. Learner history
        // (questions, hints) is kept so the instructor stays contextual.
        const keepQuestions = state.learnerQuestions;
        const keepHints = state.hintsAlreadyGiven;
        const keepGoal = state.statedGoal;
        const keepMeta = { lessonId: state.lessonId, learnerId: state.learnerId, startedAt: state.startedAt };
        Object.assign(state, initialState(keepMeta.lessonId, keepMeta.learnerId));
        state.startedAt = keepMeta.startedAt;
        state.learnerQuestions = keepQuestions;
        state.hintsAlreadyGiven = keepHints;
        state.statedGoal = keepGoal;
        state.lastEventAt = ev.timestamp;
        failureCounts.clear();
        filesChanged.clear();
        lastFileChangeAt = undefined;
        break;
      }

      case "session.resumed":
        break; // lifecycle marker; no reduced-state effect

      case "session.abandoned":
        break; // lifecycle marker; no reduced-state effect

      case "terminal.command.started":
        state.recentCommands.push({ command: ev.command, at: ev.timestamp });
        if (state.recentCommands.length > cmdLimit) state.recentCommands.shift();
        if (isDiffViewingCommand(ev.command)) state.viewedGitDiff = true;
        break;

      case "terminal.command.completed": {
        // Attach completion to the most recent matching started command.
        for (let i = state.recentCommands.length - 1; i >= 0; i--) {
          const rc = state.recentCommands[i];
          if (rc.command === ev.command && rc.exitCode === undefined) {
            rc.exitCode = ev.exitCode;
            rc.outputSummary = ev.outputSummary;
            break;
          }
        }
        if (ev.exitCode !== 0) {
          const key = ev.command.trim();
          failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
        }
        break;
      }

      case "file.changed":
        filesChanged.add(ev.path);
        state.changedSinceLastTestRun = true;
        lastFileChangeAt = ev.timestamp;
        break;

      case "file.viewed":
        if (!state.viewedFiles.includes(ev.path)) state.viewedFiles.push(ev.path);
        break;

      case "git.diff.viewed":
        state.viewedGitDiff = true;
        break;

      case "task.validated":
        // Latest result wins — a re-check after the learner fixes their work
        // overwrites the prior fail.
        state.taskValidations[ev.taskId] = { passed: ev.passed, reason: ev.reason, contentHash: ev.contentHash };
        break;

      case "tests.completed":
        state.testsRun += 1;
        state.latestTestResult = { passed: ev.passed, failed: ev.failed };
        state.changedSinceLastTestRun = false;
        break;

      case "checkpoint.evaluated":
        state.lastCheckpointEvaluation = {
          checkpointId: ev.checkpointId,
          passed: ev.passed,
          incomplete: ev.incomplete,
        };
        break;

      case "checkpoint.completed":
        if (!state.completedCheckpoints.includes(ev.checkpointId)) {
          state.completedCheckpoints.push(ev.checkpointId);
        }
        break;

      case "learner.question":
        state.learnerQuestions.push(ev.text);
        if (state.learnerQuestions.length > qLimit) state.learnerQuestions.shift();
        break;

      case "learner.goal.stated":
        state.statedGoal = ev.text;
        break;

      case "instructor.hint":
        state.hintsAlreadyGiven.push({ level: ev.level, strategy: ev.strategy });
        break;

      case "intervention.proposed":
        break; // recorded for audit; carries no reduced state

      case "agent.action":
        break; // the agent lane: rendered as a timeline, never learner state

      case "workspace.app.opened":
        if (!state.workspace.openedApps.includes(ev.appId)) state.workspace.openedApps.push(ev.appId);
        break;

      case "workspace.artifact.opened":
        if (!state.workspace.openedArtifacts.includes(ev.artifactId)) {
          state.workspace.openedArtifacts.push(ev.artifactId);
        }
        break;

      case "aichat.context.shared": {
        const ws = state.workspace;
        ws.aiContextShares += 1;
        ws.restrictedInLatestShare = [...ev.restrictedSpans];
        ws.requiredFactsInLatestShare = [...ev.requiredFacts];
        for (const id of ev.restrictedSpans) {
          if (!ws.restrictedEverShared.includes(id)) ws.restrictedEverShared.push(id);
        }
        break;
      }

      case "aichat.prompt.submitted":
        state.workspace.aiPrompts += 1;
        for (const id of ev.restrictedSpans) {
          if (!state.workspace.restrictedEverShared.includes(id)) state.workspace.restrictedEverShared.push(id);
        }
        break;

      case "aichat.response.generated":
        state.workspace.aiDraftsGenerated += 1;
        break;

      case "workspace.draft.inserted":
        state.workspace.draftInserted = true;
        state.workspace.latestDraft = { revision: 0, similarityToGenerated: 1 };
        break;

      case "workspace.draft.updated":
        state.workspace.draftRevisions += 1;
        state.workspace.latestDraft = { revision: ev.revision, similarityToGenerated: ev.similarityToGenerated };
        break;

      case "workspace.artifact.submitted":
        state.workspace.submitted = {
          artifactId: ev.artifactId,
          revision: ev.revision,
          similarityToGenerated: ev.similarityToGenerated,
          restrictedSpans: [...ev.restrictedSpans],
          forbiddenPhrases: [...ev.forbiddenPhrases],
          requiredFactsMissing: [...ev.requiredFactsMissing],
          acknowledgesInconvenience: ev.acknowledgesInconvenience,
          at: ev.timestamp,
        };
        break;
    }
  }

  state.filesChanged = [...filesChanged];
  state.repeatedFailures = [...failureCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count);

  const nowMs = opts.nowMs ?? Date.now();
  if (lastActivityAt !== undefined) {
    state.msSinceLastActivity = Math.max(0, nowMs - Date.parse(lastActivityAt));
  }
  if (lastFileChangeAt !== undefined) {
    state.msSinceLastFileChange = Math.max(0, nowMs - Date.parse(lastFileChangeAt));
  }
  return state;
}
