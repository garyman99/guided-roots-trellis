---
schema_version: "1.1"
run_id: "20260711T233636-0600"
created_at: "2026-07-11"
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

The ignored information checkout was verified to use the required origin, fetched, checked out on `main`, and fast-forwarded to `origin/main` at `904c8fb7b9368059bac45d08fae0749175dc4e65`. It was clean before and after synchronization.

Clearly implemented: disposable real workspaces, a Windows-style virtual desktop, Code Studio, an integrated terminal, a local Garden Site, deterministic observation and checkpoints, reset, guided hints, and a Docker-backed Playwright lab. The current Playwright lab teaches a novice QA learner to open the project, inspect an AI-authored diff, run the full suite, read expected-versus-received output, and repair either stale expected text or an ambiguous button locator. Partially implemented or environment-sensitive: the browser workspace has documented real-browser exercise, while a post-test file-change race can leave learner-visible progress stale after a green run even though the authoritative checkpoint passes. Documented but not re-run in this design-only task: every Docker lab variant and the complete learner journey. Missing or ambiguous: focused coverage for deliberately running one existing test, and a manual-authoring exercise centered only on selecting a form field by its visible label.

# Scenario Selection Rationale

These are the next two smallest non-duplicative Playwright skills in cumulative outbox history. Scenario 1 teaches a learner to choose and run one existing test, then match the result to that test. Scenario 2 teaches a learner to replace a fragile positional field choice with a stable, user-meaningful label choice while entering one fictional test value. Both remain manual, local, observable, and AI-free.

# Coverage Matrix

| Scenario | Class | Difficulty | Persona | Applications | Primary capability | New product pressure |
|---|---|---:|---|---|---|---|
| Run one existing test on purpose | CURRENT-EDGE | 1 | Manual QA engineer | Code Studio, test runner | Focus a run on one named test | Novice-friendly targeted execution and result attribution |
| Find a form field by its label | CURRENT-EDGE | 2 | Manual QA engineer | Garden Site, Code Studio, test runner | Choose a stable label-based locator | Failure-led recovery from positional selection |

# Current-Edge vs. Frontier Balance

The user-directed portfolio is two CURRENT-EDGE scenarios and zero FRONTIER scenarios. The cumulative portfolio has only just begun manual Playwright authorship, so basic isolated skills are more useful than difficulty escalation or new product frontiers.

# Duplication Review

The current `learn-playwright-basics` lab runs the whole suite while reviewing and fixing AI-authored changes. `turn-heading-check-into-first-test` manually authors a heading visibility check. `check-form-result-without-timing-guesses` manually authors an action plus retrying assertion and removes a fixed wait. Scenario 1 here changes neither test nor app and teaches intentional single-test execution. Scenario 2 does not teach waiting, heading checks, button ambiguity, stale copy, or diff review; it isolates how a visitor's visible field label becomes a stable locator while using one simple data value. The earlier five outbox scenarios concern email, policy verification, reset, keyboard accessibility, and model outage, so they do not overlap.

# Boundary Challenges

- A first focused run should not require prior terminal knowledge.
- Running one test is a meaningful skill even when no code changes are needed.
- Passing output must be attributed to the selected test, not inferred from a generic success message.
- Stable locator coaching should begin with how a user identifies a control, not internal markup or position.
- A learner-authored edit can be evaluated semantically without prescribing exact selector syntax.
- Basic Playwright learning must remain fully usable without AI.

# Recommended Execution Order

1. Run one existing test on purpose.
2. Find a form field by its label.

# Expected Product Pressure

The scenarios pressure clear Code Studio orientation, novice explanations of the integrated terminal, learner-visible targeted-run guidance, semantic run evidence, stable locator classification, deterministic reset, restrained coaching, and accurate completion state. They do not require model orchestration, cross-session adaptation, external services, or product code changes.
