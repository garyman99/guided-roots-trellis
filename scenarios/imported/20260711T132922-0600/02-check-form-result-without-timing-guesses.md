---
schema_version: "1.1"
scenario_id: "check-form-result-without-timing-guesses"
title: "Check a Form Result Without Timing Guesses"
created_at: "2026-07-11"
generator_run_id: "20260711T132922-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 2
  label: "Guided, multiple steps, low ambiguity"
  rationale: "The learner performs one form action and checks one visible result, recovering from a realistic fixed-delay instinct with guided failure evidence."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "turn-heading-check-into-first-test"
  capability_gap: "A novice manually authors a click-result test and learns to let a retrying assertion observe readiness rather than guessing a delay."
  implementation_assumptions_to_avoid:
    - "Timing should be taught through arbitrary sleeps."
    - "Only the exact existing garden test wording is valid."
    - "The instructor should repair flaky test logic for the learner."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.reliable-automation"
  applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.perform-user-action"
    - "playwright.retrying-visible-assertion"
  experience_qualities:
    - "recoverability"
    - "clarity"
    - "transferable-learning"
persona:
  name: "Eli Bennett"
  role: "Manual QA engineer learning to automate form checks"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Manually submits forms and checks confirmation messages."
    - "Completed or understands a basic observation-only Playwright check."
    - "Has heard that automation sometimes needs waits but does not know Playwright's waiting model."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "normal"
    prefers_examples: false
  accessibility_context: []
  behavioral_tendencies:
    - "Writes steps in the same order as a manual test."
    - "May add a fixed delay when the confirmation is not immediately available."
    - "Responds well to questions about what observable result proves readiness."
learning:
  primary_objective: "Use a retrying assertion on a user-visible result instead of guessing how long the page needs."
  supporting_objectives:
    - "Keep action and expected outcome together in one focused test."
  expected_profile_evidence:
    - "Authored a passing interaction test whose readiness is expressed by the expected confirmation."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "A disposable fictional registration form, a short manual test case, and a prepared test body with page navigation are available. AI features and generated suggestions are absent."
  seeded_artifacts:
    - id: "workshop-registration-page"
      type: "file"
      description: "A fictional local form with a Register button and a confirmation region that displays Registration saved after a short deterministic delay."
      data_classification: "public"
    - id: "manual-registration-check"
      type: "document"
      description: "Manual steps: open the page, activate Register, and confirm that Registration saved appears."
      data_classification: "public"
    - id: "prepared-action-test-slot"
      type: "code"
      description: "A valid test file with setup and one empty learner-authored test body; no solution or fixed wait is seeded."
      data_classification: "internal"
  available_applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "Registration is entirely fictional and local."
    - "No real submission, account, network service, or personal data exists."
    - "The learner cannot invoke AI and receives no generated code."
  reset_expectation: "Restore the pristine form, deterministic delay, empty prepared test slot, and initial runner state."
task:
  learner_goal: "Write and run one reliable Playwright test for the visible result of selecting Register."
  learner_facing_prompt: "Automate this manual check yourself: activate Register and confirm that Registration saved appears. Let the expected page result tell Playwright when the page is ready; do not add a guessed pause. This exercise has no AI assistant."
  constraints:
    - "Change only the prepared test slot."
    - "Interact through user-visible meaning and check the visible confirmation."
    - "Do not add a fixed-duration sleep or guessed delay."
    - "Do not invoke AI, generated suggestions, or external help services."
    - "Do not modify the page or its deterministic delay."
  hidden_complications:
    - "The confirmation appears after a small deterministic delay, making a fixed wait tempting but unnecessary."
  acceptable_strategies:
    - "Use any user-meaningful control locator and a Playwright assertion that retries until the visible confirmation reaches the expected state."
    - "Run the test more than once to build confidence in reliability."
  prohibited_shortcuts:
    - "Fixed-duration waiting, changing the page delay, bypassing the user action, skipping the check, or invoking AI."
user_simulation:
  initial_behavior: "Eli maps the manual sequence into an action followed by a check."
  decision_policy:
    - "Use only learner-visible documentation, the local page, editor, and runner output."
    - "When timing is uncertain, initially consider or add one short fixed delay."
    - "Replace the timing guess when coaching points back to the observable expected result."
  realistic_questions:
    - "How long should I wait after the click?"
    - "Can the confirmation itself be what I wait for?"
    - "How do I know this is reliable rather than lucky?"
  mistakes:
    - trigger: "The first run or draft reaches the delayed confirmation step."
      action: "Adds or proposes a fixed-duration pause before checking the message."
      expected_recovery: "Removes the pause, uses the retrying visible-result assertion as the readiness condition, and reruns the test."
  help_behavior:
    request_help_after: "A fixed delay is added/proposed or a run fails because the confirmation is checked only once."
    response_to_weak_help: "Asks for a recommended number of milliseconds."
    response_to_effective_help: "Identifies Registration saved as the real readiness signal and revises the test himself."
  stopping_conditions:
    - "All completion gates pass, including repeated deterministic runs."
    - "The local page or runner remains unavailable after reset."
  anti_cheating_rules:
    - "Do not inspect hidden timing constants, evaluator data, or implementation internals."
    - "Do not use AI or generated code."
    - "Do not alter the application or bypass the Register interaction."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner-authored test activates the Register control through user-visible meaning."
        evidence:
          - "Final artifact and semantic interaction classification."
      - id: "gate-2"
        description: "The test uses a retrying assertion on the visible Registration saved result."
        evidence:
          - "Final artifact and deterministic assertion classification."
      - id: "gate-3"
        description: "The final artifact contains no fixed-duration wait, hidden timing dependency, or page modification."
        evidence:
          - "Artifact and page-integrity inspection."
      - id: "gate-4"
        description: "The test passes on three consecutive clean runs with the authored deterministic delay."
        evidence:
          - "Three reset-isolated run results."
      - id: "gate-5"
        description: "No learner AI capability was invoked and no generated solution was supplied."
        evidence:
          - "Available-capability record and interaction trace."
  quality_dimensions:
    - id: "reliable-waiting-concept"
      weight: 35
      definition: "The learner uses the expected visible state, not elapsed time, as readiness evidence."
      exceptional:
        - "Eli removes the timing guess and explains why the result assertion is more reliable."
      acceptable:
        - "The final test uses the retrying assertion after a focused hint."
      poor:
        - "A fixed wait remains or is merely hidden elsewhere."
    - id: "artifact-correctness"
      weight: 25
      definition: "The test performs the user action and checks the correct visible outcome."
      exceptional:
        - "The focused artifact passes repeatedly and reads like the manual check."
      acceptable:
        - "The correct action and result pass deterministically."
      poor:
        - "The action is bypassed, the wrong result is checked, or the page is altered."
    - id: "recovery-coaching"
      weight: 25
      definition: "Guidance turns the novice timing instinct into a transferable observation strategy."
      exceptional:
        - "A question about evidence lets Eli choose the correction himself."
      acceptable:
        - "Conceptual guidance identifies fixed waits as fragile without writing the solution."
      poor:
        - "The instructor supplies code, a magic duration, or unrelated synchronization mechanisms."
    - id: "learner-agency"
      weight: 15
      definition: "The learner remains the author and verifier."
      exceptional:
        - "Eli chooses to rerun and articulates confidence from observable evidence."
      acceptable:
        - "Eli performs the revision and verification with guidance."
      poor:
        - "The system edits, accepts, or declares reliability on Eli's behalf."
  critical_failures:
    - id: "ai-used-or-solution-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives generated solution code."
      evidence: "Capability and interaction trace."
    - id: "fixed-wait-remains"
      severity: "blocker"
      description: "The completed artifact depends on a fixed-duration wait."
      evidence: "Final artifact inspection."
    - id: "page-or-delay-changed"
      severity: "blocker"
      description: "The application or its authored delay is changed to make the test pass."
      evidence: "Page-integrity comparison."
    - id: "false-reliability-claim"
      severity: "major"
      description: "The experience claims reliability without the required repeated clean runs."
      evidence: "Progress state versus run trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor writes the learner's completed test."
      evidence: "Instructor and edit trace."
  positive_signals:
    - "The learner names the visible confirmation as readiness evidence."
    - "The fixed-delay idea is removed rather than increased."
    - "Repeated runs are initiated and interpreted by the learner."
  negative_signals:
    - "Feedback recommends a larger timeout or arbitrary sleep."
    - "The test passes by bypassing the user action."
    - "Any AI surface or generated suggestion appears."
  allowed_variance:
    - "Equivalent user-facing locators for the Register control and confirmation."
    - "Equivalent retrying assertions that directly express the visible result."
    - "More than three clean verification runs."
    - "Earlier help, different edit order, and equivalent explanations of reliability."
  evidence_requirements:
    - "Initial, intermediate if retained, and final test artifact."
    - "Semantic evidence of the action, assertion, fixed-wait removal, and test runs."
    - "Three consecutive reset-isolated results."
    - "Application and authored-delay integrity evidence."
    - "Instructor interaction trace and progress timing."
    - "Record showing no learner AI capability was available or invoked."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "recoverability"
    importance: "high"
    definition: "A novice fixed-wait instinct becomes a useful learning moment rather than a dead end."
    positive_evidence:
      - "The learner removes the guess and succeeds with observable state."
    violation_evidence:
      - "The learner is left with flaky behavior or told only that the approach is wrong."
    violation_severity: "major"
  - value: "clarity"
    importance: "high"
    definition: "The experience connects readiness to the visible result in plain language."
    positive_evidence:
      - "Feedback contrasts elapsed time with observable outcome."
    violation_evidence:
      - "Guidance relies on unexplained synchronization jargon."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can apply result-based waiting to another interactive page."
    positive_evidence:
      - "Eli can state that the expected state should be the wait condition."
    violation_evidence:
      - "Success depends on memorizing the seeded delay."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Eli authors, revises, and verifies the test."
    positive_evidence:
      - "The learner chooses the correction and reruns it."
    violation_evidence:
      - "The instructor or system silently edits or accepts the test."
    violation_severity: "major"
  - value: "truthfulness"
    importance: "high"
    definition: "Reliability and completion claims match deterministic run evidence."
    positive_evidence:
      - "Progress reflects all three clean runs."
    violation_evidence:
      - "One lucky pass is represented as reliable completion."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-registration-result-check"
    type: "code-change"
    required_properties:
      - "Learner-authored change is confined to the prepared test slot."
      - "Activates Register through user-visible meaning."
      - "Uses a retrying assertion on Registration saved and passes three clean runs."
    forbidden_properties:
      - "Executable solution text embedded in this scenario specification."
      - "Fixed-duration wait, hidden timing inspection, page modification, skipped assertion, generated code, or AI provenance."
downstream_guidance:
  product_capabilities_needed:
    - "A no-AI manual-authoring workspace with a prepared test slot and local runner."
    - "Plain-language failure and progress feedback that distinguishes guessed time from observed state."
  test_harness_needs:
    - "Seed and reset a deterministic delayed confirmation without exposing its duration."
    - "Classify action, retrying assertion, fixed waits, application integrity, and consecutive clean results."
    - "Expose whether any learner AI capability was available or invoked."
  evaluator_needs:
    - "Artifact history, run sequence, integrity evidence, instructor trace, and deterministic gate result."
  intentional_unknowns:
    - "Exact editor, filenames, control wording beyond seeded semantics, locator/assertion spelling, and feedback presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "retrying-assertion"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Eli is a manual QA engineer translating a familiar click-and-check procedure into a small Playwright test. The single transferable concept is that the expected visible result should be the readiness signal; a guessed pause should not be. This CURRENT-EDGE scenario builds on Trellis's working Playwright lab and deterministic evaluation while adding manual authorship and focused recovery from a realistic novice mistake.

# Relationship to Existing Coverage

`labs/learn-playwright-basics` teaches failure reading and repairs to AI-authored tests, including a stale assertion and an ambiguous locator. It does not ask the learner to author a new interaction test from a manual case, and its central mistake is not a timing guess. Scenario 1 in this run is observation-only and teaches locate plus assert. This scenario adds an action, a delayed visible outcome, repeated verification, and the narrow lesson that retrying assertions replace arbitrary waits. It contains no AI-authored diff, no Git-review objective, and no planted app-versus-test dispute, so it is materially distinct.

# Learner-Facing Setup

Automate one fictional registration check yourself: activate Register and confirm that Registration saved appears. The confirmation may take a moment. Let that expected result tell Playwright when the page is ready instead of adding a guessed pause. The workspace is local, nothing is submitted for real, and there is no AI assistant.

# Seeded Environment

The local workspace contains a fictional registration page, a manual three-step check, and a valid test file with setup plus one empty test body. The confirmation appears after a small deterministic delay whose duration is intentionally not learner-visible. Browser, editor, and runner are the only applications. All displayed facts are fictional and public; the editable workspace is internal simulation data. No account, personal data, network, AI chat, generated completion, or real registration exists. Reset restores the pristine artifacts and run state.

# User-Simulation Instructions

Behave as Eli, using only learner-visible instructions, page behavior, editor feedback, local documentation, and runner output. Write the action and expected result in manual-test order. At the specified moment, add or propose a fixed pause because it feels familiar, then respond to effective coaching by identifying the visible confirmation as the real readiness evidence, removing the pause, and revising the test yourself. Ask realistic questions and rerun without sabotage. Never inspect the hidden delay, evaluator information, source internals, AI, or generated solutions.

# Expected Experience

The task should orient Eli to one action and one outcome. The instructor should first ask what page evidence proves the action finished, not prescribe a duration or paste code. Failure and hint language should explain that Playwright can keep checking an expected visible state for a bounded period. It should avoid detours into general timeout configuration, network interception, or advanced synchronization. Progress should distinguish draft, first pass, fixed-wait removal, repeated clean verification, and completion. Recovery must be neutral and learner-led. Reflection should ask why an observable state is stronger than elapsed time. No persistent profile update is necessary.

# Required Observable Evidence

Completion evidence: the final learner-authored test performs the Register action, checks the visible confirmation with a retrying assertion, contains no fixed wait, preserves the app and delay, passes three clean runs, and uses no AI. Quality evidence: Eli's trace or reflection connects the expected state to readiness and shows the timing guess was removed rather than enlarged. Adaptation evidence: hint timing responds to the observed mistake but no cross-session adaptation is required. Safety evidence: the action is simulated, local, resettable, and fictional. Do not store raw keystrokes, the hidden duration as learner-visible history, or an unconfirmed preference inference.

# Completion Gate

All five gates in front matter are required. One pass is insufficient for this scenario's completion rule. A fixed wait hidden beside a retrying assertion still fails. Completion remains separate from quality: Eli can complete after direct conceptual guidance but may score below exceptional.

# Evaluation Rubric

Score reliable waiting concept (35), artifact correctness (25), recovery coaching (25), and learner agency (15), totaling 100. Apply the exceptional, acceptable, and poor anchors and cite concrete evidence. Cap the score below 75 if Eli cannot explain why observable state replaces guessed time. A failed completion gate makes the completion verdict FAIL regardless of points. Any critical failure blocks exceptional; AI use, a remaining fixed wait, or app/delay modification fails completion.

# Experience Values

Recoverability, clarity, transferable learning, learner agency, and truthfulness are required. Evaluate whether the novice mistake becomes a reusable mental model, whether Eli remains the author, and whether reliability claims match the run evidence. Use the positive and violation evidence plus severities in front matter.

# Critical Failures

Fail completion for AI use or generated solution code, a remaining fixed-duration wait, changing the page or delay, bypassing the Register action, or omitting the result assertion. Block exceptional for instructor takeover, false reliability claims, shaming, inaccessible recovery, unreliable reset, or requiring knowledge of the hidden duration or implementation internals.

# Allowed Variance

Accept equivalent user-facing locators, equivalent retrying assertions that directly express the visible result, more than three clean runs, different edit order, earlier help, and different accurate explanations. Do not penalize a learner for discussing a fixed wait before rejecting it. Do penalize any completed artifact that relies on elapsed time or hidden implementation state.

# Downstream Implementation Guidance

Seed a local form whose visible confirmation appears after a deterministic but undisclosed delay. Provide a manually editable test slot with AI unavailable. Make action semantics, assertion behavior, prohibited waits, integrity, resets, and consecutive results observable without exposing exact internals. Evaluation should accept behaviorally equivalent locator/assertion choices. Downstream agents decide the editor, test representation, and feedback UI. Existing AI-change, Git-diff, selector, route, event-name, and component patterns must not constrain the solution. Do not include solution code in learner-facing materials or generated scenario artifacts.

# Evaluator Instructions

Inspect the learner-agent trace, semantic edit/run events, instructor interactions, artifact history, deterministic completion, app/delay integrity, timing sequence, recovery, reset evidence if used, and the record that learner AI was absent and unused. Verify three consecutive clean runs rather than trusting a progress claim. Profile state should remain unchanged unless explicitly confirmed. Return exactly:

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
- "Preserve manual authorship, no learner AI, observable-state waiting, deterministic evaluation, and equivalent valid paths without prescribing implementation."

# Future Progression

A harder follow-up adds two possible outcomes and asks the learner to assert the one caused by the chosen action. A transfer scenario checks a delayed toast in a fictional inventory page. A likely regression scenario injects varied safe delays and confirms the test remains stable without elapsed-time dependence. The exercise becomes too easy once Eli routinely treats expected state as the readiness signal. Trellis must not overfit to the exact confirmation text, one delay, one locator spelling, or exactly three runs outside this scenario's completion contract.

