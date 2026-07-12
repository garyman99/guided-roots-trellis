---
schema_version: "1.1"
scenario_id: "turn-heading-check-into-first-test"
title: "Turn a Heading Check Into a First Playwright Test"
created_at: "2026-07-11"
generator_run_id: "20260711T132922-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 1
  label: "Guided, single application, obvious objective"
  rationale: "The learner translates one visible manual check into one small test using a prepared workspace and explicit guidance."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "learn-playwright-basics:stale-welcome-copy"
    - "learn-playwright-basics:ambiguous-button-locator"
  capability_gap: "A novice manual QA engineer authors a first Playwright check without receiving or reviewing AI-written code."
  implementation_assumptions_to_avoid:
    - "Beginner Playwright learning must start from an AI-authored diff."
    - "Only one exact locator spelling can demonstrate the concept."
    - "A passing test alone proves that the learner understood the manual check."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.manual-to-automation"
  applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.locate-visible-content"
    - "playwright.assert-visible-outcome"
  experience_qualities:
    - "clarity"
    - "psychological-safety"
    - "transferable-learning"
persona:
  name: "Maya Torres"
  role: "Manual QA engineer beginning Playwright"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Writes manual checks with expected results."
    - "Can identify headings and other visible page content."
    - "Has not authored an automated browser test."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "brief"
    prefers_examples: true
  accessibility_context: []
  behavioral_tendencies:
    - "Reads the prepared manual check before editing."
    - "May first describe the heading without asserting it."
    - "Uses failure output when it is explained in plain language."
learning:
  primary_objective: "Translate one manual expected result into a Playwright locate-and-assert check."
  supporting_objectives:
    - "Recognize that the locator identifies the user-visible target and the assertion states the expectation."
  expected_profile_evidence:
    - "Authored and ran a test that checks the seeded heading through a user-facing locator."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "A disposable community-garden page, a prepared test file with one clearly marked empty test body, and a local test runner are available. No AI assistant, AI chat, generated suggestion, or agent-authored change is present."
  seeded_artifacts:
    - id: "garden-page"
      type: "file"
      description: "A fictional public signup page whose visible main heading is Community Garden Signup."
      data_classification: "public"
    - id: "manual-heading-check"
      type: "document"
      description: "Manual check: open the signup page and confirm that the Community Garden Signup heading is visible."
      data_classification: "public"
    - id: "prepared-test-slot"
      type: "code"
      description: "A valid test file with navigation already prepared and one empty learner-authored check; it contains no solution text."
      data_classification: "internal"
  available_applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "The page and runner are local and disposable."
    - "No external service, repository, or person is contacted."
    - "The learner cannot invoke AI and receives no generated code."
  reset_expectation: "Restore the seeded page, manual check, and empty prepared test slot exactly; remove learner edits and run results."
task:
  learner_goal: "Write and run one Playwright test that confirms the page's main heading is visible."
  learner_facing_prompt: "You already check this heading by hand. In the prepared test slot, turn that one manual check into an automated check. Find the heading by information a visitor can perceive, state that it should be visible, save, and run the test. Write it yourself; this exercise does not use AI."
  constraints:
    - "Change only the prepared test slot."
    - "Use the visible heading as the test target."
    - "Do not invoke AI, paste generated code, or use an AI assistant."
    - "Do not modify the page to make the test pass."
  hidden_complications:
    - "The learner may create a locator but omit the assertion."
  acceptable_strategies:
    - "Use any Playwright locator grounded in the heading's user-visible role or text, followed by a visibility assertion."
    - "Run once after drafting or run earlier to inspect feedback."
  prohibited_shortcuts:
    - "Changing the page."
    - "Removing, skipping, or replacing the prepared check with a non-asserting action."
    - "Invoking any AI capability or using pre-generated solution code."
user_simulation:
  initial_behavior: "Maya opens the manual check and the prepared test slot, then tries to map the expected result into the test."
  decision_policy:
    - "Use only learner-visible page content, documentation, editor feedback, and runner output."
    - "Attempt a small edit before requesting help."
    - "Prefer a locator that describes what the visitor perceives."
  realistic_questions:
    - "Which part says what I am looking for?"
    - "Where do I say that the heading must be visible?"
    - "Do I need to click anything for this check?"
  mistakes:
    - trigger: "First edit in the empty test body."
      action: "Creates or identifies the heading locator but does not make an assertion about visibility."
      expected_recovery: "After a concept-level prompt, adds the missing expectation and reruns the check."
  help_behavior:
    request_help_after: "The first run fails, does not execute a meaningful assertion, or Maya cannot explain the two parts of the check."
    response_to_weak_help: "Asks which part of the manual step is still missing."
    response_to_effective_help: "States that finding and checking are separate jobs, then completes the assertion herself."
  stopping_conditions:
    - "All completion gates pass."
    - "The local editor or runner is genuinely unavailable after one reset attempt."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator information or implementation internals."
    - "Do not use AI, generated suggestions, or a solution artifact."
    - "Do not behave like an evaluator or modify the seeded page."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner-authored check locates the seeded main heading using user-visible meaning."
        evidence:
          - "Final test artifact and semantic locator classification."
      - id: "gate-2"
        description: "The check asserts that the heading is visible rather than merely locating it."
        evidence:
          - "Final test artifact and deterministic assertion inspection."
      - id: "gate-3"
        description: "The authored check runs and passes against the unchanged seeded page."
        evidence:
          - "Deterministic test result and page-integrity check."
      - id: "gate-4"
        description: "No learner AI capability was invoked and no generated solution was supplied."
        evidence:
          - "Available-capability record and learner interaction trace."
  quality_dimensions:
    - id: "manual-to-automation-transfer"
      weight: 30
      definition: "The learner connects the manual target and expected result to locator and assertion."
      exceptional:
        - "Maya can explain both parts in her own words and the artifact reflects them."
      acceptable:
        - "The correct two-part check is completed with a concept-level hint."
      poor:
        - "The learner copies a shape without connecting it to the manual check."
    - id: "artifact-correctness"
      weight: 30
      definition: "The test meaningfully verifies the heading and passes without page changes."
      exceptional:
        - "The check is focused, readable, and grounded in user-visible meaning."
      acceptable:
        - "An equivalent valid locator and visibility assertion pass."
      poor:
        - "The artifact has no assertion, targets unrelated content, or alters the page."
    - id: "instructional-effectiveness"
      weight: 25
      definition: "Guidance teaches the distinction without writing the learner's test."
      exceptional:
        - "A brief question helps Maya identify the missing concept herself."
      acceptable:
        - "A direct conceptual explanation enables recovery."
      poor:
        - "Guidance supplies a completed solution or introduces unrelated concepts."
    - id: "novice-experience"
      weight: 15
      definition: "The exercise feels safe, bounded, and clear to a first-time author."
      exceptional:
        - "Progress and failure language are calm, specific, and immediately actionable."
      acceptable:
        - "The learner can recover without shame or hidden knowledge."
      poor:
        - "Jargon, ambiguity, or blame creates avoidable confusion."
  critical_failures:
    - id: "ai-used-or-solution-generated"
      severity: "blocker"
      description: "The learner invokes AI or the experience supplies generated solution code."
      evidence: "Capability and interaction trace."
    - id: "page-changed"
      severity: "blocker"
      description: "The seeded page is changed to satisfy the test."
      evidence: "Page-integrity comparison."
    - id: "no-meaningful-assertion"
      severity: "blocker"
      description: "The final artifact passes without checking heading visibility."
      evidence: "Deterministic artifact inspection."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor authors or pastes the completed test for the learner."
      evidence: "Instructor and edit trace."
  positive_signals:
    - "The learner names the page target before editing."
    - "The learner distinguishes finding from checking."
    - "The final check uses user-visible meaning."
  negative_signals:
    - "A passing result is accepted without verifying that an assertion ran."
    - "The instructor introduces selectors, waits, fixtures, or Git review unnecessarily."
    - "Any AI surface appears in the learner path."
  allowed_variance:
    - "Equivalent role-based or text-based locator choices that uniquely identify the heading."
    - "Equivalent visibility assertions supported by the prepared environment."
    - "Running the test before or after asking a question."
    - "Earlier help requests and equivalent plain-language explanations."
  evidence_requirements:
    - "Initial and final prepared-test artifact."
    - "Semantic edit trace sufficient to distinguish locator and assertion work without retaining raw keystrokes."
    - "Test run result and assertion count or equivalent deterministic proof."
    - "Seeded page integrity before and after."
    - "Instructor interaction trace."
    - "Record showing that no learner AI capability was available or invoked."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "The learner can see the single target and the two conceptual parts of the check."
    positive_evidence:
      - "Guidance consistently separates locate from assert in plain language."
    violation_evidence:
      - "Instructions mix in unrelated setup or debugging tasks."
    violation_severity: "major"
  - value: "psychological-safety"
    importance: "high"
    definition: "A first incomplete attempt is treated as normal learning."
    positive_evidence:
      - "Feedback neutrally identifies the missing expectation."
    violation_evidence:
      - "The learner is blamed, shamed, or described as careless."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner understands a pattern usable for other visible page facts."
    positive_evidence:
      - "Maya can describe choosing a target and stating an expectation."
    violation_evidence:
      - "Success depends on memorizing a Trellis-only control sequence."
    violation_severity: "major"
  - value: "instructional-restraint"
    importance: "high"
    definition: "The experience gives only the help needed for this one concept."
    positive_evidence:
      - "Hints remain conceptual and stop after recovery."
    violation_evidence:
      - "The instructor writes the solution or expands into unrelated Playwright topics."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-heading-check"
    type: "code-change"
    required_properties:
      - "Learner-authored change is confined to the prepared test slot."
      - "Locates the Community Garden Signup heading by user-visible meaning."
      - "Includes a visibility assertion and passes deterministically."
    forbidden_properties:
      - "Executable solution text embedded in this scenario specification."
      - "Page modification, skipped test, generated code, or AI provenance."
downstream_guidance:
  product_capabilities_needed:
    - "A manual-authoring mode with no AI surface or generated completion."
    - "A prepared editable test slot, local browser target, runner, and plain-language progress."
  test_harness_needs:
    - "Seed and reset the exact page and prepared test slot."
    - "Deterministically classify the final locator and assertion semantics and verify page integrity."
    - "Expose whether any AI capability was available or invoked."
  evaluator_needs:
    - "Initial/final artifact, run result, semantic interaction trace, instructor trace, and page-integrity result."
  intentional_unknowns:
    - "Exact editor, layout, test filename, locator spelling, assertion spelling, and runner presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "first-test"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Maya is a manual QA engineer writing her first Playwright check. She turns one familiar manual expected result - a visible page heading - into one automated locate-and-assert check. The small scope makes the exercise educationally useful: it isolates the core structure without mixing in clicks, timing, Git review, or defect diagnosis. This is CURRENT-EDGE because Trellis already has a Playwright lab, a code workspace, deterministic test execution, and novice coaching; the new pressure is genuinely manual authoring with AI absent.

# Relationship to Existing Coverage

The closest coverage is `labs/learn-playwright-basics`, whose two variants ask a learner to review an AI agent's uncommitted changes and repair either stale expected text or an ambiguous locator. That lab already introduces locators, assertions, failure output, Git diff review, and the rule that the app is fixed ground truth. This scenario is materially different: the test slot begins empty, no AI agent has changed anything, no planted defect exists, and the learner creates a new observation-only check from a manual step. It challenges the assumption that the first Playwright experience should be code review and is not a duplicate of either repair variant.

# Learner-Facing Setup

You already know how to check a page heading by hand. Open the prepared test slot and turn that one step into an automated check: identify the Community Garden Signup heading the way a visitor would, say that it should be visible, save, and run the check. Write it yourself. There is no AI assistant in this exercise, and the page is a safe local simulation.

# Seeded Environment

The disposable workspace contains the fictional community-garden page, the exact manual heading check, a valid test file with navigation already prepared, and one empty test body for Maya. The browser, editor, and runner are local. The page content is public fictional data; the test workspace is internal simulation data. No AI chat, code completion, agent change, external network access, real account, or personal data exists. Reset restores the original page and empty test slot.

# User-Simulation Instructions

Behave as Maya, not as a QA evaluator. Use only the visible manual step, page, editor guidance, local documentation, and test output. Make one reasonable first attempt. If the specified mistake occurs, locate the heading but omit the expectation, then respond to coaching by explaining what is missing and adding it yourself. Ask believable beginner questions, accept clear help, and do not sabotage the environment. Do not inspect source internals, hidden evaluator facts, or solutions. Never invoke AI or accept generated code.

# Expected Experience

Orientation should make the manual check, prepared test slot, and local runner obvious. Guidance should use plain language before introducing a term, distinguish "find the heading" from "check that it is visible," and avoid providing completed code. A run with no meaningful assertion should produce calm, actionable feedback rather than false progress. Hints should arrive after observable uncertainty or failure, stop once Maya recovers, and never expand into unrelated Playwright concepts. Progress should distinguish saved, ran, passed, and completed. Completion should invite a short reflection about the two-part pattern. No persistent profile update is needed; any future inferred preference would require confirmation.

# Required Observable Evidence

Completion evidence: the final artifact contains a user-meaningful heading locator plus a visibility assertion, the check passes, the page is unchanged, and no AI interaction occurred. Quality evidence: Maya's edit sequence and explanation show the manual target became the locator target and the manual expected result became the assertion. Adaptation evidence: none is required beyond appropriate hint timing in this run. Safety evidence: the workspace is local, resettable, fictional, and has no external action or AI surface. Do not store raw keystrokes, transient incomplete source beyond what evaluation requires, or any invented learner trait as profile truth.

# Completion Gate

All four front-matter gates are non-negotiable. A green process exit without a meaningful visibility assertion is incomplete. A correct-looking artifact that was generated by AI is also incomplete. Completion is separate from quality: Maya may pass the gate with direct conceptual help while earning less than an exceptional experience score.

# Evaluation Rubric

Score manual-to-automation transfer (30), artifact correctness (30), instructional effectiveness (25), and novice experience (15), totaling 100. For each dimension, use the exceptional, acceptable, and poor anchors in front matter and cite artifact or trace evidence. Cap the overall score below 75 if Maya cannot distinguish target from expectation. Any failed completion gate yields a failed completion verdict regardless of score. Any critical failure blocks an exceptional rating; AI use, page modification, or absence of a meaningful assertion fails completion.

# Experience Values

Clarity, psychological safety, transferable learning, and instructional restraint govern the experience. The learner should leave with a reusable two-part mental model, recover from an ordinary incomplete first attempt without shame, and remain the author. Evaluate each value from observable evidence, not tone alone, using the severities in front matter.

# Critical Failures

Block completion for learner AI use or generated solution code, modifying the seeded page, or finishing without a meaningful visibility assertion. Block an exceptional rating if the instructor takes over, success is reported without deterministic evidence, the learner is shamed, reset is unreliable, or completion requires implementation internals.

# Allowed Variance

Do not penalize equivalent user-facing locator strategies, equivalent visibility assertions, a test run before the first help request, earlier help, different editor navigation, or equivalent plain-language explanations. Do penalize brittle implementation-only targeting when it bypasses the user-visible learning goal, even if it happens to pass.

# Downstream Implementation Guidance

Provide a deterministic, manually editable test slot and a local page/runner with AI unavailable. Seed enough structure that the learner works only on the target concept; do not embed a solution. Make edits, runs, assertion execution, page integrity, and AI-capability usage semantically observable. Reset must restore the exact initial state. Downstream agents should choose the editor and validation approach and accept equivalent locator/assertion forms. Current Git-diff-first and agent-change patterns must not constrain this scenario. Do not infer exact components, routes, selectors, APIs, schemas, or filenames from this document.

# Evaluator Instructions

Inspect the learner trace, semantic edit/run events, instructor interactions, initial and final artifact, deterministic completion result, page integrity, timing, recovery, reset evidence if used, and proof that learner AI was unavailable and unused. Profile state should remain unchanged unless an explicit confirmed update exists. Do not award completion from a passing exit code alone. Return exactly:

# Evaluation Result
## Verdict
- Completion gate: PASS | FAIL
- Overall score: 0-100
- Exceptional threshold met: YES | NO
- Critical failures: NONE | list
## Dimension Scores
| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
## Experience Value Assessment
| Value | Result | Evidence |
|---|---|---|
## What Worked Exceptionally Well
## Friction and Failures
## Highest-Leverage Improvements
1. ...
2. ...
3. ...
## Product Defects vs. Scenario or User-Agent Issues
## Evidence Gaps
## Final Determination
EXCEPTIONAL | GOOD BUT NOT EXCEPTIONAL | NEEDS IMPROVEMENT | FAILED

# Coding-Agent Feedback Contract

For every actionable finding, return:

finding_id: "stable-id"
severity: "blocker | high | medium | low"
category: "ux | instruction | adaptation | safety | accessibility | reliability | performance | evaluation | profile | other"
observed_behavior: "What happened"
expected_behavior: "What should have happened"
evidence:
- "Trace or artifact reference"
affected_values:
- "experience-value"
learner_impact: "Why it matters"
reproduction_conditions:
- "Relevant conditions"
acceptance_evidence:
- "What a future run must demonstrate"
implementation_constraints:
- "Preserve manual authorship, no learner AI, deterministic truth, and equivalent valid locator/assertion paths without dictating implementation."

# Future Progression

A harder follow-up asks the learner to check a short list containing a named item. A transfer scenario applies the same locate-and-assert model to an error message in a different fictional form. A likely regression scenario ensures the evaluator rejects a passing test with no meaningful assertion. This scenario becomes too easy once Maya can independently translate varied manual expected results. Trellis must not overfit to the exact garden heading, one locator spelling, or one editor path.

