# Trellis Scenario Processing Report — 2026-07-11 afternoon (second routine run, manual kick-off)

**Needs the user's eye:** nothing blocking. The scenario's score DROPPED
76 vs 91 — read that correctly: it is not a product regression but an
*evidence upgrade*. The scripted simulator couldn't feel the composer bug;
the live one did, and scores now reflect what a real learner experiences.
One live rerun on the fixed composer is expected to clear 92.

## Intake

- New outbox run imported: `20260711T132922-0600` — 2 current-edge manual-
  Playwright-authoring scenarios (difficulty 1–2, no AI involvement), both
  VALIDATED. Imported on the open run-1 branch because scenarios/registry.json
  is shared state (decision recorded in import.json).

## Scenario Status

| Scenario | Class | Difficulty | Status | Completion | Score | Regression Status |
|---|---|---:|---|---|---:|---|
| improve-delayed-order-reply | CURRENT-EDGE | 3 | NEEDS_IMPROVEMENT | PASS | 76 (live; hist: 79, 91 scripted) | container 96/98 pass (1 skip + pre-existing race) |
| turn-heading-check-into-first-test | CURRENT-EDGE | 1 | VALIDATED | — | — | — |
| check-form-result-without-timing-guesses | CURRENT-EDGE | 2 | VALIDATED | — | — | — |
| (three run-1 scenarios unchanged) | | | VALIDATED | — | — | — |

## What the LIVE simulator changed

Iterations 3 and 4 replaced the persona script with a live subagent making
in-the-moment decisions from the screen. It immediately caught two defects
no scripted run or code review had:

1. **Wrong-domain reflection (iter 3, high):** the post-lab reflection told a
   receptionist about "surgical fixes", diffs, and claimed "without hints"
   despite a check-in. FIXED (`3065084`): SessionDigest now carries workspace
   facts; reflections branch by surface and count check-ins as help; two
   ai-literacy concepts registered and fed by digest observations — iter-4's
   reflection is truthful and the learner profile visibly moved.
2. **Composer resurrected deleted text (iter 4, high):** the workspace poll
   re-adopted saved text whenever the buffer was emptied — clearing the reply
   was impossible; the learner fought it ~18 beats and a garbled greeting
   reached the sent artifact. FIXED (`415a731`) + browser-probe verified;
   not yet exercised by a live run.

Also closed: the deferred profile-facet domain scoping (`2828eb9`,
habit→concept relevance declared in HABIT_RELATED_CONCEPTS).

## Evaluation Summary

Iter-4 as experienced: 76/100 — completion PASS, learning beats landed
(overshare → realization → recovery → skeptical draft reading → honest 3/5
self-assessment), but the composer fight consumed sixteen minutes and let a
corrupted artifact through the gates. The evaluator's acceptance conditions:
one live rerun on ≥`415a731` demonstrating a clean edit phase, clean final
artifact, and reproduced truthful reflection + profile movement. Conditional
remainder: the mock instructor answers specific questions with generic
templates (a mock-provider ceiling; question-aware routing or the real-model
path are options). Worth considering: an artifact-hygiene check (duplicated
greeting / garbling) so gates cannot pass a visibly corrupted reply.

## Regression Summary

- Container suite: 98 tests — 96 pass, 1 skipped, 1 fail = pre-existing
  file.changed/tests.completed race (unchanged since branch point).
- 11 new tests this run (facet scoping, digest/reflection truthfulness,
  terminal-reflection regression guard, journey reflection assertions).
- Score history is now split by simulator fidelity in the registry;
  76 (live) vs 91 (scripted) is an evidence-quality delta, not a product one.

## Open Findings

| Finding | Severity | Scenario | Status |
|---|---|---|---|
| composer-resurrects-deleted-text | high | improve-delayed-order-reply | addressed (probe-verified; awaits live rerun) |
| mock instructor: generic answers to specific questions | medium | improve-delayed-order-reply | open (conditional acceptance blocker) |
| artifact-hygiene gate (garbled text passes) | medium | improve-delayed-order-reply | open (proposed) |
| harness-browser-pane-limits (screenshot hang, no context menu) | low | (harness) | open |
| file.changed/tests.completed race | medium (pre-existing) | terminal labs | open since branch point |

## Recommended Next Action

Tonight's scheduled run: (1) live iteration 5 on ≥`415a731` → expect ACCEPTED
at ≥92 if the composer holds; (2) then start `turn-heading-check-into-first-test`
(difficulty 1, blank-test-slot lab support); (3) consider the artifact-hygiene
gate while implementing it.
