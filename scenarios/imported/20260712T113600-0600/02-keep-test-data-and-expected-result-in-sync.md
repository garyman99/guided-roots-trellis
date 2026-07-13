---
schema_version: "1.1"
scenario_id: "keep-test-data-and-expected-result-in-sync"
title: "Keep Test Data and Expected Result in Sync"
created_at: "2026-07-12"
generator_run_id: "20260712T113600-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 2
  label: "Guided, multiple steps, low ambiguity"
  rationale: "The learner completes one prepared test with fictional data, reads one mismatch, corrects only the inconsistent expected value, and reruns to green."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "find-form-field-by-label"
    - "read-one-failing-result-before-editing"
  capability_gap: "A novice manually keeps one fictional input value consistent with the visible result asserted by the same test."
  implementation_assumptions_to_avoid:
    - "Entering test data and asserting its result are unrelated steps."
    - "A data mismatch should be solved by changing the application."
    - "Only one exact Playwright syntax can express the intended data relationship."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.test-data"
  applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.use-fictional-test-data"
    - "playwright.align-input-with-asserted-result"
  experience_qualities:
    - "recoverability"
    - "clarity"
    - "transferable-learning"
persona:
  name: "Caleb Singh"
  role: "Manual QA engineer learning to write Playwright tests manually"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Uses small fictional datasets in manual form checks."
    - "Understands a basic Playwright test as find, act, and check."
    - "Can read a simple expected-versus-received failure."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "normal"
    prefers_examples: false
  accessibility_context: []
  behavioral_tendencies:
    - "Copies the input value correctly but may leave an older value in the expected result."
    - "Looks at the page before deciding which side is inconsistent."
    - "Prefers changing one thing and rerunning."
learning:
  primary_objective: "Use one fictional data value consistently in the user action and the expected visible result."
  supporting_objectives:
    - "Use a failed run to correct the smallest inconsistent part and rerun until green."
  expected_profile_evidence:
    - "Completed a learner-authored test in which the entered fictional name and asserted confirmation agree."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis desktop shows the Guide. Garden Site and Code Studio provide a disposable local welcome-form project, beginner instructions, and one prepared manual-authoring test slot. No AI capability is present."
  seeded_artifacts:
    - id: "garden-welcome-form"
      type: "file"
      description: "A fictional local form that displays Welcome, followed by the submitted garden nickname."
      data_classification: "public"
    - id: "fictional-test-data-card"
      type: "document"
      description: "A small safe data card assigning the fictional garden nickname Clover for this check."
      data_classification: "public"
    - id: "prepared-data-test-slot"
      type: "code"
      description: "A valid focused test with navigation and user-visible control choices prepared; the learner manually supplies the fictional input and matching expected-result values. No solution code is seeded."
      data_classification: "internal"
  available_applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "The form, nickname, project, and runner are fictional, local, and disposable."
    - "No real submission, account, network service, repository, or personal data exists."
    - "The learner cannot invoke AI and receives no generated code or command."
  reset_expectation: "Restore the pristine form, Clover data card, empty learner slots, unchanged prepared steps, and clear run history."
task:
  learner_goal: "Complete and run one Playwright test using Clover consistently as both the entered nickname and the name expected in the welcome result."
  learner_facing_prompt: "Use the fictional nickname Clover from the data card. In the prepared test, enter that value in the input step and make the visible welcome check expect the same value. Save and run the focused test. If it fails, compare what the test expected with what the page returned, change only the inconsistent test value, and rerun until green. Write the values yourself; do not use AI or change the page."
  constraints:
    - "Change only the two marked learner data slots in the prepared test."
    - "Use Clover; do not invent or enter real personal data."
    - "Keep the prepared navigation, locator choices, user action, and assertion kind unchanged."
    - "Do not modify the page, skip the check, weaken the expected result, or invoke AI."
  hidden_complications:
    - "On the first attempt, the learner may enter Clover but leave the older example value Fern in the expected welcome result."
  acceptable_strategies:
    - "Fill both marked values before the first run."
    - "Make the authored mismatch once, read the failure, update only Fern to Clover, and rerun."
  prohibited_shortcuts:
    - "Changing the page to display Fern."
    - "Removing the nickname from the assertion, using a broad visibility-only check, or bypassing form submission."
    - "Using generated code, hidden evaluator data, or implementation internals."
user_simulation:
  initial_behavior: "Caleb opens the Garden Site, reads the Clover data card, and fills the first marked test value."
  decision_policy:
    - "Use only learner-visible page content, the data card, beginner instructions, editor feedback, and runner output."
    - "Treat the page and data card as fixed ground truth for this exercise."
    - "After a mismatch, change one inconsistent test value and rerun rather than editing multiple artifacts."
  realistic_questions:
    - "Should the name in the check be the same one I typed?"
    - "The page returned Clover but my test expected Fern; which value is stale?"
    - "Do I need to change anything besides the expected name?"
  mistakes:
    - trigger: "First completion of the two marked test-data slots."
      action: "Uses Clover for the input but leaves Fern as the expected nickname."
      expected_recovery: "Reads the expected-versus-received mismatch, confirms the data card and page agree on Clover, changes only the stale expected value, and reruns successfully."
  help_behavior:
    request_help_after: "The first run fails with the Clover/Fern mismatch or Caleb proposes changing the page."
    response_to_weak_help: "Asks which source defines the intended data for this check."
    response_to_effective_help: "Compares the data card, entered value, expected value, and received result, then makes the single correction himself."
  stopping_conditions:
    - "All completion gates pass."
    - "The local editor, page, or runner remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator information, page implementation, or exact internal selectors."
    - "Do not modify seeded application behavior or prepared test structure."
    - "Do not use AI, generated suggestions, or solution artifacts."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner-authored input step uses only the fictional nickname Clover."
        evidence:
          - "Final artifact and semantic input-data evidence."
      - id: "gate-2"
        description: "The unchanged assertion kind expects the visible welcome result containing the same Clover value."
        evidence:
          - "Final artifact and semantic assertion-data evidence."
      - id: "gate-3"
        description: "The focused test performs the prepared user action and passes after the learner's final edit."
        evidence:
          - "Deterministic run record and learner edit history."
      - id: "gate-4"
        description: "The page, prepared structure, and data card remain unchanged, and no learner AI interaction occurs."
        evidence:
          - "Workspace integrity comparison and capability/interaction record."
  quality_dimensions:
    - id: "test-data-consistency"
      weight: 35
      definition: "The same intentional fictional value connects the test action to the expected visible result."
      exceptional:
        - "Caleb explains that both parts describe one user story and verifies Clover in each."
      acceptable:
        - "The final values agree after one focused hint."
      poor:
        - "Input and expectation remain inconsistent or the assertion stops checking the value."
    - id: "failure-led-recovery"
      weight: 25
      definition: "The mismatch is corrected using expected-versus-received evidence and the fixed data card."
      exceptional:
        - "Caleb identifies Fern as the one stale test value and changes only it."
      acceptable:
        - "The mismatch is corrected after a source-comparison prompt."
      poor:
        - "The page is blamed or multiple artifacts are changed without evidence."
    - id: "artifact-correctness"
      weight: 25
      definition: "The intended interaction and specific welcome check remain intact and pass."
      exceptional:
        - "The final focused test is readable, specific, green, and preserves all prepared structure."
      acceptable:
        - "The Clover interaction and expected result pass deterministically."
      poor:
        - "The action is bypassed, the check is weakened, or the app is altered."
    - id: "novice-experience"
      weight: 15
      definition: "The exercise stays bounded and understandable without prior editor or CLI expertise."
      exceptional:
        - "Caleb uses plain-language output to make the single correction without unnecessary concepts."
      acceptable:
        - "One brief orientation or conceptual hint enables completion."
      poor:
        - "Jargon, hidden state, or instructor takeover obscures the data relationship."
  critical_failures:
    - id: "data-mismatch-accepted"
      severity: "blocker"
      description: "Completion is awarded while input and expected nickname values differ."
      evidence: "Final artifact and semantic data comparison."
    - id: "assertion-weakened"
      severity: "blocker"
      description: "The nickname-specific expected result is removed or reduced to a non-specific pass condition."
      evidence: "Prepared-versus-final artifact comparison."
    - id: "seeded-artifact-changed"
      severity: "blocker"
      description: "The page, data card, prepared interaction, or assertion kind is changed to pass."
      evidence: "Workspace integrity comparison."
    - id: "ai-used-or-code-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives generated solution code."
      evidence: "Capability, instructor, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor authors the final learner values or performs the correction."
      evidence: "Instructor and edit trace."
  positive_signals:
    - "The learner checks the data card before editing."
    - "The learner describes input and expected result as two parts of the same test story."
    - "Only the stale expected value changes after the failed run."
  negative_signals:
    - "The assertion is broadened until either name could pass."
    - "The page is changed to match the mistake."
    - "Any real data, AI surface, or generated completion appears."
  allowed_variance:
    - "Equivalent Playwright syntax within the marked data slots that preserves the exact Clover meaning."
    - "Completing both values correctly before the first run."
    - "Inspecting Garden Site before or after opening Code Studio."
    - "Earlier help, extra focused reruns, or equivalent explanations of data consistency."
  evidence_requirements:
    - "Initial and final prepared-test artifact plus semantic data-slot changes."
    - "Focused run identity, failed mismatch if it occurs, and final deterministic pass."
    - "Page, prepared structure, assertion kind, and data-card integrity before and after."
    - "Instructor trace and record that AI was absent and unused."
    - "Do not retain raw keystrokes or any data beyond the fictional Clover value."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "The learner can see that entered data and expected result describe one continuous behavior."
    positive_evidence:
      - "Guidance compares the two marked values and the visible result in plain language."
    violation_evidence:
      - "The values are presented as unrelated syntax fragments."
    violation_severity: "major"
  - value: "recoverability"
    importance: "high"
    definition: "A simple stale-value mismatch leads to one safe, evidence-based correction."
    positive_evidence:
      - "Caleb corrects Fern to Clover and reruns without losing work."
    violation_evidence:
      - "The mismatch creates a dead end, broad rewrite, or silent correction."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can keep input and expected output aligned in another data-driven test."
    positive_evidence:
      - "Caleb explains why a changed input may require a corresponding expected-result update."
    violation_evidence:
      - "Success depends on memorizing Clover or one test layout."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Caleb chooses, authors, corrects, and verifies the fictional test values."
    positive_evidence:
      - "Hints stop after he identifies the inconsistent value."
    violation_evidence:
      - "The instructor or system inserts or accepts the final value."
    violation_severity: "major"
  - value: "data-minimization"
    importance: "high"
    definition: "Only the one fictional value required by the check is used or retained."
    positive_evidence:
      - "Clover is the only authored input data."
    violation_evidence:
      - "Real, personal, or unnecessary values are requested or stored."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-consistent-data-test"
    type: "code-change"
    required_properties:
      - "Learner-authored edits are confined to the two marked data slots."
      - "Clover is both the entered nickname and the nickname expected in the visible result."
      - "The unchanged focused interaction test passes deterministically."
    forbidden_properties:
      - "Executable solution code in this scenario specification."
      - "Real data, weakened assertion, app or prepared-structure change, generated code, or AI provenance."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop with Garden Site, Code Studio, and a local runner."
    - "A no-AI manual-authoring path with two clearly marked data slots and plain mismatch feedback."
  test_harness_needs:
    - "Seed and reset the fictional form, Clover card, prepared test structure, and run state."
    - "Semantically compare input data, assertion data, action preservation, result, integrity, and AI absence."
  evaluator_needs:
    - "Artifact history, data-value classification, run evidence, integrity evidence, instructor trace, and learner explanation."
  intentional_unknowns:
    - "Exact filenames, editor controls, test syntax, locators, assertion syntax, runner command, event names, and feedback presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "test-data"
  - "expected-result"
  - "rerun-green"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Caleb is a manual QA engineer using one safe fictional nickname consistently across a Playwright action and its expected result. He recovers from a Clover/Fern mismatch by changing only the stale expected value and rerunning to green. This CURRENT-EDGE scenario isolates basic test-data consistency while keeping navigation, locators, action shape, and assertion kind prepared.

# Relationship to Existing Coverage

`find-form-field-by-label` enters Juniper but evaluates how the field is identified; its preview assertion is already prepared. The heading scenario evaluates assertion presence, the form-result scenario evaluates retrying behavior, and the current lab's stale-copy variant occurs inside AI-diff review with application copy as the source. This scenario instead uses an explicit fictional data card and asks the learner to author both ends of one data relationship. The locator and assertion form are held stable, so it is materially different from prior locator, timing, and copy-review coverage.

# Learner-Facing Setup

Use the fictional nickname Clover from the data card. In the prepared test, put Clover in the input step and make the visible welcome check expect Clover too. Save and run the focused test. If the result shows a mismatch, compare expected and received, correct only the inconsistent test value, and rerun until green. Do not change the page or use AI.

# Seeded Environment

The local disposable workspace contains a fictional welcome form, the Clover data card, beginner instructions, and a prepared focused test with two marked learner data slots. The interaction and check structure are present but no solution value is supplied in the slots. No real identity, account, submission, network, external repository, generated completion, or AI capability exists. Reset restores all artifacts and clears runs.

# User-Simulation Instructions

Behave as Caleb, using only the visible page, data card, instructions, editor feedback, and runner output. Make the specified Clover/Fern mismatch once when appropriate, then use the failure and fixed data card to identify the stale expected value. Change only that value and rerun yourself. Do not inspect implementation internals, hidden selectors, evaluator facts, or generated solutions.

# Expected Experience

The Guide should orient Caleb to the two marked data slots and explain that they are two parts of one manual test story: what the visitor enters and what the page should show. It should let the mismatch produce useful evidence, ask which source defines the intended nickname, and avoid pasting syntax. Failure language should display expected and received values plainly. Progress should distinguish data selected, first draft, failed comparison, single correction, green rerun, and completion. No profile update is needed.

# Required Observable Evidence

Completion evidence is Clover in both learner-authored slots, the preserved interaction and specific assertion, a deterministic focused pass, unchanged seeded artifacts, and no AI interaction. Quality evidence includes Caleb explaining why the two values must agree and why only Fern was stale. Adaptation evidence is limited to timely in-session help. Safety evidence confirms minimal fictional data. Do not retain raw keystrokes, real data, or inferred preferences.

# Completion Gate

All four gates in front matter are mandatory. A passing test with a weakened nickname check is incomplete, as is a test made green by changing the page. Completion is separate from quality: Caleb may complete after direct conceptual guidance while scoring below exceptional.

# Evaluation Rubric

Score test-data consistency (35), failure-led recovery (25), artifact correctness (25), and novice experience (15), totaling 100. A failed gate makes the completion verdict FAIL regardless of points. Any critical failure blocks exceptional; data mismatch, assertion weakening, seeded-artifact modification, or AI use fails completion.

# Experience Values

Assess clarity, recoverability, transferable learning, learner agency, and data minimization using the front-matter definitions. Confirm the learning is about a general input-to-expectation relationship rather than the word Clover.

# Critical Failures

Fail completion for inconsistent final values, a weakened or skipped check, bypassed user action, modified page or data card, generated code, AI use, real data, or a false green claim. Instructor takeover, shaming, inaccessible feedback, unreliable reset, or unnecessary data collection blocks exceptional.

# Allowed Variance

Accept equivalent syntax inside the marked slots, a correct first attempt with no failure, either application order, earlier help, extra focused reruns, and equivalent explanations. Do not penalize the authored mismatch when the learner uses evidence to make the single correction.

# Downstream Implementation Guidance

Seed a fictional form, one explicit data card, and a prepared test whose interaction and assertion structure are fixed while two data values remain learner-authored. Make both data meanings, test result, prepared-structure integrity, app integrity, reset, and AI absence observable without prescribing exact syntax, selectors, components, routes, APIs, schemas, filenames, or event names. Preserve the familiar Trellis desktop, Garden Site, and Code Studio workflow.

# Evaluator Instructions

Inspect the learner trace, Garden Site view, data-card access, semantic edits, artifact history, test runs, input/assertion value classification, seeded-artifact integrity, instructor interactions, timing, recovery, deterministic completion, and AI-capability record. Return exactly:

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

For each actionable finding, return:

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
- "Preserve manual authorship, minimal fictional data, input-to-expectation consistency, no-AI operation, deterministic evidence, and equivalent valid paths without prescribing implementation."

# Future Progression

A harder follow-up uses two small fictional records and asks the learner to keep each result paired with its own input. A transfer scenario applies the same consistency check to a fictional inventory quantity. A likely regression scenario changes the seeded nickname and confirms both learner slots must follow it. The exercise becomes too easy once Caleb routinely traces test data from action to expected result. Trellis must not overfit to Clover, one form, one test syntax, or one runner presentation.
