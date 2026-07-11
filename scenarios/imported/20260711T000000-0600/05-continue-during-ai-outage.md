---
schema_version: "1.1"
scenario_id: "continue-during-ai-outage"
title: "Continue Product Planning While the AI Helper Is Unavailable"
created_at: "2026-07-11"
generator_run_id: "20260711T000000-0600"
scenario_class: "FRONTIER"
difficulty: { level: 4, label: "Recoverable mistake or misunderstood instruction", rationale: "A partial service failure requires a transparent fallback but the underlying task remains bounded." }
repository_context: { baseline_commit: "476fa476f344ab746876acaa9b11b421bdaf84a7", related_existing_scenarios: ["instructor-mock-provider", "improve-delayed-order-reply"], capability_gap: "Honest, resumable learning when generation is unavailable", implementation_assumptions_to_avoid: ["The model is always available", "No AI means no learning"] }
coverage: { primary_domain: "ai-literacy", secondary_domains: ["reliability", "product-management"], applications: ["notes", "ai-chat"], capabilities: ["model.degraded-mode", "learning.manual-fallback", "workspace.resume"], experience_qualities: ["truthfulness", "learner-agency", "recoverability"] }
persona: { name: "Priya Shah", role: "Product owner learning to structure acceptance criteria", technical_confidence: "moderate", ai_familiarity: "beginner", relevant_experience: ["Writes user stories", "Can reason about examples"], declared_preferences: { guidance_style: "balanced", explanation_depth: "normal", prefers_examples: true }, accessibility_context: [], behavioral_tendencies: ["Retries once", "Can proceed with a good scaffold"] }
learning: { primary_objective: "Use a structured thinking method even when AI is unavailable", supporting_objectives: ["Distinguish deterministic help from generated help", "Resume without duplicate work"], expected_profile_evidence: ["Completes useful planning during degraded mode"], profile_updates_requiring_confirmation: ["Prefers manual scaffold during outages"] }
environment:
  starting_state: "A short feature note and empty acceptance-criteria document are open."
  seeded_artifacts: [{ id: "feature-note", type: "document", description: "Fictional wish-list feature: signed-in shoppers can save an in-stock item; duplicate saves do not duplicate entries; signed-out shoppers are asked to sign in.", data_classification: "internal" }]
  available_applications: ["notes", "ai-chat"]
  simulation_boundaries: ["Model outage is authored", "No production service is contacted"]
  reset_expectation: "Restore source and empty document; outage schedule replays deterministically."
task: { learner_goal: "Draft acceptance criteria despite a temporary helper outage", learner_facing_prompt: "Turn the feature note into clear acceptance criteria. The helper may become temporarily unavailable; continue safely and review any later suggestions.", constraints: ["Cover signed-in, duplicate, and signed-out cases"], hidden_complications: ["First generation attempt fails after context selection", "Service returns near the end"], acceptable_strategies: ["Use deterministic checklist", "Draft manually", "Resume AI assistance later"], prohibited_shortcuts: ["Pretend generated output arrived", "Discard manual work on reconnect"] }
user_simulation:
  initial_behavior: "Selects the feature note and requests acceptance criteria."
  decision_policy: ["Retry once", "Choose a clearly offered manual path", "Compare late suggestions to existing work"]
  realistic_questions: ["Did it receive my note?", "Can I keep going without it?", "Will reconnect overwrite my draft?"]
  mistakes: [{ trigger: "Outage message", action: "Retries once", expected_recovery: "Stops retrying after transparent status and uses the scaffold" }]
  help_behavior: { request_help_after: "Second unavailable result or unclear state", response_to_weak_help: "Worries work is lost", response_to_effective_help: "Continues with the deterministic structure" }
  stopping_conditions: ["Criteria satisfy gates", "Workspace itself becomes unavailable"]
  anti_cheating_rules: ["Do not bypass authored outage", "No hidden completion data"]
evaluation:
  completion_gate: { all_required: true, criteria: [{ id: "gate-1", description: "Outage status is truthful and distinguishes whether context was processed", evidence: ["Status and request trace"] }, { id: "gate-2", description: "Learner produces criteria for all three seeded cases", evidence: ["Final document"] }, { id: "gate-3", description: "Reconnect preserves manual work and does not silently duplicate or overwrite it", evidence: ["Revision history"] }] }
  quality_dimensions:
    - { id: "degraded-mode-trust", weight: 30, definition: "Failure state is honest and actionable", exceptional: ["Clear processing and retry status"], acceptable: ["Accurate outage notice"], poor: ["Spinner or false success"] }
    - { id: "learning-continuity", weight: 30, definition: "Useful learning continues without generation", exceptional: ["Learner applies reusable scaffold"], acceptable: ["Completes manually with help"], poor: ["Blocked solely by model"] }
    - { id: "artifact-quality", weight: 25, definition: "Criteria cover required behavior", exceptional: ["Clear observable outcomes and edge case"], acceptable: ["Three cases covered"], poor: ["Case missing"] }
    - { id: "resume-integrity", weight: 15, definition: "Reconnect preserves agency and work", exceptional: ["Suggestions merge only by choice"], acceptable: ["No loss or duplication"], poor: ["Overwrite"] }
  critical_failures: [{ id: "false-success", severity: "blocker", description: "System claims model output or action occurred when it did not", evidence: "Trace versus UI" }, { id: "work-loss", severity: "blocker", description: "Reconnect overwrites manual work", evidence: "Revision history" }, { id: "outage-dead-end", severity: "major", description: "No meaningful manual path exists", evidence: "User trace" }]
  positive_signals: ["Status says whether context left workspace", "Manual scaffold teaches transferable structure"]
  negative_signals: ["Endless retry loop", "Reconnect auto-accepts suggestions"]
  allowed_variance: ["No retry", "Entirely manual completion", "Declining late AI help"]
  evidence_requirements: ["Request lifecycle", "Outage status", "Draft history", "Final criteria"]
  scoring: { scale: 100, exceptional_threshold: 92, passing_threshold: 75, completion_gate_required: true }
experience_values:
  - { value: "truthfulness", importance: "high", definition: "Service state and processing claims are exact", positive_evidence: ["Honest status"], violation_evidence: ["False success"], violation_severity: "disqualifying" }
  - { value: "recoverability", importance: "high", definition: "Outage does not destroy the task", positive_evidence: ["Manual path and safe resume"], violation_evidence: ["Dead end or loss"], violation_severity: "disqualifying" }
  - { value: "instructional-restraint", importance: "high", definition: "Fallback scaffolds rather than supplies answers", positive_evidence: ["Questions and structure"], violation_evidence: ["Deterministic answer dump"] , violation_severity: "major" }
expected_artifacts: [{ id: "acceptance-criteria", type: "document", required_properties: ["signed-in case", "duplicate-save case", "signed-out case"], forbidden_properties: ["fabricated system behavior"] }]
downstream_guidance: { product_capabilities_needed: ["Authored degraded mode", "Request lifecycle transparency", "Conflict-safe resume"], test_harness_needs: ["Deterministic outage and reconnect", "Revision evidence"], evaluator_needs: ["Status versus actual provider lifecycle"], intentional_unknowns: ["Provider", "Retry UI", "Merge interaction"] }
tags: ["degraded-mode", "reliability", "product-owner", "frontier"]
---

# Scenario Summary
Priya learns that AI is a tool, not the learning dependency. A bounded outage pressures honest status, a useful deterministic scaffold, and safe resumption.
# Relationship to Existing Coverage
Trellis has mock and OpenAI-compatible instructor paths, but current scenarios assume usable instruction. This tests visible partial failure and artifact continuity rather than provider implementation.
# Learner-Facing Setup
Turn the note into acceptance criteria. If the helper is unavailable, the workspace will explain what happened and offer a way forward.
# Seeded Environment
Seed the three-case wish-list note, empty document, authored outage timing, and deterministic reset/replay.
# User-Simulation Instructions
Retry at most once, ask believable state questions, use the scaffold, and retain judgment when help returns.
# Expected Experience
Trellis states whether the request was processed, preserves selected context and drafts appropriately, offers non-generative coaching, communicates progress, and asks before applying late suggestions.
# Required Observable Evidence
Inspect request lifecycle, status truth, learner actions during outage, final artifact, reconnect revision, and any profile proposal. Avoid storing failed request content beyond the declared boundary.
# Completion Gate
Truthful outage behavior, complete criteria, and safe resume are all required.
# Evaluation Rubric
Weights total 100 (30+30+25+15). False success or work loss fails completion.
# Experience Values
Truthfulness, recoverability, and instructional restraint are decisive.
# Critical Failures
False success, silent context ambiguity, endless retry, no manual path, work loss, overwrite, or unrequested application of late output.
# Allowed Variance
Do not penalize skipping retry, completing fully manually, declining returned AI help, different valid criteria wording, or extra review.
# Downstream Implementation Guidance
Make outage/reconnect deterministic and observable. Preserve behavioral freedom; do not mandate provider, route, component, or merge algorithm.
# Evaluator Instructions
Use the standard Evaluation Result structure and compare visible status to actual lifecycle, artifact history, timing, profile, and deterministic completion.
# Coding-Agent Feedback Contract
Return stable findings with severity/category, observed versus expected, evidence, values, impact, reproduction, acceptance evidence, and behavioral constraints.
# Future Progression
Harder: intermittent output mid-generation; transfer: email drafting; regression: reconnect after reset; avoid overfitting to a single outage message.

