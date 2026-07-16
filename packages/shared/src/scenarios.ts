/**
 * The scenario catalog SEED — the hand-authored entries every deployment ships
 * with. This is the API-side source of truth (the web app fetches the merged
 * catalog from GET /api/scenarios rather than compiling it in), so a
 * course-generation run can add runtime entries at materialization without a
 * web rebuild (plan D2).
 *
 * A scenario is a curated way into the virtual desktop: it launches the app
 * with a specific lab preloaded (labId must resolve to a lab the API can load,
 * repo or published). The marketplace facets (role / technologies / level) are
 * presentation metadata, not learner truth.
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

export const SCENARIO_SEED: Scenario[] = [
  {
    labId: "turn-heading-check-into-first-test",
    title: "Write Playwright tests for a web app",
    blurb:
      "Take one manual expected result — a visible page heading — and turn it into your first automated Playwright check: find the heading the way a visitor would, then assert it is visible.",
    tag: "PLAYWRIGHT · FIRST TEST",
    role: "QA & Testing",
    technologies: ["Playwright", "JavaScript"],
    level: "beginner",
  },
  {
    labId: "read-one-failing-result-before-editing",
    title: "Read a failing test before touching anything",
    blurb:
      "One prepared Playwright check fails on purpose. Read past the red headline and record the four facts that matter: test name, location, expected, received.",
    tag: "PLAYWRIGHT · EVIDENCE",
    role: "QA & Testing",
    technologies: ["Playwright"],
    level: "beginner",
  },
  {
    labId: "learn-playwright-basics",
    title: "Fix a broken Playwright test",
    blurb:
      "Read an end-to-end test, run the suite, understand the failure report, and repair the test itself — without touching the app it tests.",
    tag: "PLAYWRIGHT · REPAIR",
    role: "QA & Testing",
    technologies: ["Playwright", "JavaScript"],
    level: "intermediate",
  },
  {
    labId: "inspect-generated-changes",
    title: "Inspect AI-generated changes before accepting them",
    blurb:
      "An AI coding agent left an uncommitted change: the feature you asked for, plus one subtle defect. Review the diff with Git, fix the defect surgically, keep the feature.",
    tag: "GIT · AI REVIEW",
    role: "Software Development",
    technologies: ["Git", "AI agents", "TypeScript"],
    level: "intermediate",
  },
  {
    labId: "review-content-changes",
    title: "Review an agent's content-pipeline changes",
    blurb:
      "Inspect an AI agent's change to a blog engine's text utilities, find the behavior it quietly broke, and fix it while keeping what it added.",
    tag: "GIT · AI REVIEW",
    role: "Software Development",
    technologies: ["Git", "AI agents", "TypeScript"],
    level: "intermediate",
  },
  {
    labId: "improve-delayed-order-reply",
    title: "Improve a customer reply with an AI helper",
    blurb:
      "Work a realistic support inbox: use an AI helper to draft a better delayed-order reply, then make the judgment calls the helper can't.",
    tag: "AI COLLABORATION",
    role: "Customer Support",
    technologies: ["AI tools"],
    level: "beginner",
  },
];

/**
 * The served catalog: seed entries overlaid by runtime entries (a runtime entry
 * with the same labId wins, so a generated course can supersede a seed blurb).
 * Order: seed order first, then any runtime-only entries in their given order.
 */
export function mergeScenarios(seed: Scenario[], runtime: Scenario[]): Scenario[] {
  const byId = new Map(seed.map((s) => [s.labId, s]));
  const extras: Scenario[] = [];
  for (const r of runtime) {
    if (byId.has(r.labId)) byId.set(r.labId, r);
    else extras.push(r);
  }
  return [...seed.map((s) => byId.get(s.labId)!), ...extras];
}
