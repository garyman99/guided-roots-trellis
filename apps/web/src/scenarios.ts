/**
 * Scenario catalog — types and derived-facet helpers for the home page and the
 * admin course editor.
 *
 * The catalog DATA is no longer compiled into the web bundle: it is fetched
 * from GET /api/scenarios (hand-authored seed ∪ runtime entries added when a
 * generated course is materialized — see plan D2). This module holds only the
 * shape and the pure functions that derive facets from a fetched array, so the
 * seed lives in exactly one place (packages/shared) and the API is the source
 * of record.
 */

export type ScenarioLevel = "beginner" | "intermediate" | "advanced";

export interface Scenario {
  labId: string;
  /** Learner-facing name on the home page (may differ from the lab's title). */
  title: string;
  blurb: string;
  /** Mono tag line: subject area, uppercase. */
  tag: string;
  /** Marketplace facet: who this scenario is for. */
  role: string;
  /** Marketplace facet: what it exercises. */
  technologies: string[];
  /** Marketplace facet: how much footing it assumes. */
  level: ScenarioLevel;
}

/** Experience filter values, in ladder order. */
export const ALL_LEVELS: ScenarioLevel[] = ["beginner", "intermediate", "advanced"];

/** Quick lookup by labId — course lessons reference scenarios by it. */
export function scenarioMap(scenarios: Scenario[]): Map<string, Scenario> {
  return new Map(scenarios.map((s) => [s.labId, s]));
}

/** Facet values in catalog order, deduped — the filter chips render these. */
export function rolesOf(scenarios: Scenario[]): string[] {
  return [...new Set(scenarios.map((s) => s.role))];
}

export function technologiesOf(scenarios: Scenario[]): string[] {
  return [...new Set(scenarios.flatMap((s) => s.technologies))];
}
