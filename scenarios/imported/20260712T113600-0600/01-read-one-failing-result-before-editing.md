---
schema_version: "1.1"
scenario_id: "read-one-failing-result-before-editing"
title: "Read One Failing Playwright Result Before Editing"
created_at: "2026-07-12"
generator_run_id: "20260712T113600-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 1
  label: "Guided, single application, obvious objective"
  rationale: "The learner runs one prepared test, reads one compact failure, and records four visible facts without changing code."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "run-one-existing-test-on-purpose"
    - "turn-heading-check-into-first-test"
  capability_gap: "A novice practices treating a simple Playwright failure as evidence before attempting a fix."
  implementation_assumptions_to_avoid:
    - "A learner must review an AI-authored diff before failure output is educational."
    - "A generic red status is enough to understand a failure."
    - "The learner already knows stack traces, file-and-line notation, or terminal conventions."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.failure-reading"
  applications:
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.read-failed-test-identity"
    - "playwright.distinguish-expected-from-received"
  experience_qualities:
    - "clarity"
    - "instructional-restraint"
    - "transferable-learning"
persona:
  name: "Tessa Morgan"
  role: "Manual QA engineer beginning Playwright"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Writes expected and actual results in manual defect reports."
    - "Can compare two visible text values."
    - "Has run one named automated check but has not learned to read a stack trace."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "brief"
    prefers_examples: true
  accessibility_context: []
  behavioral_tendencies:
    - "Notices the red summary first and may stop reading there."
    - "May guess the app is wrong before locating expected and received values."
    - "Responds well to a short evidence checklist."
learning:
  primary_objective: "Read one simple failed Playwright result and identify what ran, where the check failed, what it expected, and what it received."
  supporting_objectives:
    - "Pause before editing and use the runner output as evidence."
  expected_profile_evidence:
    - "Accurately identified the failed test title, learner-visible source location, expected text, and received text from one run."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis Guide is open. Code Studio contains a disposable local Playwright project with one prepared failing text check, a short beginner README, and no uncommitted changes or AI capability."
  seeded_artifacts:
    - id: "garden-status-page"
      type: "file"
      description: "A fictional local page visibly showing Plot requests are open."
      data_classification: "public"
    - id: "prepared-failing-status-test"
      type: "code"
      description: "One readable existing test whose assertion intentionally expects Plot requests are closed; the test title and compact failure location are learner-visible."
      data_classification: "internal"
    - id: "failure-evidence-note"
      type: "document"
      description: "A blank four-field note labeled Test, Location, Expected, and Received."
      data_classification: "internal"
  available_applications:
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "The page, project, runner, and evidence note are local and disposable."
    - "No external repository, account, service, or person is contacted."
    - "The learner cannot invoke AI and receives no generated command, explanation, or code."
  reset_expectation: "Restore the unchanged page and failing test, clear run history, and empty the four-field evidence note."
task:
  learner_goal: "Run the prepared test and record the four most useful facts from its failure without fixing anything."
  learner_facing_prompt: "In Code Studio, use the beginner instructions to run the one prepared status test. Before changing anything, fill in the note with the test name, the file-and-line location shown for the failed check, the text Playwright expected, and the text the page actually returned. This exercise is only about reading the result. Do not edit the test or page, and do not use AI."
  constraints:
    - "Run only the prepared status test."
    - "Use only the learner-visible result to fill the evidence note."
    - "Do not edit the test, page, configuration, or runner output."
    - "Do not invoke AI or use a generated explanation."
  hidden_complications:
    - "The top summary says only that one test failed; the four useful facts appear lower in a compact result."
  acceptable_strategies:
    - "Read the output from top to bottom and fill the note in any order."
    - "Open the referenced test location after recording it, provided no edits are made."
  prohibited_shortcuts:
    - "Guessing from the page or test file without running and reading the failure."
    - "Editing either side so the run passes."
    - "Using hidden evaluator data, implementation internals, or AI."
user_simulation:
  initial_behavior: "Tessa opens the README, starts the prepared run, sees the red summary, and initially says only that the test failed."
  decision_policy:
    - "Use visible project instructions, runner output, and the optional referenced source view."
    - "Copy meaning accurately rather than reproducing punctuation or terminal decoration."
    - "Do not diagnose or fix beyond the requested evidence."
  realistic_questions:
    - "Which line tells me the name of the test?"
    - "Does expected mean the test or the page?"
    - "Is the file-and-line text telling me where the check failed?"
  mistakes:
    - trigger: "The first red summary appears."
      action: "Records failed as the received result and leaves the expected value blank."
      expected_recovery: "After a prompt to find the paired expected and received labels, replaces the summary word with the two actual text values."
  help_behavior:
    request_help_after: "The first evidence note is incomplete or confuses the summary with the expected/received pair."
    response_to_weak_help: "Asks where in the visible output to look next."
    response_to_effective_help: "Finds the paired labels, reads them aloud in plain language, and corrects the note herself."
  stopping_conditions:
    - "All completion gates pass."
    - "The local runner remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator information, source implementation, or runner internals."
    - "Do not alter any seeded project artifact."
    - "Do not use AI, generated commands, or generated interpretations."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "Exactly the prepared status test runs and produces the authored failure."
        evidence:
          - "Deterministic run record with selected and executed test identity."
      - id: "gate-2"
        description: "The learner records the correct test title and learner-visible source location from that run."
        evidence:
          - "Completed evidence note matched to the run output."
      - id: "gate-3"
        description: "The learner records Plot requests are closed as expected and Plot requests are open as received."
        evidence:
          - "Completed evidence note and deterministic failure report."
      - id: "gate-4"
        description: "The test project and page remain unchanged, and no learner AI interaction occurs."
        evidence:
          - "Workspace integrity comparison and capability/interaction record."
  quality_dimensions:
    - id: "failure-evidence-accuracy"
      weight: 35
      definition: "The learner extracts the four requested facts from the actual failed run."
      exceptional:
        - "All four facts are accurate on the first completed note and tied to the same run."
      acceptable:
        - "All four facts are accurate after one focused hint."
      poor:
        - "The note guesses, swaps expected and received, or mixes evidence from another source."
    - id: "expected-received-understanding"
      weight: 30
      definition: "The learner understands expected as the test's claim and received as the page's observed result."
      exceptional:
        - "Tessa explains the distinction in her own manual-QA language."
      acceptable:
        - "The final note places both values correctly after guidance."
      poor:
        - "The labels remain reversed or are treated as pass/fail synonyms."
    - id: "novice-orientation"
      weight: 20
      definition: "The runner output and source location are approachable without CLI or stack-trace knowledge."
      exceptional:
        - "Tessa can find each fact with the README and plain labels alone."
      acceptable:
        - "One brief orientation prompt enables completion."
      poor:
        - "Unexplained terminal or stack-trace jargon blocks the learner."
    - id: "instructional-restraint"
      weight: 15
      definition: "Guidance supports evidence reading without diagnosing or fixing the test for the learner."
      exceptional:
        - "A single question directs attention to the paired labels and then stops."
      acceptable:
        - "The instructor explains the four fields without supplying their contents."
      poor:
        - "The instructor fills the note, edits the test, or expands into unrelated debugging."
  critical_failures:
    - id: "edit-before-completion"
      severity: "blocker"
      description: "The test, page, or configuration is changed during the exercise."
      evidence: "Workspace integrity comparison."
    - id: "failure-not-observed"
      severity: "blocker"
      description: "Completion is awarded without the prepared failed run and its result evidence."
      evidence: "Run record versus completion state."
    - id: "expected-received-reversed"
      severity: "blocker"
      description: "The final evidence note reverses expected and received."
      evidence: "Evidence note versus deterministic report."
    - id: "ai-used-or-answer-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives a generated answer."
      evidence: "Capability, instructor, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor supplies the four completed evidence values."
      evidence: "Instructor and note-edit trace."
  positive_signals:
    - "The learner continues past the red summary to the detailed result."
    - "The learner says the test expected one phrase and the page returned another."
    - "The learner resists editing because evidence collection is the stated goal."
  negative_signals:
    - "A generic red badge is treated as sufficient evidence."
    - "The learner guesses from source content instead of reading the run."
    - "Any AI surface, generated command, or generated explanation appears."
  allowed_variance:
    - "Equivalent wording that preserves the exact meaning of the title, location, expected text, and received text."
    - "Filling the note fields in any order."
    - "Opening the referenced test location before or after completing the note."
    - "Earlier help or an extra identical rerun for confidence."
  evidence_requirements:
    - "Selected and executed test identity, failure status, and learner-visible result."
    - "Final four-field evidence note and its revision history."
    - "Initial and final workspace integrity snapshots."
    - "Instructor trace and proof that AI was absent and unused."
    - "Do not retain raw keystrokes or unrelated stack frames."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "Each requested failure fact is visibly distinguishable in plain language."
    positive_evidence:
      - "Tessa can point to the title, location, expected value, and received value."
    violation_evidence:
      - "Presentation hides the useful evidence inside unexplained noise."
    violation_severity: "major"
  - value: "psychological-safety"
    importance: "high"
    definition: "Misreading a first failure is treated as a normal beginner step."
    positive_evidence:
      - "Feedback neutrally redirects attention without blame."
    violation_evidence:
      - "The learner is shamed for not knowing runner conventions."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner gains a repeatable four-question failure-reading routine."
    positive_evidence:
      - "Tessa can state what ran, where, expected what, and received what."
    violation_evidence:
      - "Success depends on memorizing the seeded phrases or one output layout."
    violation_severity: "major"
  - value: "truthfulness"
    importance: "high"
    definition: "The note reflects measured run evidence rather than guesses or instructor claims."
    positive_evidence:
      - "All recorded facts trace to the same deterministic run."
    violation_evidence:
      - "Completion is inferred from a generic status or altered artifact."
    violation_severity: "major"
expected_artifacts:
  - id: "failed-run-evidence-note"
    type: "other"
    required_properties:
      - "Correct failed test title and learner-visible source location."
      - "Correct expected and received text values from one deterministic run."
      - "Learner-authored and traceable to the visible output."
    forbidden_properties:
      - "Project edits, diagnoses presented as facts, generated content, AI provenance, or sensitive data."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop and Code Studio with a plainly introduced local runner."
    - "A compact learner-visible failure that labels test identity, source location, expected, and received."
    - "A simple editable evidence note outside the test project."
  test_harness_needs:
    - "Seed and reset one deterministic failing test and its unchanged page."
    - "Observe focused-run identity, displayed evidence, note contents, integrity, and AI absence."
  evaluator_needs:
    - "Run report, evidence-note history, instructor trace, integrity result, and deterministic gate result."
  intentional_unknowns:
    - "Exact filenames, line number, runner syntax, terminal shell, result styling, and note presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "failure-reading"
  - "expected-received"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Tessa is a manual QA engineer learning to read one Playwright failure before changing anything. She runs one prepared status check and records the failed test title, source location, expected text, and received text. This CURRENT-EDGE scenario isolates evidence reading from diff review, diagnosis, and repair, applying the smallest new pressure to Trellis's existing Playwright workflow.

# Relationship to Existing Coverage

The current Playwright lab asks learners to review an AI-authored diff, run the full suite, interpret a failure, and repair a test. `run-one-existing-test-on-purpose` focuses one already-passing test and verifies its identity. This scenario has no AI-authored change, Git review, code edit, or green outcome. Its completion artifact is an evidence note from one failed run. That narrower objective makes it materially different while building directly on focused execution.

# Learner-Facing Setup

Open Code Studio and use the beginner instructions to run the prepared status test. Before changing anything, write down four facts from the result: which test failed, where Playwright points to the failed check, what text the test expected, and what text the page returned. Do not fix the test or page. There is no AI assistant.

# Seeded Environment

The disposable project contains a fictional garden-status page, one intentionally failing status test, a beginner README, and an empty four-field evidence note. Everything runs locally. No account, network, real repository, personal data, generated answer, or AI capability exists. Reset restores the exact failure and clears the note and run history.

# User-Simulation Instructions

Behave as Tessa, not as an evaluator. Use only visible instructions, runner output, and the optional referenced source view. Stop initially at the red summary, then make the specified expected/received mistake if appropriate. Respond to effective coaching by finding the detailed paired labels and correcting the note yourself. Do not edit the project, inspect internals, or diagnose beyond the visible facts.

# Expected Experience

The Guide should explain Code Studio's runner in plain language and frame the result as the automated equivalent of a manual expected-versus-actual record. It should allow the first incomplete reading, then ask four short evidence questions rather than supplying answers. The file-and-line location should be explained as where Playwright points to the failed check, without teaching stack-trace internals. Progress should distinguish run completed, evidence inspected, note completed, and scenario completed. No profile update is needed.

# Required Observable Evidence

Completion evidence is the exact focused failure, the accurate four-field note, unchanged workspace, and absent AI interaction. Quality evidence includes Tessa explaining expected as the test's claim and received as what the page returned. Adaptation evidence is limited to appropriately timed in-session help. Safety evidence confirms the local fictional boundary. Do not store raw keystrokes, unrelated stack frames, or inferred learner preferences.

# Completion Gate

All four gates in front matter are mandatory. A red run alone is incomplete, and a correct note guessed from source without the run is incomplete. Completion remains separate from experience quality: Tessa may complete after direct orientation while scoring below exceptional.

# Evaluation Rubric

Score failure-evidence accuracy (35), expected-received understanding (30), novice orientation (20), and instructional restraint (15), totaling 100. A failed gate produces a FAIL regardless of points. Any critical failure blocks exceptional; a reversed final pair, project edit, absent failed run, or AI use fails completion.

# Experience Values

Evaluate clarity, psychological safety, transferable learning, and truthfulness from the evidence definitions in front matter. Confirm that the learner gains a reusable reading routine rather than memorizing one output layout.

# Critical Failures

Fail completion for project edits, no observed failed run, a reversed expected/received pair, AI/generated answers, or a note unrelated to the selected run. Instructor takeover, shaming, misleading status, inaccessible output, or unreliable reset blocks exceptional.

# Allowed Variance

Accept equivalent wording, any note-field order, optional opening of the referenced location, earlier help, and an extra identical rerun. Do not penalize the initial summary-only reading when the learner subsequently corrects it from visible evidence.

# Downstream Implementation Guidance

Seed one compact deterministic failure and make its selected test identity, location, expected value, and received value visibly available. Make note authorship, run evidence, project integrity, reset, and AI absence observable. Accept semantic equivalence without prescribing commands, selectors, routes, components, APIs, event names, or exact line numbers. Preserve the familiar Trellis desktop and Code Studio mental model.

# Evaluator Instructions

Inspect the learner trace, selected run, displayed result, note revisions, instructor interactions, timing, project integrity, reset evidence if used, deterministic completion, and AI-capability record. Return exactly:

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
- "Preserve read-before-edit behavior, novice clarity, no-AI operation, deterministic evidence, and equivalent valid paths without prescribing implementation."

# Future Progression

A harder follow-up asks the learner to choose the first actionable failure when a focused test reports setup noise plus one assertion mismatch. A transfer scenario reads expected and received values from a different fictional page. A likely regression scenario verifies that cached or unrelated output cannot satisfy the evidence note. The exercise becomes too easy once Tessa consistently extracts the four facts without guidance. Trellis must not overfit to one phrase pair, filename, line number, or result layout.
