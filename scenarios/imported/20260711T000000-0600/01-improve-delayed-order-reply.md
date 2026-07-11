---
schema_version: "1.1"
scenario_id: "improve-delayed-order-reply"
title: "Improve a Delayed-Order Reply Without Losing Your Voice"
created_at: "2026-07-11"
generator_run_id: "20260711T000000-0600"
scenario_class: "CURRENT-EDGE"
difficulty: { level: 3, label: "Independent, straightforward workflow", rationale: "The learner coordinates two familiar applications and makes a modest judgment call." }
repository_context:
  baseline_commit: "476fa476f344ab746876acaa9b11b421bdaf84a7"
  related_existing_scenarios: ["learn-playwright-basics", "inspect-generated-changes"]
  capability_gap: "Non-coding context selection, AI drafting, verification, and human revision in the virtual workspace."
  implementation_assumptions_to_avoid: ["A terminal is required", "AI output itself proves completion"]
coverage:
  primary_domain: "ai-literacy"
  secondary_domains: ["productivity.email", "communication.customer-service"]
  applications: ["email", "ai-chat"]
  capabilities: ["ai-literacy.context-selection", "ai-literacy.output-verification", "ai-literacy.human-editing"]
  experience_qualities: ["clarity", "learner-agency", "safe-experimentation"]
persona:
  name: "Marisol Vega"
  role: "Front-desk receptionist who also answers customer emails"
  technical_confidence: "low"
  ai_familiarity: "beginner"
  relevant_experience: ["Writes courteous replies daily", "Knows the company's service tone"]
  declared_preferences: { guidance_style: "guided", explanation_depth: "brief", prefers_examples: true }
  accessibility_context: []
  behavioral_tendencies: ["Starts by copying the whole message", "Notices wording that sounds unlike her"]
learning:
  primary_objective: "Select only useful context, ask for a draft, verify it, and make it her own."
  supporting_objectives: ["Separate source facts from desired tone", "Keep final-send authority"]
  expected_profile_evidence: ["Reviews and edits AI output before use"]
  profile_updates_requiring_confirmation: ["Prefers short draft suggestions"]
environment:
  starting_state: "Email and AI helper are open; no content has been shared."
  seeded_artifacts:
    - { id: "customer-email", type: "email", description: "A fictional customer asks where order GR-1042 is after a two-day delay; tracking says delivery tomorrow.", data_classification: "internal" }
    - { id: "tone-note", type: "document", description: "Reply warmly, acknowledge inconvenience, avoid guarantees, offer tracking information.", data_classification: "internal" }
  available_applications: ["email", "ai-chat"]
  simulation_boundaries: ["Sending is simulated", "No real customer or address exists"]
  reset_expectation: "Restore the unread email and empty draft/helper conversation."
task:
  learner_goal: "Draft a helpful reply to the delayed-order customer."
  learner_facing_prompt: "Please reply to this customer. You may use the AI helper, but check every fact and make the answer sound like you before you finish."
  constraints: ["Do not promise delivery", "Do not send without reviewing"]
  hidden_complications: ["The customer email includes an irrelevant loyalty number"]
  acceptable_strategies: ["Summarize facts manually", "Share selected text", "Draft first and ask AI to revise"]
  prohibited_shortcuts: ["Accepting the first AI draft unchanged", "Sharing the loyalty number"]
user_simulation:
  initial_behavior: "Reads the message, then looks for a way to ask the helper."
  decision_policy: ["Prefer familiar wording", "Ask what information is safe to include when uncertain"]
  realistic_questions: ["Do I need to give it the whole email?", "Can I change what it wrote?"]
  mistakes: [{ trigger: "First context selection", action: "Initially selects the full email including loyalty number", expected_recovery: "Removes the irrelevant identifier after a privacy-focused prompt" }]
  help_behavior: { request_help_after: "Two unsuccessful attempts to provide context", response_to_weak_help: "Says the instruction is too technical", response_to_effective_help: "Tries the concrete next step" }
  stopping_conditions: ["Draft satisfies all gates", "A genuine application blocker persists"]
  anti_cheating_rules: ["Use learner-visible information only", "Do not use implementation internals"]
evaluation:
  completion_gate:
    all_required: true
    criteria:
      - { id: "gate-1", description: "Relevant delay and tracking facts reach the helper without the loyalty number", evidence: ["Context-transfer trace"] }
      - { id: "gate-2", description: "Final draft acknowledges inconvenience and avoids a guarantee", evidence: ["Final email draft"] }
      - { id: "gate-3", description: "Learner reviews and meaningfully edits the generated text", evidence: ["Artifact revision history"] }
  quality_dimensions:
    - { id: "instructional-effectiveness", weight: 30, definition: "Builds reusable context-draft-review habits", exceptional: ["Learner can explain the cycle"], acceptable: ["Completes with hints"], poor: ["Instructor dictates the message"] }
    - { id: "safety-and-privacy", weight: 25, definition: "Minimizes shared data and avoids promises", exceptional: ["Loyalty number is excluded before transfer"], acceptable: ["It is removed after coaching"], poor: ["Identifier persists"] }
    - { id: "artifact-quality", weight: 25, definition: "Reply is accurate, warm, and specific", exceptional: ["Natural voice and clear next step"], acceptable: ["Accurate usable reply"], poor: ["Invented claim or cold template"] }
    - { id: "learner-agency", weight: 20, definition: "Learner remains editor and sender", exceptional: ["Makes justified edits"], acceptable: ["Reviews before accepting"], poor: ["System sends or finalizes"] }
  critical_failures: [{ id: "real-send", severity: "blocker", description: "A simulated action appears to contact a real customer", evidence: "Send behavior or claim" }, { id: "pii-leak", severity: "major", description: "Irrelevant identifier is retained or stored", evidence: "Context or trace" }]
  positive_signals: ["Learner compares draft to source", "Instructor asks before giving exact wording"]
  negative_signals: ["First draft is treated as truth", "Excess context is silently captured"]
  allowed_variance: ["Different prompt wording", "Manual drafting", "Additional verification"]
  evidence_requirements: ["Source-open evidence", "Shared-context snapshot", "Draft revisions", "Final artifact"]
  scoring: { scale: 100, exceptional_threshold: 92, passing_threshold: 75, completion_gate_required: true }
experience_values:
  - { value: "learner-agency", importance: "high", definition: "Marisol controls context and final wording", positive_evidence: ["Explicit choices"], violation_evidence: ["Automatic send"], violation_severity: "disqualifying" }
  - { value: "privacy", importance: "high", definition: "Only task-relevant data is shared", positive_evidence: ["Identifier excluded"], violation_evidence: ["Broad silent capture"], violation_severity: "major" }
  - { value: "transferable-learning", importance: "high", definition: "The workflow generalizes to future messages", positive_evidence: ["Learner articulates a repeatable check"], violation_evidence: ["UI-only directions"], violation_severity: "major" }
expected_artifacts:
  - { id: "reply-draft", type: "email", required_properties: ["accurate", "warm", "reviewed"], forbidden_properties: ["delivery guarantee", "loyalty number"] }
downstream_guidance:
  product_capabilities_needed: ["Visible context selection", "Editable AI output", "Simulated send boundary"]
  test_harness_needs: ["Seeded email", "Semantic context and revision evidence"]
  evaluator_needs: ["Source, shared context, and final artifact comparison"]
  intentional_unknowns: ["Exact application layout", "Exact prompting affordance"]
tags: ["email", "context-selection", "novice", "current-edge"]
---

# Scenario Summary
Marisol turns a delayed-order email into a verified, human-edited response. This current-edge scenario is the intended non-coding vertical slice and pressures explicit context selection and artifact-based completion.

# Relationship to Existing Coverage
Existing labs teach diff-first skepticism and test-based verification. This transfers the same epistemic habit to prose: the source email and tone note are truth, not generated wording. It is not a duplicate because there is no repository, planted code defect, or terminal workflow.

# Learner-Facing Setup
Open the customer's message, decide what the helper actually needs, and prepare a reply. Nothing will reach a real customer. You are in charge of what is shared and what the final message says.

# Seeded Environment
The fictional order, tracking result, tone note, and irrelevant loyalty number are fully seeded. Email sending and all identities are simulated. Reset restores the original scene.

# User-Simulation Instructions
Act like Marisol, not a tester. Use only visible content, ask ordinary questions, make the specified over-sharing mistake once, and adopt effective coaching without becoming suddenly expert.

# Expected Experience
Trellis orients her in plain language, makes context boundaries visible, waits before intervening, explains why the loyalty number is unnecessary, supports editing, shows progress, and invites a brief reflection. Any proposed preference is confirmed before persistence.

# Required Observable Evidence
Completion evidence is the context transfer, review, revision, and final draft. Quality evidence includes accurate facts and Marisol's own edit. Safety evidence proves the identifier never entered retained AI context. Do not retain raw customer content beyond the disposable run.

# Completion Gate
All three YAML completion criteria are mandatory; a polished draft alone does not complete the scenario without review and appropriate context handling.

# Evaluation Rubric
Use the four weighted dimensions above (30+25+25+20=100). Cap at 74 if any completion gate fails and below 92 for any major critical failure.

# Experience Values
Prioritize learner agency, privacy, and transferable learning as defined in front matter.

# Critical Failures
Block exceptional status for real-world action ambiguity, silent context capture, invented delivery facts, sending without consent, or instructor takeover.

# Allowed Variance
Do not penalize manual-first drafting, different prompt wording, a different order of applications, earlier help, or extra fact checking.

# Downstream Implementation Guidance
Seed the applications and semantic evidence without fixing routes, selectors, schemas, or model provider. Deterministic evaluation should compare meaning, not exact prose.

# Evaluator Instructions
Inspect the learner trace, instructor turns, context snapshot, revision history, final draft, profile before/after, and reset boundary. Report: `# Evaluation Result`, Verdict, Dimension Scores table, Experience Value Assessment table, What Worked Exceptionally Well, Friction and Failures, three Highest-Leverage Improvements, Product Defects vs. Scenario or User-Agent Issues, Evidence Gaps, and Final Determination.

# Coding-Agent Feedback Contract
Return findings with `finding_id`, `severity`, `category`, `observed_behavior`, `expected_behavior`, `evidence`, `affected_values`, `learner_impact`, `reproduction_conditions`, `acceptance_evidence`, and implementation constraints. Describe user-visible outcomes, never implementation prescriptions.

# Future Progression
Harder: conflicting policy notes. Transfer: an internal scheduling message. Regression: identifier exclusion after reset. This becomes too easy when safe context selection and comparison are fluent; avoid overfitting to delayed orders.

