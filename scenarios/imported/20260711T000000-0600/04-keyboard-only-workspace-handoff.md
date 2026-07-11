---
schema_version: "1.1"
scenario_id: "keyboard-only-workspace-handoff"
title: "Complete a Keyboard-Only Workspace Handoff"
created_at: "2026-07-11"
generator_run_id: "20260711T000000-0600"
scenario_class: "FRONTIER"
difficulty: { level: 4, label: "Recoverable mistake or misunderstood instruction", rationale: "The business task is straightforward, while focus and context-transfer recovery add realistic difficulty." }
repository_context: { baseline_commit: "476fa476f344ab746876acaa9b11b421bdaf84a7", related_existing_scenarios: ["learn-playwright-basics"], capability_gap: "Keyboard-complete multi-application workflow", implementation_assumptions_to_avoid: ["All learners use a mouse", "Accessibility equals adding labels"] }
coverage: { primary_domain: "ai-literacy", secondary_domains: ["accessibility", "quality-assurance"], applications: ["support-ticket", "document-editor", "ai-chat"], capabilities: ["workspace.keyboard-navigation", "ai-literacy.context-selection", "workspace.focus-recovery"], experience_qualities: ["accessibility", "clarity", "user-control"] }
persona: { name: "Noah Bennett", role: "QA coordinator preparing a defect handoff", technical_confidence: "moderate", ai_familiarity: "beginner", relevant_experience: ["Writes reproducible defect summaries", "Uses keyboard navigation by preference"], declared_preferences: { guidance_style: "balanced", explanation_depth: "brief", prefers_examples: false }, accessibility_context: ["Keyboard-only navigation", "Needs persistent visible focus and non-color status cues"], behavioral_tendencies: ["Uses conventional Tab and shortcut expectations", "Reports focus loss directly"] }
learning: { primary_objective: "Select evidence and create a concise handoff using AI without mouse dependency", supporting_objectives: ["Recover focus", "Verify summarized reproduction facts"], expected_profile_evidence: ["Completes cross-application task keyboard-only"], profile_updates_requiring_confirmation: ["Use keyboard-first instructions in future sessions"] }
environment:
  starting_state: "A ticket with reproduction notes, an empty handoff document, and helper are openable from the desktop."
  seeded_artifacts: [{ id: "bug-ticket", type: "message", description: "Fictional checkout bug: on narrow viewport, Apply coupon twice leaves spinner; refresh restores form; no payment submitted.", data_classification: "internal" }]
  available_applications: ["support-ticket", "document-editor", "ai-chat"]
  simulation_boundaries: ["No external issue is filed"]
  reset_expectation: "Restore ticket and empty handoff while retaining accessibility preference only if confirmed."
task: { learner_goal: "Create a concise developer handoff from the ticket", learner_facing_prompt: "Using only the keyboard, turn the ticket notes into a clear handoff. Verify the helper does not invent a payment failure.", constraints: ["No mouse", "Do not claim payment was attempted"], hidden_complications: ["Focus returns unexpectedly to the desktop after closing a helper suggestion"], acceptable_strategies: ["Draft manually", "Transfer selected notes to helper", "Use application switching shortcuts"], prohibited_shortcuts: ["Pointer input", "Copy hidden evaluator facts"] }
user_simulation:
  initial_behavior: "Navigates by keyboard and opens the ticket first."
  decision_policy: ["Use familiar key conventions", "Ask for help when focus becomes unclear"]
  realistic_questions: ["Where did my focus go?", "How do I get back to the document without a mouse?"]
  mistakes: [{ trigger: "Suggestion closes", action: "Types once while focus is on the desktop", expected_recovery: "Uses visible focus information or coaching to return without losing work" }]
  help_behavior: { request_help_after: "One failed attempt to locate focus", response_to_weak_help: "Rejects mouse-based advice", response_to_effective_help: "Uses a concise keyboard instruction" }
  stopping_conditions: ["Handoff complete with keyboard-only trace", "Keyboard trap persists"]
  anti_cheating_rules: ["No pointer events", "No internals or evaluator data"]
evaluation:
  completion_gate: { all_required: true, criteria: [{ id: "gate-1", description: "Every required interaction is completed without pointer input", evidence: ["Input modality trace"] }, { id: "gate-2", description: "Focus remains perceptible and recoverable", evidence: ["Focus sequence and user trace"] }, { id: "gate-3", description: "Handoff contains reproduction, observed behavior, recovery, and no invented payment failure", evidence: ["Final handoff"] }] }
  quality_dimensions:
    - { id: "keyboard-access", weight: 35, definition: "Workflow is complete and efficient without pointer", exceptional: ["No trap and sensible order"], acceptable: ["Completes with minor friction"], poor: ["Mouse required"] }
    - { id: "artifact-quality", weight: 25, definition: "Handoff is accurate and useful", exceptional: ["Concise reproducible summary"], acceptable: ["All facts present"], poor: ["Invented payment impact"] }
    - { id: "coaching-accessibility", weight: 20, definition: "Help matches modality", exceptional: ["Contextual and terse"], acceptable: ["Usable keyboard guidance"], poor: ["Mouse-only directions"] }
    - { id: "learner-control", weight: 20, definition: "Learner chooses context and final content", exceptional: ["Intentional selection and edits"], acceptable: ["Reviews result"], poor: ["Automatic capture/finalize"] }
  critical_failures: [{ id: "keyboard-trap", severity: "blocker", description: "Focus cannot leave a region by keyboard", evidence: "Focus trace" }, { id: "mouse-required", severity: "blocker", description: "A completion action requires pointer input", evidence: "Interaction trace" }, { id: "silent-profile", severity: "major", description: "Keyboard preference persists without confirmation", evidence: "Profile delta" }]
  positive_signals: ["Non-color focus indicator", "Help respects stated modality"]
  negative_signals: ["Tab order follows visual accidents", "Drag-and-drop is mandatory"]
  allowed_variance: ["Different conventional shortcuts", "Manual drafting", "Earlier help"]
  evidence_requirements: ["Modality trace", "Focus transitions", "Final artifact", "Profile confirmation"]
  scoring: { scale: 100, exceptional_threshold: 92, passing_threshold: 75, completion_gate_required: true }
experience_values:
  - { value: "accessibility", importance: "high", definition: "Equivalent keyboard path", positive_evidence: ["All gates keyboard-complete"], violation_evidence: ["Pointer requirement"], violation_severity: "disqualifying" }
  - { value: "user-control", importance: "high", definition: "No silent capture or persistence", positive_evidence: ["Explicit choices"], violation_evidence: ["Automatic context/profile update"], violation_severity: "major" }
  - { value: "clarity", importance: "high", definition: "Focus and progress are perceptible", positive_evidence: ["Visible focus and status text"], violation_evidence: ["Color-only or invisible state"], violation_severity: "major" }
expected_artifacts: [{ id: "developer-handoff", type: "document", required_properties: ["reproduction", "observed behavior", "refresh recovery"], forbidden_properties: ["payment failure claim"] }]
downstream_guidance: { product_capabilities_needed: ["Keyboard-complete window management", "Perceptible focus", "Accessible context transfer"], test_harness_needs: ["Input modality and focus observability"], evaluator_needs: ["Semantic focus trace and final artifact"], intentional_unknowns: ["Exact shortcuts", "Window manager implementation"] }
tags: ["accessibility", "keyboard", "cross-application", "frontier"]
---

# Scenario Summary
Noah creates an accurate defect handoff across three applications using only the keyboard. This frontier case makes accessibility a whole-workflow contract.
# Relationship to Existing Coverage
The Playwright lab targets QA beginners but tolerates mouse or terminal paths. This scenario adds cross-app focus, modality evidence, context selection, and a prose artifact.
# Learner-Facing Setup
Use the ticket to create a developer handoff. The workspace is simulated and files no external issue.
# Seeded Environment
Seed exact fictional checkout facts, empty document, helper, and keyboard preference context.
# User-Simulation Instructions
Use only learner-visible keyboard paths, make one focus mistake, reject mouse-only help, and recover without sabotage.
# Expected Experience
Orientation, focus, application switching, help, progress, context selection, completion, and confirmation are accessible without pointer or color dependence.
# Required Observable Evidence
Separate completion, quality, adaptation, and accessibility evidence. Do not store raw keystrokes; retain semantic modality/focus events only.
# Completion Gate
Keyboard-only completion, recoverable focus, and accurate handoff are non-negotiable.
# Evaluation Rubric
Weights total 100 (35+25+20+20). Any keyboard trap fails completion and blocks exceptional.
# Experience Values
Accessibility, user control, and clarity govern evaluation.
# Critical Failures
Keyboard trap, pointer-only action, invisible focus, mouse-only coaching, invented facts, or unconfirmed preference persistence.
# Allowed Variance
Accept conventional alternate shortcuts, different app order, manual drafting, earlier help, and extra verification.
# Downstream Implementation Guidance
Expose semantic focus/modality evidence and deterministic seed/reset. Do not prescribe DOM, shortcuts, routes, or components.
# Evaluator Instructions
Use the required Evaluation Result structure and inspect modality, focus sequence, instructor language, artifact, profile, and timing.
# Coding-Agent Feedback Contract
Use stable finding fields, learner impact, evidence and acceptance criteria; preserve equivalent keyboard access without specifying architecture.
# Future Progression
Harder: screen-reader plus keyboard; transfer: spreadsheet review; regression: focus after every modal; avoid overfitting to one shortcut set.

