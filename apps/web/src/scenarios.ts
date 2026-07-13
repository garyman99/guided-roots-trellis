/**
 * Scenario launcher entries for the post-login home page. Each scenario is a
 * curated way into the virtual desktop: it launches the app with a specific
 * lab preloaded (labId must match a directory under labs/).
 */

export interface Scenario {
  labId: string;
  /** Learner-facing name on the home page (may differ from the lab's title). */
  title: string;
  blurb: string;
  /** Mono tag line: subject area, uppercase. */
  tag: string;
}

export const scenarios: Scenario[] = [
  {
    labId: "turn-heading-check-into-first-test",
    title: "Write Playwright tests for a web app",
    blurb:
      "Take one manual expected result — a visible page heading — and turn it into your first automated Playwright check: find the heading the way a visitor would, then assert it is visible.",
    tag: "PLAYWRIGHT · FIRST TEST",
  },
  {
    labId: "read-one-failing-result-before-editing",
    title: "Read a failing test before touching anything",
    blurb:
      "One prepared Playwright check fails on purpose. Read past the red headline and record the four facts that matter: test name, location, expected, received.",
    tag: "PLAYWRIGHT · EVIDENCE",
  },
  {
    labId: "learn-playwright-basics",
    title: "Fix a broken Playwright test",
    blurb:
      "Read an end-to-end test, run the suite, understand the failure report, and repair the test itself — without touching the app it tests.",
    tag: "PLAYWRIGHT · REPAIR",
  },
  {
    labId: "inspect-generated-changes",
    title: "Inspect AI-generated changes before accepting them",
    blurb:
      "An AI coding agent left an uncommitted change: the feature you asked for, plus one subtle defect. Review the diff with Git, fix the defect surgically, keep the feature.",
    tag: "GIT · AI REVIEW",
  },
  {
    labId: "review-content-changes",
    title: "Review an agent's content-pipeline changes",
    blurb:
      "Inspect an AI agent's change to a blog engine's text utilities, find the behavior it quietly broke, and fix it while keeping what it added.",
    tag: "GIT · AI REVIEW",
  },
  {
    labId: "improve-delayed-order-reply",
    title: "Improve a customer reply with an AI helper",
    blurb:
      "Work a realistic support inbox: use an AI helper to draft a better delayed-order reply, then make the judgment calls the helper can't.",
    tag: "AI COLLABORATION",
  },
];
