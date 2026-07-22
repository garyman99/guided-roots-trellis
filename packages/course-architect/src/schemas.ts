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

/**
 * Parse JSON from a role's text, tolerating fences, surrounding prose, and
 * trailing commas. Order matters: try the WHOLE response FIRST — valid JSON may
 * legitimately contain ``` code fences inside a string value (e.g. a lesson's
 * markdown), and extracting a fence first would grab that inner block by
 * mistake (the "expected JSON, got: python3 --version" failure).
 */
export function parseJson<T>(text: string): T {
  const t = text.trim();
  let out = tryParse(t); // 1. the whole thing
  if (out === undefined) {
    // 2. a ```json-fenced block specifically
    const jsonFence = t.match(/```json\s*([\s\S]*?)```/i);
    if (jsonFence) out = tryParse(jsonFence[1].trim());
  }
  if (out === undefined) {
    // 3. the largest {...}/[...] span in the ORIGINAL text (prose around JSON)
    const span = t.match(/[[{][\s\S]*[\]}]/);
    if (span) out = tryParse(span[0]);
  }
  if (out === undefined) {
    // 4. any fenced block, last resort
    const anyFence = t.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/);
    if (anyFence) out = tryParse(anyFence[1].trim());
  }
  if (out === undefined) throw new ValidationError([`expected JSON, got: ${t.slice(0, 120)}…`]);
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
    else if (/-v\d+$/.test(l.lessonId)) {
      // The `-v<N>` suffix namespace is RESERVED for lesson versions (a
      // revision of `orient-101` ships as `orient-101-v2`); a minted id there
      // would make version↔family mapping ambiguous.
      e.push(`${where}.lessonId "${l.lessonId}" must not end in -v<number> (reserved for lesson versions)`);
    } else {
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

/* ── Lesson-revision runs (versioning plan Phase D) ── */

export interface RevisionGoalDoc {
  /** What this revision sets out to fix, grounded in the report/notes. */
  goal: string;
  /** Observable outcomes that would prove the revision worked. */
  successCriteria: string[];
}

export function validateRevisionGoal(doc: unknown): RevisionGoalDoc {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.goal !== "string" || !d.goal.trim()) e.push("revisionGoal.goal must be a non-empty string");
  if (!Array.isArray(d.successCriteria) || d.successCriteria.length === 0 || !d.successCriteria.every((s) => typeof s === "string" && s.trim())) {
    e.push("revisionGoal.successCriteria must be a non-empty string array");
  }
  if (e.length) throw new ValidationError(e);
  return d as unknown as RevisionGoalDoc;
}

export interface ImprovementPlanDoc {
  /** The change plan, markdown — WHAT changes and why, citing report findings. */
  changePlan: string;
  /** The revised lesson's inventory entry; lessonId MUST be the family id. */
  lesson: LessonInventoryEntry;
}

export function validateImprovementPlan(doc: unknown, family: string): ImprovementPlanDoc {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.changePlan !== "string" || !d.changePlan.trim()) e.push("improvementPlan.changePlan must be a non-empty string (markdown)");
  const l = (d.lesson ?? {}) as Record<string, unknown>;
  if (l.lessonId !== family) e.push(`improvementPlan.lesson.lessonId must be "${family}" (the lesson family being revised)`);
  if (typeof l.level !== "string" || !(LEVELS as readonly string[]).includes(l.level as string)) e.push(`improvementPlan.lesson.level must be one of ${LEVELS.join("|")}`);
  if (typeof l.sequence !== "number") e.push("improvementPlan.lesson.sequence must be a number");
  for (const k of ["title", "purpose", "primaryCapability"]) {
    if (typeof l[k] !== "string" || !(l[k] as string).trim()) e.push(`improvementPlan.lesson.${k} must be a non-empty string`);
  }
  for (const k of ["conceptsIntroduced", "conceptsReinforced", "prerequisites", "requiredCapabilities"]) {
    if (!Array.isArray(l[k])) e.push(`improvementPlan.lesson.${k} must be an array`);
  }
  if (e.length) throw new ValidationError(e);
  return d as unknown as ImprovementPlanDoc;
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

/** An honest "this lesson cannot be labbed on today's bench" declaration — the
 *  ONLY alternative to a real lab (2026-07-22). It blocks the lesson and files a
 *  capability gap for the operator instead of shipping a lab that measures
 *  something the lesson doesn't teach. */
export interface LabCapabilityGap {
  /** The capability the bench would need, kebab-case (e.g. "windows-installer"). */
  capability: string;
  /** Why this lesson's observable action can't be measured on today's bench. */
  why: string;
}

export interface LessonPlanDoc {
  lessonId: string;
  markdown: string;
  /** The lab spec this lesson materializes into. EXACTLY ONE of `files`, a real
   *  `kind`, or `blockedBy` — there is no generic fallback (2026-07-22).
   *  - `files`: the FULL authored artifact set (relative path → contents:
   *    lab.json, template/…, verify/checkpoint.mjs, blueprint.json) — the same
   *    contract a human authors (plan L1). When present it is used verbatim,
   *    trusted only because auto-solve proves it (plan L3). Highest precedence.
   *  - `kind`: otherwise selects a curated real-lab builder (e.g. "git-commit",
   *    "node-deps").
   *  - `expectedPackages`: structured data a curated kind needs (e.g. node-deps).
   *  - `blockedBy`: no lab is possible here; block the lesson and raise a gap. */
  lab: {
    objective: string;
    primaryAuto: string;
    kind?: string;
    expectedPackages?: string[];
    files?: Record<string, string>;
    blockedBy?: LabCapabilityGap;
  };
}

/**
 * `kind:"stub"` built a lab whose ONLY measured task was "edit solution.txt:
 * replace TODO with SOLVED" — identical for every lesson, ignoring the lesson's
 * own primaryAuto. It is rejected outright (2026-07-22 field finding: 10 of 11
 * lessons in the Selenium run took it, so a course promising "learn PowerShell"
 * measured a text edit, and no gate could see it because no reviewer is shown
 * the lab). A lesson that cannot be labbed declares `lab.blockedBy` instead.
 */
const REJECTED_LAB_KINDS = new Set(["stub", "none", "placeholder", "conceptual"]);

export function validateLessonPlan(doc: unknown, expectedId: string): LessonPlanDoc {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.lessonId !== expectedId) e.push(`lesson plan lessonId "${String(d.lessonId)}" != assigned "${expectedId}"`);
  if (typeof d.markdown !== "string" || !(d.markdown as string).trim()) e.push("lesson plan markdown must be a non-empty string");
  const lab = (d.lab ?? {}) as Record<string, unknown>;
  if (typeof lab.objective !== "string" || !(lab.objective as string).trim()) e.push("lesson plan lab.objective is required");
  if (typeof lab.primaryAuto !== "string" || !(lab.primaryAuto as string).trim()) e.push("lesson plan lab.primaryAuto is required");
  // A lab must be REAL, not defaulted and not a stub: author the full files, name
  // a real curated kind, or declare blockedBy and take the lesson out of the run.
  const gap = validateLabGap(lab.blockedBy, e);
  if (gap) {
    if (lab.files !== undefined || (typeof lab.kind === "string" && lab.kind.trim())) {
      e.push('lesson plan lab declares "blockedBy" AND a lab (files/kind) — a lesson is either labbable or blocked, not both');
    }
  } else if (typeof lab.kind === "string" && REJECTED_LAB_KINDS.has(lab.kind.trim().toLowerCase())) {
    e.push(
      `lesson plan lab.kind ${JSON.stringify(lab.kind)} is not a lab — it measures nothing this lesson teaches. ` +
        `Author "files" with a verifier that checks the observable action named in lab.primaryAuto (${JSON.stringify(lab.primaryAuto)}), ` +
        `name a real curated kind, or — if this lesson's action genuinely cannot be measured on the bench — declare ` +
        `lab.blockedBy = { capability, why } so it is blocked and raised as a capability gap.`,
    );
  } else if (lab.files === undefined && (typeof lab.kind !== "string" || !(lab.kind as string).trim())) {
    e.push('lesson plan lab must declare a real "kind" (e.g. "node-deps"/"git-commit"), author "files", or declare "blockedBy"');
  }
  // A node-deps lab is only well-formed with the concrete packages to verify —
  // its verifier asserts exactly these are declared, so prose can't stand in.
  if (lab.kind === "node-deps") {
    const pkgs = lab.expectedPackages;
    if (!Array.isArray(pkgs) || pkgs.length === 0 || !pkgs.every((p) => typeof p === "string" && p.trim())) {
      e.push('lesson plan lab.kind "node-deps" requires a non-empty expectedPackages string[]');
    }
  }
  // A fully-authored artifact set must carry the minimum a provable lab needs;
  // auto-solve enforces correctness beyond structure (plan L1/L3).
  if (lab.files !== undefined) {
    const files = lab.files as Record<string, unknown>;
    const bad = !files || typeof files !== "object" || Array.isArray(files);
    const values = bad ? [] : Object.values(files);
    if (bad || values.some((v) => typeof v !== "string")) {
      e.push("lesson plan lab.files must be an object of { relativePath: contents(string) }");
    } else {
      for (const required of ["lab.json", "blueprint.json", "verify/checkpoint.mjs"]) {
        if (!(required in files)) e.push(`lesson plan lab.files is missing required "${required}"`);
      }
      validateAuthoredLabShape(files as Record<string, string>, e);
    }
  }
  if (e.length) throw new ValidationError(e);
  return doc as LessonPlanDoc;
}

/**
 * Validate the SHAPE of a model-authored lab, not merely that the files exist
 * (2026-07-22 field finding). A live author shipped a `blueprint.json` of
 * `{ solutionFiles, notes }` — a plausible invention, but not the contract — and
 * `loadBlueprint`'s `Object.entries(bp.tiers)` threw on `undefined`, taking a
 * 19-lesson run down on lesson 1. Catching it here turns a dead run into a cheap
 * model retry carrying the exact error, long before any lab is built.
 *
 * This checks structure only; auto-solve still decides whether the lab is
 * genuinely broken-as-shipped and solvable.
 */
function validateAuthoredLabShape(files: Record<string, string>, e: string[]): void {
  const parse = (path: string): Record<string, unknown> | null => {
    const raw = files[path];
    if (typeof raw !== "string") return null;
    try {
      const doc = JSON.parse(raw) as unknown;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        e.push(`lesson plan lab.files "${path}" must be a JSON object`);
        return null;
      }
      return doc as Record<string, unknown>;
    } catch (err) {
      e.push(`lesson plan lab.files "${path}" is not valid JSON: ${(err as Error).message}`);
      return null;
    }
  };

  const manifest = parse("lab.json");
  if (manifest) {
    const tasks = manifest.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      e.push('lesson plan lab.files "lab.json" must declare a non-empty "tasks" array — the tasks are what the learner is graded on');
    } else {
      tasks.forEach((t, i) => {
        const task = (t ?? {}) as Record<string, unknown>;
        if (typeof task.id !== "string" || !task.id.trim()) e.push(`lesson plan lab.json tasks[${i}].id is required`);
        if (typeof task.auto !== "string" || !task.auto.trim()) e.push(`lesson plan lab.json tasks[${i}].auto is required — the observable action that completes the task`);
      });
    }
    const cp = manifest.checkpoint;
    if (!cp || typeof cp !== "object" || Array.isArray(cp)) {
      e.push('lesson plan lab.files "lab.json" must declare a "checkpoint" OBJECT { id, title, requirements: [{ id, kind, label }] } — not a string or a path');
    } else {
      const reqs = (cp as Record<string, unknown>).requirements;
      if (!Array.isArray(reqs) || reqs.length === 0) e.push('lesson plan lab.json checkpoint.requirements must be a non-empty array');
    }
  }

  const bp = parse("blueprint.json");
  if (bp) {
    const defects = bp.defects;
    const okDefects = !!defects && typeof defects === "object" && !Array.isArray(defects) && Object.keys(defects).length > 0;
    if (!okDefects) {
      e.push('lesson plan lab.files "blueprint.json" must declare a non-empty "defects" object: { "<defectId>": { "description": string, "solution": string[] } } — "solution" is the argv the auto-solver runs to fix the shipped defect');
    } else {
      for (const [id, spec] of Object.entries(defects as Record<string, unknown>)) {
        const s = (spec ?? {}) as Record<string, unknown>;
        if (!Array.isArray(s.solution) || s.solution.length === 0 || !s.solution.every((a) => typeof a === "string")) {
          e.push(`lesson plan blueprint.json defects.${id}.solution must be a non-empty string[] (argv, e.g. ["node","-e","…"]) that makes the verifier pass`);
        }
      }
    }
    const tiers = bp.tiers;
    const okTiers = !!tiers && typeof tiers === "object" && !Array.isArray(tiers) && Object.keys(tiers).length > 0;
    if (!okTiers) {
      e.push('lesson plan lab.files "blueprint.json" must declare a non-empty "tiers" object: { "1": { "defect": "<defectId>" } }');
    } else if (okDefects) {
      for (const [tier, spec] of Object.entries(tiers as Record<string, unknown>)) {
        const ref = ((spec ?? {}) as Record<string, unknown>).defect;
        if (typeof ref !== "string" || !(ref in (defects as Record<string, unknown>))) {
          e.push(`lesson plan blueprint.json tiers.${tier}.defect ${JSON.stringify(ref)} does not name a defect declared in defects`);
        }
      }
    }
    if (bp.driver !== undefined && bp.driver !== "local" && bp.driver !== "docker") {
      e.push('lesson plan blueprint.json "driver" must be "local" or "docker" when present');
    }
  }

  // The learner needs a workspace to work in, and a verifier that fails on it.
  if (!Object.keys(files).some((p) => p.startsWith("template/"))) {
    e.push('lesson plan lab.files must include at least one "template/…" file — the workspace the learner receives, shipped BROKEN');
  }
}

/**
 * Validate the honest-escape declaration. Returns the gap when one is present
 * and well-formed, null when absent. A vague gap is rejected: "why" has to say
 * what the bench can't do, or this becomes the new cheap path out of authoring
 * a real lab.
 */
function validateLabGap(raw: unknown, e: string[]): LabCapabilityGap | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    e.push("lesson plan lab.blockedBy must be an object { capability, why }");
    return null;
  }
  const g = raw as Record<string, unknown>;
  const capability = typeof g.capability === "string" ? g.capability.trim() : "";
  const why = typeof g.why === "string" ? g.why.trim() : "";
  if (!capability) e.push("lesson plan lab.blockedBy.capability is required (kebab-case capability id the bench would need)");
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(capability)) e.push(`lesson plan lab.blockedBy.capability ${JSON.stringify(capability)} must be kebab-case`);
  if (why.length < 40) e.push("lesson plan lab.blockedBy.why must explain in a full sentence what the bench cannot observe or host (40+ chars)");
  return capability && why.length >= 40 ? { capability, why } : null;
}
