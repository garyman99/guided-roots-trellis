/**
 * Generated-artifact shapes and their validators. Phase output is validated
 * strictly before it is written and the gate requested: a phase that produces
 * a malformed artifact is retried once with the errors appended, then the run
 * interrupts (plan §4). The load-bearing checks live here — inventory shape,
 * prerequisite-graph acyclicity, capability declarations.
 */

export class ValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`artifact validation failed:\n- ${errors.join("\n- ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

/**
 * Recursively rename snake_case / kebab-case object KEYS to camelCase — a safety
 * net for live models that ignore the camelCase field names (`target_learner` →
 * `targetLearner`). Values are untouched; camelCase keys pass through unchanged.
 */
export function camelizeKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelizeKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const ck = k.replace(/[_-]([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
      out[ck] = camelizeKeys(val);
    }
    return out;
  }
  return v;
}

/** Remove trailing commas before } or ] — a common model slip that breaks JSON.parse. */
function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

/** JSON.parse, tolerating trailing commas; returns undefined on failure. */
function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    /* try harder */
  }
  try {
    return JSON.parse(stripTrailingCommas(s));
  } catch {
    return undefined;
  }
}

/** Parse JSON from a role's text, tolerating ```json fences, prose, trailing commas. */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  let out = tryParse(body);
  if (out === undefined) {
    // Last resort: the first {...} or [...] span.
    const span = body.match(/[[{][\s\S]*[\]}]/);
    if (span) out = tryParse(span[0]);
  }
  if (out === undefined) throw new ValidationError([`expected JSON, got: ${body.slice(0, 120)}…`]);
  return out as T;
}

/**
 * Validate, tolerating a single-key WRAPPER object (a model returning
 * `{ "courseRequest": {…} }` or `{ "blueprint": {…} }`). If the top-level fails
 * and it has exactly one object-valued property, validate that instead.
 */
export function validateWithUnwrap<T>(parsed: unknown, validate: (v: unknown) => T): T {
  try {
    return validate(parsed);
  } catch (err) {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const values = Object.values(parsed as Record<string, unknown>);
      if (values.length === 1 && values[0] && typeof values[0] === "object") return validate(values[0]);
    }
    throw err;
  }
}

/* ── Phase 1: course request ── */

export interface CourseRequestDoc {
  title: string;
  technology: string;
  targetLearner: string;
  startingPoint: string;
  endingCapability: string;
  assumptions: string[];
  outOfScope: string[];
}

export function validateCourseRequest(doc: unknown): CourseRequestDoc {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  for (const k of ["title", "technology", "targetLearner", "startingPoint", "endingCapability"]) {
    if (typeof d[k] !== "string" || !(d[k] as string).trim()) e.push(`course-request.${k} must be a non-empty string`);
  }
  for (const k of ["assumptions", "outOfScope"]) {
    if (!Array.isArray(d[k])) e.push(`course-request.${k} must be an array`);
  }
  if (e.length) throw new ValidationError(e);
  return doc as CourseRequestDoc;
}

/* ── Phase 2: blueprint (the whole high-level design) ── */

export const LEVELS = ["intro", "beginner", "intermediate", "advanced", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export interface LessonInventoryEntry {
  lessonId: string;
  level: Level;
  sequence: number;
  title: string;
  purpose: string;
  primaryCapability: string;
  conceptsIntroduced: string[];
  conceptsReinforced: string[];
  prerequisites: string[]; // lessonIds
  /** Capability ids this lesson relies on (registry ids or PROPOSED new ones). */
  requiredCapabilities: string[];
}

export interface PrerequisiteGraph {
  concepts: string[];
  /** Directed edges from prerequisite → dependent concept. */
  edges: Array<{ from: string; to: string }>;
}

export interface Blueprint {
  domainMap: string;
  progressionSpine: string;
  conventions: string;
  planReview: string;
  prerequisiteGraph: PrerequisiteGraph;
  lessonInventory: LessonInventoryEntry[];
}

export function validateBlueprint(doc: unknown): Blueprint {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  for (const k of ["domainMap", "progressionSpine", "conventions", "planReview"]) {
    if (typeof d[k] !== "string" || !(d[k] as string).trim()) e.push(`blueprint.${k} must be a non-empty string`);
  }
  const inv = d.lessonInventory;
  if (!Array.isArray(inv) || inv.length === 0) {
    e.push("blueprint.lessonInventory must be a non-empty array");
    throw new ValidationError(e);
  }
  const ids = new Set<string>();
  inv.forEach((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const where = `lessonInventory[${i}]`;
    if (typeof l.lessonId !== "string" || !/^[a-z0-9-]+$/.test(l.lessonId)) e.push(`${where}.lessonId must be kebab-case`);
    else {
      if (ids.has(l.lessonId)) e.push(`${where}.lessonId "${l.lessonId}" is duplicated`);
      ids.add(l.lessonId);
    }
    if (typeof l.level !== "string" || !(LEVELS as readonly string[]).includes(l.level as string)) e.push(`${where}.level must be one of ${LEVELS.join("|")}`);
    for (const k of ["title", "purpose", "primaryCapability"]) {
      if (typeof l[k] !== "string" || !(l[k] as string).trim()) e.push(`${where}.${k} must be a non-empty string`);
    }
    for (const k of ["conceptsIntroduced", "conceptsReinforced", "prerequisites", "requiredCapabilities"]) {
      if (!Array.isArray(l[k])) e.push(`${where}.${k} must be an array`);
    }
  });
  // Prerequisites must reference lessons that exist in the inventory.
  inv.forEach((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    for (const p of (Array.isArray(l.prerequisites) ? l.prerequisites : []) as string[]) {
      if (!ids.has(p)) e.push(`lessonInventory[${i}].prerequisites references unknown lesson "${p}"`);
    }
  });

  const graph = (d.prerequisiteGraph ?? {}) as Record<string, unknown>;
  if (!Array.isArray(graph.concepts) || !Array.isArray(graph.edges)) {
    e.push("blueprint.prerequisiteGraph needs concepts[] and edges[]");
  } else {
    const cycle = findCycle(graph as unknown as PrerequisiteGraph);
    if (cycle) e.push(`prerequisiteGraph has a cycle: ${cycle.join(" → ")}`);
  }

  if (e.length) throw new ValidationError(e);
  return doc as Blueprint;
}

/** Returns a cycle path if the prerequisite graph is cyclic, else null. */
export function findCycle(graph: PrerequisiteGraph): string[] | null {
  const adj = new Map<string, string[]>();
  for (const c of graph.concepts) adj.set(c, []);
  for (const { from, to } of graph.edges) {
    if (!adj.has(from)) adj.set(from, []);
    if (!adj.has(to)) adj.set(to, []);
    adj.get(from)!.push(to);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 in-stack, 2 done
  const stack: string[] = [];
  const dfs = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (s === 0) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      const found = dfs(node);
      if (found) return found;
    }
  }
  return null;
}

/* ── Phase 3: lesson plan + reviews ── */

export interface LessonPlanDoc {
  lessonId: string;
  markdown: string;
  /** The lab spec this lesson materializes into. `kind` selects a real lab
   *  builder (e.g. "git-commit"); absent → the generic "complete the stub" lab. */
  lab: { objective: string; primaryAuto: string; kind?: string };
}

export function validateLessonPlan(doc: unknown, expectedId: string): LessonPlanDoc {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.lessonId !== expectedId) e.push(`lesson plan lessonId "${String(d.lessonId)}" != assigned "${expectedId}"`);
  if (typeof d.markdown !== "string" || !(d.markdown as string).trim()) e.push("lesson plan markdown must be a non-empty string");
  const lab = (d.lab ?? {}) as Record<string, unknown>;
  if (typeof lab.objective !== "string" || !(lab.objective as string).trim()) e.push("lesson plan lab.objective is required");
  if (typeof lab.primaryAuto !== "string" || !(lab.primaryAuto as string).trim()) e.push("lesson plan lab.primaryAuto is required");
  if (e.length) throw new ValidationError(e);
  return doc as LessonPlanDoc;
}
