# Trellis — build progress

## Verified in this sandbox (64 tests, green across 3 consecutive full runs: `npm test`)

**POC foundations (ADR-0001)** — event-sourced sessions, deterministic
checkpoint evaluation, session reducer, intervention engine, instructor
abstraction, terminal hub, real-shell labs. 39 tests.

**Roadmap phases 0–5 (ADR-0002)** — this build:

- **Phase 0** · Event schema versioning (`v` stamp on write, upcast on
  read; session.started v2 = variantId, instructor.hint v2 =
  contextManifest). Concept registry with validated IDs, edges,
  acyclicity. Learner identity + tiered consent (self / cohort /
  research). Erasure = hard delete + tombstone (D18); erased answers 410.
- **Phase 1** · Deterministic session digest (order-aware: diff-before-
  first-edit, recovery, hint→progress outcomes). Append-only evidence
  stream. ProfileReducer v1: evidence-rule mastery with provenance
  pointers + computed confidence + half-life decay; habits vs the
  learner's own baseline; learner-asserted preferences. Agent timeline:
  authored beats emitted as agent.action events, rendered from the log.
- **Phase 2** · Reflection engine (deterministic struct + regenerable
  narrative; self-assessment calibration). Context assembler: concept-ID
  join + prereqs, priority tiers, char budget, manifest recorded on every
  hint event. Golden-tested.
- **Phase 3** · Curriculum graph + prereq-gated recommendations
  (refreshers rank first). Six-rung elicit-first instruction policy with
  frustration override. Hypothesis pipeline: enum claims, citation-
  required proposals, deterministic corroboration, TTL expiry, learner
  rejection — quarantine enforced by the assembler; prompt-injection into
  the profile is inert by schema (tested).
- **Phase 4** · Adaptive labs: blueprint variation axes (2-defect curated
  library), pure variant resolution, asymmetric tier hysteresis, CI
  auto-solve harness proving every variant broken-as-shipped AND
  solvable (rejection fixture included). Universal behavioral verifier.
- **Phase 5** · Analytics as read-side projections; cohort k-suppression
  (k=5); consent-gated research export.
- **Phase 4 exit criterion** · Second blueprint lab
  (`review-content-changes`: blog text utilities, 2-defect library) proves
  the variation axes generalize. The CI auto-solve harness now discovers
  every blueprint lab, proves all four variants broken-as-shipped AND
  solvable, and a lab-lint gate checks manifests, registered concepts,
  tier→defect references, and authored timelines.
- **Driver hardening** · Fixed a real race caught by CI: `reset()`'s
  recursive delete vs the killed shell's instrumentation still writing
  `.git/objects` snapshots → ENOTEMPTY. Deletion now retries until
  transient writers settle.

**Learner-journey e2e (7 tests)** — create learner → tier-1 session with
agent timeline → real-shell solve → checkpoint → self-assessment →
reflection → second solve → mastery claim with evidence pointers that
resolve in the learner's own export → tier-2 auto-promotion → fresh-start
contestation → analytics gates → erasure.

## Unverified in this sandbox

- Web UI additions: prediction-gated agent timeline, reflection card with
  self-assessment, profile claims + "That's wrong" contestation in the
  drawer, learner-credential persistence. (No npm/browser here; all
  rendered behaviors are API-tested.)
- DockerDriver (no daemon), OpenAI-compatible instructor path (no
  network).

## Next (not started)

- LLM hypothesis proposer + LLM narrative path behind the existing
  deterministic interfaces.
- Fitted half-lives from analytics; strategy-efficacy feedback into the
  policy.
- Crypto-shredding erasure for production storage (interface unchanged).
