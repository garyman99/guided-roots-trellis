/**
 * Concept registry + curriculum graph (kernel).
 * Loading validates the invariants CI relies on: unique well-formed IDs,
 * edges referencing registered concepts, acyclicity.
 */
import { readFileSync } from "node:fs";

export interface MasteryRule {
  minCount: number;
  minDistinctLabs: number;
  windowDays: number;
}

export interface Concept {
  id: string;
  name: string;
  category: string;
  defaultHalfLifeDays: number;
  /**
   * Which digest observation(s) feed this concept's evidence. Multiple keys
   * exist because distinct labs demonstrate the same concept through their
   * own checkpoints (e.g. reviewing a Playwright test vs authoring one).
   */
  observation: string | string[];
  masteryRule: MasteryRule;
  explanationTemplate: string;
}

export interface ConceptEdge {
  from: string;
  to: string;
  kind: "prerequisite";
}

export interface Curriculum {
  concepts: Concept[];
  edges: ConceptEdge[];
}

export function loadCurriculum(path: string): Curriculum {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Curriculum;
  validateCurriculum(raw);
  return raw;
}

export function validateCurriculum(c: Curriculum): void {
  const ids = new Set<string>();
  for (const concept of c.concepts) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(concept.id)) throw new Error(`bad concept id: ${concept.id}`);
    if (ids.has(concept.id)) throw new Error(`duplicate concept id: ${concept.id}`);
    ids.add(concept.id);
    if (observationKeys(concept).length === 0) throw new Error(`concept has no observation keys: ${concept.id}`);
  }
  for (const e of c.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`edge references unknown concept: ${e.from} → ${e.to}`);
  }
  // Cycle check (DFS).
  const adj = new Map<string, string[]>();
  for (const e of c.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<string, number>(); // 1 = visiting, 2 = done
  const visit = (id: string) => {
    if (state.get(id) === 1) throw new Error(`curriculum graph has a cycle at ${id}`);
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) visit(next);
    state.set(id, 2);
  };
  for (const id of ids) visit(id);
}

/** Normalized accessor: a concept's observation keys as a list. */
export function observationKeys(concept: Pick<Concept, "observation">): string[] {
  return Array.isArray(concept.observation) ? concept.observation : [concept.observation];
}

export function conceptById(c: Curriculum, id: string): Concept | null {
  return c.concepts.find((x) => x.id === id) ?? null;
}

export function prerequisitesOf(c: Curriculum, id: string): string[] {
  return c.edges.filter((e) => e.to === id && e.kind === "prerequisite").map((e) => e.from);
}
