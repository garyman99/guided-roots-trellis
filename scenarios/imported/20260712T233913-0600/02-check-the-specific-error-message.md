---
schema_version: "1.1"
scenario_id: "check-the-specific-error-message"
title: "Check the Specific Error Message"
created_at: "2026-07-12"
generator_run_id: "20260712T233913-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 2
  label: "Guided, multiple steps, low ambiguity"
  rationale: "The learner inspects one visible negative-path result, manually completes one assertion slot, runs the focused test, and recovers from an under-specific green check."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "turn-heading-check-into-first-test"
    - "read-one-failing-result-before-editing"
    - "keep-test-data-and-expected-result-in-sync"
  capability_gap: "A novice manually authors a content-specific assertion and learns that a passing visibility check may still fail to verify the manual expected result."
  implementation_assumptions_to_avoid:
    - "Any green Playwright result proves the intended behavior was checked."
    - "Only one exact assertion spelling can express the required message."
    - "Assertion precision requires generated code, advanced locator knowledge, or application internals."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.expected-results"
  applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.assert-specific-visible-text"
    - "testing.reject-under-specific-green"
  experience_qualities:
    - "truthfulness"
    - "clarity"
    - "recoverability"
persona:
  name: "Marcus Lee"
  role: "Manual QA engineer beginning to write Playwright assertions"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Writes manual negative-path checks with exact expected messages."
    - "Understands that an assertion states what the page should show."
    - "Has not yet distinguished checking presence from checking content."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "normal"
    prefers_examples: false
  accessibility_context: []
  behavioral_tendencies:
    - "First tries to prove that an error appeared because that seems sufficient."
    - "Trusts a green runner result until the intended manual expectation is compared with the test."
    - "Makes one focused revision when feedback explains the evidence gap."
learning:
  primary_objective: "Assert the specific visible error message required by a manual case rather than checking only that an error is present."
  supporting_objectives:
    - "Treat green execution and adequate coverage as separate questions."
  expected_profile_evidence:
    - "Manually authored a specific expected-message assertion and recovered from an under-specific green run."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis Guide is open. Garden Site shows a disposable fictional nickname form. Code Studio contains one prepared negative-path test with navigation, empty submission, and a user-visible error target already set up; only the marked assertion slot is for the learner. No AI capability is present."
  seeded_artifacts:
    - id: "garden-nickname-form"
      type: "file"
      description: "A fictional local form that shows the visible message Please enter a garden nickname. when submitted empty."
      data_classification: "public"
    - id: "manual-error-case"
      type: "document"
      description: "Manual case: submit without a nickname and verify the full visible error message Please enter a garden nickname."
      data_classification: "public"
    - id: "prepared-error-test-slot"
      type: "code"
      description: "A valid focused test with page preparation, empty submission, and the user-visible error target prepared; the assertion slot contains no solution code."
      data_classification: "internal"
  available_applications:
    - "browser"
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "The form, message, test project, and runner are fictional, local, and disposable."
    - "No real submission, account, external repository, network service, or personal data exists."
    - "The learner cannot invoke AI and receives no generated code, command, or solution."
  reset_expectation: "Restore the pristine form, manual case, empty assertion slot, prepared interaction, and clear focused-run history."
task:
  learner_goal: "Complete and run one Playwright assertion that verifies the full error message from the manual case."
  learner_facing_prompt: "Use Garden Site to observe the empty-submit result, then complete the marked assertion in Code Studio yourself. The manual case requires the full message Please enter a garden nickname., not only proof that some error appeared. Save and run the focused test. If an initial check runs green but the checkpoint says it checks too little, compare the assertion with the manual expected result, make it specific, and rerun until both the test and checkpoint are green. Do not use AI or change the page."
  constraints:
    - "Change only the marked assertion slot."
    - "Keep the prepared page opening, empty submission action, and user-visible error target unchanged."
    - "Verify the full seeded error message, not merely visibility, non-emptiness, or generic error presence."
    - "Do not modify the page, bypass submission, skip the test, weaken the expected result, or invoke AI."
  hidden_complications:
    - "Marcus may first add a visibility-only assertion; the focused test can pass even though the scenario checkpoint remains incomplete."
  acceptable_strategies:
    - "Observe the page before writing the assertion or rely on the exact manual expected result and then confirm it in Garden Site."
    - "Write the specific message assertion on the first attempt or recover after one under-specific green run."
    - "Use any equivalent Playwright assertion that verifies the complete visible message on the prepared user-facing target."
  prohibited_shortcuts:
    - "Accepting a visibility-only, non-empty, partial, or broad assertion as completion."
    - "Changing the application message, prepared action, or target to match the test."
    - "Using generated code, hidden evaluator data, exact internals, or AI."
user_simulation:
  initial_behavior: "Marcus opens Garden Site, submits the empty fictional form, reads the error, and then opens the prepared assertion slot in Code Studio."
  decision_policy:
    - "Use only the manual case, visible page, beginner instructions, editor feedback, and focused-run output."
    - "Treat the full manual expected result as the coverage requirement even if a broader check passes."
    - "After incomplete feedback, change only the assertion and rerun."
  realistic_questions:
    - "If the test can see an error, why is that not enough?"
    - "Should the assertion include the whole message from the manual case?"
    - "Can a test be green and still miss the point of the case?"
  mistakes:
    - trigger: "Marcus completes the assertion slot for the first time."
      action: "Checks only that the prepared error target is visible, then assumes the green focused run means the manual case is covered."
      expected_recovery: "Compares the manual expected result with what the assertion actually proves, replaces the broad check with a full-message assertion, and reruns until both execution and semantic checkpoint pass."
  help_behavior:
    request_help_after: "The visibility-only run passes but the checkpoint reports that exact message content is not verified."
    response_to_weak_help: "Asks what fact from the manual case is still untested."
    response_to_effective_help: "States that visibility proves an error exists but not that it says the required words, then authors the specific assertion himself."
  stopping_conditions:
    - "All completion gates pass."
    - "Garden Site, Code Studio, or the local runner remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator data, page implementation, or exact internal selectors."
    - "Do not modify the seeded application, prepared interaction, or error target."
    - "Do not use AI, generated suggestions, external help services, or solution artifacts."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The prepared negative-path interaction still submits the form without a nickname and reaches the intended visible error."
        evidence:
          - "Final artifact semantics and deterministic interaction result."
      - id: "gate-2"
        description: "The learner-authored assertion verifies the complete visible message Please enter a garden nickname. on the prepared user-facing error target."
        evidence:
          - "Final artifact and semantic assertion classification."
      - id: "gate-3"
        description: "The focused test and semantic checkpoint both pass after the learner's final assertion edit."
        evidence:
          - "Focused run identity, result history, and deterministic checkpoint."
      - id: "gate-4"
        description: "The page, prepared interaction, and error target remain unchanged, and no learner AI interaction occurs."
        evidence:
          - "Workspace integrity and capability or interaction record."
  quality_dimensions:
    - id: "assertion-specificity"
      weight: 35
      definition: "The assertion proves the complete manual expected result rather than generic error presence."
      exceptional:
        - "Marcus authors the full-message check and explains exactly what evidence the visibility-only version lacked."
      acceptable:
        - "The final assertion is specific after one focused hint."
      poor:
        - "The check remains broad, partial, or dependent on unrelated implementation details."
    - id: "coverage-reasoning"
      weight: 25
      definition: "The learner distinguishes green execution from adequate coverage."
      exceptional:
        - "Marcus independently compares the manual expectation with the assertion's actual claim before accepting completion."
      acceptable:
        - "He makes the comparison after honest checkpoint feedback."
      poor:
        - "A green result is treated as sufficient without examining test meaning."
    - id: "recovery-and-feedback"
      weight: 25
      definition: "An under-specific green run leads to a clear, learner-led correction."
      exceptional:
        - "Feedback names the missing evidence without supplying code, and Marcus changes only the assertion."
      acceptable:
        - "Plain-language feedback enables a correct focused revision."
      poor:
        - "The experience falsely completes, shames the learner, or dictates the solution."
    - id: "novice-experience"
      weight: 15
      definition: "The workflow stays bounded and understandable without prior CLI or editor knowledge."
      exceptional:
        - "Marcus moves among Garden Site, the marked slot, and the runner without unnecessary concepts."
      acceptable:
        - "One orientation hint enables completion."
      poor:
        - "Jargon, hidden state, or tooling assumptions obscure the assertion lesson."
  critical_failures:
    - id: "under-specific-green-accepted"
      severity: "blocker"
      description: "Completion is awarded when the final assertion proves only visibility, presence, non-emptiness, or a partial message."
      evidence: "Final artifact and deterministic semantic evaluation."
    - id: "expected-message-not-verified"
      severity: "blocker"
      description: "The complete seeded manual expected result is not verified by the passing test."
      evidence: "Manual-case-to-assertion comparison."
    - id: "seeded-behavior-changed"
      severity: "blocker"
      description: "The page, message, prepared submission, or error target is changed to pass."
      evidence: "Workspace integrity comparison."
    - id: "ai-used-or-code-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives generated assertion code."
      evidence: "Capability, Guide, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor writes or inserts the final assertion."
      evidence: "Instructor and edit trace."
  positive_signals:
    - "Marcus reads the visible error before finalizing the assertion."
    - "He explains that presence and content are different claims."
    - "Only the marked assertion changes after incomplete feedback."
  negative_signals:
    - "A process exit code alone triggers completion."
    - "The expected message is shortened until unrelated copy could pass."
    - "Any AI surface, generated code, or real data appears."
  allowed_variance:
    - "Equivalent Playwright assertion forms that verify the complete visible message on the prepared target."
    - "Writing the specific assertion correctly before the first run."
    - "Inspecting Garden Site before or after opening Code Studio."
    - "Earlier help, additional focused reruns, or equivalent explanations of assertion precision."
  evidence_requirements:
    - "Initial and final assertion-slot artifact plus semantic edit classification."
    - "Focused run identity and result history, including the under-specific green run if it occurs."
    - "Deterministic proof that the final assertion verifies the full seeded message."
    - "Application, prepared-interaction, and target integrity before and after."
    - "Instructor trace and record that AI was absent and unused."
    - "Do not retain raw keystrokes, unrelated source, or data beyond the fictional error message."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "truthfulness"
    importance: "high"
    definition: "Completion accurately represents what the final assertion proves."
    positive_evidence:
      - "A green visibility-only run remains incomplete until message content is checked."
    violation_evidence:
      - "The experience claims the manual case is covered based only on execution success."
    violation_severity: "disqualifying"
  - value: "clarity"
    importance: "high"
    definition: "The difference between error presence and required error content is understandable."
    positive_evidence:
      - "Feedback compares the manual expected result with the assertion's actual claim in plain language."
    violation_evidence:
      - "The learner receives only a generic incomplete status or unexplained assertion jargon."
    violation_severity: "major"
  - value: "recoverability"
    importance: "high"
    definition: "An under-specific green attempt can be corrected through one safe assertion edit."
    positive_evidence:
      - "Marcus preserves the interaction, strengthens the assertion, and reruns successfully."
    violation_evidence:
      - "The learner reaches a dead end, rewrites unrelated code, or loses work."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can compare any manual expected result with what an automated assertion actually verifies."
    positive_evidence:
      - "Marcus explains that green execution does not guarantee adequate coverage."
    violation_evidence:
      - "Success depends on memorizing this one garden message or assertion spelling."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Marcus observes, authors, revises, and verifies the assertion."
    positive_evidence:
      - "Hints stop after he identifies the evidence gap."
    violation_evidence:
      - "The instructor or system inserts the final assertion."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-specific-error-assertion"
    type: "code-change"
    required_properties:
      - "Learner-authored change is confined to the marked assertion slot."
      - "The complete fictional error message is verified on the prepared user-visible target."
      - "The focused test and semantic checkpoint pass deterministically."
    forbidden_properties:
      - "Executable solution code in this scenario specification."
      - "Visibility-only or partial check, app mutation, prepared-step change, generated code, AI provenance, exact internal selector, or real data."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop with Garden Site, Code Studio, a marked assertion slot, and a focused local runner."
    - "AI-free manual authoring and honest semantic feedback when a green test checks too little."
  test_harness_needs:
    - "Seed and reset the fictional form, manual case, prepared interaction and target, empty assertion slot, and run state."
    - "Semantically distinguish full-message assertions from visibility, presence, non-empty, partial, skipped, or implementation-coupled checks."
  evaluator_needs:
    - "Artifact history, manual-case comparison, run and checkpoint results, integrity evidence, instructor trace, and AI-absence record."
  intentional_unknowns:
    - "Exact filenames, editor controls, test syntax, assertion spelling, target implementation, runner command, event names, and feedback presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "assertion-specificity"
  - "expected-message"
  - "green-is-not-coverage"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Marcus is a manual QA engineer writing one specific Playwright assertion for a familiar negative-path case. He learns that proving an error is visible does not prove it contains the required message. This CURRENT-EDGE scenario adds assertion precision and honest semantic completion while keeping navigation, submission, and target selection prepared. It is basic, local, observable, and entirely manual.

# Relationship to Existing Coverage

`turn-heading-check-into-first-test` distinguishes locating from asserting but intentionally uses visibility as the expected result. The current Playwright lab repairs stale expected text inside a larger AI-authored diff review, and `read-one-failing-result-before-editing` extracts evidence without editing. `keep-test-data-and-expected-result-in-sync` aligns one value across an action and expected result. This scenario has no AI diff, failure-reading objective, locator choice, timing issue, or data mismatch. It is materially different because its new pressure is a learner-authored check that can execute green while remaining semantically incomplete because it verifies only presence, not the manual case's exact content.

# Learner-Facing Setup

Submit the fictional form empty in Garden Site and read the error. In Code Studio, complete only the marked assertion so the focused test verifies the full manual expected message, Please enter a garden nickname. Save and run it. If a broad check runs green but the checkpoint says it checks too little, compare what the manual case requires with what your assertion actually proves, strengthen it yourself, and rerun. Do not change the page or use AI.

# Seeded Environment

The disposable local workspace contains a fictional nickname form, an exact manual negative-path case, and a valid prepared test with page opening, empty submission, and the user-visible error target already established. Only the assertion slot is empty. Garden Site, Code Studio, Guide, and a focused runner are available. No external service, real account, personal data, AI surface, generated completion, exact selector lesson, or solution artifact exists. Reset restores every seeded artifact and clears run history.

# User-Simulation Instructions

Behave as Marcus and use only learner-visible information. Observe the form, make a reasonable first assertion attempt, and if triggered use a visibility-only check that runs green. Do not treat that as sabotage; it is a believable novice interpretation. Respond to honest checkpoint feedback by comparing the manual expected result with the assertion's actual meaning, then write the specific assertion and rerun. Ask realistic questions, accept effective help, and never inspect internals, use AI, or let the instructor author the result.

# Expected Experience

Orientation should make the form, manual case, marked assertion slot, and focused runner obvious without prior editor or CLI knowledge. Guidance should acknowledge the green run while truthfully explaining that it proves only presence. It should ask what exact fact remains unchecked before naming the distinction, avoid pasting code, and stop after Marcus recovers. Progress should distinguish saved, execution green, semantic coverage complete, and checkpoint complete. The mismatch between green execution and incomplete coverage should feel safe and actionable, not punitive. Reflection should ask what the final assertion proves. No profile update is required.

# Required Observable Evidence

Completion evidence: the unchanged prepared interaction reaches the visible error, the learner-authored assertion verifies the complete seeded message, the focused run and semantic checkpoint pass, seeded behavior is unchanged, and AI was absent. Quality evidence: Marcus explains the evidence gap and makes a focused revision. Adaptation evidence is limited to hint timing in this run. Safety evidence confirms a fictional, local, resettable action with no external effect. Do not retain raw keystrokes, implementation details, or any data beyond the fictional expected message needed for evaluation.

# Completion Gate

All four front-matter gates are non-negotiable. A green visibility-only or partial assertion is incomplete. A specific-looking artifact that changes the page, prepared action, or target is incomplete. Completion is separate from experience quality: Marcus can pass after direct conceptual guidance while scoring below exceptional if the experience was confusing or overly prescriptive.

# Evaluation Rubric

Score assertion specificity (35), coverage reasoning (25), recovery and feedback (25), and novice experience (15), totaling 100. Use the exceptional, acceptable, and poor anchors and cite artifacts, semantic evaluation, runs, and interaction evidence. Any failed gate yields a failed completion verdict regardless of points. Any critical failure blocks exceptional; accepting an under-specific green result, missing the expected message, changing seeded behavior, or using AI fails completion.

# Experience Values

Truthfulness, clarity, recoverability, transferable learning, and learner agency govern this exercise. Evaluate whether completion matches the assertion's real meaning, whether feedback makes the evidence gap understandable, whether the novice can recover safely, and whether Marcus remains the author. Apply the observable evidence and severities in front matter.

# Critical Failures

Fail completion if a visibility-only, presence-only, non-empty, partial, or otherwise under-specific assertion is accepted; if the complete message is not checked; if seeded behavior changes; if the action is bypassed or test skipped; or if AI or generated code appears. Block exceptional for instructor takeover, shaming, false green-equals-coverage messaging, inaccessible recovery, unreliable reset, or evaluation tied to one exact syntax spelling.

# Allowed Variance

Accept any equivalent Playwright assertion that verifies the complete visible message on the prepared user-facing target, either page/editor order, a correct first attempt, earlier help, extra reruns, and equivalent explanations of presence versus content. Do not require one exact selector or assertion spelling. Do not penalize the initial green visibility check if it is corrected before completion.

# Downstream Implementation Guidance

Seed a local empty-submit behavior with a stable fictional message, a manual case, and a prepared focused test whose only learner slot is the assertion. Keep AI unavailable. Make run success, assertion semantics, checkpoint status, artifact history, application integrity, and reset observable. Evaluation must accept equivalent full-message assertions and reject broad or partial checks even when execution passes. Downstream agents choose filenames, UI, runner presentation, event names, and internal evaluation strategy. Do not expose solution code, exact selectors, components, APIs, or internals.

# Evaluator Instructions

Inspect the learner-agent trace, Garden Site observation, semantic edit events, initial and final artifacts, focused run history, deterministic checkpoint, app and prepared-step integrity, instructor interactions, timing and recovery, reset evidence if used, and AI-absence record. Compare the final assertion's meaning with the full seeded manual expected result rather than matching one code string. Return exactly:

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
- "Preserve manual authorship, full-message semantics, honest completion, AI absence, and equivalent valid assertions without prescribing implementation."

# Future Progression

A harder follow-up asks Marcus to choose between exact and contains-style expectations based on a manual case with stable and variable text. A transfer scenario checks a specific validation message in a fictional inventory form. A likely regression scenario changes unrelated nearby copy and confirms the intended full message remains the only completion target. The exercise becomes too easy once Marcus routinely compares manual expectations with assertion meaning. Trellis must not overfit to the garden wording, one target representation, one assertion spelling, or one runner layout.
