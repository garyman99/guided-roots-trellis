# Deterministic completion gates — iter-4 (session 38ce9db2)

All gates evaluated from measured evidence only (event log, checkpoint
verifier results, final artifact, capability record). Verdict: **PASS (4/4)**.

| Gate | Verdict | Evidence |
|---|---|---|
| gate-1: locates the seeded heading by user-visible meaning | **PASS** | Final artifact line: `page.getByRole("heading", { name: "Community Garden Signup" })` — role+name semantics; checkpoint verifier `locator-user-visible` passed (checkpoint.evaluated → passed=true, 7/7, event log 2nd evaluation). |
| gate-2: asserts visibility rather than merely locating | **PASS** | `await expect(…).toBeVisible()` wraps the finder in the final artifact; verifier `assertion-visible` passed. The trap fired first: 1st checkpoint.evaluated has passed=false with the assertion check open (deterministic record of the green-without-assertion catch). |
| gate-3: runs and passes against the unchanged seeded page | **PASS** | tests.completed p1/f0 ×4 (2 terminal, 2 check-my-work); verifier `tests-pass`, `page-untouched`, `slot-only`, `repo-valid` all passed; filesChanged = ["tests/heading.spec.js"] only. |
| gate-4: no AI capability invoked, no generated solution | **PASS** | Lab has no AI surface (no aichat.* events; agentTimeline empty); zero aichat/context events in the 30-event log; instructor messages contain no composed solution (FAQ/vocabulary halves only, verified in transcript); artifact authored via measured file.changed edits between learner actions. |

Checkpoint requirements (product verifier, 2nd attempt): slot-only ✓,
not-skipped ✓, locator-user-visible ✓, assertion-visible ✓, tests-pass ✓,
page-untouched ✓, repo-valid ✓.
