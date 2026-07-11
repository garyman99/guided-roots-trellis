/**
 * Reflection engine, deterministic half: digest + profile delta → structured
 * reflection. The narrative a learner reads is rendered FROM this (userland,
 * regenerable); this struct is what history keeps.
 */
import type { SessionDigest } from "./evidence.ts";
import type { LearnerProfile } from "./profileReducer.ts";

export interface Reflection {
  sessionId: string;
  labId: string;
  demonstrated: string[];
  improved: string[];
  habitsPositive: string[];
  habitsToImprove: string[];
  revisitLater: string[];
  profileChanges: string[];
}

export function buildReflection(digest: SessionDigest, before: LearnerProfile, after: LearnerProfile): Reflection {
  const ws = digest.workspace;
  const demonstrated: string[] = [];
  // Every line here must be TRUE for the session it describes: terminal-lab
  // phrasing never reaches a workspace session and vice versa (a live
  // simulated learner caught "surgical fix… requested feature" + diff advice
  // in an email lesson — scenario finding, iter 3).
  if (digest.diffViewedBeforeFirstEdit) demonstrated.push("Reviewed the agent's diff before making any edit.");
  if (digest.recoveredAfterFailure) demonstrated.push(`Took a failing test suite to green (${digest.testsRun} run${digest.testsRun === 1 ? "" : "s"}).`);
  if (ws) {
    if (ws.contextShares > 0 && ws.restrictedShares === 0) {
      demonstrated.push("Shared only the facts the AI helper needed — nothing personal went along.");
    }
    if (ws.recoveredFromRestrictedShare) {
      demonstrated.push("Caught that the AI helper was given more than it needed, and re-shared just the useful facts.");
    }
    if (ws.submitted && (ws.submittedSimilarity === null || ws.draftEdits > 0)) {
      demonstrated.push(
        ws.submittedSimilarity === null
          ? "Wrote the final result in your own words."
          : "Reviewed and reshaped the AI draft before using it — the words that went out were yours.",
      );
    }
    if (digest.checkpointCompleted) demonstrated.push("Completed the task, and the platform verified every requirement.");
  } else if (digest.checkpointCompleted) {
    demonstrated.push("Completed the checkpoint with a surgical fix that kept the requested feature.");
  }

  const statusBefore = new Map(before.skills.map((s) => [s.conceptId, s.status]));
  const improved: string[] = [];
  const profileChanges: string[] = [];
  for (const s of after.skills) {
    const prev = statusBefore.get(s.conceptId) ?? "unknown";
    if (prev !== s.status && (s.status === "mastered" || s.status === "emerging")) {
      improved.push(`${s.conceptId}: ${prev} → ${s.status}`);
      profileChanges.push(`${s.conceptId} is now "${s.status}" — ${s.explanation}`);
    }
  }

  const habitsPositive: string[] = [];
  const habitsToImprove: string[] = [];
  if (digest.testsRun > 0) habitsPositive.push("Verified with the test suite instead of assuming.");
  if (!ws && !digest.diffViewedBeforeFirstEdit) {
    habitsToImprove.push("Edits began before the diff was reviewed — inspect first next time.");
  }
  if (ws) {
    if (ws.submitted && ws.submittedSimilarity !== null && ws.draftEdits > 0) {
      habitsPositive.push("Treated AI output as a starting point, not a finished answer.");
    }
    if (ws.restrictedShares > 0) {
      habitsToImprove.push(
        "The first thing shared with the AI helper included more than it needed — deciding what a tool needs before sharing is the habit to build.",
      );
    }
    if (ws.submitted && ws.submittedSimilarity !== null && ws.draftEdits === 0) {
      habitsToImprove.push("The AI draft went out nearly unchanged — read it like a skeptic and reshape it next time.");
    }
  }
  // "Independently" must count ALL help received, proactive check-ins included.
  if (digest.hintsRequested === 0 && digest.interventions.length === 0 && digest.checkpointCompleted) {
    habitsPositive.push("Worked through independently, without hints.");
  }

  const revisitLater = after.skills.filter((s) => s.status === "decayed").map((s) => s.conceptId);

  return { sessionId: digest.sessionId, labId: digest.labId, demonstrated, improved, habitsPositive, habitsToImprove, revisitLater, profileChanges };
}
