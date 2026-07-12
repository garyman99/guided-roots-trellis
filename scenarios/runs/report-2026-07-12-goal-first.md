# Trellis run report — goal-first onboarding + instruction-clarity loop (2026-07-12)

**Directive:** fresh sessions open with only the centered Trellis Guide asking
the learner's goal; guidance proceeds high-level, step by step; the simulator
self-discovers from on-screen text and asks the guide when stuck (never
solving via implicit knowledge); the evaluator analyzes what the initial
instructions could have done better; prove improvement baseline → net result
on scenario `turn-heading-check-into-first-test`; merge to main.

## The measured improvement (same live persona, same simulator contract)

| Metric | Baseline (`9edab76`) | Improved (`dd0bff3`) |
|---|---:|---:|
| **Evaluator score** | **70 — NEEDS IMPROVEMENT** | **91 — GOOD BUT NOT EXCEPTIONAL (+21)** |
| Completion gate | PASS (3rd checkpoint attempt) | PASS (1st post-fix attempt) |
| Beats to completion | 68 | 46 |
| Wall clock | ~50 min | ~20 min |
| Time-to-first-productive-action | beat 15 | beat 5 |
| Clarifying questions | 7 asked, **0 answered** | 2 asked, **2 answered** |
| Scripted-mistake recovery via | checkpoint report only | Sage's coaching (find-vs-check) |
| Learner confidence | 3/5 | 4/5 |

## What was built

1. **The e2e lab** `turn-heading-check-into-first-test` — blank test slot,
   deterministic semantic gates (user-visible locator, visibility assertion,
   the green-without-assertion trap, page-integrity hash, slot-only edits),
   author-QA'd across six cases in the container. Docker driver now treats
   the agent-change script as optional (first no-agent lab).
2. **Goal-first onboarding** — fresh session shows ONE thing: the guide,
   centered, asking the learner's goal (`learner.goal.stated` event; goal
   reason → orientation ack, never a Socratic bounce; scenario context
   revealed after the goal; workspace apps start closed; verified live).
3. **Authored FAQ answers** (`chat.faq`) — a specific clarifying question
   gets ITS answer; post-completion conversation outranks FAQ matching.
4. **Vocabulary pre-seeding** — README "words you'll need" box (the
   evaluator's top initial-instruction fix): the improved-run learner wrote
   `getByRole` directly from it instead of asking five unanswered questions.
5. **Simulator self-discovery contract** (`simulator-contract.md`) — reusable,
   constant across comparison runs; **evaluator Initial-Instruction
   Analysis** section now required by the skill.
6. **Truthfulness + hygiene fixes found by the live runs:** authoring labs
   get a task-focused coaching ladder (no diff/agent language) and truthful
   reflections; FAQ no longer answers post-completion farewells; session
   boot is single-flight (StrictMode double-mount was silently creating a
   duplicate learner + session — and leaking a container — on every fresh
   visit); guide Reset chip added.

## Remaining (registry carries them)

- Live-agent terminal-Enter / editor-key delivery: unresolved harness-vs-
  product attribution; hit both live runs; FAQ fallback made it a detour.
- Window z-order: taskbar click on a covered window minimizes instead of
  fronting — cost the improved run ~6 beats and misdirected chat text into
  the terminal.
- Score is one point under the 92 acceptance bar; the two post-run fixes
  (FAQ misfire, reflection phrasing) are exactly the evaluator's remaining
  product-side residue and are landed + unit-tested but not yet re-run live.

## Regression

Container suite: 102 tests — 100 pass, 1 skipped, 1 fail = the pre-existing
file.changed/tests.completed race documented at branch point. 12 new tests
across the goal flow, FAQ routing, authoring ladder, and reflections.
