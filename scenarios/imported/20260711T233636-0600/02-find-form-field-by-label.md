---
schema_version: "1.1"
scenario_id: "find-form-field-by-label"
title: "Find a Form Field by Its Visible Label"
created_at: "2026-07-11"
generator_run_id: "20260711T233636-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 2
  label: "Guided, multiple steps, low ambiguity"
  rationale: "The learner inspects a small form, chooses one labeled field, enters one fictional value, and recovers from a fragile position-based choice."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics:ambiguous-button-locator"
    - "turn-heading-check-into-first-test"
    - "check-form-result-without-timing-guesses"
  capability_gap: "A novice manually authors a field interaction whose locator is grounded in the field's visible label rather than DOM position."
  implementation_assumptions_to_avoid:
    - "A position-based locator is acceptable because the seeded form happens to be small."
    - "Only one exact label-locator spelling can satisfy the learning objective."
    - "The instructor should paste the correct locator for the learner."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.stable-locators"
    - "quality-assurance.test-data"
  applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.choose-label-locator"
    - "playwright.enter-simple-test-data"
  experience_qualities:
    - "clarity"
    - "recoverability"
    - "transferable-learning"
persona:
  name: "Owen Diaz"
  role: "Manual QA engineer learning to automate form entry"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Writes manual steps such as enter a value in the Preferred garden name field."
    - "Completed or understands a basic Playwright check and a focused test run."
    - "Has not yet chosen a locator for a text field."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "brief"
    prefers_examples: true
  accessibility_context: []
  behavioral_tendencies:
    - "Looks at the visible form before editing the test."
    - "May describe the target as the first text box because two fields look similar."
    - "Responds well when asked how a visitor knows which field is which."
learning:
  primary_objective: "Choose a form field by its visible label so the test remains meaningful if field order changes."
  supporting_objectives:
    - "Use one fictional value as deliberate test data."
  expected_profile_evidence:
    - "Authored and ran a field-entry step grounded in the visible label Preferred garden name."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis desktop offers the Guide, Garden Site, and Code Studio. A disposable local form and a prepared test slot are ready; no AI surface or agent-authored change exists."
  seeded_artifacts:
    - id: "garden-profile-form"
      type: "file"
      description: "A fictional local form with two adjacent text fields labeled Contact name and Preferred garden name, plus a preview that reflects the chosen garden name."
      data_classification: "public"
    - id: "manual-garden-name-check"
      type: "document"
      description: "Manual check: enter Juniper in Preferred garden name and confirm the preview shows Juniper."
      data_classification: "public"
    - id: "prepared-label-test-slot"
      type: "code"
      description: "A valid Playwright test with page setup and final preview expectation prepared; the learner must manually author the field selection and data-entry step. No solution syntax is included."
      data_classification: "internal"
  available_applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "The form, value, preview, and test runner are fictional and local."
    - "No personal data, account, network request, or real submission exists."
    - "The learner cannot invoke AI and receives no generated code."
  reset_expectation: "Restore the original field order, blank form, prepared test slot, and empty run history."
task:
  learner_goal: "Complete and run the prepared test so it enters Juniper in the Preferred garden name field using that visible label."
  learner_facing_prompt: "Open the Garden Site and notice how a visitor tells the two text fields apart. In Code Studio, complete the prepared test yourself: find Preferred garden name by the label a visitor can read, enter the fictional value Juniper, save, and run the test. Avoid describing the field only by where it sits on the page. This exercise has no AI assistant."
  constraints:
    - "Change only the prepared test slot."
    - "Ground the field choice in the visible label Preferred garden name."
    - "Use Juniper as the only entered test value."
    - "Do not change field order, labels, page behavior, or prepared assertion."
    - "Do not invoke AI or use generated code."
  hidden_complications:
    - "A position-based first-text-field choice targets Contact name and causes the prepared preview check to fail."
  acceptable_strategies:
    - "Use any Playwright locator semantics that directly associate the visible Preferred garden name label with its field."
    - "Inspect the Garden Site before or after the first failed run."
  prohibited_shortcuts:
    - "Selecting the field only by position or internal implementation details."
    - "Changing the form, assertion, field order, or expected preview."
    - "Invoking AI, generated suggestions, or hidden evaluator information."
user_simulation:
  initial_behavior: "Owen reads the manual check, opens the Garden Site, and then opens the prepared test slot."
  decision_policy:
    - "Use only visible labels, learner documentation, editor feedback, and runner output."
    - "Initially translate leftmost or first text box too literally if no coaching has occurred."
    - "After failure, compare the manual field name with the locator meaning before editing again."
  realistic_questions:
    - "Both are text boxes; how do I say which one I mean?"
    - "Should the test use the words printed beside the field?"
    - "Would this still work if the form moved the fields around?"
  mistakes:
    - trigger: "First attempt to identify the target field."
      action: "Uses or proposes a position-based choice that targets the first text field, Contact name."
      expected_recovery: "After a concept-level prompt, replaces position with the visible Preferred garden name label, retains Juniper as test data, and reruns until green."
  help_behavior:
    request_help_after: "The first run fails because Juniper entered the wrong field, or Owen cannot distinguish the two fields in test language."
    response_to_weak_help: "Asks whether changing first to second would be enough."
    response_to_effective_help: "Explains that the printed label expresses user meaning and revises the locator himself."
  stopping_conditions:
    - "All completion gates pass."
    - "The site, editor, or local runner remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect DOM internals, hidden evaluator data, or implementation source."
    - "Do not modify the page or prepared assertion."
    - "Do not use AI, generated suggestions, or solution artifacts."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner-authored step identifies the intended field through its visible Preferred garden name label."
        evidence:
          - "Final test artifact and semantic locator classification."
      - id: "gate-2"
        description: "The test enters exactly the fictional value Juniper into that field and the prepared preview check passes."
        evidence:
          - "Deterministic test result and entered-data classification."
      - id: "gate-3"
        description: "The final locator does not depend only on field order, generic element position, or hidden implementation details."
        evidence:
          - "Final artifact inspection and optional field-order robustness probe."
      - id: "gate-4"
        description: "The seeded form and prepared assertion remain unchanged, and no learner AI interaction occurs."
        evidence:
          - "Workspace integrity comparison and capability/interaction record."
  quality_dimensions:
    - id: "stable-locator-understanding"
      weight: 35
      definition: "The learner connects the visitor-visible label with a durable way to identify the field."
      exceptional:
        - "Owen explains why the label remains meaningful if field order changes."
      acceptable:
        - "The final locator is label-grounded after a focused hint."
      poor:
        - "The solution remains positional, generic, or tied to hidden internals."
    - id: "artifact-correctness"
      weight: 25
      definition: "The learner's small edit enters the intended data and satisfies the unchanged preview check."
      exceptional:
        - "The test is focused, readable, and passes a safe field-order robustness probe."
      acceptable:
        - "The correct field receives Juniper and the deterministic test passes."
      poor:
        - "The wrong field receives data, the assertion is changed, or the page is modified."
    - id: "recovery-coaching"
      weight: 25
      definition: "Guidance turns the positional mistake into a reusable user-meaning principle."
      exceptional:
        - "A question about how a visitor identifies the field lets Owen choose the correction."
      acceptable:
        - "A direct conceptual explanation enables recovery without providing completed syntax."
      poor:
        - "The instructor pastes the locator, recommends a different position, or introduces unrelated locator types."
    - id: "novice-experience"
      weight: 15
      definition: "The task remains bounded, calm, and understandable to a first-time locator author."
      exceptional:
        - "Failure output and progress make the wrong-field cause obvious without jargon."
      acceptable:
        - "Owen recovers without shame or hidden knowledge."
      poor:
        - "The experience assumes DOM, editor, or command-line expertise."
  critical_failures:
    - id: "positional-locator-accepted"
      severity: "blocker"
      description: "Completion is awarded while the locator depends only on field position."
      evidence: "Final artifact and semantic classification."
    - id: "seeded-artifact-changed"
      severity: "blocker"
      description: "The form, labels, field order, or prepared assertion is changed to pass."
      evidence: "Workspace integrity comparison."
    - id: "ai-used-or-code-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives generated solution code."
      evidence: "Capability, instructor, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor authors the completed locator or edit."
      evidence: "Instructor and edit trace."
  positive_signals:
    - "The learner names the field from the visible form before editing."
    - "The learner rejects first or second as the field's identity."
    - "Juniper remains deliberate test data rather than a real person's information."
  negative_signals:
    - "Guidance points to DOM structure, numeric position, or an exact internal selector."
    - "The prepared assertion is weakened or rewritten."
    - "Any AI surface or generated completion appears."
  allowed_variance:
    - "Equivalent Playwright locator forms that directly use the visible label relationship."
    - "Inspecting the site before or after the first run."
    - "Running the focused test or the small local suite, provided the target test result is observable."
    - "Earlier help, extra reruns, or equivalent explanations of locator stability."
  evidence_requirements:
    - "Initial and final prepared-test artifact."
    - "Semantic edit evidence for target field, locator basis, and entered test data without raw keystrokes."
    - "Deterministic test result and optional safe field-order robustness result."
    - "Form and prepared-assertion integrity before and after."
    - "Instructor trace and record that AI was absent and unused."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "The learner can connect the manual field name to the automated field choice."
    positive_evidence:
      - "Guidance consistently refers to the visible label and intended field."
    violation_evidence:
      - "Instructions rely on position, DOM jargon, or hidden identifiers."
    violation_severity: "major"
  - value: "recoverability"
    importance: "high"
    definition: "Choosing the wrong field first produces useful evidence and a safe correction path."
    positive_evidence:
      - "The failure leads Owen back to the visible form meaning."
    violation_evidence:
      - "The mistake creates a dead end or is corrected silently."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can choose another field by how a visitor identifies it."
    positive_evidence:
      - "Owen explains why label meaning survives layout changes."
    violation_evidence:
      - "Success depends on memorizing this form's field order."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Owen authors, corrects, and verifies the locator."
    positive_evidence:
      - "Hints stop after he identifies the label principle."
    violation_evidence:
      - "The instructor or system inserts or accepts the solution."
    violation_severity: "major"
  - value: "data-minimization"
    importance: "high"
    definition: "Only the one fictional value needed by the check is entered or retained."
    positive_evidence:
      - "Juniper is the only seeded and entered value."
    violation_evidence:
      - "Real, personal, or unnecessary data is requested or retained."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-label-field-step"
    type: "code-change"
    required_properties:
      - "Learner-authored change is confined to the prepared test slot."
      - "The field is identified by the visible Preferred garden name label."
      - "Juniper is entered and the unchanged preview check passes."
    forbidden_properties:
      - "Executable solution code in this scenario specification."
      - "Position-only locator, hidden selector, page/assertion modification, generated code, AI provenance, or real data."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop with Garden Site, Code Studio, and a local runner."
    - "A no-AI manual-authoring path and plain-language wrong-field feedback."
  test_harness_needs:
    - "Seed and reset two labeled fields, the fictional value, prepared test slot, and preview."
    - "Semantically classify label-grounded versus position-only locator choices."
    - "Verify form/assertion integrity, entered data, result, and AI absence."
  evaluator_needs:
    - "Artifact history, locator classification, run evidence, integrity evidence, instructor trace, and learner explanation."
  intentional_unknowns:
    - "Exact filenames, editor controls, locator syntax, field markup, runner command, event names, and feedback presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "label-locator"
  - "test-data"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Owen is a manual QA engineer translating the manual phrase Preferred garden name field into a stable Playwright field choice. He enters one fictional value and reruns a prepared test after recovering from a position-based mistake. This CURRENT-EDGE scenario isolates label-grounded locators and applies only the minimum test data needed.

# Relationship to Existing Coverage

The current lab's ambiguous-locator variant repairs a generic button locator in AI-authored code. The prior heading scenario authors a visibility check, while the prior form-result scenario focuses on retrying assertions instead of fixed waits. This scenario has no AI diff, button ambiguity, delayed state, or assertion authoring. The learner manually chooses between two text fields and grounds that choice in a visible label, making the skill and failure mode materially distinct.

# Learner-Facing Setup

Open the Garden Site and see how a visitor tells Contact name from Preferred garden name. In Code Studio, complete the prepared test yourself: choose the Preferred garden name field by its visible label, enter the fictional value Juniper, save, and run. Do not identify the field only as first or second. There is no AI assistant.

# Seeded Environment

The local disposable form has two labeled text fields and a preview. The prepared test contains navigation and the final preview expectation but no solution for selecting or filling the field. The browser, editor, and runner are local. No account, network, submission, personal data, external service, generated completion, or AI capability exists. Reset restores the original form, blank data, prepared test slot, and run state.

# User-Simulation Instructions

Behave as Owen, using only visible form content, learner documentation, editor feedback, and runner output. Make the specified positional mistake once when appropriate, then inspect the failure and compare the manual field name with the visible label. Respond to effective coaching by replacing position with user meaning and editing the test yourself. Do not inspect DOM internals, evaluator facts, source implementation, or hidden selectors.

# Expected Experience

The Guide should orient Owen to the Garden Site and Code Studio without assuming editor or CLI experience. It should first ask how a visitor distinguishes the fields and let him connect that answer to the locator concept. Wrong-field feedback should identify the observed mismatch in plain language without pasting code. Progress should distinguish field inspection, first attempt, failed result, locator correction, rerun, and completion. Reflection should ask whether the test would still identify the field if order changed. No profile update is needed.

# Required Observable Evidence

Completion evidence is the label-grounded locator, Juniper entry, passing unchanged preview assertion, intact form, and absent AI interaction. Quality evidence includes Owen explaining why visible label meaning is stronger than position. Adaptation evidence is limited to timely in-session help. Safety evidence confirms only fictional local data is used. Do not retain raw keystrokes, DOM internals, or any unconfirmed preference inference.

# Completion Gate

All four gates in front matter are required. A passing test with a position-only locator remains incomplete. Completion is separate from quality: a correct label-grounded test can pass after direct guidance while still scoring below exceptional.

# Evaluation Rubric

Score stable-locator understanding (35), artifact correctness (25), recovery coaching (25), and novice experience (15), totaling 100. A failed gate makes the completion verdict FAIL regardless of points. Any critical failure blocks exceptional; position-only completion, seeded-artifact modification, or AI use fails completion.

# Experience Values

Assess clarity, recoverability, transferable learning, learner agency, and data minimization from the evidence definitions in front matter. Confirm the teaching remains about visitor-visible meaning, not one memorized selector spelling.

# Critical Failures

Fail completion for a position-only or hidden-internal locator, wrong-field entry, modified page/assertion, AI/generated code, skipped behavior, or a false passing claim. Instructor takeover, shaming, inaccessible recovery, unreliable reset, or unnecessary data collection blocks exceptional.

# Allowed Variance

Accept any equivalent Playwright locator semantics that directly use the visible label relationship, either site/editor order, earlier help, extra reruns, and different correct explanations. A safe field-order robustness probe may support exceptional evidence but must not alter the learner's persisted seed.

# Downstream Implementation Guidance

Seed two adjacent labeled fields, a fictional value, a preview, and a prepared manual-authoring slot. Make locator basis, entered value, assertion integrity, app integrity, test result, reset, and AI absence observable without prescribing exact syntax, selectors, components, routes, APIs, or event names. Evaluate semantic user meaning and allow equivalent label-grounded forms. Preserve the familiar Trellis desktop, Garden Site, and Code Studio workflow.

# Evaluator Instructions

Inspect the learner trace, site view, semantic edit events, artifact history, test runs, field/data classification, form and assertion integrity, instructor interactions, timing, recovery, deterministic completion, optional robustness evidence, and AI-capability record. Return exactly:

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
- "Preserve manual authorship, label-grounded user meaning, fictional minimal data, learner agency, no-AI operation, deterministic evidence, and equivalent valid paths without prescribing implementation."

# Future Progression

A harder follow-up chooses between two controls with similar labels using surrounding user-visible context. A transfer scenario locates an Email address field on a fictional support form. A likely regression scenario safely changes field order and confirms the learner's test remains meaningful. The exercise becomes too easy once Owen routinely derives field locators from visible labels. Trellis must not overfit to Juniper, one form layout, one exact label-locator spelling, or a specific editor and runner.
