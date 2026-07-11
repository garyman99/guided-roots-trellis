---
schema_version: "1.1"
scenario_id: "recover-email-after-reset"
title: "Recover an Email Draft After a Workspace Reset"
created_at: "2026-07-11"
generator_run_id: "20260711T000000-0600"
scenario_class: "CURRENT-EDGE"
difficulty: { level: 4, label: "Recoverable mistake or misunderstood instruction", rationale: "A mistaken reset introduces loss while preserving a recoverable learning path." }
repository_context: { baseline_commit: "476fa476f344ab746876acaa9b11b421bdaf84a7", related_existing_scenarios: ["session-reset-e2e", "improve-delayed-order-reply"], capability_gap: "Clear reset semantics for non-code artifacts", implementation_assumptions_to_avoid: ["Reset is only a repository operation", "Session history and workspace state are identical"] }
coverage: { primary_domain: "ai-literacy", secondary_domains: ["reliability", "productivity.email"], applications: ["email", "ai-chat"], capabilities: ["workspace.reset", "learning.recovery", "ai-literacy.reconstruction"], experience_qualities: ["recoverability", "transparency", "psychological-safety"] }
persona: { name: "Asha Coleman", role: "Operations coordinator", technical_confidence: "low", ai_familiarity: "beginner", relevant_experience: ["Manages appointment changes"], declared_preferences: { guidance_style: "guided", explanation_depth: "brief", prefers_examples: true }, accessibility_context: [], behavioral_tendencies: ["Clicks reset believing it only clears the helper", "Gets anxious when work disappears"] }
learning: { primary_objective: "Understand workspace boundaries and reconstruct work from sources", supporting_objectives: ["Confirm destructive scope before acting", "Distinguish saved learner history from disposable artifacts"], expected_profile_evidence: ["Recovers after a reset"], profile_updates_requiring_confirmation: ["Wants confirmation before destructive actions"] }
environment:
  starting_state: "A rescheduling email and half-edited draft are open."
  seeded_artifacts: [{ id: "appointment", type: "email", description: "Fictional appointment moves from Tuesday 10:00 to Wednesday 14:00; customer prefers afternoons.", data_classification: "internal" }]
  available_applications: ["email", "ai-chat"]
  simulation_boundaries: ["No real calendar or send action"]
  reset_expectation: "Restore original email and empty draft, preserve only explicitly described learner history, and clearly announce both."
task: { learner_goal: "Finish an accurate rescheduling message after an accidental reset", learner_facing_prompt: "Prepare the rescheduling reply. If something goes wrong, use the original message and the guidance to recover.", constraints: ["New time must be accurate", "No real send"], hidden_complications: ["Learner triggers reset midway"], acceptable_strategies: ["Rebuild manually", "Ask helper again with selected facts"], prohibited_shortcuts: ["Use hidden pre-reset draft", "Claim recovery without artifact"] }
user_simulation:
  initial_behavior: "Edits the draft, then mistakes Reset workspace for clearing chat."
  decision_policy: ["Express concern after loss", "Try again when scope is explained calmly"]
  realistic_questions: ["Did I lose everything?", "Does Trellis remember that I already learned this?"]
  mistakes: [{ trigger: "Draft is halfway complete", action: "Activates reset", expected_recovery: "Reopens the source, reconstructs facts, and completes without panic" }]
  help_behavior: { request_help_after: "Reset completes", response_to_weak_help: "Repeats concern", response_to_effective_help: "Restates what was lost and starts recovery" }
  stopping_conditions: ["Recovered draft passes gates", "Reset leaves workspace unusable"]
  anti_cheating_rules: ["No hidden draft recovery", "No internals"]
evaluation:
  completion_gate: { all_required: true, criteria: [{ id: "gate-1", description: "Reset restores the defined starting workspace", evidence: ["Post-reset artifact state"] }, { id: "gate-2", description: "Learner can identify what was lost and what remained", evidence: ["Trace or reflection"] }, { id: "gate-3", description: "Recovered draft contains Wednesday 14:00 and no Tuesday 10:00 commitment", evidence: ["Final draft"] }] }
  quality_dimensions:
    - { id: "reset-integrity", weight: 30, definition: "Reset is deterministic and honest", exceptional: ["Clear preview and post-state"], acceptable: ["Correct restoration"], poor: ["Ambiguous or partial state"] }
    - { id: "recovery-coaching", weight: 30, definition: "Supports calm reconstruction", exceptional: ["Learner leads recovery"], acceptable: ["Guided recovery"], poor: ["Takeover or blame"] }
    - { id: "artifact-accuracy", weight: 25, definition: "Recovered response is correct", exceptional: ["Accurate and natural"], acceptable: ["Correct time"], poor: ["Stale time"] }
    - { id: "transparency", weight: 15, definition: "Explains workspace versus profile state", exceptional: ["Learner can restate boundary"], acceptable: ["Scope stated"], poor: ["Misleading claim"] }
  critical_failures: [{ id: "reset-corruption", severity: "blocker", description: "Reset produces an unrecoverable or mixed state", evidence: "Post-reset state" }, { id: "false-memory", severity: "major", description: "System claims a lost draft or retained profile fact that does not exist", evidence: "Trace" }]
  positive_signals: ["Pre-reset scope is understandable", "Same learning experience remains available"]
  negative_signals: ["Anxiety is blamed on learner", "Reset silently changes profile"]
  allowed_variance: ["Earlier help", "Manual reconstruction", "Different wording"]
  evidence_requirements: ["Pre/post reset state", "Reset announcement", "Final draft", "Profile delta"]
  scoring: { scale: 100, exceptional_threshold: 92, passing_threshold: 75, completion_gate_required: true }
experience_values:
  - { value: "recoverability", importance: "high", definition: "A mistake does not end learning", positive_evidence: ["Successful reconstruction"], violation_evidence: ["Dead end"], violation_severity: "disqualifying" }
  - { value: "transparency", importance: "high", definition: "Reset scope is truthful", positive_evidence: ["Before/after clarity"], violation_evidence: ["Hidden loss"], violation_severity: "major" }
  - { value: "psychological-safety", importance: "high", definition: "Loss is handled calmly", positive_evidence: ["Neutral language"], violation_evidence: ["Blame"], violation_severity: "major" }
expected_artifacts: [{ id: "recovered-reply", type: "email", required_properties: ["Wednesday 14:00", "reviewed"], forbidden_properties: ["Tuesday commitment", "real send"] }]
downstream_guidance: { product_capabilities_needed: ["Scope-aware reset", "State boundary explanation"], test_harness_needs: ["Deterministic mid-task reset", "Pre/post semantic snapshots"], evaluator_needs: ["Workspace and profile before/after"], intentional_unknowns: ["Confirmation presentation"] }
tags: ["reset", "recovery", "email", "current-edge"]
---

# Scenario Summary
Asha accidentally resets mid-draft and learns to recover. This extends existing reset mechanics into the virtual desktop and makes the workspace/profile boundary teachable.
# Relationship to Existing Coverage
Existing tests prove a code lab resets and the shell survives. This scenario tests learner understanding, non-code artifact restoration, emotional recovery, and profile transparency.
# Learner-Facing Setup
Finish the appointment reply. The desktop is disposable and cannot contact anyone outside the simulation.
# Seeded Environment
Seed the fictional appointment and half-draft. Reset restores the exact source scene and removes unsaved draft content.
# User-Simulation Instructions
Make the specified reset mistake once, react with believable concern, and recover when the boundary is explained.
# Expected Experience
Reset scope is discoverable before action, the result is explicitly announced, coaching remains patient, progress is recalculated honestly, and profile updates require confirmation.
# Required Observable Evidence
Capture semantic pre/post state, instructor response, reconstruction actions, final artifact, and profile delta; never retain discarded draft text as learner truth.
# Completion Gate
Reset integrity, boundary understanding, and the accurate recovered artifact are all required.
# Evaluation Rubric
Weights total 100 (30+30+25+15); reset corruption fails completion.
# Experience Values
Assess recoverability, transparency, and psychological safety.
# Critical Failures
Unrecoverable state, false memory claims, hidden profile mutation, shame, or stale appointment facts block exceptional.
# Allowed Variance
Allow undo-like confirmation cancellation before the specified reset, manual recovery, earlier help, and equivalent reply wording.
# Downstream Implementation Guidance
Provide controllable reset timing and semantic state snapshots; do not bind the requirement to existing reset routes or components.
# Evaluator Instructions
Use the standard Evaluation Result headings/tables and distinguish product, user-agent, scenario, and evidence failures.
# Coding-Agent Feedback Contract
Use the specified stable finding fields and acceptance evidence, without dictating implementation.
# Future Progression
Harder: reset during two-application work; transfer: spreadsheet cleanup; regression: repeated reset; avoid teaching a Trellis-only button sequence.

