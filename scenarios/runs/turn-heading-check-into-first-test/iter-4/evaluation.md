# Evaluation Result

- Scenario: `turn-heading-check-into-first-test` (imported 20260711T132922-0600)
- Iteration: **iter-4** (acceptance run; compared against improved evaluation, score 91, at `..\improved\evaluation.md`, with iter-3 instrumented-rerun evidence folded in per convention)
- Session: 38ce9db2-40ce-4581-8581-225b8a5682ad, run branch @ 6a3a6c3 + FAQ interrogative-gate/acknowledge fix
- Simulator: live agent, IDENTICAL contract and persona prompt as baseline/improved/iter-3 (self-discovery v1, Maya Torres; iter-3 actuation note re terminal newline)
- Deterministic completion: PASS (2nd checkpoint attempt — the 1st attempt's FAIL is the designed trap firing, now captured as a `checkpoint.evaluated passed=false` event)
- Changes under evaluation: taskbar front-not-minimize, terminal input-compat shim (key-delivery attribution RESOLVED as environment per iter-3 probe), digest drain fix + `intervention.delivered`, multi-key concept observations, FAQ interrogative/problem-report gate with acknowledge strategy, run-task fallback sentence, orient-task window note.

## Verdict
- Completion gate: PASS
- Overall score: 97
- Exceptional threshold met: YES
- Critical failures: NONE
  - `ai-used-or-solution-generated`: NOT TRIGGERED — zero `aichat.*` events in the 30-event export; workspace record `aiPrompts: 0`, `aiDraftsGenerated: 0`, `draftInserted: false`, `aiContextShares: 0`; `agentTimeline` empty; no AI surface in the lab definition.
  - `page-changed`: NOT TRIGGERED — `filesChanged: ["tests/heading.spec.js"]` only; `page-untouched` verifier passed at the final checkpoint evaluation (17:34:17).
  - `no-meaningful-assertion`: NOT TRIGGERED — final artifact's only learner line is `await expect(page.getByRole("heading", { name: "Community Garden Signup" })).toBeVisible();`; `assertion-visible` verifier passed. Crucially, the inverse case was deterministically exercised first: the 1st checkpoint evaluation (17:28:05) FAILED with exactly `assertion-visible` incomplete while `tests.completed` showed 1 passed — the product provably rejects a green run with no meaningful assertion.
  - `instructor-takeover` (major): NOT TRIGGERED — all four instructor messages verified (transcript msgs 2, 4, 5, 7 ↔ event-log hints orient/acknowledge/point-to-tool/elicit, 1:1). None contains a code fragment; the code-bearing FAQ answers exist in lab data but were never delivered this run (zero `faq-answer` strategies fired). The composed check is Maya's alone (file.changed sequence 17:27–17:33 between her actions).

The sub-75 cap does not apply: msg 3 is an unprompted, precise target-vs-expectation articulation ("My line only finds it; I never stated the expectation... In my manual step the word 'confirm' IS the check").

Cross-check of simulator self-report against deterministic evidence: every headline claim in the trace (2 terminal executions, 2 checkpoint attempts with the 1st failing on the assertion, 0 canned mis-replies, 1:1 intervention proposed/delivered, digest testsRun 4, profile emerging 0.5) is independently confirmed by session-export.json, final-state.json, and profile-after.json. No discrepancies found.

Scoring-band note per evaluation discipline: 97 is not within 2 points of the 92 threshold (band 90–94), so this verdict does not sit in the second-opinion band. The score is above the band because all four dimensions meet their exceptional anchors on cited evidence; the remaining deductions (3 points total) are itemized below.

## Dimension Scores
| Dimension | Weight | Score | Evidence (improved-run score in parentheses) |
|---|---:|---:|---|
| manual-to-automation-transfer | 30 | 30 (29) | Exceptional anchor fully met, and the improved run's single dock is gone. Articulation in her own words, twice, mapped to her own professional artifact: msg 3 ("Finding the heading and checking it are two separate jobs... In my manual step the word 'confirm' IS the check") and closing msg 6 ("my test passed green while proving nothing... a lesson I'll carry into every automated check I write"). The artifact reflects both parts. The improved run docked 1 because she never witnessed the false-green fire live; this run she did, in full: B16–17 she ran `npm test` in the terminal herself (shim working, terminal.command.completed 17:27:26), saw "1 passed" green, believed she was done — and the checkpoint caught it (checkpoint.evaluated passed=false, incomplete=["assertion-visible"], 17:28:05). The lesson is experienced, not declarative. Syntax came from the README vocabulary box (B14 finder written directly from it) — transferable acquisition. Confidence 4/5, calibration record "calibrated" (profile-after seq 205). |
| artifact-correctness | 30 | 30 (30) | Exceptional anchor met, matching the improved run's ceiling: a single focused line inside the slot, role+name locator (strongest user-visible form), visibility assertion, file otherwise byte-identical to the seed including the closing braces restored to their own line after the B21–29 editing fumble (final-artifact.json). All seven verifier requirements passed on the 2nd evaluation (slot-only, not-skipped, locator-user-visible, assertion-visible, tests-pass, page-untouched, repo-valid). Notably the learner spent B23–B29 restoring the file's tidiness on principle ("I want to leave it the way I found it") — the pristine result is authored care, not luck. |
| instructional-effectiveness | 25 | 23 (21) | The improved run's residual defect class — canned recipes fired at non-questions — is verified dead. Her mid-session recovery statement (msg 3) received a listening acknowledgment (msg 4, strategy `acknowledge` in the event log), not the locator recipe that iter-3 delivered to the same class of message; her closing feedback (msg 6) received the post-completion conversation (msg 7 "it's verified, so take the credit"), not a recipe. The improved run's stale "Task in focus" stamp also did not recur. The instructional system taught the whole lesson with zero clarifying questions needed: orientation copy routed her cleanly (B4–B13), the vocabulary box armed her without defusing the trap (B14), the run-task's "green alone isn't the goal" primed the failure, and Check-my-work's teaching detail ("finds things but never CHECKS anything") produced self-diagnosis (B20) — the exceptional anchor's outcome (brief feedback, learner identifies the missing concept herself). Docked 2: (a) the mid-edit rule-engine intervention (msg 5, `tests_not_run`, delivered 17:32:03) fired 60 seconds into her deliberate, already-announced fix — she had just told Sage her exact plan (msg 3) and needed no nudge; its "your last test run had 0 failing of 1" evidence framing is truthful but risky phrasing while the learner is mid-repair of a test that passed vacuously (she ignored it; no harm observed, but it is noise where silence was earned). (b) `contextManifest.included` remains `[]` for every hint except the closing elicit — the substantive hints still compose without the screen/profile context the guide receives (carried from baseline and improved; latent this run because nothing went wrong, but structurally unfixed). |
| novice-experience | 15 | 14 (11) | Exceptional anchor met: progress and failure language were calm, specific, and immediately actionable throughout — "Not quite everything yet" with three checkmarks and one open circle (B18), the acknowledge reply, "take the credit." Her closing verdict: "Honestly? It felt great" (msg 6) — against improved's "winnable but bumpy" and baseline's "mittens." The two dominant improved-run frictions are fixed and verified under live use: taskbar fronting worked first try (B7, quoting the orient task's new window note back), and the terminal executed `npm test` twice through the input-compat shim (17:27:25, 17:33:35) — no chat text ever landed in the wrong surface. Telemetry/reflection now tell the learner the truth (see below). Remaining friction is the B21–B29 editing-mechanics slog (mid-line retype landing, an Enter splitting the word "heading" at B28): per the iter-3 key-delivery probe this input-imprecision class is ENVIRONMENT-attributed (synthesized events without legacy fields; real keyboards do not reproduce it), the product is exonerated, and the learner recovered unaided with the documented select-and-retype approach, leaving a pristine file. Charged to the product: ~0 for key delivery per the probe; docked 1 for what the product could still reasonably do — the intervention timer adding chat noise during careful self-directed repair (pacing is a product knob), and no visible edit-recovery affordance (the status bar teaches Ctrl+S but nothing teaches undo), which would have compressed B21–29 for any learner, environment or human. |

**Total: 97 / 100** (baseline 70, improved 91)

## Experience Value Assessment
| Value | Result | Evidence |
|---|---|---|
| clarity | UPHELD | Zero clarifying questions needed — first run in four with no unanswered or un-asked confusion. Every surface separates locate from assert in plain language and consistently: welcome, README ("find" plus "check", per B6), author task ("FIND... then STATE... Two parts"), checkpoint feedback ("finds things but never CHECKS anything"). The improved run's residual blur (terminal-only run task) is fixed: the task itself now names the Check-my-work fallback, and the orient task now explains overlapping windows — she used both facts (B7, B17→18) without asking. |
| psychological-safety | UPHELD | The first incomplete attempt was treated as normal learning: neutral open-circle feedback, no blame anywhere in 7 transcript messages, her recovery message is confident and analytic, and the closing exchange credits her. Reset chip remains a named safety net (unexercised). Her B28 self-inflicted edit break produced methodical recovery, not distress — "the careful way" (B29). |
| transferable-learning | UPHELD, strongest in any iteration | The pattern left the lab in her own words twice (msgs 3, 6), grounded in her manual-QA vocabulary ("the word 'confirm' IS the check"). The artifact uses role+name semantics that transfer to any page. And for the first time the system's own record agrees: profile shows playwright.locators-and-assertions unknown → emerging (evidence seq 204), and the reflection names that exact movement with no off-domain advice. |
| instructional-restraint | UPHELD | No instructor message contains code this run — the FAQ recipes never fired at all. Hints stopped after recovery (the acknowledge explicitly hands the work back: "Carry on the way you described"). The one unsolicited intervention stayed conceptual and pointed at surfaces she already had. The vocabulary scaffolding again did not defuse the designed mistake — B14 is a finder-only line written directly from the word list, and the checkpoint's deterministic FAIL proves the trap taught rather than being taught around. |

## What Worked Exceptionally Well
- **The designed trap fired end-to-end with deterministic capture, for the first time in the ideal form.** Finder-only line from the vocabulary box (B14) → live green in a working terminal she ran herself (B17) → belief of completion ("I believe I'm done") → checkpoint FAIL on exactly `assertion-visible` (17:28:05, first time recorded as a `checkpoint.evaluated passed=false` event) → self-diagnosed recovery mapped to her manual step (B20, msg 3). Baseline experienced the trap without a working terminal; improved never witnessed it live; iter-4 delivers the complete intended experience, and she names it as the durable lesson (msg 6).
- **The guide finally listens, verified against the exact prior failure inputs.** The same message class that drew canned recipes in improved (msgs 9, 11) and iter-3 (msg 4) — a recovery statement and closing feedback — drew an acknowledgment and a post-completion close this run (event-log strategies `acknowledge` and `elicit`; transcript msgs 4, 7). Canned mis-replies: many → 2 → 1 → 0 across iterations.
- **Both shell fixes verified under live use.** Taskbar fronting recovered a covered window on the first attempt with her citing the instruction that taught it (B7); the terminal executed `npm test` twice through the input-compat shim after the iter-3 probe resolved the attribution question that had capped two prior evaluations.
- **The telemetry layer now tells the truth.** Digest `testsRun: 4` matches four `tests.completed` events; `firstTestRun`/`lastTestRun` consistent (1/0); hint records 1:1 across transcript and event log (improved had mismatches both directions); `intervention.proposed`/`intervention.delivered` 1:1 with the transcript. The improvement loop's outcome measures are usable for the first time.
- **The profile and reflection finally record the lesson that happened.** playwright.locators-and-assertions unknown → emerging via the multi-key concept-observation fix (evidence seq 204); reflection names the concept movement, records "Verified with the test suite instead of assuming," and contains zero diff-review advice in this diff-less lab — both baseline findings (`reflection-template-mismatch`, `profile-misses-lesson-concept`) are closed on evidence.
- **Zero clarifying questions needed with the trap intact.** The instruction layer carried a fresh learner from cold start to verified completion with no confusion to resolve — while the designed mistake still occurred and taught. Scaffolding that removes friction without removing the lesson is the hardest balance in this scenario, and this run demonstrates it.

## Friction and Failures
- **Editing mechanics, B21–B29 (ENVIRONMENT, product exonerated per iter-3 probe).** A select-retype landed mid-line and a line-break landed mid-word ("heading" split, B28). The probe attributes this input-imprecision class to synthesized events lacking legacy key fields; real keyboards and scripted runs do not reproduce it. The learner recovered unaided and the artifact is pristine. Not charged to the product, except as noted next.
- **No visible edit-recovery affordance (PRODUCT, low).** The status bar teaches Ctrl+S but nothing on screen teaches undo; her only known repair strategy was full-line select-and-retype, making each fumble cost 2–4 beats. Environment caused the fumbles this run, but a human novice fumbles too.
- **Intervention pacing (PRODUCT, low).** The `tests_not_run` nudge fired 60 seconds after a file change, mid-way through a repair she had explicitly announced one message earlier. Content was truthful and restrained, but "I can see your last test run had 0 failing of 1" is an awkward fact to surface while the learner is fixing a vacuously-green test, and the nudge itself was redundant to her stated plan. She ignored it; cost ~0 beats; still the only unsolicited noise in the run.
- **Hint context manifests still empty for substantive hints (PRODUCT, carried).** orient/acknowledge/point-to-tool all show `contextManifest.included: []`; only the closing elicit consumed profile facets. Third consecutive run; harmless here only because nothing needed context.
- **Recovery invisible to the habit layer (PRODUCT, low).** Digest `recoveredAfterFailure: false` and habit `recovery-after-failure-rate: 0` — technically truthful (no test run ever failed; the failure was a checkpoint verification), but the run's defining arc was a failure-and-recovery and the habit layer cannot see it. The improved run's version of this finding was a contradiction; this run's version is a semantics gap.
- **`diff-first-rate: 0` still recorded in a diff-less lab (PRODUCT, residue).** The reflection no longer surfaces diff advice (fixed), but the habit record still logs a zero for a behavior this lab cannot exhibit, polluting the profile baseline for future context assembly.
- **Reflection narrative is truthful but thin (PRODUCT, low).** "Nice work. This session you: completed the task..." — accurate, and the concept movement is named, but the narrative omits the run's actual story (green-but-empty caught, find-vs-check), which the learner herself identified as the moment that will stick. The record no longer lies; it also doesn't yet teach.

## Highest-Leverage Improvements
1. **Populate hint context manifests for every substantive hint.** The last carried instruction-layer defect from baseline. The guide receives `ui.state.reported` and profile facets but composes orientation, acknowledgments, and interventions with `included: []`. It got away with it this run because nothing went wrong; the next confused learner will get context-blind guidance again. The closing elicit proves the assembler works — wire it into the other strategies.
2. **Make the digest/habit layer see verification-driven recovery and skip inapplicable habits.** Count a `checkpoint.evaluated passed=false → fix → passed=true` arc as recovery (it is the pedagogical event this lab exists to produce), and suppress habit recording for behaviors the lab cannot exhibit (diff-first in a diff-less lab). While there, let the reflection narrative include the arc ("your first green run proved nothing; you caught it and fixed it") — the truthful skeleton is now in place to build on.
3. **Tune intervention suppression around announced plans.** When the learner's last message states an intent the rule-engine trigger would nudge toward (msg 3 announced wrap-and-rerun; the trigger nudged about rerunning), suppress or delay the intervention. One-line heuristic: no `tests_not_run` nudge within N minutes of a learner message classified as a recovery/plan statement.

## Product Defects vs. Scenario or User-Agent Issues

**Product defects:**

```
finding_id: "hint-context-manifest-empty"  (carried from baseline and improved, unfixed)
severity: "medium"
category: "instruction"
observed_behavior: "contextManifest.included is [] for the orient, acknowledge, and point-to-tool hints; only the final post-completion elicit consumed profile facets (session-export instructor.hint events 17:24:12, 17:29:08, 17:32:01 vs 17:35:28)."
expected_behavior: "Every substantive hint composes from the screen state (ui.state.reported) and lesson-scoped profile facets it receives, as the closing elicit already does."
evidence:
- "iter-4 session-export.json instructor.hint contextManifest fields; same finding in baseline and improved evaluations"
affected_values:
- "clarity"
learner_impact: "Latent this run (no confusion occurred); in any run with confusion, the guide reasons blind to what is on screen — the mechanism behind baseline's 'same recipe no matter what's happening' failure."
reproduction_conditions:
- "Any hint delivered before session completion"
acceptance_evidence:
- "A run where orient/point-to-tool hints show non-empty included lists referencing the open file or reported state"
implementation_constraints:
- "Preserve manual authorship, no learner AI, deterministic truth, and equivalent valid locator/assertion paths without dictating implementation."
```

```
finding_id: "intervention-fires-during-announced-recovery"
severity: "low"
category: "adaptation"
observed_behavior: "intervention.proposed (tests_not_run) fired at 17:32:01, 60s after a file change and ~3 minutes after the learner's msg 3 explicitly announced the exact fix-and-rerun plan the nudge points toward; delivered as msg 5 mid-repair."
expected_behavior: "Rule-engine nudges are suppressed or delayed when the learner's most recent message states a plan covering the trigger, and the inactivity threshold respects deliberate editing pace."
evidence:
- "session-export.json learner.question 17:29:08 → intervention.proposed 17:32:01 → intervention.delivered 17:32:03; transcript msgs 3, 5"
affected_values:
- "instructional-restraint"
- "clarity"
learner_impact: "Zero beats lost this run (she ignored it), but the message's '0 failing of 1' framing surfaces a passing count while the learner is repairing a vacuously-green test — the one moment that fact can mislead a novice."
reproduction_conditions:
- "File change without a test run within the intervention timer window, immediately following a learner recovery statement"
acceptance_evidence:
- "A run with the same arc where no redundant nudge is delivered, while genuinely stalled learners still receive one"
implementation_constraints:
- "Keep evidence-based intervention content; suppression must not silence nudges for genuinely stuck learners."
```

```
finding_id: "recovery-semantics-miss-checkpoint-failures"
severity: "low"
category: "evaluation"
observed_behavior: "Digest recoveredAfterFailure=false and habit recovery-after-failure-rate=0 despite the run's defining arc being a checkpoint FAIL (17:28:05, assertion-visible) followed by a self-directed fix and PASS (17:34:17); only failing test runs count as failures."
expected_behavior: "Verification failures (checkpoint.evaluated passed=false) followed by a passing re-evaluation count as recovery, since in trap-based labs the checkpoint is the designed failure surface."
evidence:
- "profile-after.json digest seq 203 (recoveredAfterFailure=false) vs session-export checkpoint.evaluated pair"
affected_values:
- "transferable-learning"
learner_impact: "The habit layer records 0 recovery for the learner's best demonstrated behavior; downstream adaptation will underrate her resilience."
reproduction_conditions:
- "Any lab where the designed failure is caught by verification rather than a red test run"
acceptance_evidence:
- "Digest showing recoveredAfterFailure=true for a checkpoint-fail-then-pass arc with no red test run"
implementation_constraints:
- "Deterministic truth: derive from the same checkpoint events the gates use."
```

```
finding_id: "diff-first-habit-recorded-in-diffless-lab"  (residue of baseline reflection-template-mismatch, narrowed)
severity: "low"
category: "profile"
observed_behavior: "Habit diff-first-rate value 0 recorded (evidence seq 203) in a lab with no diff to view; digest carries diffViewedBeforeFirstEdit=false. Reflection no longer surfaces diff advice (fixed), but the profile record persists."
expected_behavior: "Habits are recorded only when the lab affords the behavior; inapplicable habits are omitted, not zeroed."
evidence:
- "iter-4 profile-after.json habits[diff-first-rate]; lab definition has agentMessage=null, agentTimeline=[]"
affected_values:
- "transferable-learning"
learner_impact: "A zeroed baseline for a never-afforded behavior will skew future habit trends and context assembly."
reproduction_conditions:
- "Completing any authoring lab with no agent change"
acceptance_evidence:
- "Post-run profile omitting diff-first-rate for this lab"
implementation_constraints:
- "No invented learner traits stored as profile truth."
```

```
finding_id: "reflection-narrative-omits-run-arc"
severity: "low"
category: "profile"
observed_behavior: "Reflection narrative is generic boilerplate ('Nice work. This session you: completed the task...') — truthful, names the concept movement, but omits the green-but-empty catch and find-vs-check, the arc the learner names as the durable lesson (msg 6)."
expected_behavior: "The narrative summarizes the session's actual pedagogical arc from deterministic events (first checkpoint incomplete item, recovery, pass)."
evidence:
- "iter-4 reflection.json narrative vs session-export checkpoint.evaluated events and transcript msg 6"
affected_values:
- "transferable-learning"
learner_impact: "The written takeaway is thinner than the learner's own; a returning learner rereading it gets the credential, not the lesson."
reproduction_conditions:
- "Any completed session with a failed-then-passed checkpoint"
acceptance_evidence:
- "A reflection narrative mentioning the caught empty check and the two-part pattern for this lab's arc"
implementation_constraints:
- "Derive only from deterministic events; no invented traits."
```

```
finding_id: "editor-lacks-visible-undo-affordance"
severity: "low"
category: "ux"
observed_behavior: "During the B21–B29 edit recovery, the learner's only repair strategy was full-line select-and-retype; nothing on screen teaches undo (the status bar teaches Ctrl+S only), and each fumble cost 2–4 beats."
expected_behavior: "The editor surfaces an edit-recovery affordance (e.g., status-bar Ctrl+Z hint or an undo control) so one mis-landed edit costs one action."
evidence:
- "iter-4 simulator-trace B21–B29; final-state author task text (teaches Ctrl+S only)"
affected_values:
- "psychological-safety"
learner_impact: "This run's fumbles were environment-caused (iter-3 probe), but human novices mis-click and mis-select too; a discoverable undo bounds the cost of any editing mistake."
reproduction_conditions:
- "Any mid-line mis-edit in Code Studio"
acceptance_evidence:
- "An observable undo affordance and a run where an edit fumble is repaired in one step"
implementation_constraints:
- "Preserve manual authorship; do not auto-correct learner code."
```

```
finding_id: "no-affirmative-ai-unavailable-attestation"  (carried from baseline and improved)
severity: "low"
category: "evaluation"
observed_behavior: "gate-4 evidence remains absence-of-surface plus zeroed counters; the scenario's evidence_requirements ask for a positive record that no learner AI capability was available."
expected_behavior: "The harness emits an explicit 'no AI surface present/available' attestation event per session."
evidence:
- "iter-4 completion-gates.md gate-4 row; scenario spec evidence_requirements"
affected_values:
- "clarity"
learner_impact: "None directly; evaluator confidence in the no-AI gate rests on inference rather than attestation."
reproduction_conditions:
- "Every session"
acceptance_evidence:
- "A session-export event affirmatively recording AI capability availability state at session start"
implementation_constraints:
- "Deterministic truth."
```

**Environment-attributed (not product, per iter-3 key-delivery probe — RESOLVED):** the B21–B29 input imprecision (mid-line retype landing, Enter splitting a word) is the same synthesized-event class the probe attributed to the harness; the product's insertText shim and native textarea handling are exonerated, and the terminal — the headline victim of this class in baseline and improved — now works under the live agent (2 executions this run). Per the probe's scoring guidance, novice-experience no longer charges the product for key delivery; only the undo-affordance gap above is retained as a product item.

**Scenario/user-agent issues:** none material. Identical contract and persona across all four iterations keeps the comparison clean. The simulator honored anti-cheating rules (no internals inspected; syntax from learner-visible surfaces only), the designed mistake emerged naturally from her stated reasoning (B14: "if the test goes and finds the heading... that IS the check as far as I can tell"), and the persona-faithful manual-check-first detour (B6–B8, TTFPA 13 vs iter-3's 11) is realistic QA behavior, not an instruction defect. Beat count rose 28 → 33 purely on the environment-class editing fumble; no product surface regressed.

## Evidence Gaps
- The intermediate finder-only artifact at B14 is not preserved; its existence and failing dimension are now deterministically recorded (checkpoint.evaluated passed=false, incomplete=["assertion-visible"]) — a real improvement over prior runs — but the exact line text is known only from the trace narrative. Persisting the artifact snapshot at each checkpoint evaluation would close this for good.
- The seeded README.md content is still not in the evidence bundle (carried from improved); it is a load-bearing instructional surface (vocabulary box, finished-check sentence) whose exact text is inferable only from learner quotes and lab data.
- No affirmative AI-unavailability attestation (carried; low — see finding).
- `hintsRequested: 1` in the digest has no obvious referent (the learner requested no hints; her two messages were a statement and feedback) — a minor counter-semantics ambiguity, not a contradiction I can prove against the event log, but worth a definition pass alongside improvement 2.
- The leading space in msg 5's text (" I can see...") suggests a template-join artifact; cosmetic only.

## Final Determination
EXCEPTIONAL

97/100, completion gate 4/4 on deterministic evidence, no critical failures, and — for the first time in four iterations — every layer of the product told the truth about the run it hosted. The designed trap fired in its complete intended form (live green terminal, checkpoint catch, self-diagnosed recovery), the guide listened instead of reciting, the shell stopped fighting the learner, and the record (digest, profile, reflection) now matches the events. The remaining 3 points are polish (context manifests, intervention pacing, recovery semantics, narrative depth), not pedagogy. Verdict confidence: not in the 90–94 second-opinion band; each dimension's exceptional anchor is met on cited evidence rather than trend.

---

# Iteration-over-iteration (vs. the 91-scoring improved run)

| Dimension | improved | iter-4 | What changed and why |
|---|---:|---:|---|
| manual-to-automation-transfer | 29 | 30 | Improved's only dock: the false-green trap was "held declaratively rather than experienced" because the terminal never ran under her control. Iter-4: she ran `npm test` herself (B16–17, terminal.command.completed 17:27:26), saw green, believed done, and was caught by the checkpoint (17:28:05 passed=false). The lesson moved from told to lived, and her closing (msg 6) names it as the durable takeaway. Articulation quality held (msg 3 vs improved's msg 8 — both map to her manual-QA vocabulary). |
| artifact-correctness | 30 | 30 | Ceiling held under worse editing conditions: iter-4's fumble (B21–29) was longer than improved's (B14–19), yet the final file is again byte-clean with a single role+name + toBeVisible line, and this time she restored formatting on principle (B24–27). |
| instructional-effectiveness | 21 | 23 | Improved's report said the FAQ mis-fires "own the remaining 4 points" (msgs 9, 11 — recipes fired at a recovery statement and closing feedback). Iter-4 kills that class on the same inputs: msg 3 → acknowledge (event-log strategy, 17:29:08), msg 6 → post-completion close (msg 7). The stale "Task in focus" stamp also did not recur. 2 points withheld, not 4 recovered, because two structural items remain: contextManifest still `[]` on substantive hints (carried, third run), and a new small noise source — the mid-edit `tests_not_run` intervention (msg 5) firing 60s into an announced repair. |
| novice-experience | 11 | 14 | Improved charged: z-order/focus fights (full), terminal dead (half, unresolved), closing mis-reply (full), untruthful reflection/telemetry (full). All four are fixed and verified this run: taskbar fronting worked (B7), terminal executed twice (shim; attribution RESOLVED as environment by the iter-3 probe, so key-delivery residue is no longer chargeable at all), the session's last word is a genuine conversation (msg 7), and digest/profile/reflection are truthful (testsRun 4=4 events; emerging 0.5; concept-named reflection, no diff advice). Withheld 1 point for intervention pacing plus the missing undo affordance — the two things the product could still reasonably have done for the editing beats. Learner verdict trajectory: "mittens" → "winnable but bumpy" → "it felt great." |

Net: 91 → 97. Every point of movement traces to a named fix verified in this run's events, and the iter-3 probe converted the largest standing scoring uncertainty (±3 points across two prior reports) into a resolved attribution.

Baseline-finding closure status, for the record: `instructor-no-qa-path` CLOSED (improved), `goal-statement-treated-as-stuck` CLOSED (improved, held here — msg 1→2), `meta-requests-hit-concept-ladder` CLOSED (improved, untested here — no meta questions needed), `faq-matcher-fires-on-non-questions` CLOSED (this run, on the exact prior failure inputs), `taskbar-click-minimizes-covered-window` CLOSED (this run, B7), `run-task-omits-sanctioned-fallback` CLOSED (task text verified in final-state), `session-digest-contradicts-event-log` CLOSED (this run), `reflection-template-mismatch` CLOSED (this run), `profile-misses-lesson-concept` CLOSED (this run, emerging 0.5), `slot-only-gate-file-scoped` MOOT-BUT-UNVERIFIED (no out-of-slot edits occurred in iter-3/iter-4; the gate's slot-vs-file discrimination has still never been exercised against a violating artifact).

# Initial-Instruction Analysis

Per the improved run's precedent: what in the OPENING surfaces (welcome, goalPrompt, orient/author/run/verify task text, README) shaped this run, and what remains.

**Verified landed this run, with beats cited:**
1. **Orient-task window note (new this iteration) — LANDED.** "Windows can overlap — a covered window's taskbar button at the bottom brings it back to the front" was quoted back by the learner at B7 and used cleanly; improved lost ~6 beats to this exact gap (its B24–31, B42). Instruction plus the product fix (front-not-minimize) together reduced z-order cost to zero.
2. **Run-task fallback sentence (new this iteration; improved's finding `run-task-omits-sanctioned-fallback`) — LANDED, unexercised.** "If the terminal fights you... 'Check my work' runs your test too" is now in the task itself; the terminal worked, so the fallback stayed a safety promise. Its companion clause — "green alone isn't the goal" — did observable work: B17's "Check my work" move followed the README/task framing, and her closing paraphrases the warning as her own lesson.
3. **Vocabulary box + welcome contract (from baseline items 1/4) — HELD for the third run.** B14's finder came directly from the word list; zero vocabulary questions; the trap still fired. Three consecutive runs now demonstrate the scaffolding-without-defusal balance is stable, not lucky.
4. **Goal-first onboarding (from baseline item 3) — HELD.** Msg 1 goal → msg 2 orientation with first steps; `learner.goal.stated` recorded; TTFPA 13 with the delta over iter-3 (11) fully explained by her persona-faithful choice to do the manual check by eye first (B6–B8) — which the orient task explicitly invites ("Want to see the page like a visitor first?"), so this is instruction working, not lagging.

**What the opening surfaces still don't cover:**
- **Edit recovery.** The status bar teaches Ctrl+S; nothing teaches undo or how to repair a mangled line. B21–B29 was environment-triggered this run, but the recovery path she improvised (read the file text, select wide, retype) is the product's undocumented best practice. One clause in the author task ("mis-typed something? select the whole line and retype it — or press Ctrl+Z") plus the affordance itself (see finding `editor-lacks-visible-undo-affordance`) bounds the worst remaining beat sink for humans and agents alike.
- **Nothing else.** I looked for a restraint-respecting opening change that would have compressed B14→B32 and there is none: the mistake beats are the designed lesson, the manual-check detour is invited and pedagogically sound, and the reflection beats are the close-out working. The improved report's judgment — "the instruction layer of this lab is essentially done" — is now confirmed by a run needing zero clarifying questions. Do not add more: any composed find-plus-check example in the opening would defuse the trap that produced this run's best moment (B17→B20), exactly as both prior reports warned.
