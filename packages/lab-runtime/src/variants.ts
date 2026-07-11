/**
 * Adaptive labs (kernel): resolve a concrete Lab Variant from an authored
 * blueprint, deterministically. The invariant: same blueprint + same tier →
 * same lab → same evaluation, forever. Runtime generation is forbidden by
 * construction — a variant that isn't in the blueprint cannot exist.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Blueprint {
  blueprintId: string;
  teaches: string[];
  exercises: string[];
  defects: Record<string, { description: string; solution: string[] }>;
  tiers: Record<string, { defect: string }>;
  ciPolicy: string;
}

export interface LabVariant {
  variantId: string; // "tier<N>:<defectId>" — recorded on session.started v2
  tier: number;
  defect: string;
}

export function loadBlueprint(labDir: string): Blueprint | null {
  const path = join(labDir, "blueprint.json");
  if (!existsSync(path)) return null; // labs without a blueprint are single-variant
  const bp = JSON.parse(readFileSync(path, "utf8")) as Blueprint;
  for (const [tier, spec] of Object.entries(bp.tiers)) {
    if (!bp.defects[spec.defect]) throw new Error(`blueprint ${bp.blueprintId}: tier ${tier} references unknown defect ${spec.defect}`);
  }
  return bp;
}

export function resolveVariant(bp: Blueprint, tier: number): LabVariant {
  const tiers = Object.keys(bp.tiers).map(Number).sort((a, b) => a - b);
  const chosen = tiers.includes(tier) ? tier : tiers[0];
  const defect = bp.tiers[String(chosen)].defect;
  return { variantId: `tier${chosen}:${defect}`, tier: chosen, defect };
}

/**
 * Deterministic tier selection with HYSTERESIS, so noisy mastery estimates
 * don't whipsaw learners between tiers:
 *   • promotion is immediate on mastery (the mastery RULE already demands
 *     sustained evidence — that's where promotion's hysteresis lives);
 *   • demotion is damped: one non-mastered read never demotes; it takes two
 *     consecutive selections at the higher tier without the signal returning.
 * Tier changes only ever happen here, at session creation — never mid-lab.
 */
export function chooseTier(exercisedConceptsMastered: boolean, recentTiers: number[], maxTier = 2): number {
  const current = recentTiers.at(-1) ?? 1;
  if (exercisedConceptsMastered) return Math.min(current + 1, maxTier);
  if (current > 1) {
    const lastTwo = recentTiers.slice(-2);
    if (lastTwo.length === 2 && lastTwo.every((t) => t === current)) return current - 1;
    return current;
  }
  return 1;
}
