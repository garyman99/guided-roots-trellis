/**
 * Evidence events + the Session Digest extractor (kernel).
 *
 * The digest is the ONLY path from a session into the learner's long-term
 * record, and it is pure arithmetic over the session event log — the same
 * discipline as the session reducer, one level up. LLM narratives are
 * rendered FROM digests and are never load-bearing (delete every narrative
 * and Trellis believes nothing different).
 */
import type { SessionEvent } from "../../session-events/src/events.ts";

export interface HintOutcome {
  strategy: string;
  level: number;
  /** Did measured progress (edit, improved tests, checkpoint) follow within the window? */
  followedByProgress: boolean;
}

export interface SessionDigest {
  sessionId: string;
  labId: string;
  variantId: string | null;
  learnerId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  checkpointCompleted: boolean;
  testsRun: number;
  firstTestRun?: { passed: number; failed: number };
  lastTestRun?: { passed: number; failed: number };
  /** Saw a failing suite and later reached green. */
  recoveredAfterFailure: boolean;
  hintsRequested: number;
  interventions: string[];
  diffViewedBeforeFirstEdit: boolean;
  filesChanged: string[];
  hintOutcomes: HintOutcome[];
  /** Concept observations, matched to the registry's `observation` keys. */
  conceptObservations: Array<{ observation: string }>;
}

export type EvidenceEvent =
  | { type: "session.digest"; digest: SessionDigest; timestamp: string }
  | { type: "concept.evidence"; conceptId: string; observation: string; labId: string; sessionId: string; timestamp: string }
  | {
      type: "learner.assertion";
      kind: "preference" | "suppression" | "self-assessment" | "fresh-start";
      key?: string;
      value?: string;
      target?: string;
      note?: string;
      confidence?: number;
      actualPassed?: boolean;
      conceptId?: string;
      timestamp: string;
    }
  | { type: "hypothesis.proposed"; hypothesisId: string; claim: string; proposedBy: string; citations: number[]; expiresAt: string; timestamp: string }
  | { type: "hypothesis.corroborated"; hypothesisId: string; ruleId: string; timestamp: string }
  | { type: "hypothesis.expired"; hypothesisId: string; timestamp: string }
  | { type: "hypothesis.rejected"; hypothesisId: string; by: "learner" | "rule"; timestamp: string };

export type StoredEvidence = EvidenceEvent & { seq: number };

const PROGRESS_WINDOW_MS = 10 * 60_000;

/**
 * Pure: session events (+ session metadata) → digest.
 * Ordering matters here (diff BEFORE first edit; progress AFTER a hint), so
 * this reads the raw log rather than the order-erased reduced state.
 */
export function extractDigest(
  events: SessionEvent[],
  meta: { sessionId: string; labId: string; learnerId: string },
): SessionDigest {
  let startedAt = "";
  let variantId: string | null = null;
  let firstEditAt: number | null = null;
  let firstDiffViewAt: number | null = null;
  let testsRun = 0;
  let firstTestRun: { passed: number; failed: number } | undefined;
  let lastTestRun: { passed: number; failed: number } | undefined;
  let sawFailure = false;
  let recoveredAfterFailure = false;
  let hintsRequested = 0;
  const interventions: string[] = [];
  const filesChanged = new Set<string>();
  let checkpointCompleted = false;
  const completedCheckpointIds = new Set<string>();
  let lastAt = "";

  interface PendingHint { strategy: string; level: number; atMs: number; progressed: boolean; }
  const hints: PendingHint[] = [];
  const progressAt = (ms: number) => {
    for (const h of hints) if (!h.progressed && ms - h.atMs <= PROGRESS_WINDOW_MS && ms >= h.atMs) h.progressed = true;
  };

  for (const ev of events) {
    lastAt = ev.timestamp;
    const ms = Date.parse(ev.timestamp);
    switch (ev.type) {
      case "session.started":
        startedAt = ev.timestamp;
        variantId = ev.variantId ?? null;
        break;
      case "git.diff.viewed":
        if (firstDiffViewAt === null) firstDiffViewAt = ms;
        break;
      case "file.changed":
        if (firstEditAt === null) firstEditAt = ms;
        filesChanged.add(ev.path);
        progressAt(ms);
        break;
      case "tests.completed": {
        testsRun += 1;
        const run = { passed: ev.passed, failed: ev.failed };
        if (!firstTestRun) firstTestRun = run;
        lastTestRun = run;
        if (ev.failed > 0) sawFailure = true;
        else if (sawFailure) recoveredAfterFailure = true;
        if (ev.failed === 0 || (lastTestRun && firstTestRun && ev.failed < firstTestRun.failed)) progressAt(ms);
        break;
      }
      case "learner.question":
        hintsRequested += 1;
        break;
      case "instructor.hint":
        hints.push({ strategy: ev.strategy, level: ev.level, atMs: ms, progressed: false });
        break;
      case "intervention.proposed":
        interventions.push(ev.triggerType);
        break;
      case "checkpoint.completed":
        checkpointCompleted = true;
        completedCheckpointIds.add(ev.checkpointId);
        progressAt(ms);
        break;
      default:
        break;
    }
  }

  const diffViewedBeforeFirstEdit =
    firstDiffViewAt !== null && (firstEditAt === null || firstDiffViewAt <= firstEditAt);

  const conceptObservations: Array<{ observation: string }> = [];
  if (diffViewedBeforeFirstEdit) conceptObservations.push({ observation: "diff-before-first-edit" });
  if (recoveredAfterFailure && (lastTestRun?.failed ?? 1) === 0) conceptObservations.push({ observation: "tests-pass-after-fail" });
  // One observation per completed checkpoint, keyed by the checkpoint's own id.
  // (Both POC labs use checkpoint id "inspect-fix-verify", so this generalization
  // is byte-identical for them; new labs get their own observation key for free.)
  for (const id of [...completedCheckpointIds].sort()) {
    conceptObservations.push({ observation: `checkpoint-${id}` });
  }

  return {
    sessionId: meta.sessionId,
    labId: meta.labId,
    variantId,
    learnerId: meta.learnerId,
    startedAt,
    completedAt: lastAt,
    durationMs: startedAt && lastAt ? Math.max(0, Date.parse(lastAt) - Date.parse(startedAt)) : 0,
    checkpointCompleted,
    testsRun,
    firstTestRun,
    lastTestRun,
    recoveredAfterFailure,
    hintsRequested,
    interventions,
    diffViewedBeforeFirstEdit,
    filesChanged: [...filesChanged],
    hintOutcomes: hints.map((h) => ({ strategy: h.strategy, level: h.level, followedByProgress: h.progressed })),
    conceptObservations,
  };
}

/** Digest → the evidence events to append (digest itself + per-concept evidence). */
export function digestToEvidence(
  digest: SessionDigest,
  concepts: Array<{ id: string; observation: string }>,
): EvidenceEvent[] {
  const at = digest.completedAt || new Date().toISOString();
  const out: EvidenceEvent[] = [{ type: "session.digest", digest, timestamp: at }];
  for (const obs of digest.conceptObservations) {
    for (const c of concepts.filter((c) => c.observation === obs.observation)) {
      out.push({
        type: "concept.evidence",
        conceptId: c.id,
        observation: obs.observation,
        labId: digest.labId,
        sessionId: digest.sessionId,
        timestamp: at,
      });
    }
  }
  return out;
}
