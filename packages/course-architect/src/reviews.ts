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

/**
 * Blueprint-scoped pedagogy rubric (2026-07-22). NOT the lesson rubric reused —
 * `activeLearning` and `feedback` are meaningless for a plan, while the things
 * that decide a course's pedagogy are decided HERE and are unfixable later:
 * sequencing, what rests on what, how load is spread, whether the inventory
 * actually reaches the promised outcome.
 *
 * Before this, the only critic on the blueprint was the learner-advocate, and
 * per-lesson pedagogy could merely score how well a lesson executed a plan it
 * had no power to change — so a plan defect (lesson 5 needs lists; nothing
 * introduced lists) blocked LESSON 5 and burned re-author rounds on the wrong
 * artifact.
 */
export const BLUEPRINT_PEDAGOGY_CATEGORIES = [
  "progression",
  "prerequisiteIntegrity",
  "loadBalance",
  "outcomeCoverage",
  "levelCalibration",
] as const;
export type BlueprintPedagogyCategory = (typeof BLUEPRINT_PEDAGOGY_CATEGORIES)[number];

/** Any score below this fails the lesson unless justified. */
export const REVISION_THRESHOLD = 4;

export type Verdict = "approved" | "revise";

/**
 * Severity is what lets the verdict reviewers ever say "done" (field finding,
 * 2026-07-22). Before this, `TechnicalReview` was `{verdict, issues[]}` with no
 * severity, so ONE nitpick blocked a lesson — and a reviewer handed 400 fresh
 * lines every round always finds one. Two lessons in the Selenium run burned 6
 * and 3 rounds and still landed needs-revision on lists whose tail was
 * "Minor: this f-string has no placeholder". Same failure mode `evaluateReviews`
 * already fixed for the learner-advocate, applied to the reviewers that vote.
 *
 * - `blocker` — the lesson is WRONG or UNFOLLOWABLE as written: a factual error,
 *   a step that cannot produce the promised result, a self-contradiction.
 * - `minor` — a polish/currency/taste note. Recorded and fed back, never blocking.
 */
export type IssueSeverity = "blocker" | "minor";
export interface ReviewIssue {
  severity: IssueSeverity;
  text: string;
}

export interface TechnicalReview {
  verdict: Verdict;
  issues?: ReviewIssue[];
}
export interface CohesionReview {
  verdict: Verdict;
  issues?: ReviewIssue[];
}
export interface PedagogyReview {
  scores: Record<PedagogyCategory, number>;
  verdict: Verdict;
  /** Per-category rationale; a justified low score does NOT fail the lesson. */
  justifications?: Partial<Record<PedagogyCategory, string>>;
}
export interface BlueprintPedagogyReview {
  scores: Record<BlueprintPedagogyCategory, number>;
  verdict: Verdict;
  justifications?: Partial<Record<BlueprintPedagogyCategory, string>>;
}

/**
 * Coerce one raw issue into a severity-tagged one. A bare string (older model
 * output, or a model that ignored the schema) is read as a `blocker` — the safe
 * default: an unlabelled issue keeps its old blocking power rather than being
 * silently downgraded.
 */
function normalizeIssue(raw: unknown): ReviewIssue | null {
  if (typeof raw === "string") return raw.trim() ? { severity: "blocker", text: raw.trim() } : null;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = String(r.text ?? r.issue ?? r.detail ?? "").trim();
  if (!text) return null;
  return { severity: r.severity === "minor" ? "minor" : "blocker", text };
}

function validateVerdictDoc(doc: unknown, label: string): { verdict: Verdict; issues?: ReviewIssue[] } {
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.verdict !== "approved" && d.verdict !== "revise") throw new ValidationError([`${label}.verdict must be "approved" or "revise"`]);
  const issues = Array.isArray(d.issues) ? d.issues.map(normalizeIssue).filter((i): i is ReviewIssue => !!i) : undefined;
  return { verdict: d.verdict, ...(issues ? { issues } : {}) };
}

export function validateTechnicalReview(doc: unknown): TechnicalReview {
  return validateVerdictDoc(doc, "technical-review");
}
export function validateCohesionReview(doc: unknown): CohesionReview {
  return validateVerdictDoc(doc, "cohesion-review");
}

/** An issue from the course-wide cohesion sweep (rehearsal-phase §6). Same
 *  shape as `ReviewIssue`, plus an optional `lessonId` — the sweep runs over
 *  the WHOLE finished course, so an issue may name which single lesson must
 *  change, or (rarely) be a genuinely course-level problem with no one owner. */
export interface CourseCohesionIssue extends ReviewIssue {
  lessonId?: string;
}
export interface CourseCohesionReview {
  verdict: Verdict;
  issues?: CourseCohesionIssue[];
}

function normalizeCourseCohesionIssue(raw: unknown): CourseCohesionIssue | null {
  const base = normalizeIssue(raw);
  if (!base) return null;
  if (!raw || typeof raw !== "object") return base;
  const lessonId = String((raw as Record<string, unknown>).lessonId ?? "").trim();
  return lessonId ? { ...base, lessonId } : base;
}

export function validateCourseCohesionReview(doc: unknown): CourseCohesionReview {
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.verdict !== "approved" && d.verdict !== "revise") throw new ValidationError([`course-cohesion-review.verdict must be "approved" or "revise"`]);
  const issues = Array.isArray(d.issues) ? d.issues.map(normalizeCourseCohesionIssue).filter((i): i is CourseCohesionIssue => !!i) : undefined;
  return { verdict: d.verdict, ...(issues ? { issues } : {}) };
}

/** Shared scored-rubric validator — the lesson and blueprint rubrics differ only
 *  in their category set. */
function validateScoredReview<C extends string>(doc: unknown, categories: readonly C[], label: string): { scores: Record<C, number>; verdict: Verdict; justifications?: Partial<Record<C, string>> } {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  const rawScores = (d.scores ?? {}) as Record<string, unknown>;
  const scores = {} as Record<C, number>;
  for (const cat of categories) {
    const v = rawScores[cat];
    if (typeof v !== "number" || v < 1 || v > 5 || !Number.isFinite(v)) e.push(`${label}.scores.${cat} must be a number 1–5`);
    else scores[cat] = v;
  }
  if (d.verdict !== "approved" && d.verdict !== "revise") e.push(`${label}.verdict must be "approved" or "revise"`);
  if (e.length) throw new ValidationError(e);
  return {
    scores,
    verdict: d.verdict as Verdict,
    ...(d.justifications && typeof d.justifications === "object" ? { justifications: d.justifications as Partial<Record<C, string>> } : {}),
  };
}

export function validatePedagogyReview(doc: unknown): PedagogyReview {
  return validateScoredReview(doc, PEDAGOGY_CATEGORIES, "pedagogy-review");
}

export function validateBlueprintPedagogyReview(doc: unknown): BlueprintPedagogyReview {
  return validateScoredReview(doc, BLUEPRINT_PEDAGOGY_CATEGORIES, "blueprint-pedagogy-review");
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
 *
 * Within those reviewers, only `blocker` issues block (2026-07-22). A "revise"
 * verdict carrying nothing but `minor` notes passes the lesson and the notes ride
 * `advisory`, exactly like the advocate's. A "revise" with NO itemised issues at
 * all still blocks — the reviewer refused to ship and gave us nothing to weigh.
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
  const advisory: string[] = [];
  for (const [label, review] of [
    ["technical", technical],
    ["cohesion", cohesion],
  ] as const) {
    const blocking = (review.issues ?? []).filter((i) => i.severity === "blocker");
    const minor = (review.issues ?? []).filter((i) => i.severity === "minor");
    if (blocking.length) blockers.push(`${label}: ${blocking.map((i) => i.text).join("; ")}`);
    else if (review.verdict === "revise" && !minor.length) blockers.push(`${label}: revise`);
    for (const i of minor) advisory.push(`${label} (minor): ${i.text}`);
  }
  for (const cat of failingCategories) blockers.push(`pedagogy.${cat}=${pedagogy.scores[cat]} (< ${REVISION_THRESHOLD}, unjustified)`);
  if (advocate && !advocate.satisfied) {
    const before = advisory.length;
    for (const i of advocate.personaFit.issues) advisory.push(`persona-fit: ${i}`);
    for (const i of advocate.goalFit.issues) advisory.push(`goal-fit: ${i}`);
    for (const c of advocate.requiredChanges) advisory.push(`learner-advocate: ${c}`);
    if (advisory.length === before) advisory.push("learner-advocate: unsatisfied");
  }
  return { lessonId, passed: blockers.length === 0, technical, pedagogy, cohesion, ...(advocate ? { advocate } : {}), failingCategories, blockers, advisory };
}

export interface BlueprintReviewOutcome {
  passed: boolean;
  technical: TechnicalReview;
  pedagogy: BlueprintPedagogyReview;
  cohesion: CohesionReview;
  advocate?: CritiqueVerdict;
  failingCategories: BlueprintPedagogyCategory[];
  blockers: string[];
  advisory: string[];
}

/**
 * The blueprint's review panel (2026-07-22). Same machine as `evaluateReviews`,
 * one layer up: technical/cohesion vote with severity, the blueprint pedagogy
 * rubric fails a category scored below threshold without a justification, and
 * the learner-advocate stays ADVISORY.
 *
 * Severity discipline matters more here, not less. A blueprint has unbounded
 * surface for "you could sequence this better", so only structural defects — a
 * concept used before it is introduced, an inventory that doesn't reach the
 * promised outcome — may block. Everything else is advisory and rides to the
 * operator's gate. Without that rule this becomes the non-convergent critic the
 * advocate already had to be demoted for being.
 */
export function evaluateBlueprintReviews(
  technical: TechnicalReview,
  pedagogy: BlueprintPedagogyReview,
  cohesion: CohesionReview,
  advocate?: CritiqueVerdict,
): BlueprintReviewOutcome {
  const failingCategories = BLUEPRINT_PEDAGOGY_CATEGORIES.filter(
    (cat) => pedagogy.scores[cat] < REVISION_THRESHOLD && !(pedagogy.justifications?.[cat]?.trim()),
  );
  const blockers: string[] = [];
  const advisory: string[] = [];
  for (const [label, review] of [
    ["technical", technical],
    ["cohesion", cohesion],
  ] as const) {
    const blocking = (review.issues ?? []).filter((i) => i.severity === "blocker");
    const minor = (review.issues ?? []).filter((i) => i.severity === "minor");
    if (blocking.length) blockers.push(`${label}: ${blocking.map((i) => i.text).join("; ")}`);
    else if (review.verdict === "revise" && !minor.length) blockers.push(`${label}: revise`);
    for (const i of minor) advisory.push(`${label} (minor): ${i.text}`);
  }
  for (const cat of failingCategories) blockers.push(`pedagogy.${cat}=${pedagogy.scores[cat]} (< ${REVISION_THRESHOLD}, unjustified)`);
  if (advocate && !advocate.satisfied) {
    const before = advisory.length;
    for (const i of advocate.personaFit.issues) advisory.push(`persona-fit: ${i}`);
    for (const i of advocate.goalFit.issues) advisory.push(`goal-fit: ${i}`);
    for (const c of advocate.requiredChanges) advisory.push(`learner-advocate: ${c}`);
    if (advisory.length === before) advisory.push("learner-advocate: unsatisfied");
  }
  return { passed: blockers.length === 0, technical, pedagogy, cohesion, ...(advocate ? { advocate } : {}), failingCategories, blockers, advisory };
}
