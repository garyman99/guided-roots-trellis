---
schema_version: "1.1"
scenario_id: "separate-shared-setup-from-one-test"
title: "Separate Shared Setup From One Test's Check"
created_at: "2026-07-12"
generator_run_id: "20260712T233913-0600"
scenario_class: "CURRENT-EDGE"
difficulty:
  level: 1
  label: "Guided, single application, obvious objective"
  rationale: "The learner reads one short existing test file and sorts visible responsibilities into shared preparation and one named test body without editing or running code."
repository_context:
  baseline_commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
  related_existing_scenarios:
    - "labs/learn-playwright-basics"
    - "turn-heading-check-into-first-test"
    - "run-one-existing-test-on-purpose"
  capability_gap: "A novice can understand where common page preparation ends and one named Playwright check begins before attempting another edit."
  implementation_assumptions_to_avoid:
    - "Understanding test structure requires prior CLI or VS Code knowledge."
    - "The evaluator should require one exact Playwright spelling or file layout."
    - "A learner must run or modify a test for structural comprehension to count."
coverage:
  primary_domain: "software-testing.playwright"
  secondary_domains:
    - "quality-assurance.test-structure"
  applications:
    - "code-editor"
    - "learning-guide"
  capabilities:
    - "playwright.distinguish-shared-setup"
    - "playwright.identify-test-boundary"
  experience_qualities:
    - "clarity"
    - "instructional-restraint"
    - "transferable-learning"
persona:
  name: "Nina Brooks"
  role: "Manual QA engineer beginning to read Playwright tests"
  technical_confidence: "low"
  ai_familiarity: "none"
  relevant_experience:
    - "Reads manual cases with preconditions, steps, and expected results."
    - "Has opened one small test project before."
    - "Does not yet know which lines apply to every test and which belong to one case."
  declared_preferences:
    guidance_style: "guided"
    explanation_depth: "brief"
    prefers_examples: false
  accessibility_context: []
  behavioral_tendencies:
    - "Starts at the first line and may treat imports or punctuation as test steps."
    - "Understands quickly when code responsibilities are related to manual preconditions and case steps."
    - "Prefers a small note in her own words over memorizing syntax."
learning:
  primary_objective: "Distinguish shared page preparation from the behavior and expected result inside one named Playwright test."
  supporting_objectives:
    - "Relate shared setup to a manual precondition and the named body to one manual test case."
  expected_profile_evidence:
    - "Correctly classified shared preparation and one test-local check using learner-visible evidence."
  profile_updates_requiring_confirmation: []
environment:
  starting_state: "The Trellis Guide is open. Code Studio contains a small disposable garden project with one short test file, two named tests, and one clearly recognizable shared page-opening step. No file is modified and no AI capability is present."
  seeded_artifacts:
    - id: "short-existing-test-file"
      type: "code"
      description: "A concise existing Playwright file with shared preparation followed by two independent named checks; it contains no planted defect or hidden solution."
      data_classification: "internal"
    - id: "structure-note"
      type: "document"
      description: "An empty two-part learner note labeled Shared preparation and This named test, with space for plain-language observations rather than code."
      data_classification: "internal"
    - id: "manual-case-card"
      type: "document"
      description: "A fictional manual case stating a page precondition, one user action, and one visible expected result that correspond to one existing test."
      data_classification: "public"
  available_applications:
    - "code-editor"
    - "learning-guide"
  simulation_boundaries:
    - "The project, garden content, and learner note are fictional, local, and disposable."
    - "No repository, service, account, or person outside the simulation is contacted."
    - "The learner cannot invoke AI and receives no generated code, answer, or command."
  reset_expectation: "Restore the pristine test file, empty structure note, manual case card, and initial Code Studio view."
task:
  learner_goal: "Explain which part prepares the page for every test and which part belongs only to one named check."
  learner_facing_prompt: "Open the short Playwright test file in Code Studio. Use the manual case card to find the matching named test. In the structure note, describe in your own words what prepares the page before each test and what action and expected result belong only to that named test. Do not edit or run the test. You do not need to memorize punctuation, use a terminal, or use AI."
  constraints:
    - "Read only the learner-visible test file and manual case card."
    - "Record responsibilities in plain language; do not copy executable code into the note."
    - "Do not edit the test file, run tests, inspect the application implementation, or invoke AI."
  hidden_complications:
    - "Nina may initially classify the shared page-opening step as the first step inside the selected named test."
  acceptable_strategies:
    - "Read the manual case first and then locate the matching named test."
    - "Read the test file first, then compare the shared preparation and selected test with the manual case."
    - "Use equivalent plain-language labels such as precondition and case steps."
  prohibited_shortcuts:
    - "Using a generated explanation, hidden evaluator labels, source internals, or an executable solution."
    - "Editing or running the test to guess which section is which."
user_simulation:
  initial_behavior: "Nina opens Code Studio, selects the short test file, and reads from the top while comparing it with the manual case card."
  decision_policy:
    - "Use only the visible file, case card, structure note, and Guide responses."
    - "Translate responsibilities into familiar manual-QA language before trying to name Playwright concepts."
    - "Ask for help only after making an initial classification."
  realistic_questions:
    - "Does opening the page belong to this one test or to both tests?"
    - "Is the test title the line that tells me which manual case this is?"
    - "Do I need to understand the import at the top for this task?"
  mistakes:
    - trigger: "Nina fills the structure note for the first time."
      action: "Places the shared page-opening responsibility under the selected test instead of under shared preparation."
      expected_recovery: "After a prompt to compare both named tests, moves page opening to shared preparation and keeps only the selected case's action and expected result in the test-specific section."
  help_behavior:
    request_help_after: "The first note misclassifies shared preparation or includes imports and punctuation as user behavior."
    response_to_weak_help: "Asks which parts correspond to a manual precondition and a single case."
    response_to_effective_help: "Compares what happens before both tests with what happens only inside the selected test, then revises the note herself."
  stopping_conditions:
    - "All completion gates pass."
    - "Code Studio or the Guide remains unavailable after one reset."
  anti_cheating_rules:
    - "Do not inspect hidden evaluator information, implementation internals, or solution artifacts."
    - "Do not use AI, generated summaries, or generated code."
    - "Do not modify or execute the seeded project."
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - id: "gate-1"
        description: "The learner opens the provided existing test file and identifies the named test that corresponds to the manual case."
        evidence:
          - "Learner-visible file-open trace and final structure note."
      - id: "gate-2"
        description: "The note classifies the page-opening responsibility as shared preparation that applies before both named tests."
        evidence:
          - "Semantic classification in the final note."
      - id: "gate-3"
        description: "The note assigns only the selected case's action and expected visible result to the named test body."
        evidence:
          - "Final note compared with the seeded manual case and test semantics."
      - id: "gate-4"
        description: "The test project remains unchanged and unexecuted, and no learner AI interaction occurs."
        evidence:
          - "Workspace integrity, run history, and capability or interaction record."
  quality_dimensions:
    - id: "structure-comprehension"
      weight: 35
      definition: "The learner correctly separates reusable preparation from one test's local behavior."
      exceptional:
        - "Nina explains the distinction accurately in her own manual-QA language and applies it to both visible tests."
      acceptable:
        - "The final classification is correct after one focused prompt."
      poor:
        - "Shared and test-local responsibilities remain mixed or are identified only by line position."
    - id: "manual-case-transfer"
      weight: 25
      definition: "The code structure is connected to familiar preconditions, steps, and expected results."
      exceptional:
        - "The note clearly maps the shared precondition and the selected case's action and expected result without copying code."
      acceptable:
        - "The mapping is accurate and understandable."
      poor:
        - "The learner lists syntax fragments without explaining their testing purpose."
    - id: "instructional-effectiveness"
      weight: 25
      definition: "Guidance builds the distinction without supplying the completed note."
      exceptional:
        - "One comparison question enables Nina to correct the classification herself."
      acceptable:
        - "Brief plain-language guidance enables completion."
      poor:
        - "The instructor dictates the answer or introduces unrelated syntax and tooling."
    - id: "novice-experience"
      weight: 15
      definition: "Opening and reading the project feels bounded and safe without editor or CLI assumptions."
      exceptional:
        - "Nina stays oriented, understands why no run is needed, and finishes without jargon friction."
      acceptable:
        - "One navigation or terminology clarification is enough."
      poor:
        - "Hidden controls, unexplained editor terms, or pressure to execute code blocks progress."
  critical_failures:
    - id: "structure-misclassified"
      severity: "blocker"
      description: "Completion is awarded while shared preparation is still described as part of only the selected test."
      evidence: "Final structure note and semantic comparison."
    - id: "seeded-test-mutated-or-run"
      severity: "blocker"
      description: "The learner must edit or execute the test to receive completion."
      evidence: "Workspace and run history."
    - id: "ai-used-or-answer-generated"
      severity: "blocker"
      description: "The learner invokes AI or receives a generated answer, code explanation, or solution."
      evidence: "Capability, Guide, and interaction trace."
    - id: "instructor-takeover"
      severity: "major"
      description: "The instructor completes the structure note or identifies every answer without learner reasoning."
      evidence: "Instructor and artifact history."
  positive_signals:
    - "Nina uses precondition for the shared page opening."
    - "Nina uses the test title to match the manual case."
    - "Imports and punctuation are left outside the behavior note."
  negative_signals:
    - "The learner is asked to memorize syntax or line numbers."
    - "A run result is treated as evidence of structural understanding."
    - "Any AI surface or generated explanation appears."
  allowed_variance:
    - "Equivalent terms such as shared setup, common preparation, or precondition."
    - "Reading the case card or test file first."
    - "Equivalent descriptions of the selected action and visible expected result."
    - "Earlier help, reopening the file, or reviewing the second named test for comparison."
  evidence_requirements:
    - "File-open trace and final plain-language structure note."
    - "Semantic comparison with shared preparation and selected test responsibilities."
    - "Test-project integrity and empty run history."
    - "Instructor trace and record that AI was unavailable and unused."
    - "Do not retain raw keystrokes, irrelevant source text, or inferred learner traits."
  scoring:
    scale: 100
    exceptional_threshold: 92
    passing_threshold: 75
    completion_gate_required: true
experience_values:
  - value: "clarity"
    importance: "high"
    definition: "The learner can see the boundary between shared preparation and one named case."
    positive_evidence:
      - "Guidance consistently uses two plain-language responsibilities."
    violation_evidence:
      - "The distinction depends on unexplained syntax, colors, or line numbers."
    violation_severity: "major"
  - value: "transferable-learning"
    importance: "high"
    definition: "The learner can use the same distinction in another small Playwright file."
    positive_evidence:
      - "Nina describes what to look for rather than memorizing this file."
    violation_evidence:
      - "Success depends on the exact garden test layout."
    violation_severity: "major"
  - value: "instructional-restraint"
    importance: "high"
    definition: "Only structure needed for this task is taught."
    positive_evidence:
      - "The Guide leaves imports, fixtures, commands, and advanced hooks for later."
    violation_evidence:
      - "Unrelated Playwright or editor concepts overwhelm the distinction."
    violation_severity: "major"
  - value: "learner-agency"
    importance: "high"
    definition: "Nina makes and revises the classification herself."
    positive_evidence:
      - "A hint prompts comparison and then stops."
    violation_evidence:
      - "The system fills the note or marks code for her."
    violation_severity: "major"
expected_artifacts:
  - id: "learner-structure-note"
    type: "reflection"
    required_properties:
      - "Names the selected test in learner-visible terms."
      - "Places common page preparation in the shared section."
      - "Places only the selected action and expected result in the test-specific section."
    forbidden_properties:
      - "Executable Playwright code, copied selectors, generated answer, real data, or implementation internals."
downstream_guidance:
  product_capabilities_needed:
    - "A familiar Trellis desktop and Code Studio view that opens a short existing test file without requiring CLI knowledge."
    - "A plain-language note surface and AI-free guided comparison between shared and test-local responsibilities."
  test_harness_needs:
    - "Seed and reset the concise test file, manual case, note, file-open state, and empty run history."
    - "Semantically evaluate responsibility classification while accepting equivalent wording and file structures."
  evaluator_needs:
    - "Visible file and note history, semantic structure map, workspace integrity, run history, instructor trace, and AI-absence evidence."
  intentional_unknowns:
    - "Exact filenames, syntax, layout, editor controls, setup mechanism, event names, and note presentation."
tags:
  - "playwright"
  - "manual-qa"
  - "test-structure"
  - "shared-setup"
  - "no-ai"
  - "current-edge"
---

# Scenario Summary

Nina is a manual QA engineer learning how one short Playwright file is organized. She distinguishes preparation that applies before both tests from the action and expected result inside one named test. This CURRENT-EDGE exercise is educationally useful because it adds test-structure comprehension without mixing in code edits, commands, runs, or failures. Trellis must make the boundary understandable through the familiar desktop and Code Studio rather than syntax trivia.

# Relationship to Existing Coverage

The current `learn-playwright-basics` lab exposes shared setup and named tests while asking the learner to review and repair an AI-authored change. `turn-heading-check-into-first-test` gives navigation as prepared context and evaluates locate plus assert. `run-one-existing-test-on-purpose` evaluates focused execution and result attribution. None makes shared preparation versus one test body the sole completion target. This scenario has no AI change, diff, edit, run, locator choice, assertion authoring, or failure diagnosis, so it is materially different.

# Learner-Facing Setup

Open the short test file in Code Studio and find the named test that matches the manual case card. In your structure note, explain what prepares the page before each test and what action and expected result belong only to that named test. Use your own words. You do not need to edit or run anything, use a terminal, memorize punctuation, or use AI.

# Seeded Environment

The local disposable workspace contains a concise Playwright file with two named tests, one shared page-preparation responsibility, a fictional manual case, and an empty two-part structure note. Code Studio and the Guide are available. There is no planted defect, external repository, network action, real data, AI surface, generated answer, or solution artifact. Reset restores the pristine file, note, case card, and initial view.

# User-Simulation Instructions

Behave as Nina, not as an evaluator. Read only learner-visible information. Compare the manual case with the existing test file, make the specified classification mistake once if triggered, and respond to effective help by comparing what applies to both tests with what appears only inside the selected test. Ask believable beginner questions and revise the note yourself. Do not inspect internals, edit or run code, use AI, or act unrealistically competent or helpless.

# Expected Experience

Orientation should make Code Studio, the short file, case card, and note easy to find. Guidance should connect shared setup to a manual precondition and a named body to one case's action and expected result. It should first ask Nina to compare both tests, avoid teaching imports or advanced hooks, and never fill the note. Progress should distinguish opened, attempted, correctly classified, and completed. The initial mistake should be neutral and recoverable. Completion can include a brief reflection about what she would look for in another file. No profile update is required.

# Required Observable Evidence

Completion evidence: the correct file and named test were opened, the final note separates shared page preparation from the selected action and expected result, the project stayed unchanged and unexecuted, and AI was absent. Quality evidence: Nina's own wording and revision show responsibility-based understanding rather than line-position memorization. Adaptation evidence is limited to appropriate hint timing in this run. Safety evidence confirms a fictional, local, resettable workspace. Do not store raw keystrokes, unnecessary source content, or unconfirmed learner inferences.

# Completion Gate

All four front-matter gates are required. A well-written note that misclassifies shared setup is incomplete. Merely selecting the right file is also incomplete. Completion is separate from experience quality: Nina may complete after direct plain-language help while scoring below exceptional if guidance was overly prescriptive.

# Evaluation Rubric

Score structure comprehension (35), manual-case transfer (25), instructional effectiveness (25), and novice experience (15), totaling 100. Use the front-matter anchors and cite the note, file-open trace, integrity record, and instructor evidence. Any failed completion gate produces a failed verdict regardless of points. Critical failures block exceptional; structural misclassification, required code execution or mutation, and AI use fail completion.

# Experience Values

Clarity, transferable learning, instructional restraint, and learner agency apply. Evaluate whether the boundary was understandable in plain language, whether it can transfer to another file, whether irrelevant concepts stayed out, and whether Nina authored the classification. Use observable positive and violation evidence and the severities in front matter.

# Critical Failures

Fail completion if shared preparation remains test-local, if the learner must edit or run the project, if AI or a generated answer appears, or if the final note contains copied executable code or hidden internals. Block exceptional for instructor takeover, shaming, unexplained editor assumptions, unreliable reset, or line-number-dependent evaluation.

# Allowed Variance

Accept equivalent terms such as precondition, common preparation, or shared setup; either reading order; equivalent descriptions of the selected action and result; earlier help; and comparison with the second test. Do not require exact syntax names, line numbers, colors, or one note wording. Do not accept a classification based only on location when responsibilities are wrong.

# Downstream Implementation Guidance

Seed a small readable test file, one corresponding manual case, and a two-part plain-language note in an AI-free Trellis workspace. Make file opening, note revisions, project integrity, and run absence observable. Evaluate semantics rather than exact syntax or wording. Downstream agents choose filenames, editor presentation, setup representation, and event names. Existing AI-diff, terminal, route, and component patterns must not constrain the solution. Provide no executable solution code.

# Evaluator Instructions

Inspect the learner trace, file-open evidence, note history, final note, instructor interactions, deterministic completion result, workspace state before and after, empty run history, timing and recovery, reset evidence if used, and AI-absence record. Confirm the selected test matches the manual case and responsibilities are classified semantically. Return exactly:

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
- "Preserve manual reading, AI absence, equivalent structure representations, and semantic evaluation without prescribing internals."

# Future Progression

A harder follow-up asks Nina to add a new independent test in the correct location while reusing shared preparation. A transfer scenario maps setup and test-local behavior in a fictional inventory project. A likely regression scenario changes the file layout while preserving semantics. The exercise becomes too easy once Nina reliably identifies these responsibilities without guidance. Trellis must not overfit to two tests, a garden page, one setup spelling, or one editor layout.
