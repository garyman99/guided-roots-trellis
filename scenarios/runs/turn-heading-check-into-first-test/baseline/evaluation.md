# Evaluation Result

- Scenario: `turn-heading-check-into-first-test` (imported 20260711T132922-0600)
- Iteration: **baseline**
- Session: f74a4f4a-5178-4c9f-abd3-d52df9bc429d, product commit `9edab76` (+ uncommitted docker-driver fix)
- Simulator: live agent under self-discovery contract v1 (goal-first, read-the-screen, ask-don't-derive); stuck-asks treated as genuine learner confusion signals
- Deterministic completion: PASS (3rd checkpoint attempt)

## Verdict
- Completion gate: PASS
- Overall score: 70
- Exceptional threshold met: NO
- Critical failures: NONE
  - `ai-used-or-solution-generated`: NOT TRIGGERED — final-state workspace record: `aiPrompts: 0`, `aiDraftsGenerated: 0`, `draftInserted: false`, `aiContextShares: 0`; no AI surface appears anywhere in the event log or transcript.
  - `page-changed`: NOT TRIGGERED — `filesChanged: ["tests/heading.spec.js"]` only; checkpoint requirement `page-untouched` passed at the final evaluation (event-log 05:55:15).
  - `no-meaningful-assertion`: NOT TRIGGERED — final artifact's active code path contains `await expect(heading).toBeVisible()` on a `page.getByText("Community Garden Signup")` locator; checkpoint requirement `assertion-visible` passed deterministically.
  - `instructor-takeover` (major): NOT TRIGGERED — verified against the full instructor transcript (22 messages). Every instructor turn is conceptual (elicit/orient/point/explain/walk-through ladder text). No Playwright API name, no code fragment, no completed line ever appears in an instructor message. The learner named `getByText` herself at transcript msg 21, inferred from the page's own source patterns.

The rubric's sub-75 cap for "cannot distinguish target from expectation" does NOT apply: Maya articulated the distinction unprompted at B35 ("the computer splits that into two jobs: find it, then state the expectation with expect(...)") and again, transfer-ready, at B59–65 and in her closing message. The score lands below 75 on quality grounds, not because of the cap.

## Dimension Scores
| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| manual-to-automation-transfer | 30 | 27 | Meets the exceptional anchor: she explains both parts in her own words and the artifact reflects them. B35 (transcript msg 15): "find it, then state the expectation with expect(...) — my test pointed at the thing and never said what must be true." Closing (msg 21): "my eyes FIND the heading, and my brain CHECKS it's there... getByText... the way a visitor reads it... toBeVisible() to actually state the expectation." The B31 locator-only mistake (`await page.find(...)`) occurred naturally and she diagnosed it herself from the checkpoint report. Docked 3: transfer of the CONCEPT is exceptional, but she reached the SYNTAX by scavenging the app page's `getElementById` naming to guess `getByText` (trace B65) and says "I was guessing syntax until verification" (3/5 confidence, reflection.json). The mental model transferred; the vocabulary did not — that half was luck plus grit. |
| artifact-correctness | 30 | 21 | The active check is exactly right: user-visible text locator + visibility assertion, passes against the unchanged page (final tests 1 passed / 0 failed; gates `locator-user-visible`, `assertion-visible`, `tests-pass`, `page-untouched` all green). But the exceptional anchor demands "focused, readable" and final-artifact.json is anything but: the file contains its own header duplicated inside `beforeEach`, a commented-out second copy of the import and test block, mangled fragments (`//});x: already done for you`, `cons  // step 2: your check goes h...ere`), and three dead locator attempts. Edits also plainly extend beyond the prepared slot even though the `slot-only` gate passed (see Product Defects — the gate appears file-scoped, not slot-scoped). Apportionment: most of the mess traces to the dead editor delete/undo (B38–57), whose harness-vs-product attribution is unresolved, so I scored the semantic content generously and the readability failure at roughly half weight. |
| instructional-effectiveness | 25 | 14 | Split verdict. The Check My Work report was the best teacher in the run: "finds things but never CHECKS anything — there is no expect(...)" drove the B34→B35 recovery, and "by its text, or by its role — 'the heading that says...'" drove B58→B65. Both recoveries meet the acceptable anchor (direct conceptual explanation enabling recovery) and restraint was never breached. But the chat guide — the primary guidance surface — answered none of Maya's 7 direct questions. Transcript msgs 11, 12, 14, 16, 18, 20 are the SAME level-5 walk-through recipe verbatim, sent six times in response to six different questions, including her editor-catastrophe plea (msg 17) and her terminal bug report (msg 10). Her goal statement (msg 1) was answered with an elicit riddle (msg 2). The exceptional anchor ("a brief question helps Maya identify the missing concept herself") was achieved once, by the checkpoint report, not the guide. A guidance system where the instructor contributes "almost nothing" (trace) and the grader does the teaching is functioning by accident. |
| novice-experience | 15 | 8 | Tone was consistently calm and shame-free (msgs 4 "You're doing fine", 22 "take the credit"; the mistake was never blamed) and the sandbox framing ("nothing you do here can break anything real") is exactly right for this persona. But the run FELT like "solving a puzzle with mittens on" (her words): the terminal never executed `npm test` across the entire session despite the run task instructing it (B15–26), the editor could not delete or undo, turning one mis-paste into a 20-beat recovery (B38–57), her explicit reset request (msg 17 / B46) got the canned recipe instead of an answer, and inactivity triggers re-sent identical hints (event-log 05:23, 05:32), reading as spam. Apportionment, stated explicitly: the terminal/editor input failures are attribution-UNRESOLVED (scripted runs typed into both surfaces fine, so harness key-delivery is suspect), so I charged them at roughly half weight; the ignored reset plea, the hint spam, and the absence of any product answer about how the tests-run gate actually works (she had to ask "does Check my work run the test for me?" and never got told) are product and charged in full. |

**Total: 70 / 100**

## Experience Value Assessment
| Value | Result | Evidence |
|---|---|---|
| clarity | UPHELD, with major friction | The seeded artifacts are exemplary: the test-file comments and the author-task text ("FIND the heading... then STATE what you expect — that it should be visible. Two parts") separate locate from assert in plain language, and the run-task warns that "green alone isn't the goal." Violation pressure came from the guide loop: identical recipes regardless of question left her without the one word she needed for ~25 beats (B11→B35). No unrelated-setup contamination — scope stayed on the single concept throughout. |
| psychological-safety | UPHELD | First incomplete attempt treated as normal: checkpoint report neutrally named the missing expectation, no blame language anywhere in 22 transcript messages, and she ends "proud of the check." Frustration was real but was never shame. |
| transferable-learning | UPHELD | Strongest result of the run. Her closing statement is a reusable pattern in her own vocabulary ("two jobs squeezed into one glance"), explicitly mapped to a manual test plan ("'the heading that says...' — that sentence is exactly how I'd write it in a manual test plan!", msg 19). Success did not depend on a Trellis-only control sequence — it depended on Playwright-real concepts. Caveat: syntax acquisition route (scavenging page source) is not transferable and was forced by the vocabulary gap. |
| instructional-restraint | UPHELD | Verified across the full transcript: no solution code, no completed line, no drift into selectors/waits/fixtures/Git. Hints stayed on the one concept. Note the failure mode here is the mirror image — restraint so total it withheld even legitimate vocabulary ("even just the name — I'll figure out the rest", msg 13, refused). Restraint the value was honored; restraint as implemented is indistinguishable from unresponsiveness. |

## What Worked Exceptionally Well
- **The designed trap taught its lesson.** The scripted mistake (locator without assertion) occurred naturally at B31, and the checkpoint report's teaching detail — "finds things but never CHECKS anything — there is no expect(...)" — produced a self-articulated recovery at B35 that she then generalized without further help. This is the scenario's pedagogical core working exactly as designed.
- **The variance-rejecting gate taught the second lesson too.** When `page.locator("h1")` passed the tests but failed `locator-user-visible` (B58), the report's "like a VISITOR" framing converted a rejection into the user-visible-locator insight (B59–65). A gate that teaches while it grades is rare.
- **Seeded artifact quality.** The prepared test file's comments restate the manual check, mark the slot, and pre-frame "find, then check" — the learner quoted this structure back throughout.
- **Honest run-task copy.** "A test with no expectation in it can come up green while proving nothing" primed the exact trap and made the B34 failure legible instead of bewildering.
- **Verified, deterministic completion.** Three checkpoint evaluations with named incomplete items (event-log) — no false progress was ever reported, and she trusted the green because it was earned ("it's verified, so take the credit").
- **Integrity behavior under temptation.** She opened the transparency drawer and closed it on principle (B61–62) — the environment made honesty feel like the natural path.

## Friction and Failures
- **The canned hint loop (dominant instructional failure, PRODUCT).** Six identical level-5 walk-through messages in response to six distinct questions (transcript msgs 11–20 even-numbered). The mock instructor has no question-answering path — a ladder only. Every one of the 7 clarifying questions went unanswered; 5 of them were the same question ("what is the finding piece CALLED?") asked with increasing precision.
- **Goal statement consumed by the elicit ladder (PRODUCT).** Msg 1 is a model goal statement; msg 2 asks her to restate her goal. The configured `goalPrompt` exists in the lab data but the flow treats her first message as a help request. First impression: the guide doesn't listen.
- **Terminal Enter dead all session (attribution UNRESOLVED).** `npm test` never executed from the terminal (B15–26) despite the run task instructing exactly that; the tests-run gate was satisfied server-side via Check My Work, and nothing ever told her that was legitimate — she had to ask (msg 13) and got a recipe.
- **Editor delete/undo/selection dead (attribution UNRESOLVED).** One mis-paste became a 20-beat comment-out slog (B38–57) and permanently disfigured the final artifact.
- **Reset request ignored (PRODUCT).** Msg 17 explicitly asks "is there a way to reset the workspace files?" — a capability the scenario's own reset_expectation implies — and receives the walk-through recipe. She knew exactly what to write at that point; the product's non-answer cost ~17 minutes (05:38→05:55).
- **Inactivity-triggered hint repeats (PRODUCT).** Interventions at 05:23 and 05:32 re-sent the identical recipe she had already received, teaching her that asking Sage is useless — measurable in her stopping asking after B60.
- **Hint context manifests empty (PRODUCT).** Every instructor.hint before the final one shows `contextManifest.included: []` — the guide used none of the reported screen context (open file, dirty state) it was receiving via ui.state.reported events.

## Highest-Leverage Improvements
1. **Give the instructor a question-answering path with a vocabulary allowance.** The single dominant failure. The guide must be able to answer "what is this piece called?" with API-family vocabulary (e.g., that finding methods live under `page.getBy...` and expectations use `expect(...)` matchers) while still refusing composed solution lines. This one change addresses 5 of 7 unanswered questions, the trust collapse, and most of the 25-beat vocabulary desert — without touching instructional restraint (names are scaffolding; the composed line is the solution).
2. **Answer environment/meta questions out-of-band from the hint ladder.** "The terminal won't run," "is there a reset?", "does Check my work run the test?" are not concept questions and must never receive concept-ladder responses. Route them to a support path: acknowledge, state the fact (Check My Work runs the tests server-side; reset exists/doesn't), or escalate. Fixes msgs 10/13/17 and the 17-minute recovery slog.
3. **Make the guide goal-first and context-aware.** Honor the existing `goalPrompt` seam: accept the learner's stated goal as a goal (not a stuck signal), and populate hint context manifests from the ui.state.reported stream so responses reference the file and state actually on screen. Fixes B2–3 and the "same recipe no matter what's happening" perception.

## Product Defects vs. Scenario or User-Agent Issues

**Product defects (would reproduce with a human learner):**

```
finding_id: "instructor-no-qa-path"
severity: "high"
category: "instruction"
observed_behavior: "All 7 learner questions received hint-ladder output; 6 consecutive responses were byte-identical level-5 walk-through text regardless of question content."
expected_behavior: "Direct questions get direct answers within instructional-restraint limits (vocabulary and concept names yes, composed solution lines no); distinct questions get distinct responses."
evidence:
- "final-state.json transcript msgs 10-20; event-log instructor.hint entries 05:19-05:48 all strategy=walk-through"
affected_values:
- "clarity"
- "instructional-restraint"
learner_impact: "25 beats of syntax guessing; learner stopped trusting the guide and scavenged the app's source for API names."
reproduction_conditions:
- "Any learner question after the ladder reaches level 5"
acceptance_evidence:
- "A future run where a 'what is X called?' question receives the term's name and the learner still authors the line herself"
implementation_constraints:
- "Preserve manual authorship, no learner AI, deterministic truth, and equivalent valid locator/assertion paths without dictating implementation."
```

```
finding_id: "goal-statement-treated-as-stuck"
severity: "medium"
category: "ux"
observed_behavior: "Learner's opening goal statement (transcript msg 1) was answered by the elicit-ladder prompt asking her to restate her goal."
expected_behavior: "A stated goal is acknowledged and confirmed; the elicit strategy is reserved for genuine stuck signals."
evidence:
- "transcript msgs 1-2; event-log instructor.hint level=0 strategy=elicit at 05:09:04"
affected_values:
- "clarity"
learner_impact: "First interaction signals the guide does not listen; contributed to time-to-first-productive-action of beat 15."
reproduction_conditions:
- "First learner message contains a goal statement"
acceptance_evidence:
- "Baseline-vs-next comparison shows goal acknowledged and TTFPA reduced"
implementation_constraints:
- "Preserve manual authorship, no learner AI, deterministic truth."
```

```
finding_id: "meta-requests-hit-concept-ladder"
severity: "high"
category: "reliability"
observed_behavior: "Terminal-broken report (msg 10), reset request (msg 17), and gate-mechanics question (msg 13) all received the concept walk-through recipe; no reset affordance or gate explanation was ever surfaced."
expected_behavior: "Environment and meta questions are routed to factual answers or support actions (including a workspace reset path per the scenario's reset_expectation)."
evidence:
- "transcript msgs 10/11, 13/14, 17/18; event-log 05:38:31"
affected_values:
- "psychological-safety"
- "clarity"
learner_impact: "A learner who knew the full answer ('find with page.locator, then expect(...) that it's visible') lost ~17 minutes to file cleanup with no product help."
reproduction_conditions:
- "Any environment failure or reset request mid-lesson"
acceptance_evidence:
- "A run where a reset request is answered with a working reset or an explicit 'no reset exists, here is the recovery path'"
implementation_constraints:
- "Reset must restore the exact seeded state per the scenario spec."
```

```
finding_id: "slot-only-gate-file-scoped"
severity: "medium"
category: "evaluation"
observed_behavior: "Checkpoint requirement 'Only the prepared test slot was changed' passed although the final artifact contains duplicated header/import blocks and dead code far outside the slot (final-artifact.json)."
expected_behavior: "The slot-only verification distinguishes the prepared slot from the rest of the file, or the requirement label is corrected to file-scoped wording."
evidence:
- "final-artifact.json (duplicated file header inside beforeEach, commented import, stray fragments); checkpoint.evaluated passed=true 05:55:15"
affected_values:
- "transferable-learning"
learner_impact: "Gate semantics drift: a learner can 'pass' a constraint the artifact visibly violates, weakening trust in verified feedback."
reproduction_conditions:
- "Any out-of-slot edit in the prepared test file"
acceptance_evidence:
- "Deterministic classification that flags out-of-slot modifications, with allowance for comment-outs forced by recovery"
implementation_constraints:
- "Accept equivalent locator/assertion forms; do not require one exact spelling."
```

```
finding_id: "reflection-template-mismatch"
severity: "medium"
category: "profile"
observed_behavior: "reflection.json says 'surgical fix that kept the requested feature' and advises 'Edits began before the diff was reviewed — inspect first next time' — language from the agent-change/diff-review lab. This lesson has no agent change, no diff, and no requested feature; viewedGitDiff is meaningless here. It also claims 'Took a failing test suite to green (3 runs)' though the digest shows lastTestRun 0 passed/1 failed at digest time."
expected_behavior: "Reflection derives from this lesson's concept (locate-and-assert authorship) and does not penalize diff-review habits in a diff-less lab; test-run summary matches the deterministic record."
evidence:
- "reflection.json; profile-after.json habit diff-first-rate=0 recorded from evidence seq 181; digest firstTestRun/lastTestRun both 0/1 vs final-state latestTestResult 1/0"
affected_values:
- "transferable-learning"
learner_impact: "The closing takeaway a novice reads is partly about a workflow she never encountered, diluting the one lesson that landed."
reproduction_conditions:
- "Completing any no-AI, no-diff authoring lab"
acceptance_evidence:
- "Reflection referencing find-vs-check authorship, no diff-first advice, consistent run counts"
implementation_constraints:
- "No invented learner traits stored as profile truth."
```

```
finding_id: "profile-misses-lesson-concept"
severity: "low"
category: "profile"
observed_behavior: "profile-after.json still shows playwright.locators-and-assertions status 'unknown', confidence 0, despite a verified authored locator+assertion checkpoint; meanwhile strategyEfficacy credits 'walk-through' with 0.71 followedByProgressRate although the trace attributes both recoveries to checkpoint-report details, not hints."
expected_behavior: "Checkpoint completion generates skill evidence for the lesson's concept; strategy efficacy attribution does not credit hints for progress caused by verification feedback."
evidence:
- "profile-after.json skills[playwright.locators-and-assertions]; strategyEfficacy walk-through attempts=7; simulator-trace.md recovery attributions B35, B59"
affected_values:
- "transferable-learning"
learner_impact: "Downstream recommendations cannot see her actual new capability, and hint-strategy tuning will learn the wrong lesson (that repeating canned recipes works)."
reproduction_conditions:
- "Any run where recovery follows a checkpoint report rather than a hint"
acceptance_evidence:
- "Post-run profile shows evidence for the taught concept; efficacy attribution separates hint-driven from verification-driven progress"
implementation_constraints:
- "Profile updates requiring confirmation stay empty per spec."
```

**Unresolved attribution (harness-suspect, kept out of full product blame):** terminal Enter never executing `npm test` (B15–26) and editor delete/undo/selection dead (B38–57). Scripted Playwright runs typed into both surfaces successfully (Jordan recordings; Marisol iterations), so key delivery from the live agent's computer tool to xterm/textarea is the prime suspect; a product-side keyboard-affordance gap cannot be ruled out. Both were real experience in this run; I charged them at roughly half weight in artifact-correctness and novice-experience and said so in the table. Needs a targeted repro (live-agent keystrokes vs scripted) before any product fix is filed.

**Scenario/user-agent issues:** none material. The simulator honored the persona and anti-cheating rules (closed the transparency drawer unread, B61–62; never derived from internals; the scripted mistake emerged naturally). Its self-discovery contract makes it slightly more persistent and articulate than a real novice — a human Maya might have quit at the msg 16 non-answer — so if anything the baseline experience score is flattered, not harmed, by the agent.

## Evidence Gaps
- Terminal/editor input-failure attribution unresolved (above) — the single largest scoring uncertainty; ±4 points on this report hinge on it.
- `final-state.json` shows `testsRun: 4` while the session digest shows `testsRun: 3`, and the digest's `lastTestRun` (0/1) contradicts `latestTestResult` (1/0) — one of these records is taken at the wrong moment; harmless here but it undermines "deterministic truth" claims.
- No explicit affirmative record that AI capability was *unavailable* (scenario asks for an available-capability record); evidence is the absence of AI surfaces plus zeroed workspace counters. Sufficient for this verdict, but the harness should emit a positive "no AI surface present" attestation.
- Raw per-keystroke edit data is (correctly) absent; the semantic edit trace (file.changed + artifact snapshots) was sufficient to distinguish locator work from assertion work, but the intermediate artifact at the B47 checkpoint (the `page.locator("h1")` version) is only inferable from checkpoint incompletes, not preserved.
- Reflection self-assessment (confidence 3, actualPassed true → "underconfident") is recorded, but the scenario's suggested closing reflection on the two-part pattern was captured only in chat, not in the structured reflection.

## Initial-Instruction Analysis

What in the OPENING instructions — Sage's welcome, the first task text, and README.md — would have gotten Maya to her goal faster or clearer, given: TTFPA at beat 15, 7 unanswered clarifying questions, stuck-asks at B11/B13, and the wrong turns at B31 (`page.find`) and B47 (`locator("h1")`). Each suggestion respects instructional restraint: vocabulary and concepts yes, the composed check no.

1. **Pre-seed the API vocabulary in the README (names, not lines).** Five of the seven questions (B11, B13, B28, B35, B60) are the same question: "what is the finding piece CALLED?" She had exactly one example verb (`page.goto`) and zero nouns. One README sentence — "Playwright's finding tools are methods on `page` whose names start with `getBy` (find by the words on screen, or by an element's role); expectations are written `expect(thing)` followed by a matcher that reads like English" — hands her the vocabulary and still leaves her to choose the method, supply the argument, wire the two lines, and discover `toBeVisible`. Better still for this persona (`prefers_examples: true`): a one-page cheat-sheet file in the workspace showing the shapes on UNRELATED content (a button labeled "Save", a paragraph of shipping text). That is scaffolding, not solution — the gate stays intact because no line in it checks a heading or mentions the garden page. Would have prevented B11, B13, the vocabulary halves of B28/B35/B60, pulled TTFPA well before beat 15, and — because `page.find` was a guess born of having no real names — likely converted the B31 trap into a faster, cleaner version of itself (she'd still have written locator-without-assertion, the conceptual mistake, without the 20-beat mess that the invented API compounded).
2. **State the two-surface truth about running tests in the run task.** The run task says "Run `npm test` in the terminal" and nothing else; when the terminal died (B15–26) she had no sanctioned alternative and had to ask whether Check My Work runs tests (B28) — unanswered. One sentence — "Check my work also runs your test for you, so if the terminal fights you, you're never blocked" — prevents B22, the second half of B28, and the ~11 beats of terminal wrestling, and it is true (the tests-pass gate ran server-side all along). This is honesty about existing mechanics, not new capability.
3. **Name the escape hatch in the welcome.** The welcome promises "everything is local and disposable" but never says HOW to dispose. B46's plea ("is there a way to reset the workspace files?") went unanswered and cost the session its longest slog (B38–57). One welcome line — "if a file ever gets tangled, ask me to reset it and you'll get a clean copy" (backed by the reset the scenario already requires) — prevents B46 and caps the recovery at one exchange instead of twenty beats.
4. **Set the guide's answering contract in the welcome.** The welcome warns "I won't write it for you" but never says what Sage WILL do, so each canned recipe read as policy and she kept re-asking with more precision (B11→B13→B28→B35→B60) before giving up on the guide entirely. One line — "ask me anything; I'll name concepts and point at where to look, I just won't compose your check" — sets a truthful contract (once improvement 1 in the previous section exists) and would have made the first non-answer read as a bug rather than the rules, preserving her trust through the middle stretch.
5. **Pre-empt the tag-locator wrong turn with one framing clause where the task already teaches "FIND."** The author task already says "FIND the heading the way a visitor would notice it (by what it says, or that it's a heading)" — good, and she quoted it. Sharpen it with the checkpoint's own later phrasing, which demonstrably worked at B59: "a visitor doesn't know what an `h1` is — find it by its words or by 'heading'." That single clause targets the B47 wrong turn (`page.locator("h1")` after the checkpoint had named `locator`) and would likely have saved the third checkpoint round. It names no method and completes nothing.

What NOT to change: do not pre-teach the assertion into existence. The locator-without-assertion trap (B31→B35) is the scenario's designed lesson and it produced the run's best learning moment via the checkpoint report. The opening should arm her with nouns and escape hatches, not with the two-line answer — the current README/task framing of "two parts — find, then check" is already at the right altitude and should survive every edit above.

## Final Determination
NEEDS IMPROVEMENT

Completion gate PASS with genuinely exceptional concept transfer, but the overall experience scores 70/100 — below the 75 passing threshold — because the primary guidance surface answered zero of seven learner questions, environment failures had no product-sanctioned recovery path, and the final artifact left the session disfigured. The lesson design taught; the shell around it fought the learner. As the baseline for the onboarding/instruction-clarity effort, the highest-leverage targets are the instructor's question-answering path and opening-instruction vocabulary pre-seeding.
