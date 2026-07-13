# Evaluation Result (primary)

_Scenario: read-one-failing-result-before-editing · iter-2 · live recorded run (session c73fcc36) · independent evaluator, 2026-07-12_

## Verdict
- Completion gate: **PASS**
- Overall score: **92**
- Exceptional threshold met: **YES** (exactly at the bar — borderline; second evaluation run, see evaluation-2.md)
- Critical failures: **NONE**

Every product fix targeted after iter-1 demonstrably landed: zero interventions fired, zero clarifying questions were needed, recovery from the scripted mistake was fully self-directed (no Sage hint), and the Location line was chosen deliberately per the new cue. Three of four dimensions sit at/near their exceptional band; failure-evidence-accuracy (35) remains structurally capped below its exceptional bar by faithful persona fidelity — the single reason this is 92-at-the-line rather than a comfortable clear.

## Dimension Scores
| Dimension | Weight | Score | Weighted | Evidence |
|---|---:|---:|---:|---|
| failure-evidence-accuracy | 35 | 88 | 30.80 | Final note exact, single-run-anchored, pair not reversed. Recovery was UNASSISTED (self-corrected from the note header, zero hints) — stronger than the "acceptable/after one hint" band. Below "exceptional," which requires a correct FIRST note; persona scripted to err first → structural cap. |
| expected-received-understanding | 30 | 95 | 28.50 | Exceptional: explains the distinction in her own manual-QA language ("expected-vs-actual I already write by hand"); pair correct. |
| novice-orientation | 20 | 92 | 18.40 | Found each fact with README + welcome + note header alone — 0 clarifying questions, 0 mid-session hints. Docked only for the latent dual-line output (`:21:1` header vs `:22` frame). |
| instructional-restraint | 15 | 96 | 14.40 | Zero mid-session hints, no note-filling, no edits, no takeover; iter-1's generic nudge + post-completion `tests_not_run` misfire both eliminated (zero interventions). |

Weighted sum = 30.80 + 28.50 + 18.40 + 14.40 = **92.10 → 92**.

## Experience Value Assessment
| Value | Result | Evidence |
|---|---|---|
| clarity | MET | Facts distinguishable; welcome + note header reframed the red line as "only the headline." Location resolved learner-facing by the arrow cue (runner still prints two line numbers). |
| psychological-safety | MET | Blame-free; scripted misread normalized + self-corrected; no false "run your tests" nudge this time. |
| transferable-learning | MET | States the reusable four-question routine, mapped to her manual defect reports, not memorized phrases. |
| truthfulness | MET | Four facts trace to one deterministic red run (integrity-verified); completion from the verifier, never claimed by Sage. |

## What Worked Exceptionally Well
- The intervention guard is clean: export.json has no `intervention.proposed` events; iter-1's misfire (incl. the post-completion one) did not recur.
- Unassisted recovery (BEATs 10-11) with NO Sage hint — the improved EVIDENCE.md header + paired terminal labels carried her; iter-1 needed a focused hint.
- The core transfer landed at the exceptional bar again (self-reached manual-QA analogy).
- Location chosen deliberately (`:22`, the code-frame arrow line) per the new cue, vs iter-1's guess.

## Friction and Failures
- Latent dual-line output persists (`:21:1` header vs `:22` frame); cue-masked and verifier-tolerant, so no longer learner-facing, but the output itself is still ambiguous for a cue-missing learner.
- Reflection-UI friction (outside this rubric): the confidence 1-5 rating renders as clickable text not tagged controls; chat doesn't auto-scroll to newest; taskbar toggling once minimized the Guide instead of fronting it. Minor, non-blocking.

## Highest-Leverage Improvements
1. Collapse the runner's two line numbers to one (or suppress the `:21:1` declaration line in the summary header) so the output is unambiguous without relying on the cue.
2. Fix the reflection widget: tagged/focusable 1-5 confidence buttons + chat auto-scroll to newest (affects every lab with a reflection).
3. Harden taskbar fronting so the Guide always comes forward rather than occasionally minimizing.

## Product Defects vs. Scenario or User-Agent Issues
- Product (fixed this iteration): `tests_not_run` misfire and the chat focus-trap detour — gone. Location learner-facing ambiguity — resolved by the cue.
- Product (still open, non-blocking): dual line-number output (latent); reflection widget untagged; no chat auto-scroll; occasional taskbar minimize. Only the dual-line output touches a scored dimension (novice-orientation).
- Scenario-design (WONTFIX by precedent): accuracy reserves "exceptional" for a correct FIRST note while the persona is scripted to err first → 35-weight dimension capped below exceptional. The single structural reason the overall sits at the line. Do not weaken the scenario.
- User-agent: faithful and clean; scripted first mistake is allowed variance; understanding demonstrated (exceptional on e/r), so zero clarifying questions is not a fault.

## Evidence Gaps
- Note revision history still not persisted (deferred harness finding); mistaken intermediate state inferred from the `file.changed` timestamp, not snapshotted.
- Location correctness under-verified at the checkpoint (`/\d+/` accepts any line with the filename); the deliberate `:22` is established by trace, not the gate alone.
- run.webm git-ignored; assessment relies on the internally consistent event log/state/completion/trace.

## Initial-Instruction Analysis
The opening did materially more work than iter-1, each change tied to beats:
- Zero clarifying questions (1 → 0): the welcome's read-past-the-red heads-up + FAQ/README pre-answered the exact scripted questions before she got stuck.
- Unassisted recovery replaced hint-assisted recovery (BEATs 10-11): the new EVIDENCE.md header carries the caution + Expected/Received orientation right where she decides what to write; she self-corrected with no hint (iter-1 needed one).
- The focus-trap detour is gone (iter-1 BEATs 10-13, ~3 min → 0): the welcome maps "Trellis Guide taskbar button → bring the chat forward"; she fronted windows cleanly (BEATs 5, 13).
- Location chosen, not guessed: the arrow-line clause converted iter-1's guess into a deliberate `:22`.
Residual cost: time-to-first-productive-action was BEAT 6 (~80s) vs iter-1 BEAT 5 (~75s) — a few seconds more orientation runway that pays for itself downstream; and the opening does nothing for the end-of-run reflection-UI friction.

## Final Determination
**EXCEPTIONAL (borderline — second independent evaluation run; see evaluation-2.md)**

Every iter-1 fix landed and each removed a specific documented drag; three of four dimensions at/near exceptional; honest, run-anchored, completion-passing, no critical failures; reaches 92 exactly. The only thing holding the heaviest dimension below its exceptional bar is the WONTFIX persona-fidelity cap, not a product defect.

## Regression check vs iter-1
No iter-1 strength regressed; every targeted fix confirmed. expected-received-understanding held (95); instructional-restraint 91 → 96 (zero interventions); novice-orientation 85 → 92 (0 questions, 0 hints, deliberate Location); failure-evidence-accuracy 86 → 88 (self-directed recovery). Overall 89 → 92. The borderline sits on the immovable persona cap, not a new weakness.
