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
  const demonstrated: string[] = [];
  if (digest.diffViewedBeforeFirstEdit) demonstrated.push("Reviewed the agent's diff before making any edit.");
  if (digest.recoveredAfterFailure) demonstrated.push(`Took a failing test suite to green (${digest.testsRun} run${digest.testsRun === 1 ? "" : "s"}).`);
  if (digest.checkpointCompleted) demonstrated.push("Completed the checkpoint with a surgical fix that kept the requested feature.");

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
  if (!digest.diffViewedBeforeFirstEdit) habitsToImprove.push("Edits began before the diff was reviewed — inspect first next time.");
  if (digest.hintsRequested === 0 && digest.checkpointCompleted) habitsPositive.push("Worked through independently, without hints.");

  const revisitLater = after.skills.filter((s) => s.status === "decayed").map((s) => s.conceptId);

  return { sessionId: digest.sessionId, labId: digest.labId, demonstrated, improved, habitsPositive, habitsToImprove, revisitLater, profileChanges };
}
