/**
 * ProfileReducer (kernel) — the learner profile is a CACHE of this pure,
 * versioned function over the append-only evidence stream. Every claim
 * carries evidence pointers and the rule that concluded it; confidence is
 * always computed, never model-stated; model-proposed hypotheses stay
 * quarantined until a deterministic rule corroborates them.
 */
import type { Curriculum } from "./curriculum.ts";
import { conceptById } from "./curriculum.ts";
import type { SessionDigest, StoredEvidence } from "./evidence.ts";

export const PROFILE_REDUCER_VERSION = "profile-reducer@1.0.0";

export interface SkillClaim {
  conceptId: string;
  status: "unknown" | "emerging" | "mastered" | "decayed";
  confidence: number;
  evidence: number[]; // evidence seq pointers
  ruleId: string;
  lastEvidenceAt?: string;
  decayDueAt?: string;
  explanation: string;
}

export interface HabitClaim {
  habitId: string;
  window: string;
  value: number;
  baseline: number | null; // the learner's OWN earlier value — never a cohort comparison
  evidence: number[];
}

export interface PreferenceClaim {
  key: string;
  value: string;
  source: "learner-asserted";
  assertedAt: string;
}

export interface StrategyEfficacyClaim {
  strategy: string;
  attempts: number;
  followedByProgressRate: number;
}

export interface HypothesisClaim {
  hypothesisId: string;
  claim: string;
  proposedBy: string;
  citations: number[];
  state: "quarantined" | "corroborated" | "expired" | "rejected";
  expiresAt: string;
  /** Enforced by the context assembler, not by prompt politeness. */
  visibleToInstructor: boolean;
}

export interface CalibrationClaim {
  samples: number;
  tendency: "overconfident" | "underconfident" | "calibrated";
}

export interface LearnerProfile {
  learnerId: string;
  reducerVersion: string;
  builtFromEvidenceSeq: number;
  builtAt: string;
  skills: SkillClaim[];
  habits: HabitClaim[];
  preferences: PreferenceClaim[];
  strategyEfficacy: StrategyEfficacyClaim[];
  hypotheses: HypothesisClaim[];
  calibration: CalibrationClaim | null;
  labsCompleted: number;
}

const HABIT_WINDOW = 10;

export function reduceProfile(
  learnerId: string,
  evidence: StoredEvidence[],
  curriculum: Curriculum,
  nowMs = Date.now(),
): LearnerProfile {
  const digests: Array<{ seq: number; d: SessionDigest }> = [];
  const conceptEvidence = new Map<string, Array<{ seq: number; labId: string; at: string }>>();
  const preferences = new Map<string, PreferenceClaim>();
  const hypotheses = new Map<string, HypothesisClaim>();
  const selfAssessments: Array<{ confidence: number; actualPassed: boolean }> = [];
  const freshStarts = new Map<string, string>(); // conceptId → after timestamp

  for (const ev of evidence) {
    switch (ev.type) {
      case "session.digest":
        digests.push({ seq: ev.seq, d: ev.digest });
        break;
      case "concept.evidence": {
        const list = conceptEvidence.get(ev.conceptId) ?? [];
        list.push({ seq: ev.seq, labId: ev.labId, at: ev.timestamp });
        conceptEvidence.set(ev.conceptId, list);
        break;
      }
      case "learner.assertion":
        if (ev.kind === "preference" && ev.key && ev.value) {
          preferences.set(ev.key, { key: ev.key, value: ev.value, source: "learner-asserted", assertedAt: ev.timestamp });
        } else if (ev.kind === "suppression" && ev.target) {
          const h = hypotheses.get(ev.target);
          if (h) { h.state = "rejected"; h.visibleToInstructor = false; }
        } else if (ev.kind === "self-assessment" && typeof ev.confidence === "number") {
          selfAssessments.push({ confidence: ev.confidence, actualPassed: ev.actualPassed === true });
        } else if (ev.kind === "fresh-start" && ev.conceptId) {
          freshStarts.set(ev.conceptId, ev.timestamp);
        }
        break;
      case "hypothesis.proposed":
        hypotheses.set(ev.hypothesisId, {
          hypothesisId: ev.hypothesisId,
          claim: ev.claim,
          proposedBy: ev.proposedBy,
          citations: ev.citations,
          state: "quarantined",
          expiresAt: ev.expiresAt,
          visibleToInstructor: false,
        });
        break;
      case "hypothesis.corroborated": {
        const h = hypotheses.get(ev.hypothesisId);
        if (h && h.state === "quarantined") { h.state = "corroborated"; h.visibleToInstructor = true; }
        break;
      }
      case "hypothesis.expired":
      case "hypothesis.rejected": {
        const h = hypotheses.get(ev.hypothesisId);
        if (h) { h.state = ev.type === "hypothesis.expired" ? "expired" : "rejected"; h.visibleToInstructor = false; }
        break;
      }
    }
  }

  // TTL: uncorroborated hypotheses die on their own.
  for (const h of hypotheses.values()) {
    if (h.state === "quarantined" && Date.parse(h.expiresAt) <= nowMs) h.state = "expired";
  }

  // ── Skills: evidence rules + computed confidence + decay ──
  const skills: SkillClaim[] = curriculum.concepts.map((concept) => {
    const cutoff = freshStarts.get(concept.id);
    const all = (conceptEvidence.get(concept.id) ?? []).filter((e) => !cutoff || e.at > cutoff);
    // The window constrains evidence SPREAD (relative to the latest
    // evidence); recency-from-now is decay's job, not the mastery rule's.
    const last = all.at(-1);
    const windowStart = last ? Date.parse(last.at) - concept.masteryRule.windowDays * 86_400_000 : 0;
    const inWindow = all.filter((e) => Date.parse(e.at) >= windowStart);
    const distinctLabs = new Set(inWindow.map((e) => e.labId)).size;
    const count = inWindow.length;

    let status: SkillClaim["status"] = "unknown";
    if (count >= concept.masteryRule.minCount && distinctLabs >= concept.masteryRule.minDistinctLabs) status = "mastered";
    else if (count >= 1) status = "emerging";

    let decayDueAt: string | undefined;
    if (status === "mastered" && last) {
      const due = Date.parse(last.at) + concept.defaultHalfLifeDays * 86_400_000;
      decayDueAt = new Date(due).toISOString();
      if (nowMs > due) status = "decayed";
    }

    // COMPUTED confidence: base + evidence count + lab diversity, dampened
    // by recency past the half-life. Never model-stated.
    const recency = last
      ? Math.min(1, Math.max(0.3, 1 - (nowMs - Date.parse(last.at)) / (2 * concept.defaultHalfLifeDays * 86_400_000)))
      : 0;
    const confidence =
      status === "unknown" ? 0 : Math.min(0.95, (0.3 + 0.2 * Math.min(count, 3) + 0.1 * (distinctLabs - 1)) * recency);

    const dates = inWindow.map((e) => e.at.slice(0, 10)).join(", ");
    const explanation =
      status === "unknown"
        ? "No evidence observed yet."
        : concept.explanationTemplate.replace("{n}", String(count)).replace("{dates}", dates) +
          (status === "decayed" ? " (last evidence is past this concept's half-life — due for a refresher)" : "");

    return {
      conceptId: concept.id,
      status,
      confidence: Math.round(confidence * 100) / 100,
      evidence: inWindow.map((e) => e.seq),
      ruleId: `rule.${concept.id}.v1`,
      lastEvidenceAt: last?.at,
      decayDueAt,
      explanation,
    };
  });

  // ── Habits: rates over the learner's recent digests vs their own earlier baseline ──
  const recent = digests.slice(-HABIT_WINDOW);
  const earlier = digests.slice(0, Math.max(0, digests.length - HABIT_WINDOW));
  const rate = (list: typeof digests, f: (d: SessionDigest) => boolean) =>
    list.length === 0 ? null : Math.round((list.filter((x) => f(x.d)).length / list.length) * 100) / 100;
  const habits: HabitClaim[] = [];
  const mkHabit = (habitId: string, f: (d: SessionDigest) => boolean) => {
    const value = rate(recent, f);
    if (value === null) return;
    habits.push({
      habitId,
      window: `last-${recent.length}-labs`,
      value,
      baseline: rate(earlier, f),
      evidence: recent.map((x) => x.seq),
    });
  };
  mkHabit("diff-first-rate", (d) => d.diffViewedBeforeFirstEdit);
  mkHabit("tests-before-done-rate", (d) => d.testsRun > 0);
  mkHabit("recovery-after-failure-rate", (d) => !d.recoveredAfterFailure === false);

  // ── Strategy efficacy: measured, per learner ──
  const byStrategy = new Map<string, { attempts: number; progressed: number }>();
  for (const { d } of digests) {
    for (const h of d.hintOutcomes) {
      const s = byStrategy.get(h.strategy) ?? { attempts: 0, progressed: 0 };
      s.attempts += 1;
      if (h.followedByProgress) s.progressed += 1;
      byStrategy.set(h.strategy, s);
    }
  }
  const strategyEfficacy: StrategyEfficacyClaim[] = [...byStrategy.entries()].map(([strategy, s]) => ({
    strategy,
    attempts: s.attempts,
    followedByProgressRate: Math.round((s.progressed / s.attempts) * 100) / 100,
  }));

  // ── Calibration from self-assessments (confidence 1–5 vs actual outcome) ──
  let calibration: CalibrationClaim | null = null;
  if (selfAssessments.length > 0) {
    const gap =
      selfAssessments.reduce((sum, s) => sum + (s.confidence / 5 - (s.actualPassed ? 1 : 0)), 0) / selfAssessments.length;
    calibration = {
      samples: selfAssessments.length,
      tendency: gap > 0.2 ? "overconfident" : gap < -0.2 ? "underconfident" : "calibrated",
    };
  }

  return {
    learnerId,
    reducerVersion: PROFILE_REDUCER_VERSION,
    builtFromEvidenceSeq: evidence.at(-1)?.seq ?? 0,
    builtAt: new Date(nowMs).toISOString(),
    skills,
    habits,
    preferences: [...preferences.values()],
    strategyEfficacy,
    hypotheses: [...hypotheses.values()],
    calibration,
    labsCompleted: digests.filter((x) => x.d.checkpointCompleted).length,
  };
}
