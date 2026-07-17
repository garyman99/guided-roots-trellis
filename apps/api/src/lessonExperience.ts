/**
 * Per-lesson experience metrics — the deterministic half of the improvement
 * loop (plan: lesson experience analysis → improvement → versioning, Phase A).
 *
 * Every lab session already records a complete event log (commands + exit
 * codes, task validations with reasons, checkpoint attempts with the blocking
 * requirement ids, interventions, the learner's own questions). This module is
 * the first per-LESSON reader of that trove: it folds each session's log into
 * a SessionExperience, scores its friction, and aggregates across all sessions
 * of a lesson FAMILY (all versions; see familyOf) into a LessonExperience.
 *
 * Facts only — no model calls here. The AI experience-analyst (Phase B) reads
 * these aggregates plus the most-frictional transcripts and writes the
 * structured improvement report; this module's numbers are also the operator's
 * dashboard on their own.
 */
import type { EventStore, SessionMeta } from "./store.ts";
import type { SessionDigest } from "../../../packages/learner-model/src/evidence.ts";
import { familyOf, versionOf } from "../../../packages/shared/src/ids.ts";

/** A gap between consecutive events longer than this counts as a stall. */
const STALL_MS = 3 * 60 * 1000;
/** Bounds so responses (and analyst prompts) stay small. */
const MAX_QUOTES = 12;
const MAX_REASONS = 8;
const MAX_SESSION_SUMMARIES = 50;

export interface SessionExperience {
  sessionId: string;
  labId: string; // the exact version the learner ran
  version: number;
  learnerId: string;
  startedAt: string;
  lastEventAt: string;
  durationMs: number;
  completed: boolean; // checkpoint.completed observed
  abandoned: boolean; // "Start over" — the attempt explicitly ended unfinished
  open: boolean;
  events: number;
  commands: number;
  commandFailures: number; // non-zero exit codes
  /** Runs of ≥3 consecutive failing commands — a learner beating their head. */
  failureBursts: number;
  hints: number;
  maxHintLevel: number;
  /** Delivered interventions by trigger type (repeated_failure, inactivity…). */
  interventions: Record<string, number>;
  /** task.validated failures: the learner-facing reasons (bounded). */
  taskFailReasons: string[];
  checkpointFailures: number;
  /** checkpoint.evaluated → which requirement ids blocked, with counts. */
  blockingRequirements: Record<string, number>;
  /** The learner's own words (bounded), with their stuck flag. */
  questions: Array<{ text: string; stuck: boolean }>;
  stalls: number; // inter-event gaps > STALL_MS
  longestGapMs: number;
  /** Deterministic friction score — see frictionScore(). Higher = worse. */
  friction: number;
}

export interface LessonVersionExperience {
  labId: string;
  version: number;
  sessions: number;
  completed: number;
  abandoned: number;
  open: number;
  completionRate: number; // completed / sessions
  abandonmentRate: number;
  medianDurationMs: number | null;
  hintsPerSession: number;
  commandFailureRate: number; // failures / commands (0 when no commands)
  stallsPerSession: number;
  topBlockingRequirements: Array<{ id: string; count: number }>;
  topInterventionTriggers: Array<{ trigger: string; count: number }>;
  topTaskFailReasons: string[];
  /** From completion digests where present: did hints lead to progress? */
  hintFollowedByProgressRate: number | null;
  quotes: Array<{ sessionId: string; text: string; stuck: boolean }>;
}

export interface LessonExperience {
  family: string;
  /** The version the caller asked about (versionOf the requested labId). */
  requestedVersion: number;
  totalSessions: number;
  /** Per-version aggregates, newest version first. */
  versions: LessonVersionExperience[];
  /** Per-session summaries for the REQUESTED version, newest first (bounded). */
  sessions: SessionExperience[];
}

/**
 * Deterministic friction score for one session. Weights are heuristic but
 * FIXED, so scores are comparable across sessions and stable over time (the
 * analyst's transcript sampling depends on that). Higher = more friction.
 */
export function frictionScore(s: Omit<SessionExperience, "friction">): number {
  const stuckQuestions = s.questions.filter((q) => q.stuck).length;
  const interventionCount = Object.values(s.interventions).reduce((a, b) => a + b, 0);
  return (
    s.hints * 2 +
    s.maxHintLevel +
    s.commandFailures +
    s.failureBursts * 3 +
    s.checkpointFailures * 2 +
    stuckQuestions * 3 +
    interventionCount * 2 +
    s.stalls +
    (s.abandoned ? 10 : 0)
  );
}

/** Fold one session's event log into its experience summary. */
export function sessionExperience(store: EventStore, meta: SessionMeta): SessionExperience {
  const events = store.eventsFor(meta.sessionId);
  const s: Omit<SessionExperience, "friction"> = {
    sessionId: meta.sessionId,
    labId: meta.labId,
    version: versionOf(meta.labId),
    learnerId: meta.learnerId,
    startedAt: meta.createdAt,
    lastEventAt: events.at(-1)?.timestamp ?? meta.createdAt,
    durationMs: 0,
    completed: false,
    abandoned: meta.status === "abandoned",
    open: meta.status === "open",
    events: events.length,
    commands: 0,
    commandFailures: 0,
    failureBursts: 0,
    hints: 0,
    maxHintLevel: 0,
    interventions: {},
    taskFailReasons: [],
    checkpointFailures: 0,
    blockingRequirements: {},
    questions: [],
    stalls: 0,
    longestGapMs: 0,
  };

  let consecutiveFailures = 0;
  let prevTs: number | null = null;
  for (const e of events) {
    const ts = Date.parse(e.timestamp);
    if (prevTs !== null && Number.isFinite(ts) && Number.isFinite(prevTs)) {
      const gap = ts - prevTs;
      if (gap > s.longestGapMs) s.longestGapMs = gap;
      if (gap > STALL_MS) s.stalls++;
    }
    if (Number.isFinite(ts)) prevTs = ts;

    switch (e.type) {
      case "terminal.command.completed": {
        s.commands++;
        if (e.exitCode !== 0) {
          s.commandFailures++;
          consecutiveFailures++;
          if (consecutiveFailures === 3) s.failureBursts++; // count each run once, at its 3rd failure
        } else {
          consecutiveFailures = 0;
        }
        break;
      }
      case "instructor.hint": {
        s.hints++;
        if (e.level > s.maxHintLevel) s.maxHintLevel = e.level;
        break;
      }
      case "intervention.delivered": {
        s.interventions[e.triggerType] = (s.interventions[e.triggerType] ?? 0) + 1;
        break;
      }
      case "task.validated": {
        if (!e.passed && e.reason && s.taskFailReasons.length < MAX_REASONS) s.taskFailReasons.push(e.reason);
        break;
      }
      case "checkpoint.evaluated": {
        if (!e.passed) {
          s.checkpointFailures++;
          for (const id of e.incomplete) s.blockingRequirements[id] = (s.blockingRequirements[id] ?? 0) + 1;
        }
        break;
      }
      case "checkpoint.completed": {
        s.completed = true;
        break;
      }
      case "learner.question": {
        if (s.questions.length < MAX_QUOTES) s.questions.push({ text: e.text, stuck: e.stuck });
        break;
      }
      default:
        break;
    }
  }
  s.durationMs = Math.max(0, Date.parse(s.lastEventAt) - Date.parse(s.startedAt)) || 0;
  return { ...s, friction: frictionScore(s) };
}

/**
 * Aggregate the whole FAMILY (all versions) of a lesson. `labId` may be any
 * version; per-session summaries are returned for that version specifically.
 */
export function lessonExperience(store: EventStore, labId: string): LessonExperience {
  const family = familyOf(labId);
  const metas = store.listSessions().filter((m) => familyOf(m.labId) === family);
  const all = metas.map((m) => sessionExperience(store, m));

  // Completion digests carry hint-outcome signal the raw log lacks. Digests are
  // keyed by learner, so scan just the learners who ran this family.
  const digests = new Map<string, SessionDigest>(); // sessionId → digest
  for (const learnerId of new Set(metas.map((m) => m.learnerId))) {
    for (const ev of store.evidenceFor(learnerId)) {
      if (ev.type === "session.digest" && familyOf(ev.digest.labId) === family) {
        digests.set(ev.digest.sessionId, ev.digest);
      }
    }
  }

  const byVersion = new Map<number, SessionExperience[]>();
  for (const s of all) {
    const list = byVersion.get(s.version) ?? [];
    list.push(s);
    byVersion.set(s.version, list);
  }

  const versions: LessonVersionExperience[] = [...byVersion.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, sessions]) => aggregateVersion(family, version, sessions, digests));

  const requestedVersion = versionOf(labId);
  const requested = (byVersion.get(requestedVersion) ?? [])
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_SESSION_SUMMARIES);

  return { family, requestedVersion, totalSessions: all.length, versions, sessions: requested };
}

function aggregateVersion(
  family: string,
  version: number,
  sessions: SessionExperience[],
  digests: Map<string, SessionDigest>,
): LessonVersionExperience {
  const n = sessions.length;
  const completed = sessions.filter((s) => s.completed).length;
  const abandoned = sessions.filter((s) => s.abandoned).length;
  const open = sessions.filter((s) => s.open && !s.completed).length;
  const durations = sessions.filter((s) => s.completed).map((s) => s.durationMs).sort((a, b) => a - b);
  const commands = sum(sessions, (s) => s.commands);
  const failures = sum(sessions, (s) => s.commandFailures);

  const blocking = tally(sessions.flatMap((s) => Object.entries(s.blockingRequirements)));
  const triggers = tally(sessions.flatMap((s) => Object.entries(s.interventions)));

  // Hint efficacy from digests (completed sessions only — the digest is written
  // at checkpoint completion).
  let hintOutcomes = 0;
  let hintProgress = 0;
  for (const s of sessions) {
    const d = digests.get(s.sessionId);
    if (!d) continue;
    hintOutcomes += d.hintOutcomes.length;
    hintProgress += d.hintOutcomes.filter((h) => h.followedByProgress).length;
  }

  const quotes = sessions
    .flatMap((s) => s.questions.map((q) => ({ sessionId: s.sessionId, ...q })))
    .slice(-MAX_QUOTES);

  return {
    labId: version <= 1 ? family : `${family}-v${version}`,
    version,
    sessions: n,
    completed,
    abandoned,
    open,
    completionRate: n ? completed / n : 0,
    abandonmentRate: n ? abandoned / n : 0,
    medianDurationMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
    hintsPerSession: n ? sum(sessions, (s) => s.hints) / n : 0,
    commandFailureRate: commands ? failures / commands : 0,
    stallsPerSession: n ? sum(sessions, (s) => s.stalls) / n : 0,
    topBlockingRequirements: blocking.slice(0, 5).map(([id, count]) => ({ id, count })),
    topInterventionTriggers: triggers.slice(0, 5).map(([trigger, count]) => ({ trigger, count })),
    topTaskFailReasons: [...new Set(sessions.flatMap((s) => s.taskFailReasons))].slice(0, MAX_REASONS),
    hintFollowedByProgressRate: hintOutcomes ? hintProgress / hintOutcomes : null,
    quotes,
  };
}

/**
 * A bounded, human/model-readable transcript of one session: the dialogue plus
 * the load-bearing facts (failed commands, checkpoint outcomes, abandonment).
 * Feeds the experience analyst; deterministic, newest-truncated at capChars.
 */
export function sessionTranscript(store: EventStore, sessionId: string, capChars = 8000): string {
  const lines: string[] = [];
  for (const e of store.eventsFor(sessionId)) {
    switch (e.type) {
      case "learner.goal.stated": lines.push(`LEARNER (goal): ${e.text}`); break;
      case "learner.question": lines.push(`LEARNER${e.stuck ? " (stuck)" : ""}: ${e.text}`); break;
      case "instructor.greeting": if (e.text) lines.push(`GUIDE (greeting): ${e.text}`); break;
      case "instructor.hint": if (e.text) lines.push(`GUIDE (hint L${e.level}): ${e.text}`); break;
      case "instructor.progress": if (e.text) lines.push(`GUIDE (progress): ${e.text}`); break;
      case "intervention.delivered": lines.push(`GUIDE (intervention ${e.triggerType}): ${e.text}`); break;
      case "terminal.command.completed":
        if (e.exitCode !== 0) lines.push(`TERMINAL: \`${e.command}\` failed (exit ${e.exitCode}) ${e.outputSummary}`.trim());
        break;
      case "task.validated": if (!e.passed) lines.push(`TASK CHECK failed: ${e.reason}`); break;
      case "checkpoint.evaluated": if (!e.passed) lines.push(`CHECKPOINT failed — incomplete: ${e.incomplete.join(", ")}`); break;
      case "checkpoint.completed": lines.push(`CHECKPOINT completed.`); break;
      case "session.abandoned": lines.push(`SESSION ABANDONED (learner started over).`); break;
      default: break;
    }
  }
  const text = lines.join("\n");
  return text.length <= capChars ? text : `…(truncated)\n${text.slice(-capChars)}`;
}

/**
 * The transcript sample for analysis (D7): the most frictional sessions plus
 * the most recent ones, deduped, from an already-filtered summary list.
 */
export function sampleForAnalysis(sessions: SessionExperience[], topFriction = 5, recent = 5): SessionExperience[] {
  const byFriction = [...sessions].sort((a, b) => b.friction - a.friction).slice(0, topFriction);
  const byRecency = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, recent);
  const seen = new Set<string>();
  return [...byFriction, ...byRecency].filter((s) => (seen.has(s.sessionId) ? false : (seen.add(s.sessionId), true)));
}

function sum<T>(items: T[], f: (t: T) => number): number {
  return items.reduce((acc, t) => acc + f(t), 0);
}

/** Sum entry counts by key, sorted descending. */
function tally(entries: Array<[string, number]>): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const [k, v] of entries) m.set(k, (m.get(k) ?? 0) + v);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
