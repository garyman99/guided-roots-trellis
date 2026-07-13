---
schema_version: "1.1"
run_id: "20260712T113600-0600"
created_at: "2026-07-12"
scenario_count: 2
repository_baseline:
  repository_url: "https://github.com/garyman99/guided-roots-trellis.git"
  branch: "main"
  commit: "904c8fb7b9368059bac45d08fae0749175dc4e65"
difficulty_range:
  minimum: 1
  maximum: 2
portfolio:
  current_edge_count: 2
  frontier_count: 0
---

# Repository Assessment

The ignored information checkout was verified against the required origin, found clean, fetched, checked out on `main`, and confirmed identical to `origin/main` at `904c8fb7b9368059bac45d08fae0749175dc4e65`. It remained clean after inspection.

Clearly implemented: a disposable Playwright project, the Windows-style Trellis desktop, Code Studio, a local Garden Site, a beginner-oriented Guide, deterministic test results, checkpoint evaluation, reset, and a Docker-backed Playwright lab. The existing lab teaches review of an AI-authored diff, a full-suite run, expected-versus-received failure reading, and repair of either stale expected text or an ambiguous button locator. Partially implemented or environment-sensitive: learner-visible progress can lag behind an authoritative passing checkpoint because of a documented post-test file-change race. Documented but not re-executed in this design-only run: the complete Docker learner journey and every authored lab variant. Missing or ambiguous: a no-edit exercise that isolates reading one simple Playwright failure, and a manual-authoring exercise focused on keeping fictional input data consistent with the expected result.

# Scenario Selection Rationale

The cumulative outbox already covers writing a heading visibility check, replacing a fixed wait with a retrying assertion, running one named test, and choosing a field by its visible label. Scenario 1 takes the next smallest diagnostic step: run one prepared failing test and identify the failed title, source location, expected value, and received value without editing. Scenario 2 then introduces one bounded authoring idea: use one fictional value consistently in the input and expected result, diagnose a deliberate mismatch, and rerun until green. Both remain manual, local, AI-free, and centered on a novice QA learner.

# Coverage Matrix

| Scenario | Class | Difficulty | Persona | Applications | Primary capability | New product pressure |
|---|---|---:|---|---|---|---|
| Read one failing result before editing | CURRENT-EDGE | 1 | Manual QA engineer | Code Studio, test runner | Read a simple failure as evidence | Evidence capture without premature editing or jargon |
| Keep test data and expected result in sync | CURRENT-EDGE | 2 | Manual QA engineer | Garden Site, Code Studio, test runner | Use one fictional value consistently | Mismatch-led recovery and deterministic green rerun |

# Current-Edge vs. Frontier Balance

The user-directed portfolio is two CURRENT-EDGE scenarios and zero FRONTIER scenarios. Manual Playwright learning coverage is still building its foundation, so isolating failure reading and basic test-data consistency is more appropriate than advancing to independent or frontier workflows.

# Duplication Review

The current `learn-playwright-basics` lab includes expected-versus-received reading inside a larger AI-diff review and repair workflow. `run-one-existing-test-on-purpose` isolates focused execution but uses a passing test. Scenario 1 is materially different because the learner makes no edit and must produce a four-part evidence note from one intentionally failing run. `find-form-field-by-label` enters one fictional value but evaluates locator stability while its expected result is prewritten. Scenario 2 instead holds locator choices stable and makes input-to-expectation consistency the sole learning target. The earlier heading and form-result scenarios focus assertion presence and result-based waiting, not data consistency. The five original outbox scenarios concern workplace AI, reset, accessibility, and outage behavior and do not overlap.

# Boundary Challenges

- Reading a failure accurately is a complete learning objective even when no fix is requested.
- A novice should be able to distinguish test title, source location, expected value, and received value without prior CLI knowledge.
- Failure evidence should remain authoritative even when the learner thinks they already know the cause.
- Test data is part of the test's story: the entered fictional value and expected visible result must agree.
- A passing rerun is valid only when the intended check remains present and the app is unchanged.
- Basic Playwright learning must remain usable without AI or generated commands.

# Recommended Execution Order

1. Read one failing result before editing.
2. Keep test data and expected result in sync.

# Expected Product Pressure

These scenarios pressure plain-language failure presentation, novice Code Studio orientation, semantic evidence for the exact run and result inspected, restrained guidance, learner-authored data correction, deterministic reset, workspace integrity, and honest completion. They require no model orchestration, workplace applications, external services, cross-session adaptation, or product changes.
