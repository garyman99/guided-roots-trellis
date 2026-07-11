---
schema_version: "1.1"
run_id: "20260711T132922-0600"
created_at: "2026-07-11"
scenario_count: 2
repository_baseline:
  repository_url: "https://github.com/garyman99/guided-roots-trellis.git"
  branch: "main"
  commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
difficulty_range:
  minimum: 1
  maximum: 2
portfolio:
  current_edge_count: 2
  frontier_count: 0
---

# Repository Assessment

Clone record: the ignored `trellis-source` checkout was inspected on 2026-07-11. Its origin is `https://github.com/garyman99/guided-roots-trellis.git`. Origin was fetched, `main` was checked out, and the checkout was fast-forwarded to `origin/main` at `904c8fb7b9368059bac45d08fae0749175dc4e65`. The checkout was clean after synchronization and remained read-only during inspection.

Clearly implemented and verified in repository evidence: disposable lab workspaces, deterministic checkpoints, event-sourced observations, instructor hint policy, authored lab variants, reset, and a Docker-backed `learn-playwright-basics` lab. That lab teaches a novice QA learner to review an AI-authored test change, read failure output, distinguish locator from assertion problems, and surgically repair a planted defect. Partially implemented or environment-sensitive: the browser workspace and live Docker journey are documented as exercised, while a post-test file-change race can leave the learner-visible task state stale even when the authoritative checkpoint passes. Documented but not re-run in this design-only routine: the complete learner journey and every Playwright variant. Missing or ambiguous: current scenario coverage for a learner authoring a first Playwright test manually from a blank test slot, without an AI-authored change; semantic evidence that distinguishes thoughtful manual authoring from copying; and novice-oriented coaching around retrying assertions without prescribing a particular editor UI.

# Scenario Selection Rationale

Both scenarios are BASIC CURRENT-EDGE exercises for a manual QA engineer learning to write Playwright tests manually. They use the existing community-garden subject and current deterministic lab strengths while changing the learner action from reviewing AI output to authoring a small test. Scenario 1 isolates translating one manual observation into a discoverable heading check. Scenario 2 isolates checking the result of one button action with a retrying, user-visible assertion. Each has one transferable concept, fictional data, recoverable novice mistakes, and no learner access to or use of AI.

# Coverage Matrix

| Scenario | Class | Difficulty | Persona | Applications | Primary capability | New product pressure |
|---|---|---:|---|---|---|---|
| Turn a heading check into a first test | CURRENT-EDGE | 1 | Manual QA engineer | browser, code editor, test runner | Translate a manual check into locate-and-assert structure | Manual authoring evidence and minimal novice coaching |
| Check a form result without timing guesses | CURRENT-EDGE | 2 | Manual QA engineer | browser, code editor, test runner | Use a retrying visible-outcome assertion after an action | Failure-led recovery from a fixed-wait instinct |

# Current-Edge vs. Frontier Balance

The user-directed balance is two current-edge and zero frontier. This is appropriate for a deliberately basic manual-authoring routine: both scenarios should be near-term additions to the existing Playwright lab family and should require no major product redesign. The portfolio still applies useful pressure by challenging the assumption that beginner Playwright learning begins with reviewing an AI-generated change.

# Duplication Review

The closest current coverage is `labs/learn-playwright-basics`, including its `stale-welcome-copy` and `ambiguous-button-locator` variants. That lab starts with an AI coding agent's uncommitted edits, requires diff inspection, and asks the learner to fix an existing test while preserving the agent's requested test. The two new scenarios contain no AI-authored change, no planted product-versus-test dispute, no Git review goal, and no request to repair the existing variants. The prior outbox run covers AI-assisted email work, hallucination review, reset recovery, keyboard-only cross-application work, and AI outage continuity; neither new scenario overlaps those tasks. Scenario 1 differs from Scenario 2 because it is observation-only and teaches locating plus asserting, while Scenario 2 begins with an interaction and teaches waiting through an outcome assertion.

# Boundary Challenges

- A beginner Playwright scenario can begin from a manual test step, not an AI-generated diff.
- Learner-authored code can be the artifact even though the scenario specification contains no executable code.
- One scenario should teach one concept rather than combining Git review, debugging, locators, assertions, and product diagnosis.
- Completion should depend on deterministic behavior and observable authoring evidence, not an instructor's claim.
- The learner must be able to complete the lesson without invoking AI.
- Equivalent accessible locators and equivalent user-visible assertions should remain valid.

# Recommended Execution Order

1. Turn a heading check into a first test.
2. Check a form result without timing guesses.

# Expected Product Pressure

These scenarios pressure workspace orientation, manual test-file editing, concise instructor restraint, semantic observation of test runs and edits, deterministic evaluation of learner-authored tests, safe reset, clear failure explanations, and evidence that no learner AI interaction occurred. They do not require profile adaptation, external model orchestration, cross-session behavior, or remote actions.
