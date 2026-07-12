---
schema_version: "1.1"
scenario_id: "run-one-existing-test-on-purpose"
title: "Run One Existing Playwright Test on Purpose"
created_at: "2026-07-11"
generator_run_id: "20260711T233636-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 1
  label: "Guided, single application, obvious objective"
  rationale: "The learner opens one prepared project, identifies one named test, and runs only that test with a documented, guided workflow."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "turn-heading-check-into-first-test"
    - "check-form-result-without-timing-guesses"
  capability_gap: "A novice intentionally runs one existing Playwright test and connects the focused result to the selected test without editing code."
  implementation_assumptions_to_avoid:
    - "A beginner already understands terminals, command arguments, or test filtering."
    - "Running the entire suite demonstrates focused-test execution."
    - "A generic green status proves the intended test ran."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.test-execution"
  applications:
    - "code-editor"
    - "test-runner"
  capabilities:
    - "playwright.identify-test-structure"
    - "playwright.run-one-test"
  experience_qualities:
    - "clarity"
    - "learner-agency"
    - "transferable-learning"
persona:
  name: "Renee Park"
  role: "Manual QA engineer beginning Playwright"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Runs individual manual test cases from a test-management list."
    - "Recognizes a test title as the automated equivalent of a manual case name."
    - "Has not used a command-line test filter."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "brief"
    prefers_examples: true
  accessibility_context: []
  behavioral_tendencies:
    - "Opens the project instructions before using the terminal."
    - "May run every test because that is the most visible instruction."
    - "Checks the displayed test title when prompted."
learning:
  primary_objective: "Choose and run one existing Playwright test, then verify that the focused result belongs to it."
  supporting_objectives:
    - "Recognize the test title and test body as one named check."
  expected_profile_evidence:
    - "Selected a named existing test and produced a focused run containing only that test."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis desktop opens with the Guide visible. Code Studio contains a disposable local Playwright project with three passing tests and a short beginner README. No files are modified and no AI capability is present."
  seeded_artifacts:
    - id: "pickup-page"
      type: "file"
      description: "A fictional local community pickup page used by the prepared tests."
      data_classification: "public"
    - id: "existing-pickup-tests"
      type: "code"
      description: "Three readable existing tests, including one titled Weekday pickup hours are shown; all are initially green."
      data_classification: "internal"
    - id: "focused-run-guide"
      type: "document"
      description: "A novice README explains that the terminal is the text box at the bottom of Code Studio, that a run instruction starts the test runner, and that a focus option narrows the run to one test title. It provides a project-valid example without exposing evaluator internals."
      data_classification: "internal"
  available_applications:
    - "code-editor"
    - "test-runner"
  simulation_boundaries:
    - "All files and browser activity are local and disposable."
    - "No external repository, service, account, or person is contacted."
    - "The learner cannot invoke AI and receives no generated command or code."
  reset_expectation: "Restore the pristine project, clear run history, and reopen the same beginner orientation state."
task:
  learner_goal: "Run only the existing test named Weekday pickup hours are shown and confirm that it passes."
  learner_facing_prompt: "Open Code Studio and find the test named Weekday pickup hours are shown. Use the project's beginner instructions to run that one test, not all three. The terminal is simply the text box at the bottom where you ask the local project to run a check; it cannot contact anything outside this practice workspace. Confirm the result names the test you chose. No code changes and no AI are needed."
  constraints:
    - "Do not edit, skip, rename, or add tests."
    - "Do not modify the page or project configuration."
    - "Use the learner-visible project instructions to focus the run."
    - "Do not invoke AI or use generated commands."
  hidden_complications:
    - "The learner's first run may execute all three tests because the general run instruction is easier to notice."
  acceptable_strategies:
    - "Use the documented focused-run instruction with the visible test title."
    - "Use an equivalent learner-visible focused-run affordance if the downstream workspace provides one."
  prohibited_shortcuts:
    - "Accepting a full-suite result as focused execution."
    - "Changing the project so only one test remains."
    - "Using hidden runner APIs, evaluator information, or AI."
user_simulation:
  initial_behavior: "Renee opens Code Studio, reads the project README, and locates the named test."
  decision_policy:
    - "Use only visible files, instructions, terminal output, and controls."
    - "Try the most prominent run instruction once before asking for help."
    - "Compare the result's displayed test title with the requested title."
  realistic_questions:
    - "Is the terminal just where I type the run instruction?"
    - "How do I tell it which one of the three tests I mean?"
    - "How can I tell that only my chosen test ran?"
  mistakes:
    - trigger: "First test execution."
      action: "Runs the full three-test suite and initially treats the green summary as completion."
      expected_recovery: "After a plain-language prompt to compare the requested scope with the result list, uses the documented focus option and reruns only the named test."
  help_behavior:
    request_help_after: "The first run contains more than one test or Renee cannot identify which result belongs to the requested title."
    response_to_weak_help: "Asks what the unfamiliar option changes."
    response_to_effective_help: "Explains that the option narrows the run by test name, then applies it herself."
  stopping_conditions:
    - "All completion gates pass."
    - "Code Studio or the local runner remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator information, runner internals, or source implementation."
    - "Do not alter the seeded project."
    - "Do not use AI, generated commands, or generated code."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner locates the requested existing test by its learner-visible title."
        evidence:
          - "File-open trace or equivalent learner-visible selection evidence."
      - id: "gate-2"
        description: "A focused execution runs exactly the requested test and no other tests."
        evidence:
          - "Deterministic run record with selected and executed test identities."
      - id: "gate-3"
        description: "The focused test passes and the learner verifies that the displayed result names the requested test."
        evidence:
          - "Run output plus learner confirmation or semantic result-inspection trace."
      - id: "gate-4"
        description: "No project file changes or learner AI interactions occur."
        evidence:
          - "Workspace integrity comparison and capability/interaction record."
  quality_dimensions:
    - id: "focused-execution-understanding"
      weight: 35
      definition: "The learner understands that focused execution narrows a run to a chosen named test."
      exceptional:
        - "Renee explains the scope difference and independently verifies the single result."
      acceptable:
        - "Renee completes the focused run after one conceptual hint."
      poor:
        - "A full-suite pass is mistaken for focused execution or the focus instruction is copied without result checking."
    - id: "result-attribution"
      weight: 25
      definition: "The pass is tied to the requested test rather than a generic green indicator."
      exceptional:
        - "The learner checks both the test title and the one-test scope."
      acceptable:
        - "The deterministic record and learner trace show correct attribution."
      poor:
        - "The experience declares success without proving which test ran."
    - id: "novice-orientation"
      weight: 25
      definition: "Code Studio and the terminal are introduced in plain language with a bounded purpose."
      exceptional:
        - "Renee proceeds without needing prior editor or command-line knowledge."
      acceptable:
        - "One brief orientation prompt enables progress."
      poor:
        - "Unexplained jargon or assumed CLI knowledge blocks the learner."
    - id: "learner-agency"
      weight: 15
      definition: "The learner chooses, runs, and verifies the test."
      exceptional:
        - "Guidance stops once Renee identifies the scope correction."
      acceptable:
        - "Renee performs the focused run herself with guidance."
      poor:
        - "The instructor runs the test or supplies an opaque command on her behalf."
  critical_failures:
    - id: "wrong-scope-accepted"
      severity: "blocker"
      description: "Completion is awarded when more than the requested test ran."
      evidence: "Run record versus completion state."
    - id: "project-mutated"
      severity: "blocker"
      description: "A project change is used to reduce the number of runnable tests."
      evidence: "Workspace integrity comparison."
    - id: "ai-or-generated-command"
      severity: "blocker"
      description: "The learner invokes AI or receives a generated command."
      evidence: "Capability, instructor, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor performs the run or provides unexplained steps that bypass learning."
      evidence: "Instructor and execution trace."
  positive_signals:
    - "The learner reads the test title before running."
    - "The learner notices that the first output lists three tests."
    - "The focused result displays only the requested title."
  negative_signals:
    - "A generic green badge is treated as sufficient evidence."
    - "Guidance assumes knowledge of flags, shells, or regular expressions."
    - "Any AI surface or generated answer appears."
  allowed_variance:
    - "An equivalent learner-visible focused-run control instead of the integrated terminal."
    - "Opening the test file before or after the README."
    - "Earlier help requests or equivalent plain-language descriptions of run scope."
    - "An extra focused rerun for confidence."
  evidence_requirements:
    - "Initial and final workspace integrity snapshots."
    - "Learner-visible selection of the requested test."
    - "Full-suite mistake record if it occurs, followed by the focused run record."
    - "Executed test identities and deterministic pass result."
    - "Instructor trace and record that AI was absent and unused."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "Run scope, test title, and result are understandable without prior CLI knowledge."
    positive_evidence:
      - "Instructions explain the terminal's limited purpose and the meaning of a focused run."
    violation_evidence:
      - "Unexplained syntax or a generic status obscures what ran."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Renee makes the scope correction and runs the test herself."
    positive_evidence:
      - "The learner initiates and verifies the focused run."
    violation_evidence:
      - "The system executes or accepts the result for her."
    violation_severity: "major"
  - value: "psychological-safety"
    importance: "high"
    definition: "Running too many tests is treated as a normal, recoverable beginner mistake."
    positive_evidence:
      - "Feedback neutrally compares intended and actual run scope."
    violation_evidence:
      - "The learner is blamed for not knowing command-line conventions."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can focus another test by its visible name."
    positive_evidence:
      - "Renee can describe selecting a test and confirming the result scope."
    violation_evidence:
      - "Success depends on memorizing a Trellis-only sequence."
    violation_severity: "major"
expected_artifacts:
  - id: "focused-test-run"
    type: "other"
    required_properties:
      - "Exactly one executed test."
      - "Executed title corresponds to Weekday pickup hours are shown."
      - "Deterministic passing result and unchanged workspace."
    forbidden_properties:
      - "Project edits, skipped tests, AI provenance, or hidden runner access."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop and Code Studio experience with a plainly introduced local runner."
    - "Learner-visible project guidance for running one named test."
    - "A result surface that shows both test identity and run scope."
  test_harness_needs:
    - "Seed three named passing tests and reset run history deterministically."
    - "Observe selected and executed test identities separately from generic pass status."
    - "Verify workspace integrity and AI absence."
  evaluator_needs:
    - "Selection trace, run-scope evidence, pass result, instructor interaction, and integrity evidence."
  intentional_unknowns:
    - "Exact test filename, runner syntax, focus mechanism, terminal shell, and result presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "focused-run"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Renee is a manual QA engineer learning to connect one named manual case with one named automated test run. She opens the familiar Trellis desktop and Code Studio, finds an existing test, and deliberately runs only that test. This CURRENT-EDGE scenario adds focused execution and result attribution without code changes, AI, or advanced runner knowledge.

# Relationship to Existing Coverage

The current Playwright lab runs the full suite while reviewing and repairing an AI-authored change. The prior heading scenario authors a first observation check; the prior form scenario authors an interaction check and replaces a fixed wait. None isolates selecting one already-green test, narrowing execution to it, and proving that the displayed pass belongs to that test. This scenario is therefore not a diff-review, failure-reading, locator, assertion, or manual-authoring duplicate.

# Learner-Facing Setup

Open Code Studio, find Weekday pickup hours are shown, and use the beginner project instructions to run just that test. The terminal is the text box at the bottom where this local project accepts run instructions. Confirm the result names the test you selected. Do not change any files; there is no AI assistant.

# Seeded Environment

The disposable local project contains a fictional pickup page, three readable passing tests, and a beginner README describing general and focused runs in plain language. Code Studio and the local runner are the only applications needed. No account, network, real data, external repository, generated answer, or AI capability exists. Reset restores pristine files and clears all run evidence.

# User-Simulation Instructions

Behave as Renee, not as an evaluator. Use only visible project files, instructions, controls, and output. Read the test title, then make the specified full-suite mistake once if the prominent general instruction leads there. Respond to a clear scope question by finding the focused-run guidance, applying it yourself, and checking the result list. Do not edit files, inspect internals, or use hidden information.

# Expected Experience

The Guide should orient Renee to Code Studio and explain the terminal as a bounded local runner, not assume she knows a shell. It should let the first scope mistake happen safely, then ask how many tests were requested and how many appeared. Help should explain the focusing concept without executing the run. Progress should distinguish finding the test, running the wrong scope, correcting the scope, verifying the title, and completion. No profile update is needed.

# Required Observable Evidence

Completion evidence consists of the requested test selection, an exactly-one-test run, its passing result, matching displayed title, unchanged project, and no AI interaction. Quality evidence includes Renee recognizing why the full-suite result did not satisfy the narrower goal. Adaptation evidence is limited to timely in-session help; no cross-session change is expected. Safety evidence confirms the local disposable boundary. Do not store raw keystrokes or infer a persistent terminal preference.

# Completion Gate

All four front-matter gates are mandatory. A green full-suite run does not complete the scenario. Completion is separate from experience quality: Renee may complete after direct conceptual guidance but score below exceptional if orientation or agency was weak.

# Evaluation Rubric

Score focused-execution understanding (35), result attribution (25), novice orientation (25), and learner agency (15), totaling 100. A failed completion gate produces a FAIL regardless of points. Cap below 92 for any major critical failure. Apply each exceptional, acceptable, and poor anchor using traceable evidence.

# Experience Values

Evaluate clarity, learner agency, psychological safety, and transferable learning using the definitions and evidence in front matter. In particular, confirm the terminal explanation is understandable to someone with no CLI background and that the scope correction remains learner-led.

# Critical Failures

Fail completion if the wrong scope is accepted, files are changed to force a single run, the requested test does not pass, or AI/generated instructions are used. Instructor takeover, misleading result attribution, shame, hidden runner access, or unreliable reset blocks exceptional.

# Allowed Variance

Accept an equivalent visible focused-run control, a different order for opening README and test file, earlier help, extra focused reruns, and equivalent plain-language explanations. Do not penalize the initial full-suite run when the learner subsequently identifies and corrects the scope.

# Downstream Implementation Guidance

Seed a local project with three distinct named green tests and beginner-facing focused-run documentation. Make selected scope, executed identities, pass status, project integrity, and AI availability observable without tying the design to a command, route, selector, event name, or component. Downstream agents decide the exact runner affordance and syntax. Preserve the familiar Trellis desktop and Code Studio mental model.

# Evaluator Instructions

Inspect the learner trace, test-file view, runner interactions, executed test identities, result title, project integrity, instructor exchanges, timing, any recovery, deterministic completion, and AI-capability record. Return exactly:

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
- "Preserve focused execution, learner agency, no-AI operation, novice orientation, deterministic evidence, and equivalent valid paths without prescribing implementation."

# Future Progression

A harder follow-up runs one failing test and identifies its first useful error line. A transfer scenario focuses one test in a different local project. A likely regression scenario verifies that focused results cannot be confused with cached suite results. The exercise becomes too easy once Renee routinely selects and verifies individual tests. Trellis must not overfit to one title, runner syntax, terminal, or result layout.
