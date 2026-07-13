---
schema_version: "1.1"
run_id: "20260712T233913-0600"
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

The ignored information checkout was verified against the required origin, required to be clean, fetched, checked out on `main`, and confirmed identical to `origin/main` at `904c8fb7b9368059bac45d08fae0749175dc4e65`. It remained an information source only.

Clearly implemented: a disposable Playwright project, Windows-style Trellis desktop, Code Studio with file explorer and editor, Garden Site, beginner Guide, local test execution, deterministic checkpoint evaluation, reset, and a Docker-backed Playwright lab. The existing lab teaches reviewing an AI-authored diff, running the suite, reading expected-versus-received output, and repairing stale expected text or an ambiguous button locator. Partially implemented or environment-sensitive: learner-visible automatic progress can lag an authoritative passing checkpoint because of a documented post-test file-change race. Documented but not re-executed in this design-only run: the Docker learner journey and its two variants. Missing or ambiguous: an AI-free reading exercise that isolates shared setup from a named test body, and a manual-authoring exercise that distinguishes a specific expected message from a visibility-only assertion.

# Scenario Selection Rationale

The cumulative basic portfolio already covers authoring a heading visibility check, replacing a fixed wait with a retrying assertion, focusing one test, choosing a field by its label, reading one simple failure, and keeping fictional input data aligned with its expected result. Scenario 1 adds the next smallest comprehension skill: identify what shared setup does and what belongs to one named test without editing. Scenario 2 then adds one bounded authoring skill: assert the exact error message required by a manual case instead of proving only that some error is visible. Both remain local, manual, novice-oriented, and AI-free.

# Coverage Matrix

| Scenario | Class | Difficulty | Persona | Applications | Primary capability | New product pressure |
|---|---|---:|---|---|---|---|
| Separate shared setup from one test's check | CURRENT-EDGE | 1 | Manual QA engineer | Trellis Guide, Code Studio | Distinguish shared preparation from one named test body | Plain-language structural evidence without edits or syntax trivia |
| Check the specific error message | CURRENT-EDGE | 2 | Manual QA engineer | Garden Site, Code Studio, test runner | Author a content-specific assertion | Honest feedback when a green test checks too little |

# Current-Edge vs. Frontier Balance

The user-directed portfolio is two CURRENT-EDGE scenarios and zero FRONTIER scenarios. Cumulative manual Playwright coverage is still at the foundation, so test structure and assertion precision are more useful than difficulty escalation, new applications, adaptation, outages, accessibility frontiers, or other future boundaries.

# Duplication Review

`turn-heading-check-into-first-test` teaches locate plus visibility assertion, but its navigation is simply prepared and shared setup is not the learning objective. `run-one-existing-test-on-purpose` focuses execution and result attribution, not source structure. Scenario 1 requires no run or edit; it evaluates whether the learner can separate shared preparation from one test's own behavior. `read-one-failing-result-before-editing` extracts failure facts, while `keep-test-data-and-expected-result-in-sync` aligns one value across action and expected result. Scenario 2 instead challenges an under-specific assertion that can pass while failing to verify the manual expected result. The existing Playwright lab includes text assertions inside a larger AI-diff repair workflow, but it does not isolate learner-authored assertion precision with AI absent. Earlier outbox scenarios about workplace AI, reset, keyboard workflow, and outages are outside this run's scope.

# Boundary Challenges

- Reading the boundary between shared setup and a named test is a complete beginner objective even when no test is run or edited.
- Structure guidance should explain responsibilities in plain language rather than demand memorized Playwright syntax.
- A green result is not sufficient when the test checks only that an error exists and the manual case requires exact error content.
- Deterministic completion should inspect the meaning of the assertion, not one approved spelling.
- The learner must remain the manual author; AI and generated solution code are neither required nor available.
- Basic learning should work entirely through the familiar Trellis desktop and Code Studio.

# Recommended Execution Order

1. Separate shared setup from one test's check.
2. Check the specific error message.

# Expected Product Pressure

These scenarios pressure Code Studio orientation, plain-language structure cues, semantic distinction between shared setup and test-local behavior, assertion-specificity evaluation, honest incomplete-state feedback after an under-specific green run, learner-led recovery, workspace integrity, deterministic reset, and evidence that AI remained absent. They require no frontier applications, model orchestration, cross-session adaptation, external services, real data, or Trellis product changes in the read-only checkout.
