/**
 * Deterministic mock course generator — the offline default responder.
 *
 * It produces a small, coherent, schema-valid course from a run request, using
 * only capabilities that exist in the base build (so a plain offline run yields
 * a gap-free course). Two purposes: it lets the feature be demoed without model
 * keys, and it's the fixture the pipeline tests assert against. Tests that want
 * gaps or malformed output pass their own responder instead.
 */
import type { MockResponder } from "./roles.ts";
import type { Blueprint, CourseRequestDoc, LessonInventoryEntry, LessonPlanDoc } from "./schemas.ts";

interface Requestish {
  technology?: string;
  title?: string;
  targetLearner?: string;
  outcome?: string;
}

function reqOf(context: Record<string, unknown> | undefined): Requestish {
  const r = (context?.request ?? {}) as Requestish;
  return { technology: r.technology ?? "the technology", title: r.title, targetLearner: r.targetLearner, outcome: r.outcome };
}

/** Course-scoped lesson id prefix, e.g. "git" → "git-101". */
function slug(technology: string): string {
  return technology.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "course";
}

function mockCourseRequest(context?: Record<string, unknown>): CourseRequestDoc {
  const r = reqOf(context);
  return {
    title: r.title ?? `${r.technology}: from first steps to confidence`,
    technology: r.technology!,
    targetLearner: r.targetLearner ?? "a working professional new to this technology",
    startingPoint: "Has adjacent experience but has not used this technology directly.",
    endingCapability: r.outcome ?? `Can complete common ${r.technology} tasks independently and diagnose failures.`,
    assumptions: ["The learner works in a terminal daily.", "No prior experience with this specific tool is assumed."],
    outOfScope: ["Deep internals", "Ecosystem tooling beyond the core workflow"],
  };
}

/** A two-lesson course (intro + beginner) using only base-build capabilities. */
function mockBlueprint(context?: Record<string, unknown>): Blueprint {
  const r = reqOf(context);
  const s = slug(r.technology!);
  const inventory: LessonInventoryEntry[] = [
    {
      lessonId: `${s}-101`,
      level: "intro",
      sequence: 1,
      title: `Meet ${r.technology}`,
      purpose: `Build a first mental model of ${r.technology} by reading a complete, working example.`,
      primaryCapability: "Recognize the core workflow and read a complete example.",
      conceptsIntroduced: ["core-workflow", "mental-model"],
      conceptsReinforced: [],
      prerequisites: [],
      requiredCapabilities: ["file-viewed", "code"],
    },
    {
      lessonId: `${s}-102`,
      level: "beginner",
      sequence: 2,
      title: `Your first ${r.technology} task`,
      purpose: `Complete a small, guided ${r.technology} task and prove the result.`,
      primaryCapability: "Complete a straightforward task using the course conventions.",
      conceptsIntroduced: ["first-task", "verification"],
      conceptsReinforced: ["core-workflow"],
      prerequisites: [`${s}-101`],
      requiredCapabilities: ["tests-run", "code"],
    },
  ];
  return {
    domainMap: `# Domain map: ${r.technology}\n\nCapability areas: purpose & mental model, core operations, validation, failure handling.`,
    progressionSpine: `# Progression spine\n\nIntro → Beginner: recognize the workflow, then complete a first task with proof.`,
    conventions: `# Conventions\n\nOne terminal lab per lesson; tasks named by the observable action; failures are taught, not hidden.`,
    planReview: `# Plan review\n\nCoverage, progression, and cohesion checked: two lessons, no forward references, autonomy increases.`,
    prerequisiteGraph: {
      concepts: ["core-workflow", "mental-model", "first-task", "verification"],
      edges: [
        { from: "mental-model", to: "core-workflow" },
        { from: "core-workflow", to: "first-task" },
        { from: "first-task", to: "verification" },
      ],
    },
    lessonInventory: inventory,
  };
}

function mockLessonPlan(context?: Record<string, unknown>): LessonPlanDoc {
  const lesson = (context?.lesson ?? {}) as LessonInventoryEntry;
  return {
    lessonId: lesson.lessonId,
    markdown: [
      `# ${lesson.title}`,
      ``,
      `## Why this matters`,
      lesson.purpose,
      ``,
      `## Learning objective`,
      `- ${lesson.primaryCapability}`,
      ``,
      `## Concrete demonstration`,
      `A complete, working example the learner runs and inspects.`,
      ``,
      `## Guided practice`,
      `Complete the missing step, then prove the result.`,
      ``,
      `## Mastery evidence`,
      `The learner completes the task and explains why it works.`,
      ``,
    ].join("\n"),
    lab: { objective: lesson.purpose, primaryAuto: lesson.requiredCapabilities?.[0] ?? "any-command" },
  };
}

/** The offline default responder used when no model provider is configured. */
export const defaultMockResponder: MockResponder = (role, prompt) => {
  const ctx = prompt.context;
  if (prompt.task === "course-request") return JSON.stringify(mockCourseRequest(ctx));
  if (prompt.task === "blueprint") return JSON.stringify(mockBlueprint(ctx));
  if (prompt.task.startsWith("lesson:")) return JSON.stringify(mockLessonPlan(ctx));
  // Reviews are structured; a passing verdict keeps the default course moving.
  if (prompt.task.startsWith("review:pedagogy:")) return JSON.stringify({ scores: { priorKnowledge: 5, mentalModel: 5, activeLearning: 5, feedback: 5, mastery: 5 }, verdict: "approved" });
  if (prompt.task.startsWith("review:technical:")) return JSON.stringify({ verdict: "approved", issues: [] });
  if (prompt.task.startsWith("review:cohesion:")) return JSON.stringify({ verdict: "approved", issues: [] });
  return "{}";
};
