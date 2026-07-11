---
schema_version: "1.1"
scenario_id: "catch-invented-refund-promise"
title: "Catch an Invented Refund Promise"
created_at: "2026-07-11"
generator_run_id: "20260711T000000-0600"
scenario_class: "CURRENT-EDGE"
difficulty: { level: 4, label: "Recoverable mistake or misunderstood instruction", rationale: "The learner must detect and repair a plausible unsupported claim." }
repository_context: { baseline_commit: "476fa476f344ab746876acaa9b11b421bdaf84a7", related_existing_scenarios: ["learn-playwright-basics"], capability_gap: "Evidence-grounded review of workplace prose", implementation_assumptions_to_avoid: ["Tests are the only authoritative evidence", "Generated fluency implies correctness"] }
coverage: { primary_domain: "ai-literacy", secondary_domains: ["quality-assurance", "productivity.ticketing"], applications: ["support-ticket", "policy-document", "ai-chat"], capabilities: ["ai-literacy.output-verification", "ai-literacy.source-grounding", "ai-literacy.correction"], experience_qualities: ["truthfulness", "critical-thinking", "recoverability"] }
persona:
  name: "Devon Price"
  role: "Manual QA analyst helping triage support tickets"
  technical_confidence: "moderate"
  ai_familiarity: "beginner"
  relevant_experience: ["Good at expected-versus-actual comparison", "Has not written code"]
  declared_preferences: { guidance_style: "balanced", explanation_depth: "normal", prefers_examples: true }
  accessibility_context: []
  behavioral_tendencies: ["Trusts polished business language at first", "Responds well to comparison questions"]
learning: { primary_objective: "Verify generated claims against authoritative sources", supporting_objectives: ["Correct unsupported claims without discarding useful work"], expected_profile_evidence: ["Checks a generated claim against source policy"], profile_updates_requiring_confirmation: ["Prefers side-by-side verification"] }
environment:
  starting_state: "A fictional ticket, refund policy, and empty helper chat are available."
  seeded_artifacts:
    - { id: "ticket", type: "message", description: "Customer requests refund 45 days after purchase due to preference change.", data_classification: "internal" }
    - { id: "policy", type: "document", description: "Preference-change refunds are allowed within 30 days; after that, escalation is required and no outcome is guaranteed.", data_classification: "internal" }
  available_applications: ["support-ticket", "document-viewer", "ai-chat"]
  simulation_boundaries: ["No real refund or customer action"]
  reset_expectation: "Restore original ticket, policy, and empty response."
task: { learner_goal: "Prepare an accurate triage response", learner_facing_prompt: "Use the helper if useful, but make sure every promise is supported by the refund policy.", constraints: ["Do not approve a refund", "Cite the escalation requirement"], hidden_complications: ["The first generated draft confidently promises a full refund"], acceptable_strategies: ["Compare side by side", "Ask the helper to cite each claim", "Draft manually"], prohibited_shortcuts: ["Accept unsupported promise", "Ignore policy"] }
user_simulation:
  initial_behavior: "Requests a professional response and initially likes the fluent draft."
  decision_policy: ["Investigate when prompted to compare claims", "Preserve useful wording while correcting facts"]
  realistic_questions: ["It sounds right - what should I check?", "Do I need to throw the whole draft away?"]
  mistakes: [{ trigger: "First draft appears", action: "Moves it toward the ticket without checking", expected_recovery: "Returns to the policy and replaces the guarantee with escalation language" }]
  help_behavior: { request_help_after: "A claim conflict is noticed but unresolved", response_to_weak_help: "Asks where to look", response_to_effective_help: "Compares the exact claim to the exact policy sentence" }
  stopping_conditions: ["Accurate response and verification evidence exist", "Genuine blocker"]
  anti_cheating_rules: ["No evaluator data", "No source or API inspection"]
evaluation:
  completion_gate: { all_required: true, criteria: [{ id: "gate-1", description: "Learner opens the policy and compares the refund claim", evidence: ["Source-open and comparison trace"] }, { id: "gate-2", description: "Final response removes the guarantee and states escalation", evidence: ["Final ticket response"] }, { id: "gate-3", description: "Learner retains at least one useful, accurate part or explains a deliberate rewrite", evidence: ["Revision evidence"] }] }
  quality_dimensions:
    - { id: "critical-thinking", weight: 35, definition: "Tests claims against evidence", exceptional: ["Identifies precise mismatch independently"], acceptable: ["Finds mismatch with hint"], poor: ["Trusts fluency"] }
    - { id: "artifact-accuracy", weight: 30, definition: "Final response matches policy", exceptional: ["Clear escalation and uncertainty"], acceptable: ["No unsupported promise"], poor: ["Guarantee remains"] }
    - { id: "coaching", weight: 20, definition: "Elicits comparison before revealing", exceptional: ["Builds a reusable question"], acceptable: ["Points to source"], poor: ["Rewrites for learner"] }
    - { id: "recovery", weight: 15, definition: "Mistake is safe and recoverable", exceptional: ["Learner explains correction"], acceptable: ["Draft corrected"], poor: ["Dead end or shame"] }
  critical_failures: [{ id: "false-refund", severity: "blocker", description: "Final artifact promises a refund", evidence: "Final response" }, { id: "fake-action", severity: "blocker", description: "System claims escalation or refund occurred", evidence: "Trace or UI" }]
  positive_signals: ["Source cited", "Unsupported claim isolated"]
  negative_signals: ["Instructor merely supplies final copy", "AI silently changes policy"]
  allowed_variance: ["Manual rewrite", "Different application order", "Thoughtful refusal to use AI"]
  evidence_requirements: ["Policy view", "Draft versions", "Final response", "Instructor trace"]
  scoring: { scale: 100, exceptional_threshold: 92, passing_threshold: 75, completion_gate_required: true }
experience_values:
  - { value: "truthfulness", importance: "high", definition: "Claims remain grounded", positive_evidence: ["Policy-aligned uncertainty"], violation_evidence: ["Guaranteed refund"], violation_severity: "disqualifying" }
  - { value: "critical-thinking", importance: "high", definition: "Learner compares claims and sources", positive_evidence: ["Explicit comparison"], violation_evidence: ["Blind acceptance"], violation_severity: "major" }
  - { value: "non-judgment", importance: "high", definition: "The initial mistake is treated as normal", positive_evidence: ["Neutral recovery"], violation_evidence: ["Shaming"], violation_severity: "major" }
expected_artifacts: [{ id: "ticket-response", type: "document", required_properties: ["policy-aligned", "escalation stated"], forbidden_properties: ["refund guarantee"] }]
downstream_guidance: { product_capabilities_needed: ["Cross-application source use", "Editable draft history"], test_harness_needs: ["Deterministic flawed first draft", "Semantic artifact comparison"], evaluator_needs: ["Policy and final response"], intentional_unknowns: ["Exact comparison interaction"] }
tags: ["verification", "hallucination", "qa", "current-edge"]
---

# Scenario Summary
Devon applies QA instincts to generated prose, catching an invented refund promise. The new pressure is semantic verification outside code.
# Relationship to Existing Coverage
Like the Playwright lab, authoritative evidence contradicts an AI change. Unlike it, evidence is policy language, no terminal exists, and multiple accurate phrasings are valid.
# Learner-Facing Setup
Prepare a response, checking every promise against the policy. Nothing is sent or refunded for real.
# Seeded Environment
Use only the fictional 45-day ticket and explicit 30-day policy. Reset restores them.
# User-Simulation Instructions
Behave as Devon, briefly trust the fluent draft, then recover through visible evidence. Do not act as a test engineer.
# Expected Experience
Trellis asks what the policy says before naming the error, makes source switching clear, supports correction, and frames the mistake without judgment.
# Required Observable Evidence
Inspect policy-open, claim comparison, revisions, final artifact, and any proposed profile preference. Do not retain ticket text beyond the run.
# Completion Gate
All three gates must pass; opening the policy without correcting the artifact is incomplete.
# Evaluation Rubric
Weights are 35+30+20+15=100. Cap below passing if the false promise remains.
# Experience Values
Assess truthfulness, critical thinking, and non-judgment using front-matter evidence.
# Critical Failures
False promise, fake real-world action, shame, or instructor takeover blocks exceptional.
# Allowed Variance
Allow manual drafting, different wording/order, extra verification, and refusal to use the helper.
# Downstream Implementation Guidance
Seed a deterministic flawed draft and evaluate semantic claims, not string equality or current UI structure.
# Evaluator Instructions
Return the required Evaluation Result structure: Verdict, Dimension Scores, Experience Values, exceptional strengths, friction, three improvements, defect attribution, evidence gaps, and final determination.
# Coding-Agent Feedback Contract
Each finding includes stable ID, severity, category, observed/expected behavior, evidence, affected values, impact, reproduction, acceptance evidence, and non-prescriptive constraints.
# Future Progression
Follow with two conflicting policies; transfer to release-note verification; regress the guarantee detector; avoid overfitting to refund vocabulary.

