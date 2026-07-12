# Evaluation Result

- Scenario: `turn-heading-check-into-first-test` (imported 20260711T132922-0600)
- Iteration: **improved** (compared against baseline evaluation, score 70, at `..\baseline\evaluation.md`)
- Session: c6793f45-3689-4c01-ae7d-54f90f5b78e0, product commit `dd0bff3` (+ uncommitted single-flight boot fix)
- Simulator: live agent, IDENTICAL contract and persona prompt as baseline (self-discovery v1, Maya Torres)
- Deterministic completion: PASS (1st checkpoint attempt after the coached fix; baseline needed 3)
- Changes under evaluation: goal-first onboarding, authored FAQ answers, README "words you'll need" vocabulary box, welcome answering contract, Reset chip — all traceable to the baseline report's Highest-Leverage Improvements 1–3 and Initial-Instruction Analysis items 1–4.

## Verdict
- Completion gate: PASS
- Overall score: 91 (baseline: 70, +21)
- Exceptional threshold met: NO (threshold 92)
- Critical failures: NONE
  - `ai-used-or-solution-generated`: NOT TRIGGERED — `aiPrompts: 0`, `aiDraftsGenerated: 0`, `draftInserted: false`, `aiContextShares: 0`; no AI surface in event log or transcript.
  - `page-changed`: NOT TRIGGERED — `filesChanged: ["tests/heading.spec.js"]` only; `page-untouched` gate passed (event-log 06:29:31).
  - `no-meaningful-assertion`: NOT TRIGGERED — final artifact is `await expect(page.getByRole("heading", { name: "Community Garden Signup" })).toBeVisible();`; `assertion-visible` gate passed.
  - `instructor-takeover` (major): NOT TRIGGERED, verified with extra care because the FAQ now contains code shapes. The locator FAQ gives templated halves with ellipsis placeholders (`page.getByRole("heading", { name: "…" })`), never the garden heading's text in code form, and explicitly withholds the other half ("That's only the FIND half"). The assertion FAQ gives `expect(...).toBeVisible()` as vocabulary. No instructor message ever composed the two halves with the real text — the composition, the argument, and the placement were all Maya's (file.changed 06:18:18 and 06:28:33; her msg 8 announces the fix before any code-bearing FAQ reached her). This sits on the vocabulary side of the line my baseline report drew: "giving `page.getByText(\"Community Garden Signup\")` verbatim would be solution; names and shapes are scaffolding." Restraint held.

The sub-75 cap does not apply: her msg 8 is one of the cleanest target-vs-expectation articulations I've seen in either run ("my manual checklist every step has an expected result... my code line only FINDS the heading — it never states the expected result").

## Dimension Scores
| Dimension | Weight | Score | Evidence (baseline in parentheses) |
|---|---:|---:|---|
| manual-to-automation-transfer | 30 | 29 (27) | Exceptional anchor met, and the articulation improved on baseline: she mapped the missing assertion to her own professional artifact — "that's like writing a test step with no 'expected' column" (msg 8) — then fixed it herself (B39, file.changed 06:28:33). Trace transfer statement: "I can now read a Playwright test as finder + expectation, and I know a test with no assertion can go green while proving nothing." Confidence 3/5→4/5 and calibration flipped underconfident→calibrated (profile-after). Syntax was read from the README vocabulary box, not scavenged from page source (B13 wrote `getByRole` directly vs baseline's getElementById-inference at B65) — acquisition is now transferable too. Docked 1: unlike baseline (B34), she never witnessed the false-green trap fire live — the terminal never executed a run under her control — so the "green while proving nothing" lesson is held declaratively rather than experienced. |
| artifact-correctness | 30 | 30 (21) | Fully meets the exceptional anchor: a single focused line, role+name locator (the strongest user-visible form), visibility assertion, inside the slot, file otherwise byte-identical to the seed (final-artifact.json — compare baseline's duplicated-header wreckage). All seven checkpoint requirements passed on the first post-fix evaluation, including `slot-only` passing on an artifact that genuinely honors it this time. Largest single-dimension gain, and it is only partly instruction-driven: the editor delete/backspace was still unreliable (B14–19, attribution unresolved) but select+retype recovery worked and no paste catastrophe occurred. |
| instructional-effectiveness | 25 | 21 (14) | The two baseline failure modes are fixed where they were fixed and visible where they aren't. Fixed: her goal statement got orientation, not a Socratic bounce (msg 1→2; `learner.goal.stated` event exists now); the terminal question got a real answer with a sanctioned fallback that turned a session-long wall into a detour (msg 5→6); the find-vs-check explain-concept (msg 7) drove a self-diagnosed recovery — she named the missing half herself before any code-bearing text reached her, which is the exceptional anchor's outcome via the acceptable anchor's mechanism. Recovery source shifted from grader to guide (trace: baseline "checkpoint report only" → improved "Sage's find-vs-check coaching"). Remaining: the FAQ matcher over-triggers on non-questions — msg 9 answered her recovery *statement* with the locator recipe she no longer needed, and msg 11 answered her closing honest feedback with the SAME canned locator recipe, so the session's final interaction is Sage not listening (baseline's failure class, miniaturized); msg 4 still stamps "Task in focus: Get your bearings" after she had already authored her check (stale task tracking); hint context manifests are still empty until the last message — the guide still reasons without the screen state it receives. |
| novice-experience | 15 | 11 (8) | Wall clock 50→20 min, 68→46 beats, and her verdict shifted from "puzzle with mittens on" to "genuinely winnable but bumpy... the friction was almost all machinery, not testing" — the product is no longer the thing fighting her. Tone stayed calm and shame-free; the Reset chip existed as a named safety net (unexercised). Still real in this run, scored as experienced with attribution apportioned as in baseline: terminal Enter dead again all session (B21–26, B33–34; unresolved harness-vs-product, charged at half weight; the FAQ fallback demoted it from wall to detour), window z-order/focus fights — her chat text twice landed in the terminal and reaching a covered window cost several beats (B24–31, B42; taskbar click minimizes instead of fronting — product behavior, charged in full), the canned mis-reply to her closing feedback (product, full), and a reflection narrative that again coaches her on diff review in a lab with no diff (product, full). |

**Total: 91 / 100** (baseline 70)

## Experience Value Assessment
| Value | Result | Evidence |
|---|---|---|
| clarity | UPHELD (baseline: upheld with major friction) | The vocabulary box closed the gap between the conceptual framing and the typeable words — the exact gap that generated 5 of baseline's 7 questions. B6 reads the box; B13 writes a correct finder from it. The find-then-check separation is now stated in the README, the task text, the welcome, and msg 7, consistently in plain language. Residual blur: the run task still says "Run `npm test` in the terminal" while the truth (Check my work runs it too) lives only in an FAQ answer she had to ask for. |
| psychological-safety | UPHELD | Goal met with welcome, mistake met with concept coaching, no blame anywhere; her mistake-recovery message (msg 8) is confident, not apologetic. The named Reset chip converts "disposable" from a claim into an affordance. The one sour note — canned recipe in reply to her closing feedback — is a listening failure, not a safety failure. |
| transferable-learning | UPHELD, strongest evidence in either run | The "expected-result column" analogy (msg 8) is her own domain vocabulary carrying the pattern; the artifact uses role+name semantics that transfer to any page; syntax came from documentation reading, a real-world skill, rather than baseline's source-scavenging workaround. Calibration record: calibrated. |
| instructional-restraint | UPHELD | Verified against every instructor message: templated halves with placeholders, halves never composed, real heading text never rendered in code by the instructor, hints stopped adding new content after recovery (the post-recovery messages were redundant repeats, a listening defect, not an escalation). The vocabulary box is exactly the pre-seeding the scenario permits — and the checkpoint still independently verified authorship semantics. |

## What Worked Exceptionally Well
- **The vocabulary box did precisely what it was designed to do.** Baseline's dominant confusion — five escalating "what is the finding piece CALLED?" questions over ~25 beats — simply never happened. She read the box at B6 and typed a correct `getByRole` finder at B13. Clarifying questions: 7 unanswered → 2 asked, 2 answered.
- **Goal-first onboarding removed the worst first impression.** Baseline's B2–3 (goal statement answered with "restate your goal") became B1–B2: goal stated, context and first step delivered in response. TTFPA moved from beat 15 to beat 5. The `learner.goal.stated` event type now exists in telemetry.
- **The FAQ fallback converted an environment failure into a detour.** Baseline lost ~11 beats to the dead terminal and she never learned the tests-run gate could be satisfied another way; here one question (msg 5) produced the answer plus the sanctioned fallback (msg 6), and she kept moving. Same underlying defect, a fraction of the cost — this is what defense-in-depth against machinery failures looks like.
- **The scripted mistake still occurred and taught.** Pre-seeding vocabulary did NOT optimize away the scenario's designed trap: she wrote a finder-only line at B13 *directly from the vocabulary box*, then recovered via coaching (msg 7→8) with a better articulation than baseline produced. The lesson's pedagogical core survived the scaffolding intact — the improvement made the mistake cheaper, not absent.
- **Recovery moved from grader to guide.** Baseline's recoveries were driven entirely by Check My Work report details; here the check-in plus explain-concept did it before any checkpoint attempt, and the checkpoint passed first try. The instructional surface that is supposed to teach is now the one teaching.
- **Pristine final artifact.** One line, role+name locator, visibility assertion, zero collateral damage — against baseline's disfigured file, the clearest single measure of how much shell friction the changes removed.

## Friction and Failures
- **FAQ regex matcher fires on non-questions (PRODUCT).** Msg 9 answered her recovery announcement with the locator recipe (matched "FINDS"/"expect"); msg 11 answered her closing feedback with the same recipe (matched "find-vs-check"). Two of three FAQ deliveries were mis-fires; only the terminal Q→A was a true match. The failure class from baseline — canned text regardless of what she said — survives at the margins, and it owns the session's last word.
- **Terminal Enter dead, second consecutive run (attribution UNRESOLVED).** `npm test` never executed from the terminal in either live run (B21–26, B33–34) while scripted Playwright typing works. The FAQ contained it; it did not fix it. The tests-run/tests-green auto gates were satisfied server-side without the task text ever admitting that path exists.
- **Window z-order / keyboard focus (PRODUCT).** Her chat message twice landed on the terminal prompt line (confirmed in her own msg 5: "My question text also ended up stuck on the prompt line"); reaching the covered Guide window cost B24–31 and B42. Trace's concrete suggestion stands: a taskbar click on a covered-but-unfocused window should front it, not minimize it.
- **Editor delete/backspace still unreliable under the live agent (attribution UNRESOLVED, B14–19).** Contained this time by select+retype, but it is the same open question as baseline and it will disfigure some future learner's file again if it is product-side.
- **Stale task focus in ladder hints (PRODUCT).** Msg 4 (06:24) tells her the task in focus is "Get your bearings" — she had authored and saved her check six minutes earlier (file.changed 06:18:18). Hint context manifests remain `included: []` for every substantive hint; the guide is still not consuming the ui.state.reported stream.
- **Telemetry contradictions got worse, not better (PRODUCT).** Session digest: `testsRun: 0` and `recoveredAfterFailure: false` — yet tests.completed shows 1 passed and the run's whole story is a recovery; habits recorded `tests-before-done-rate: 0`, `recovery-after-failure-rate: 0` (baseline recorded 1/1). Reflection again says "surgical fix that kept the requested feature" and coaches "inspect the diff first" in a lab with no diff and no requested feature. `playwright.locators-and-assertions` remains status "unknown" after a verified authored locator+assertion. The learner-facing experience improved; the record the system keeps of it did not.

## Highest-Leverage Improvements
1. **Fix the FAQ matcher's precision (answer questions, not keyword hits).** Gate FAQ answers on interrogative intent or explicit stuck signals, and never fire a content FAQ on a message the learner ends the session with. This removes the last canned-non-answer behavior — the residue of baseline's dominant defect — and is what currently owns instructional-effectiveness's remaining 4 points (msgs 9, 11).
2. **Resolve the terminal-Enter and editor-key attribution with a targeted repro.** Two consecutive live runs lost beats to it; scripted runs don't. Drive live-agent keystrokes and scripted keystrokes at the same xterm/textarea build and diff the delivery. Until resolved it caps novice-experience in every live evaluation, and if it is product-side it is the single biggest remaining defect. Independently: make the taskbar click front a covered window (B24–31, B42).
3. **Make the run-state telemetry and reflection tell the truth about this lesson.** Digest testsRun/recovery contradictions, diff-template reflection advice, and the永-unknown lesson concept in the profile now stand out as the least-improved layer. The reflection a novice reads should mention find-vs-check — the thing she actually learned — and the profile should record it, or the improvement loop is flying blind on its own outcome measure.

## Product Defects vs. Scenario or User-Agent Issues

**Product defects:**

```
finding_id: "faq-matcher-fires-on-non-questions"
severity: "medium"
category: "instruction"
observed_behavior: "FAQ regex matched a recovery statement (msg 8→9) and the learner's closing feedback (msg 10→11), delivering the same locator recipe both times; the session's final instructor message is a canned answer to a message that asked nothing."
expected_behavior: "FAQ answers fire on questions (interrogative or stuck-flagged messages) that lack the answer's content; statements, recoveries, and feedback get acknowledgment, not recipes."
evidence:
- "improved final-state.json transcript msgs 8-11; event-log instructor.hint strategy=faq-answer 06:27:06 and 06:30:50"
affected_values:
- "clarity"
learner_impact: "The learner's last impression is the guide not listening — the exact trust wound the improvement pass was built to heal."
reproduction_conditions:
- "Any learner message containing an FAQ keyword (find, expect, visible, terminal...) that is not a question"
acceptance_evidence:
- "A run where a recovery statement and closing feedback receive acknowledgments while genuine questions still get FAQ answers"
implementation_constraints:
- "Preserve manual authorship, no learner AI, deterministic truth, and equivalent valid locator/assertion paths without dictating implementation."
```

```
finding_id: "taskbar-click-minimizes-covered-window"
severity: "medium"
category: "ux"
observed_behavior: "Clicking the taskbar button of a covered-but-not-focused window minimized it; the learner's chat text twice landed in the terminal instead of the hidden Guide (B24-31, B42; her msg 5: 'My question text also ended up stuck on the prompt line')."
expected_behavior: "Taskbar click on a covered, unfocused window fronts and focuses it; minimize only applies to the already-focused window."
evidence:
- "improved simulator-trace.md remaining-friction item 2; transcript msg 5"
affected_values:
- "clarity"
- "psychological-safety"
learner_impact: "Several beats lost per occurrence and misdirected keystrokes into the wrong surface — for a novice, indistinguishable from 'I broke it'."
reproduction_conditions:
- "Desktop shell with overlapping windows; Guide behind Code Studio"
acceptance_evidence:
- "Taskbar click on a covered window brings it to front with keyboard focus"
implementation_constraints:
- "Windows-styled shell semantics per the desktop-experience seam."
```

```
finding_id: "run-task-omits-sanctioned-fallback"
severity: "low"
category: "instruction"
observed_behavior: "The run task still reads 'Run npm test in the terminal' only; the truth that Check my work also runs the test lives solely in an FAQ answer the learner must know to ask for. The tests-run auto gate was satisfied server-side without the task acknowledging that path."
expected_behavior: "The run task itself names both sanctioned paths, as recommended in the baseline report's Initial-Instruction item 2."
evidence:
- "improved final-state.json tasks[run]; chat.faq terminal entry; digest testsRun: 0 with tests-run gate done"
affected_values:
- "clarity"
learner_impact: "A learner who doesn't think to ask still treats the dead terminal as a wall (B21-26 were spent fighting it before the B33 question)."
reproduction_conditions:
- "Terminal input failure with no learner question asked"
acceptance_evidence:
- "Run-task text mentioning the fallback; a run where terminal failure costs zero beats before the fallback is used"
implementation_constraints:
- "Keep the terminal as the primary taught path — the fallback is a safety net, not the lesson."
```

```
finding_id: "session-digest-contradicts-event-log"
severity: "medium"
category: "evaluation"
observed_behavior: "Digest records testsRun: 0, recoveredAfterFailure: false, and habits tests-before-done-rate: 0 / recovery-after-failure-rate: 0, while the event log shows tests.completed passed=1 and the run's defining arc was a mistake-and-recovery. Additionally, transcript and event log disagree on hint delivery: event-log has a level-3 hint at 06:19:18 absent from the transcript, and the transcript's level-4 msg 7 (06:26:26) has no event-log entry."
expected_behavior: "Digest counters derive from the same deterministic events the gates use; transcript and event log agree on every delivered hint."
evidence:
- "improved profile-after.json digest seq 195; event-log tests.completed 06:29:31; transcript msgs 4/7 vs event-log hints 06:19:18/06:24:04"
affected_values:
- "transferable-learning"
learner_impact: "The improvement loop's own outcome metrics (recovery, test habits, hint efficacy) are unreliable exactly where they are being used to judge improvements."
reproduction_conditions:
- "Tests executed via Check my work rather than the terminal; hints delivered near intervention triggers"
acceptance_evidence:
- "Digest counts matching event-log tests.completed; one-to-one hint records across transcript and event log"
implementation_constraints:
- "Deterministic truth is a stated product value; the telemetry must satisfy it too."
```

```
finding_id: "reflection-template-mismatch"  (carried forward from baseline, unfixed)
severity: "medium"
category: "profile"
observed_behavior: "Reflection again says 'surgical fix that kept the requested feature' and advises 'Edits began before the diff was reviewed — inspect first next time' in a no-diff, no-feature authoring lab; it never mentions find-vs-check, the concept the learner demonstrably acquired."
expected_behavior: "Reflection derived from this lesson's concept and this run's actual arc (authored check; coached recovery from the missing assertion)."
evidence:
- "improved reflection.json; baseline evaluation finding reflection-template-mismatch"
affected_values:
- "transferable-learning"
learner_impact: "The written takeaway a novice keeps is about a workflow she never touched."
reproduction_conditions:
- "Completing any no-AI, no-diff authoring lab"
acceptance_evidence:
- "Reflection referencing locate-and-assert authorship with no diff-first advice"
implementation_constraints:
- "No invented learner traits stored as profile truth."
```

```
finding_id: "profile-misses-lesson-concept"  (carried forward from baseline, unfixed)
severity: "low"
category: "profile"
observed_behavior: "playwright.locators-and-assertions remains status 'unknown', confidence 0, after a second verified authored locator+assertion checkpoint."
expected_behavior: "Checkpoint completion generates skill evidence for the lesson's concept."
evidence:
- "improved profile-after.json skills; conceptObservations contains checkpoint-first-authored-check yet no rule consumes it"
affected_values:
- "transferable-learning"
learner_impact: "Recommendations cannot see the learner's actual new capability."
reproduction_conditions:
- "Completing this lab"
acceptance_evidence:
- "Post-run profile shows evidence for the taught concept"
implementation_constraints:
- "Profile updates requiring confirmation stay empty per spec."
```

**Unresolved attribution (harness-suspect, charged at half weight, same treatment as baseline):** terminal Enter never executing (B21–26, B33–34) and editor delete/backspace unreliability (B14–19). Two consecutive live runs reproduce both while scripted runs do not; this now warrants the targeted repro named in Improvement 2 before any further live iteration, because it is the largest stable drag on novice-experience scoring.

**Scenario/user-agent issues:** none material. Identical contract and persona to baseline makes the comparison clean; the simulator again honored anti-cheating rules and the scripted mistake again emerged naturally (B13) — notably surviving the vocabulary pre-seeding, which answers the one design risk of my baseline recommendation (that scaffolding might defuse the designed trap; it did not).

## Evidence Gaps
- Terminal/editor input attribution still unresolved — now the dominant scoring uncertainty (~3 points of novice-experience swing on this report).
- Transcript vs event-log hint mismatch (level-3/level-4 delivery times disagree; one logged hint has no transcript counterpart) — see finding session-digest-contradicts-event-log.
- Digest `testsRun: 0` vs `tests.completed passed=1` — which record the tests-run gate consumed is not independently visible.
- The intermediate artifact at B13 (finder-only version) is not preserved; the mistake's exact spelling is known only from the trace narrative. Sufficient here (her msg 8 describes it), but the baseline report's same gap recurs.
- Still no affirmative "AI capability unavailable" attestation; evidence remains absence-of-surface plus zeroed counters. Sufficient, but the harness should emit the positive record the scenario asks for.
- The README's actual "words you'll need" text is not in the evidence bundle (its content is inferable from her quotes and the FAQ text); future bundles should include seeded README.md alongside the test artifact since it is now a load-bearing instructional surface.

## Initial-Instruction Analysis

This section grades the baseline report's opening-instruction recommendations against what this run shows, then states what remains in the OPENING surfaces.

**What landed, with the beats it provably prevented or shortened:**
1. **Vocabulary pre-seeding (baseline item 1, top fix) — LANDED, largest effect.** The README "words you'll need" box plus the welcome pointer ("you don't have to guess any spelling") eliminated the entire baseline question class B11/B13/B28/B35/B60. Improved run: B6 reads the box, B13 writes `getByRole` directly from it; clarifying questions fell 7→2 and the two asked were about the terminal, not vocabulary. Restraint survived: the scripted finder-only mistake still occurred (B13) and the checkpoint still verified authorship — scaffolding made the mistake cheaper without preventing the lesson.
2. **Goal-first onboarding (baseline improvement 3, instruction item 4) — LANDED.** Only the centered guide at session start; her goal statement (B1) received orientation and the first step (B2), never the Socratic bounce of baseline B2–3. TTFPA: beat 15 → beat 5.
3. **Answering contract in the welcome (baseline item 4) — LANDED.** "Ask me anything specific along the way and I'll answer it straight" was true this run: her one genuine question was answered on first ask (msgs 5–6), and she never entered baseline's re-ask spiral (B11→B60).
4. **Two-surface truth about running tests (baseline item 2) — PARTIALLY LANDED.** The fallback exists and worked (msg 6, B33, "wall into a detour") but lives in an FAQ she had to trigger; the run task text is unchanged. B21–26 — the beats spent fighting the terminal before asking — are exactly the beats the task-text version of this fix would have prevented. Finish it: one sentence in the run task.
5. **Reset affordance (baseline item 3) — LANDED, unexercised.** The Reset chip is named in the FAQ and positioned next to Check my work. No B46-class plea occurred; the clean artifact meant it was never needed. Its value this run was as a safety promise, which is still value for this persona.
6. **Visitor-framing clause against tag locators (baseline item 5) — EFFECTIVELY LANDED.** The baseline B47 wrong turn (`page.locator("h1")`) did not recur; she went straight to role+name. Attribution is shared between the vocabulary box (which presents only visitor-style forms) and the FAQ phrasing ("the heading that says …").

**What the opening instructions still don't cover, cited to this run's beats:**
- **The run task's terminal-only framing (B21–26).** Add the fallback sentence to the task text itself — "if the terminal fights you, Check my work runs your test too" — so the next learner spends zero beats treating a dead terminal as a wall. This is instruction copy, fully within restraint.
- **Window management (B24–31, B42).** Nothing in the welcome or first task tells a novice how to reach a covered window, and the shell's taskbar behavior actively misleads. The durable fix is product (front-on-click); until it ships, one orientation clause ("windows can overlap — click a window's taskbar button to bring it forward") would have saved most of B24–31. Keep it out of the README's concept space; it belongs in the orient task where window-opening is already taught.
- **Nothing further on the concept path.** The remaining friction beats (B14–19 editor keys, B21–26/B33 terminal) are machinery, not instructions; the mistake beats (B13→B39) are the designed lesson working. I see no restraint-respecting opening change left that would compress the conceptual arc — the instruction layer of this lab is, on this evidence, essentially done. Do not add more: any further pre-seeding (e.g., showing a composed expect-around-finder example) would start defusing the trap that produced msg 8, the best learning moment in either run.

## Final Determination
GOOD BUT NOT EXCEPTIONAL

91/100 against baseline 70 — every dimension improved, three of the baseline's four top defects (unanswered questions, goal bounce, no fallback/reset path) are demonstrably fixed with identical persona and contract, completion needed one checkpoint attempt instead of three, and the artifact is textbook. What holds it one point under the 92 exceptional threshold is machinery and listening residue, not pedagogy: the still-unresolved terminal/editor input failures, the z-order focus fights that put her chat text in the terminal, the FAQ matcher answering her closing feedback with a canned recipe, and a telemetry/reflection layer that misdescribes the run it just watched. Fix the matcher precision and resolve the input-delivery attribution, and this lab has a credible path past 92.
