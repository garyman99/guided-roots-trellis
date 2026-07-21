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

/** Course-scoped lesson id prefix from the technology's first word, e.g.
 *  "Selenium with Python" → "selenium", "Git" → "git". */
function slug(technology: string): string {
  return technology.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? "course";
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

/**
 * A full course across the five-level progression, built from a fixed template
 * so any technology gets a real ladder (not a two-lesson stub). Concepts chain
 * so the prerequisite graph is acyclic, and every lesson uses only base-build
 * capabilities. A live model would tailor this; the mock keeps the shape real.
 */
interface LessonTemplate {
  level: LessonInventoryEntry["level"];
  title: (tech: string) => string;
  purpose: (tech: string) => string;
  primaryCapability: string;
  concept: string; // the concept this lesson introduces
  requiredCapabilities: string[];
}

const COURSE_TEMPLATE: LessonTemplate[] = [
  { level: "intro", title: (t) => `Meet ${t}`, purpose: (t) => `Build a first mental model of ${t} by reading a complete, working example.`, primaryCapability: "Recognize the core workflow and read a complete example.", concept: "mental-model", requiredCapabilities: ["file-viewed", "code"] },
  { level: "beginner", title: (t) => `Your first ${t} task`, purpose: (t) => `Complete a small, guided ${t} task and prove the result.`, primaryCapability: "Complete a straightforward task using the course conventions.", concept: "core-workflow", requiredCapabilities: ["tests-run", "code"] },
  { level: "beginner", title: () => `Read a failing result`, purpose: (t) => `Read a failing ${t} result calmly and extract the facts that matter.`, primaryCapability: "Interpret a failure report before changing anything.", concept: "reading-failures", requiredCapabilities: ["diff-viewed", "code"] },
  { level: "intermediate", title: () => `Diagnose and repair`, purpose: (t) => `Find and fix a broken ${t} setup without changing what it protects.`, primaryCapability: "Diagnose a nontrivial failure and repair it surgically.", concept: "diagnosis", requiredCapabilities: ["any-command", "diff-viewed", "code"] },
  { level: "advanced", title: () => `Design under constraints`, purpose: (t) => `Design a ${t} solution from an incomplete problem statement.`, primaryCapability: "Design a robust solution and justify the tradeoffs.", concept: "design", requiredCapabilities: ["file-viewed", "code"] },
  { level: "expert", title: () => `Set the team conventions`, purpose: (t) => `Establish ${t} conventions others will follow, and defend them.`, primaryCapability: "Define standards and evaluate implementation quality.", concept: "governance", requiredCapabilities: ["file-viewed", "code"] },
];

function mockBlueprint(context?: Record<string, unknown>): Blueprint {
  const r = reqOf(context);
  const tech = r.technology!;
  const s = slug(tech);
  const inventory: LessonInventoryEntry[] = COURSE_TEMPLATE.map((t, i) => ({
    lessonId: `${s}-10${i + 1}`,
    level: t.level,
    sequence: i + 1,
    title: t.title(tech),
    purpose: t.purpose(tech),
    primaryCapability: t.primaryCapability,
    conceptsIntroduced: [t.concept],
    conceptsReinforced: i > 0 ? [COURSE_TEMPLATE[i - 1].concept] : [],
    prerequisites: i > 0 ? [`${s}-10${i}`] : [],
    requiredCapabilities: t.requiredCapabilities,
  }));
  const concepts = COURSE_TEMPLATE.map((t) => t.concept);
  return {
    domainMap: `# Domain map: ${tech}\n\nCapability areas: purpose & mental model, core operations, validation, failure handling, diagnosis, design, and governance.`,
    progressionSpine: `# Progression spine\n\nIntro → Beginner → Intermediate → Advanced → Expert: recognize the workflow, complete and verify tasks, diagnose failures, design under constraints, then set conventions.`,
    conventions: `# Conventions\n\nOne terminal lab per lesson; tasks named by the observable action; failures are taught, not hidden.`,
    planReview: `# Plan review\n\nCoverage across all five levels, prerequisites chain forward-only, autonomy and ambiguity increase per level.`,
    prerequisiteGraph: {
      concepts,
      edges: concepts.slice(1).map((c, i) => ({ from: concepts[i], to: c })),
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

/* ── curated curriculum packs (a real course, offline) ── */

interface CoursePack {
  request: CourseRequestDoc;
  blueprint: Blueprint;
  lessons: Record<string, LessonPlanDoc>;
}

/** A real, playable Git Fundamentals course — the offline stand-in for what a
 *  live model would generate. Its lessons materialize into real git labs. */
const GIT_PACK: CoursePack = {
  request: {
    title: "Git Fundamentals",
    technology: "Git",
    targetLearner: "A developer who uses Git occasionally but wants confident control of the working tree.",
    startingPoint: "Can clone a repo and has run a few git commands without a clear mental model.",
    endingCapability: "Confidently stages, commits, and discards changes, reasoning about working-tree state.",
    assumptions: ["The learner works in a terminal.", "A repository is already initialized in the lab."],
    outOfScope: ["Branching and merging", "Remotes and pull requests", "Rebasing"],
  },
  blueprint: {
    domainMap: "# Git domain map\n\nCapability areas: the working tree & index (what git is tracking), recording history (commit), and undoing local changes (restore/checkout).",
    progressionSpine: "# Progression spine\n\nBeginner: observe working-tree state → record a change with a commit → discard an unwanted change. Each lesson is a real repo you act on.",
    conventions: "# Conventions\n\nOne terminal lab per lesson over a real git repo; tasks named by the git action; a planted 'AI agent' change sets up each exercise.",
    planReview: "# Plan review\n\nTwo beginner lessons, prerequisite commit→restore, no forward references, both grounded in real git state.",
    prerequisiteGraph: {
      concepts: ["working-tree", "staging", "commit", "restore"],
      edges: [
        { from: "working-tree", to: "staging" },
        { from: "staging", to: "commit" },
        { from: "commit", to: "restore" },
      ],
    },
    lessonInventory: [
      {
        lessonId: "git-101",
        level: "beginner",
        sequence: 1,
        title: "Stage and commit a change",
        purpose: "Record an uncommitted change into history with git add and git commit.",
        primaryCapability: "Stage and commit a change so the working tree is clean.",
        conceptsIntroduced: ["staging", "commit"],
        conceptsReinforced: ["working-tree"],
        prerequisites: [],
        requiredCapabilities: ["any-command", "code"],
      },
      {
        lessonId: "git-102",
        level: "beginner",
        sequence: 2,
        title: "Discard an unwanted change",
        purpose: "Restore a tracked file to its committed contents, undoing a local edit.",
        primaryCapability: "Discard an unwanted working-tree change with git restore.",
        conceptsIntroduced: ["restore"],
        conceptsReinforced: ["working-tree", "commit"],
        prerequisites: ["git-101"],
        requiredCapabilities: ["any-command", "code"],
      },
    ],
  },
  lessons: {
    "git-101": {
      lessonId: "git-101",
      markdown: "# Stage and commit a change\n\n## Why this matters\nA change only becomes part of history when you commit it. Until then it lives in the working tree, at risk.\n\n## Task\nAn AI agent added `feature.txt` but didn't commit it. Stage it (`git add`) and commit it (`git commit`) so `git status` is clean.\n\n## Mastery evidence\n`git status` reports a clean tree and `feature.txt` is in the latest commit.\n",
      lab: { objective: "Stage and commit the pending change so the working tree is clean.", primaryAuto: "any-command", kind: "git-commit" },
    },
    "git-102": {
      lessonId: "git-102",
      markdown: "# Discard an unwanted change\n\n## Why this matters\nNot every edit is worth keeping. Git lets you restore a file to its committed state instead of hand-reverting it.\n\n## Task\nAn AI agent changed `config.txt` in a way you don't want. Discard the change (`git restore config.txt`) so the file matches what's committed.\n\n## Mastery evidence\n`config.txt` matches its committed contents.\n",
      lab: { objective: "Restore config.txt to its committed contents.", primaryAuto: "any-command", kind: "git-discard" },
    },
  },
};

/** A minimal real Selenium/TypeScript course — the offline stand-in whose
 *  setup lesson materializes a REAL node-deps lab (not the stub). Proves the
 *  node-deps kind end to end through the mock pipeline. */
const SELENIUM_DEPS = ["selenium-webdriver", "typescript", "tsx", "@types/selenium-webdriver"];
const SELENIUM_PACK: CoursePack = {
  request: {
    title: "Selenium WebDriver in TypeScript",
    technology: "Selenium",
    targetLearner: "A manual QA engineer moving into automated browser testing with TypeScript.",
    startingPoint: "Comfortable testing by hand; new to npm projects and Selenium.",
    endingCapability: "Sets up a Selenium + TypeScript project and writes a first automated browser test.",
    assumptions: ["The learner works in a Code Studio terminal (PowerShell).", "An empty project folder is provided."],
    outOfScope: ["CI pipelines", "Cross-browser grids", "Page Object frameworks"],
  },
  blueprint: {
    domainMap: "# Selenium domain map\n\nCapability areas: the npm project (package.json + dependencies), the WebDriver session, and locating/asserting on page elements.",
    progressionSpine: "# Progression spine\n\nBeginner: set up the project's dependencies → open a browser → find and assert on elements. Each lesson acts on a real project.",
    conventions: "# Conventions\n\nOne terminal lab per lesson over a real Node project; tasks named by the action; the project ships missing a piece the learner supplies.",
    planReview: "# Plan review\n\nOne beginner setup lesson grounded in a real package.json; no forward references.",
    prerequisiteGraph: { concepts: ["package.json", "dependency"], edges: [{ from: "package.json", to: "dependency" }] },
    lessonInventory: [
      {
        lessonId: "selenium-setup",
        level: "beginner",
        sequence: 1,
        title: "Set up your project dependencies",
        purpose: "Declare the four packages the course needs in package.json so the project can run.",
        primaryCapability: "Declare a project's dependencies in package.json.",
        conceptsIntroduced: ["package.json", "dependency"],
        conceptsReinforced: [],
        prerequisites: [],
        requiredCapabilities: ["file-edited", "code"],
      },
    ],
  },
  lessons: {
    "selenium-setup": {
      lessonId: "selenium-setup",
      markdown:
        "# Set up your project dependencies\n\n## Why this matters\nAn empty folder can't run anything. A project's `package.json` lists the packages it needs — its shopping list — before you install or run a line of code.\n\n## Task\nOpen `package.json` and add the four course packages to its `dependencies`: `selenium-webdriver`, `typescript`, `tsx`, and `@types/selenium-webdriver`. Then check your work.\n\n## Mastery evidence\n`package.json` declares all four dependencies.\n",
      lab: {
        objective: "Declare selenium-webdriver, typescript, tsx and @types/selenium-webdriver in package.json.",
        primaryAuto: "file-edited",
        kind: "node-deps",
        expectedPackages: SELENIUM_DEPS,
      },
    },
  },
};

const PACKS: Record<string, CoursePack> = { git: GIT_PACK, selenium: SELENIUM_PACK };

function packFor(context?: Record<string, unknown>): CoursePack | null {
  const tech = reqOf(context).technology;
  return PACKS[slug(tech ?? "")] ?? null;
}

/** The offline default responder used when no model provider is configured. */
export const defaultMockResponder: MockResponder = (role, prompt) => {
  const ctx = prompt.context;
  const pack = packFor(ctx);
  const tech = reqOf(ctx).technology ?? "the technology";
  // Every response carries the operator-facing `summary` the executor lifts
  // into the run's chat feed (agent.message), mirroring what live models are
  // instructed to add — so the chat panel works offline too.
  if (prompt.task === "course-request") {
    return JSON.stringify({ ...(pack?.request ?? mockCourseRequest(ctx)), summary: `Framed a ${tech} course: who it serves, where they start, and what they can do at the end.` });
  }
  if (prompt.task === "blueprint") {
    return JSON.stringify({ ...(pack?.blueprint ?? mockBlueprint(ctx)), summary: `Blueprinted the ${tech} course: lesson inventory, prerequisite graph, and conventions are ready for review.` });
  }
  if (prompt.task.startsWith("lesson:")) {
    const lessonId = (ctx?.lesson as LessonInventoryEntry | undefined)?.lessonId;
    const plan = pack && lessonId && pack.lessons[lessonId] ? pack.lessons[lessonId] : mockLessonPlan(ctx);
    return JSON.stringify({ ...plan, summary: `Drafted the "${lessonId ?? "lesson"}" plan with demonstration, guided practice, and a lab spec.` });
  }
  // The learner-advocate critique (Phase 2): satisfied on round 1 keeps the
  // offline pipeline fast; tests that exercise iteration pass their own responder.
  if (prompt.task.startsWith("critique:")) {
    return JSON.stringify({ satisfied: true, personaFit: { ok: true, issues: [] }, goalFit: { ok: true, issues: [] }, requiredChanges: [], summary: "No persona-fit or goal-fit objections — the draft stays within the persona's level and serves its stated goal." });
  }
  // Reviews are structured; a passing verdict keeps the default course moving.
  if (prompt.task.startsWith("review:pedagogy:")) return JSON.stringify({ scores: { priorKnowledge: 5, mentalModel: 5, activeLearning: 5, feedback: 5, mastery: 5 }, verdict: "approved", summary: "Pedagogy approved — full marks across the rubric." });
  if (prompt.task.startsWith("review:technical:")) return JSON.stringify({ verdict: "approved", issues: [], summary: "Technically sound — no correctness or currency issues found." });
  if (prompt.task.startsWith("review:cohesion:")) return JSON.stringify({ verdict: "approved", issues: [], summary: "Reads as one coherent journey — no cohesion issues." });
  // Lesson-revision runs: the goal (G1 artifact) and the improvement plan
  // (G2 artifact — a 1-lesson inventory the normal authoring path consumes).
  if (prompt.task === "revision-goal") {
    return JSON.stringify({
      goal: `Fix the orientation friction the experience report surfaced in ${String(ctx?.family ?? "the lesson")}: name the visible tools before the first task and give intermediate feedback.`,
      successCriteria: [
        "First-session learners no longer ask what the terminal/editor is",
        "Completion rate rises above 60% with fewer than 2 hints per session",
      ],
    });
  }
  if (prompt.task === "improvement-plan") {
    const family = String(ctx?.family ?? "lesson-101");
    const level = String(ctx?.level ?? "intro");
    return JSON.stringify({
      changePlan: [
        `# Change plan for ${family}`,
        ``,
        `1. Add an orientation paragraph naming Code Studio and the Trellis Guide before the first task (report finding 1).`,
        `2. Split the single check into an early encouraging verification plus the final one (report finding 2).`,
      ].join("\n"),
      lesson: {
        lessonId: family,
        level,
        sequence: 1,
        title: `Revised: ${family}`,
        purpose: "The same observable action, taught with an orientation-first opening.",
        primaryCapability: "file-edited",
        conceptsIntroduced: [],
        conceptsReinforced: [],
        prerequisites: [],
        requiredCapabilities: ["file-edited"],
      },
    });
  }
  // Persona interview (Phase 1): a deterministic three-turn interview that
  // progressively fills the profile, so the whole workbench flow runs offline.
  if (prompt.task === "persona-interview") {
    const transcript = (ctx?.transcript as Array<{ role: string; text: string }> | undefined) ?? [];
    const adminTurns = transcript.filter((m) => m.role === "admin").length;
    const seed = transcript.find((m) => m.role === "admin")?.text.trim() || "a working professional";
    const empty = {
      name: "", anticipatedKnowledgeLevel: "", anticipatedCapabilityLevel: "", background: "",
      goals: [] as string[], frustrations: [] as string[], vocabularyComfort: "",
      toolFamiliarity: [] as string[], behaviorUnderFriction: "", narrative: "",
    };
    if (adminTurns <= 1) {
      return JSON.stringify({
        reply: "Got it. What do they already KNOW coming in — which terms and concepts are familiar, and which would be new?",
        profile: { ...empty, name: `Persona: ${seed.slice(0, 60)}`, background: seed },
        complete: false,
      });
    }
    if (adminTurns === 2) {
      return JSON.stringify({
        reply: "That sharpens the knowledge picture. When they get stuck, what do they actually do — retry, search, ask someone, give up?",
        profile: {
          ...empty,
          name: `Persona: ${seed.slice(0, 60)}`,
          background: seed,
          anticipatedKnowledgeLevel: "Knows the vocabulary of their day job; has read about this technology but never used it hands-on.",
          anticipatedCapabilityLevel: "Can follow precise numbered steps; cannot yet adapt when a step's output differs from the example.",
          vocabularyComfort: "Everyday tooling terms are safe; this technology's jargon needs defining on first use.",
          toolFamiliarity: ["web browser", "text editor"],
        },
        complete: false,
      });
    }
    return JSON.stringify({
      reply: "This persona is specific enough to role-play. I've marked it complete — review the profile and mark it ready when you agree.",
      profile: {
        name: `Persona: ${seed.slice(0, 60)}`,
        background: seed,
        anticipatedKnowledgeLevel: "Knows the vocabulary of their day job; has read about this technology but never used it hands-on.",
        anticipatedCapabilityLevel: "Can follow precise numbered steps; cannot yet adapt when a step's output differs from the example.",
        goals: ["Become independently productive with the core workflow", "Stop relying on a teammate for routine tasks"],
        frustrations: ["Docs that assume unstated background", "Errors with no hint at the cause"],
        vocabularyComfort: "Everyday tooling terms are safe; this technology's jargon needs defining on first use.",
        toolFamiliarity: ["web browser", "text editor"],
        behaviorUnderFriction: "Re-reads the instructions once, retries once, then asks for help rather than experimenting.",
        narrative: `${seed}. New to this technology but motivated: follows precise steps well, needs terms defined on first use, and asks for help quickly when stuck rather than thrashing.`,
      },
      complete: true,
    });
  }
  // Course-idea intake (plan §3.2, the front door): deterministic so the
  // whole idea → autopilot flow is testable offline. Reuse the first READY
  // persona shown if the library has one; otherwise draft a complete new one.
  if (prompt.task === "suggest:persona") {
    const idea = (ctx?.idea as string | undefined)?.trim() || "a new technology";
    const readyPersonas = (ctx?.readyPersonas as Array<{ personaId: string; name: string }> | undefined) ?? [];
    const technology = idea.match(/[A-Za-z][A-Za-z0-9.+#-]*/)?.[0] ?? idea.slice(0, 40);
    if (readyPersonas.length > 0) {
      const first = readyPersonas[0];
      return JSON.stringify({
        technology,
        match: "existing",
        personaId: first.personaId,
        profile: null,
        rationale: `"${first.name}" already matches who this course is for — no need to draft a new persona.`,
      });
    }
    return JSON.stringify({
      technology,
      match: "new",
      personaId: null,
      profile: {
        name: `Persona: ${idea.slice(0, 60)}`,
        anticipatedKnowledgeLevel: "Knows adjacent, everyday tooling but has never used this technology directly.",
        anticipatedCapabilityLevel: "Can follow precise numbered steps; cannot yet adapt when a step's output differs from the example.",
        background: idea,
        goals: ["Become independently productive with the core workflow", "Stop relying on a teammate for routine tasks"],
        frustrations: ["Docs that assume unstated background", "Errors with no hint at the cause"],
        vocabularyComfort: "Everyday tooling terms are safe; this technology's jargon needs defining on first use.",
        toolFamiliarity: ["web browser", "text editor"],
        behaviorUnderFriction: "Re-reads the instructions once, retries once, then asks for help rather than experimenting.",
        narrative: `${idea}. New to this technology but motivated: follows precise steps well, needs terms defined on first use, and asks for help quickly when stuck rather than thrashing.`,
      },
      rationale: `No existing persona fits "${idea}" — drafted a new one anchored on the stated context.`,
    });
  }
  // Auto-gate (Autopilot §3.1): the mock gate-reviewer always approves, with a
  // reservation flagged for the human's after-the-fact review — lets the whole
  // autopilot pipeline (idea → published course) walk unattended offline.
  if (prompt.task.startsWith("gate:")) {
    return JSON.stringify({ decision: "approved", notes: [], reservations: ["mock gate-reviewer: auto-approved"] });
  }
  // Experience analysis: a deterministic report echoing the metrics it was
  // shown, with one finding per area class so UIs/tests exercise the routing.
  if (prompt.task.startsWith("experience:")) {
    const family = (ctx?.family as string) ?? prompt.task.slice("experience:".length);
    const version = (ctx?.version as number) ?? 1;
    const sessions = (ctx?.sessions as number) ?? 0;
    return JSON.stringify({
      family,
      version,
      sessionsAnalyzed: sessions,
      verdict: "revise",
      summary:
        `Mock analysis of ${sessions} recorded session(s) for ${family} v${version}. ` +
        `Learners stalled early and asked orientation questions; the lab's single check ` +
        `blocked completion. One platform-level error also appeared in transcripts.`,
      findings: [
        { severity: "high", area: "content", description: "The opening instructions assume tools the learner has not met yet.", evidence: "Learner quotes: orientation questions in the first minutes." },
        { severity: "medium", area: "lab-design", description: "The single verifier check gives no intermediate feedback.", evidence: "checkpoint.evaluated failures all blocked on one requirement." },
        { severity: "low", area: "platform", description: "Environment errors appeared in the terminal.", evidence: "Terminal error lines in session transcripts." },
      ],
      recommendations: [
        { findingIndex: 0, change: "Add a short orientation paragraph naming each visible tool before the first task.", rationale: "Removes the first-minutes confusion the quotes show." },
        { findingIndex: 1, change: "Split the task into two checkpoints with an early, encouraging verification.", rationale: "Intermediate feedback converts stalls into progress." },
      ],
    });
  }
  return "{}";
};
