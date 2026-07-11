/**
 * Hypothesis pipeline (kernel): models may PROPOSE, deterministic rules
 * decide. Claims are an ENUM — free text can never become profile truth by
 * schema, which is what makes prompt-injection into the profile inert.
 */
import { randomUUID } from "node:crypto";
import type { EvidenceEvent, SessionDigest, StoredEvidence } from "./evidence.ts";

export const HYPOTHESIS_CLAIMS = ["edits-before-inspecting", "skips-test-runs", "hint-dependent"] as const;
export type HypothesisClaimId = (typeof HYPOTHESIS_CLAIMS)[number];

const DEFAULT_TTL_DAYS = 60;

/** Validate + build a proposal event. Throws on non-enum claims or missing citations. */
export function proposeHypothesis(
  claim: string,
  proposedBy: string,
  citations: number[],
  nowMs = Date.now(),
): EvidenceEvent {
  if (!(HYPOTHESIS_CLAIMS as readonly string[]).includes(claim)) {
    throw new Error(`hypothesis claim must be one of the registered enum values, got: ${JSON.stringify(claim).slice(0, 80)}`);
  }
  if (!Array.isArray(citations) || citations.length === 0 || !citations.every((c) => Number.isInteger(c))) {
    throw new Error("hypothesis proposals require integer evidence citations");
  }
  return {
    type: "hypothesis.proposed",
    hypothesisId: randomUUID(),
    claim,
    proposedBy,
    citations,
    expiresAt: new Date(nowMs + DEFAULT_TTL_DAYS * 86_400_000).toISOString(),
    timestamp: new Date(nowMs).toISOString(),
  };
}

/** Deterministic corroboration rules: claim → does the measured record support it? */
const CORROBORATION_RULES: Record<HypothesisClaimId, { ruleId: string; check: (digests: SessionDigest[]) => boolean }> = {
  "edits-before-inspecting": {
    ruleId: "rule.hyp.edits-before-inspecting.v1",
    check: (d) => d.filter((x) => !x.diffViewedBeforeFirstEdit).length >= 3,
  },
  "skips-test-runs": {
    ruleId: "rule.hyp.skips-test-runs.v1",
    check: (d) => d.filter((x) => x.testsRun === 0).length >= 3,
  },
  "hint-dependent": {
    ruleId: "rule.hyp.hint-dependent.v1",
    check: (d) => d.length >= 3 && d.every((x) => x.hintsRequested >= 2),
  },
};

/**
 * Run corroboration over quarantined proposals. Returns lifecycle events to
 * append (corroborated / expired). Only measured digests are consulted —
 * never the proposal's own text.
 */
export function corroborateHypotheses(evidence: StoredEvidence[], nowMs = Date.now()): EvidenceEvent[] {
  const digests = evidence.filter((e) => e.type === "session.digest").map((e) => e.digest);
  const resolved = new Set(
    evidence
      .filter((e) => e.type === "hypothesis.corroborated" || e.type === "hypothesis.expired" || e.type === "hypothesis.rejected")
      .map((e) => e.hypothesisId),
  );
  const out: EvidenceEvent[] = [];
  for (const ev of evidence) {
    if (ev.type !== "hypothesis.proposed" || resolved.has(ev.hypothesisId)) continue;
    const rule = CORROBORATION_RULES[ev.claim as HypothesisClaimId];
    const at = new Date(nowMs).toISOString();
    if (rule && rule.check(digests)) {
      out.push({ type: "hypothesis.corroborated", hypothesisId: ev.hypothesisId, ruleId: rule.ruleId, timestamp: at });
    } else if (Date.parse(ev.expiresAt) <= nowMs) {
      out.push({ type: "hypothesis.expired", hypothesisId: ev.hypothesisId, timestamp: at });
    }
  }
  return out;
}
