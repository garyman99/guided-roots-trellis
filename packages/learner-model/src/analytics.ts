/**
 * Analytics = read-side projections over the same digests everything else
 * uses. Analytics can never know anything the learner's export doesn't
 * contain — that property, not policy text, is the "not surveillance" claim.
 */
import type { SessionDigest } from "./evidence.ts";

export const K_ANONYMITY_THRESHOLD = 5;

export interface LearnerSummary {
  labs: number;
  completed: number;
  medianDurationMs: number | null;
  hintsPerLab: number;
  diffFirstRate: number;
  testUsageRate: number;
  recoveryRate: number;
}

export function learnerSummary(digests: SessionDigest[]): LearnerSummary {
  const n = digests.length;
  const durations = digests.map((d) => d.durationMs).sort((a, b) => a - b);
  const rate = (f: (d: SessionDigest) => boolean) => (n === 0 ? 0 : Math.round((digests.filter(f).length / n) * 100) / 100);
  return {
    labs: n,
    completed: digests.filter((d) => d.checkpointCompleted).length,
    medianDurationMs: n === 0 ? null : durations[Math.floor(n / 2)],
    hintsPerLab: n === 0 ? 0 : Math.round((digests.reduce((s, d) => s + d.hintsRequested, 0) / n) * 100) / 100,
    diffFirstRate: rate((d) => d.diffViewedBeforeFirstEdit),
    testUsageRate: rate((d) => d.testsRun > 0),
    recoveryRate: rate((d) => d.recoveredAfterFailure),
  };
}

export type CohortAggregate =
  | { suppressed: true; reason: string }
  | { suppressed: false; learners: number; avg: LearnerSummary };

/** Cohort view with k-suppression: a cohort of one is never a window into a person. */
export function cohortAggregate(perLearner: Map<string, SessionDigest[]>, k = K_ANONYMITY_THRESHOLD): CohortAggregate {
  if (perLearner.size < k) {
    return { suppressed: true, reason: `cohort below k-anonymity threshold (${perLearner.size} < ${k})` };
  }
  const summaries = [...perLearner.values()].map(learnerSummary);
  const avgOf = (f: (s: LearnerSummary) => number) =>
    Math.round((summaries.reduce((sum, s) => sum + f(s), 0) / summaries.length) * 100) / 100;
  return {
    suppressed: false,
    learners: perLearner.size,
    avg: {
      labs: avgOf((s) => s.labs),
      completed: avgOf((s) => s.completed),
      medianDurationMs: avgOf((s) => s.medianDurationMs ?? 0),
      hintsPerLab: avgOf((s) => s.hintsPerLab),
      diffFirstRate: avgOf((s) => s.diffFirstRate),
      testUsageRate: avgOf((s) => s.testUsageRate),
      recoveryRate: avgOf((s) => s.recoveryRate),
    },
  };
}
