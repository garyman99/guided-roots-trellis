/**
 * Critique/refine loop (quality-rework Phase 2).
 *
 * Every generation touchpoint — the course frame, the blueprint, each lesson
 * plan — is judged by the learner-advocate against two questions before it may
 * park at a human gate:
 *
 *   personaFit — are the technical terms and directions within the target
 *                persona's anticipated knowledge + capability levels?
 *   goalFit    — will this output actually achieve its stated (scoped) goal?
 *
 * An unsatisfied verdict feeds `requiredChanges` back to the producing role,
 * which refines and is re-judged — up to MAX_CRITIQUE_ROUNDS (default 2, env
 * COURSE_GEN_CRITIQUE_ROUNDS overrides, clamped to 1..10). Unsatisfied-after-cap
 * keeps the LAST output and
 * records the verdict trail; the human gate decides (framing/designing) or the
 * lesson lands in needs-revision (authoring).
 *
 * This module owns the contract: verdict type, validator, the exact-JSON
 * instruction, and the generic loop. The executor supplies the produce/critique
 * closures (it owns roles, prompts, and artifacts).
 */
import { ValidationError } from "./schemas.ts";

export interface CritiqueVerdict {
  satisfied: boolean;
  personaFit: { ok: boolean; issues: string[] };
  goalFit: { ok: boolean; issues: string[] };
  /** Concrete, actionable changes — fed back verbatim to the producer. */
  requiredChanges: string[];
}

export const MAX_CRITIQUE_ROUNDS = 2;

/** The round cap: env-tunable, clamped to a sane 1..10. */
export function critiqueRounds(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.COURSE_GEN_CRITIQUE_ROUNDS ?? MAX_CRITIQUE_ROUNDS);
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.floor(n))) : MAX_CRITIQUE_ROUNDS;
}

/**
 * Per-phase round cap (gap-reconciliation-pause §1): each phase's critique loop
 * reads ITS OWN cap off the run request — `framingRounds`/`designRounds`/
 * `authoringRounds` — so cranking design iteration no longer multiplies
 * authoring cost across every lesson. Absent ⇒ `critiqueRounds(env)`, which is
 * now only the DEFAULT SEED for a new run, not the shared control surface.
 */
export function phaseRounds(
  phase: "framing" | "designing" | "authoring",
  request: { framingRounds?: number; designRounds?: number; authoringRounds?: number },
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = phase === "framing" ? request.framingRounds : phase === "designing" ? request.designRounds : request.authoringRounds;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(10, Math.max(1, Math.floor(raw)));
  return critiqueRounds(env);
}

function fit(doc: unknown, label: string, errors: string[]): { ok: boolean; issues: string[] } {
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.ok !== "boolean") errors.push(`critique.${label}.ok must be a boolean`);
  const issues = Array.isArray(d.issues) ? d.issues.map(String) : (errors.push(`critique.${label}.issues must be an array`), []);
  return { ok: d.ok === true, issues };
}

export function validateCritiqueVerdict(doc: unknown): CritiqueVerdict {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.satisfied !== "boolean") e.push("critique.satisfied must be a boolean");
  const personaFit = fit(d.personaFit, "personaFit", e);
  const goalFit = fit(d.goalFit, "goalFit", e);
  const requiredChanges = Array.isArray(d.requiredChanges)
    ? d.requiredChanges.map(String)
    : (e.push("critique.requiredChanges must be an array"), [] as string[]);
  // A dissatisfied critic must say what to change — otherwise the producer
  // can only guess and the loop burns rounds without converging.
  if (d.satisfied === false && requiredChanges.length === 0) {
    e.push("critique.requiredChanges must be non-empty when satisfied is false");
  }
  if (e.length) throw new ValidationError(e);
  return { satisfied: d.satisfied as boolean, personaFit, goalFit, requiredChanges };
}

/** The exact output contract — real models need the shape spelled out. */
export function critiqueInstruction(): string {
  return [
    `Judge the CONTENT above for the target persona and the stated goal.`,
    `Return ONLY a JSON object, no prose or fences, with EXACTLY these fields:`,
    `{`,
    `  "satisfied": boolean,          // true ONLY if both fits hold`,
    `  "personaFit": { "ok": boolean, "issues": string[] },   // terms/directions within the persona's knowledge + capability?`,
    `  "goalFit":    { "ok": boolean, "issues": string[] },   // will this achieve the stated scoped goal?`,
    `  "requiredChanges": string[]    // concrete, actionable changes; REQUIRED (non-empty) when satisfied is false`,
    `}`,
    `Cite the specific term, step, or gap behind every issue. Do not invent`,
    `requirements beyond the persona and the stated goal. No comments, no`,
    `trailing commas, no wrapper object.`,
  ].join("\n");
}

export interface CritiqueLoopResult<T> {
  value: T;
  /** Rounds actually run (1 = accepted first try). */
  rounds: number;
  satisfied: boolean;
  /** The final verdict (null only if the critic call itself failed). */
  verdict: CritiqueVerdict | null;
}

/** One entry of critiques/summary.json — the gate UI's per-subject rollup. */
export interface CritiqueSummaryEntry {
  subject: string;
  rounds: number;
  satisfied: boolean;
}

/**
 * The generic produce → critique → refine loop. Deliberately free of role/
 * artifact plumbing: the executor's closures own prompts and writes, so this
 * stays unit-testable and reusable (the interviewer and future critics too).
 */
export async function critiqueLoop<T>(opts: {
  maxRounds: number;
  produce: (requiredChanges: string[] | null, round: number) => Promise<T>;
  critique: (value: T, round: number) => Promise<CritiqueVerdict>;
  /** Called after every round with the verdict (artifact writes, events). */
  onRound?: (round: number, verdict: CritiqueVerdict) => void;
}): Promise<CritiqueLoopResult<T>> {
  const max = Math.max(1, opts.maxRounds);
  let feedback: string[] | null = null;
  let value!: T;
  let verdict: CritiqueVerdict | null = null;
  for (let round = 1; round <= max; round++) {
    value = await opts.produce(feedback, round);
    verdict = await opts.critique(value, round);
    opts.onRound?.(round, verdict);
    if (verdict.satisfied) return { value, rounds: round, satisfied: true, verdict };
    // Feed the full picture back: explicit changes plus the cited issues.
    feedback = [...verdict.requiredChanges, ...verdict.personaFit.issues, ...verdict.goalFit.issues];
  }
  return { value, rounds: max, satisfied: false, verdict };
}
