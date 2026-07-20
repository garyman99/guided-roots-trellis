/**
 * The three review stages (plan review workflow): technical, pedagogy, cohesion.
 * A lesson is only shipped when all three pass. Pedagogy is SCORED 1–5 per
 * rubric category; any category below the revision threshold (4) fails the
 * lesson unless the reviewer supplies an explicit justification — the strategy
 * doc's "below 4 requires revision or an explicit justification" made real.
 */
import { ValidationError } from "./schemas.ts";
import type { CritiqueVerdict } from "./critique.ts";

/** Pedagogy rubric — kept to the load-bearing few for this slice. */
export const PEDAGOGY_CATEGORIES = ["priorKnowledge", "mentalModel", "activeLearning", "feedback", "mastery"] as const;
export type PedagogyCategory = (typeof PEDAGOGY_CATEGORIES)[number];

/** Any score below this fails the lesson unless justified. */
export const REVISION_THRESHOLD = 4;

export type Verdict = "approved" | "revise";

export interface TechnicalReview {
  verdict: Verdict;
  issues?: string[];
}
export interface CohesionReview {
  verdict: Verdict;
  issues?: string[];
}
export interface PedagogyReview {
  scores: Record<PedagogyCategory, number>;
  verdict: Verdict;
  /** Per-category rationale; a justified low score does NOT fail the lesson. */
  justifications?: Partial<Record<PedagogyCategory, string>>;
}

function validateVerdictDoc(doc: unknown, label: string): { verdict: Verdict; issues?: string[] } {
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.verdict !== "approved" && d.verdict !== "revise") throw new ValidationError([`${label}.verdict must be "approved" or "revise"`]);
  return { verdict: d.verdict, ...(Array.isArray(d.issues) ? { issues: d.issues.map(String) } : {}) };
}

export function validateTechnicalReview(doc: unknown): TechnicalReview {
  return validateVerdictDoc(doc, "technical-review");
}
export function validateCohesionReview(doc: unknown): CohesionReview {
  return validateVerdictDoc(doc, "cohesion-review");
}

export function validatePedagogyReview(doc: unknown): PedagogyReview {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  const rawScores = (d.scores ?? {}) as Record<string, unknown>;
  const scores = {} as Record<PedagogyCategory, number>;
  for (const cat of PEDAGOGY_CATEGORIES) {
    const v = rawScores[cat];
    if (typeof v !== "number" || v < 1 || v > 5 || !Number.isFinite(v)) e.push(`pedagogy-review.scores.${cat} must be a number 1–5`);
    else scores[cat] = v;
  }
  if (d.verdict !== "approved" && d.verdict !== "revise") e.push(`pedagogy-review.verdict must be "approved" or "revise"`);
  if (e.length) throw new ValidationError(e);
  return {
    scores,
    verdict: d.verdict as Verdict,
    ...(d.justifications && typeof d.justifications === "object" ? { justifications: d.justifications as PedagogyReview["justifications"] } : {}),
  };
}

export interface ReviewOutcome {
  lessonId: string;
  passed: boolean;
  technical: TechnicalReview;
  pedagogy: PedagogyReview;
  cohesion: CohesionReview;
  /** The learner-advocate's persona-fit + goal-fit verdict (Phase 2), when run. */
  advocate?: CritiqueVerdict;
  /** Pedagogy categories below threshold WITHOUT a justification. */
  failingCategories: PedagogyCategory[];
  /** Human-readable reasons the lesson didn't pass (empty when it passed). */
  blockers: string[];
  /** Advocate reservations: fed to the author as feedback, recorded for the
   *  gate, never blocking (absent only on pre-advisory outcomes). */
  advisory?: string[];
}

/**
 * Decide whether a lesson's reviews clear the bar.
 *
 * The learner-advocate is ADVISORY here, not blocking (field finding,
 * 2026-07-19: as a blocking 4th reviewer against a strict persona it condemned
 * 7/7 lessons that scored 5/5 on pedagogy with approving technical/cohesion
 * reviews — an adversarial critic never says "done"). Its issues ride
 * `advisory` — fed back to the author on a failing round and recorded as
 * reservations for the human/auto gate — while pass/fail stays with the
 * verdict-giving reviewers.
 */
export function evaluateReviews(
  lessonId: string,
  technical: TechnicalReview,
  pedagogy: PedagogyReview,
  cohesion: CohesionReview,
  advocate?: CritiqueVerdict,
): ReviewOutcome {
  const failingCategories = PEDAGOGY_CATEGORIES.filter(
    (cat) => pedagogy.scores[cat] < REVISION_THRESHOLD && !(pedagogy.justifications?.[cat]?.trim()),
  );
  const blockers: string[] = [];
  if (technical.verdict === "revise") blockers.push(`technical: ${technical.issues?.join("; ") || "revise"}`);
  if (cohesion.verdict === "revise") blockers.push(`cohesion: ${cohesion.issues?.join("; ") || "revise"}`);
  for (const cat of failingCategories) blockers.push(`pedagogy.${cat}=${pedagogy.scores[cat]} (< ${REVISION_THRESHOLD}, unjustified)`);
  const advisory: string[] = [];
  if (advocate && !advocate.satisfied) {
    for (const i of advocate.personaFit.issues) advisory.push(`persona-fit: ${i}`);
    for (const i of advocate.goalFit.issues) advisory.push(`goal-fit: ${i}`);
    for (const c of advocate.requiredChanges) advisory.push(`learner-advocate: ${c}`);
    if (advisory.length === 0) advisory.push("learner-advocate: unsatisfied");
  }
  return { lessonId, passed: blockers.length === 0, technical, pedagogy, cohesion, ...(advocate ? { advocate } : {}), failingCategories, blockers, advisory };
}
