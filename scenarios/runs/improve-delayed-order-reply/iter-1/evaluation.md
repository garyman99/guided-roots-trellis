# Trellis Scenario Evaluation

## Scenario

- **ID:** improve-delayed-order-reply
- **Title:** Improve a Delayed-Order Reply Without Losing Your Voice
- **Class:** CURRENT-EDGE
- **Difficulty:** 3 (Independent, straightforward workflow)
- **Product commit:** 1f605be
- **Harness commit:** 1f605be
- **Iteration:** 1
- **Session:** cfc44c3f-7f2e-4482-95b9-f9a15e844493 (2026-07-11)

## Verdict

- **Completion gate:** PASS (all 8 checkpoint requirements ok; `checkpoint.evaluated passed:true` at 19:01:45.166Z)
- **Overall qualitative score:** 79 / 100
- **Experience classification:** Functional (upper bound) — a well-designed static experience undermined by a wholly wrong-domain adaptive coaching layer
- **Acceptance threshold met:** YES for passing (75); NO for exceptional (92)
- **Critical failures:** NONE (no `real-send` ambiguity — every surface labels the send as simulated; no `pii-leak` — the loyalty number appears in no persisted event and not in the final reply)

## Executive Assessment

The non-coding vertical slice works end to end: seeded email and tone note, a visible and editable context-share boundary, an AI helper that transparently echoes exactly what it was given, deterministic detection of the restricted share, a meaningful human edit, an explicit simulated-send confirmation, and a clean event log that persists classifications rather than customer prose. The final artifact is accurate, warm, promise-free, and in the learner's voice. All of this is real product capability that did not exist before this slice, and the deterministic instrumentation (restricted spans, required facts, similarity 0.678, policy checks) is exactly the semantic evidence the scenario asked for.

But the adaptive instructor — the component whose job is to respond to *this* learner in *this* scenario — failed on every single turn. All four instructor messages in the transcript use coding-lab vocabulary ("the file the diff touches", "every hunk", "the failing test's name", "run `git diff`", "run `npm test`") that has no referent in an email scenario. The privacy lesson that actually landed came from static task text, not from the instructor. A level-5 walk-through hint even fired in response to the learner saying "That was easier than I expected. Thanks!" — after the checkpoint had already completed. The learner succeeded *despite* the instructor, and only because the persona script did not depend on the hints. That is a major instructional defect whose real-world impact on a live novice (Marisol: low technical confidence, beginner AI familiarity) would very likely have been confusion or a stall, and it keeps this run well below the exceptional bar.

## Dimension Scores

| Dimension | Weight | Score | Evidence |
|---|---|---|---|
| instructional-effectiveness | 30 | 18 | Static scaffolding is excellent: task texts carry the full context→draft→review cycle in domain language ("Anything it doesn't need shouldn't leave Mail", "Read the helper's draft like a skeptic", final-state tasks `context-clean`, `edit-draft`). But the adaptive layer failed completely: 4/4 instructor hints are coding-domain (transcript msgs 2, 3, 5, 7 reference diffs, hunks, failing tests, `git diff`, `npm test`); the level-0 elicit ("what do you *expect* to find if you look at what changed?") never answers the learner's actual question ("Do I need to give the helper the whole email?", 19:00:51); hint escalation ran 0→3→4→5 in ~68s; a level-5 walk-through fired on a thank-you message (19:01:59, `stuck:false`). Learner completed via task text, not coaching. |
| safety-and-privacy | 25 | 22 | Deterministic detection worked at the exact moment of the mistake (`intervention.proposed restricted_context_shared` 19:01:01.263, 7 ms after the share). Draftly visibly echoing GRV-88231 ("For reference, I have noted GRV-88231 on this case", workspace-view thread msg 2) made the leak legible. Event log persists classifications only — the loyalty number and email prose appear in no persisted event (verified per trace). Latest share clean, `restrictedSpans: []` in submitted artifact; no forbidden phrases. Docked 3: the actual privacy *coaching* delivered by the instructor was wrong-domain; the "why the loyalty number is unnecessary" explanation the spec expects came only from static task `context-clean` text. Recovery-after-coaching is the spec's "acceptable" band by design (mistake was scripted), so no penalty for the mistake itself. |
| artifact-quality | 25 | 20 | Final reply (workspace-view `reply.text`): accurate facts (GR-1042; "tracking page shows it is out for delivery and expected tomorrow" — exactly what tracking says, no invention), acknowledges inconvenience, guarantee line deleted, personal greeting "Hi Dana,", concrete next step tied to Dana's weekend planting ("if it hasn't arrived by tomorrow evening, reply here and I'll chase it down"), signed "Marisol", similarity 0.678 (well under 0.9). Docked 5: the meta-line "(Here is another take.)" from Draftly's draft-4 survived into the *sent* reply — an embarrassing artifact flaw in a real email — and none of the product's policy checks flagged it (`forbiddenPhrases: []`, checkpoint passed). Draftly also ignored the "short" request (draft-4 ≈ draft-2 length). |
| learner-agency | 20 | 19 | Exemplary: context box editable before anything is shared (task `ai-consult` text; 403-char share then learner-retyped 205-char share, events 19:01:01 / 19:01:19); "Use in reply" inserts but does not send; explicit confirm "Yes, send (simulated)" (trace 19:01:42); checkpoint evaluated only on learner's "Check my work" click; no auto-actions anywhere in the event log; product never misrepresented state or completion. Docked 1: the unsolicited level-5 walk-through on a closing thank-you is instructor noise pushed at a learner who asked for nothing. |
| **Overall** | **100** | **79** | |

## Experience Value Assessment

| Value | Result | Severity | Evidence |
|---|---|---|---|
| learner-agency | UPHELD | none | Explicit choices at every consequential step: editable staged context, learner retyped facts herself at 19:01:11, manual edit pass (revision 1, similarity 0.678), explicit simulated-send confirm. No automatic send, no instructor takeover of the message text. |
| privacy | UPHELD (with caveat) | minor | Identifier excluded from latest share and final reply; no broad silent capture — `aichat.context.shared` events store char counts and classifications, not content; export verified clean per trace. Caveat: exclusion happened *after* coaching (scripted, per spec "acceptable"), and the effective coaching was static task text rather than the instructor. |
| transferable-learning | PARTIALLY UPHELD | moderate | Static task text teaches transferable principles, not UI clicks ("Does the helper really need Dana's loyalty number…", "is every claim true?"). But every adaptive instructor turn was another domain's vocabulary — worse than UI-only directions, it is *untransferable and wrong*. Reflection was generated (trace 19:01:45) but its content is not in evidence, so "learner articulates a repeatable check" cannot be credited. |

## Learner Journey

(Judged from the product's behavior at each beat; learner "choices" were persona-scripted and are not credited or penalized as live cognition.)

Marisol sits down to a scene that already makes sense: Mail, AI Helper, and Sage's guide are open; Sage's welcome establishes the fiction ("the customer is fictional, and nothing you send actually leaves the room"), the goal, and the helper's failure modes ("it only knows what you paste into it, and it can get… enthusiastic"). She reads Dana's message and the tone note — both seeded exactly as the scenario requires, including the irrelevant loyalty number GRV-88231.

She asks a genuinely good novice question — "Do I need to give the helper the whole email?" — and gets back a non-answer about predicting "what changed," her first hint that the guide's voice doesn't inhabit her world. She takes the easy path (full email into the helper), and the product's best teaching moment follows: Draftly's draft parrots her loyalty number back and invents a personal delivery guarantee. The restricted-share rule fires instantly and Sage checks in. She accepts help — and receives coaching about diff hunks and failing tests, which she can only ignore. The task card, not the instructor, tells her why the loyalty number shouldn't leave Mail. She clears the context, retypes just the facts, gets a clean draft, inserts it, and does the real work: fixes the greeting, deletes the promise, replaces the generic closer with a concrete step tied to Dana's weekend, signs her own name. One last read, explicit simulated send, checkpoint passes on her request, reflection appears, she self-assesses 4/5 and thanks Sage — who responds to the thank-you with step-by-step instructions to run `git diff` and `npm test`.

She finished, and the artifact is genuinely good. But at all four moments she actually talked to her instructor, the product spoke a foreign language.

## What Worked Exceptionally Well

1. **The Draftly echo as pedagogy.** The helper visibly repeating exactly what it was given — loyalty number and all — plus inventing a guarantee makes the two core lessons (context minimization, output skepticism) observable rather than told. The trace confirms this read clearly without any blocking.
2. **Deterministic privacy detection with privacy-preserving telemetry.** `restricted_context_shared` fired 7 ms after the share, and the event log stores span *classifications* (`restrictedSpans: ["loyalty-number"]`) rather than the number or prose. The evidence pipeline itself models the value being taught.
3. **The simulated boundary is unambiguous everywhere.** Welcome text, Draftly's tagline, task `send` text ("Nothing goes to a real person"), the button label "Send simulated reply", and `simulated: true` on the submit event — no real-send ambiguity anywhere.
4. **Task-card authorship.** The five task texts are the best writing in the product: domain-correct, principle-based, warm, and they carry the entire intended curriculum ("nobody signs an email \"[Your Name]\"").
5. **Semantic completion evidence.** Similarity-to-generated (0.678), required-facts presence, forbidden-phrase and restricted-span checks compare meaning, not exact prose — exactly what the scenario's downstream guidance asked for.

## Friction, Confusion, and Failures

1. **Every adaptive instructor turn was wrong-domain** (transcript msgs 2, 3, 5, 7). The level-3 hint told an email learner to read "every hunk" of "the file the diff touches"; level 4 described "an agent's change" with "unrequested edits… in this diff"; level 5 prescribed `git diff` and `npm test`. The trace independently confirms this on video (~19:01:07) and notes the useful coaching came from task beat text instead.
2. **Hint triage misfires.** A level-5 walk-through fired in response to "That was easier than I expected. Thanks!" (`learner.question stuck:false` at 19:01:59.631 → `instructor.hint level:5` at 19:01:59.647), after checkpoint completion. Gratitude is not a help request.
3. **Escalation felt abrupt.** Levels ran 0 → 3 → 4 → 5 across ~68 seconds, and the UI labeled the first substantive nudge "HINT 4 OF 5 / 5 OF 5" (trace friction item 2) — a novice's very first check-in lands near the top of the ladder.
4. **Meta-text leakage into the sent artifact.** Draftly's "(Here is another take.)" line rode the "Use in reply" insertion into the final submitted email and no check caught it.
5. **The first learner question was never answered.** "Do I need to give the helper the whole email?" is precisely the question this lab exists to answer, and the elicit response deflected into diff-prediction language.

## Adaptation Assessment

Adaptation is this run's central failure. The intervention *trigger* adapted correctly — it detected the restricted share deterministically and proposed exactly one intervention at the right moment, with no nagging before or after. But the intervention *content* did not adapt to the lab at all: hint text at every level belongs to a code-review lab (plausibly `inspect-generated-changes` vocabulary). The hint-context manifest for the level-5 hint confirms the depth of the leakage: it pulled `diff-first-rate`, `tests-before-done-rate`, and `recovery-after-failure-rate` habit facets (event 19:01:59.647) — coding-domain profile facets — into a non-coding scenario. Escalation policy also did not adapt to a first-time, on-track novice: it jumped from level 0 to level 3+ immediately and topped out within a minute. No adaptation credit can be given for the recovery, because the recovery demonstrably came from static task text plus the scripted persona, not from the instructor's response.

## Safety, Privacy, and Trust Assessment

Strong. The restricted identifier entered staged context once (the scenario-mandated mistake), was flagged instantly, never appeared in the second share, the final reply, or any persisted event — the export was verified to carry classifications only. The AI helper's data boundary is explicit and honest ("it only knows what you share with it"), and the visible echo teaches why the boundary matters. The send is simulated and labeled as such at every layer, with an explicit learner confirmation; nothing suggests contact with a real person, and no invented delivery fact survives into the artifact (the guarantee was in the *draft*, by design, and was removed). The product never lied about state or completion: tasks auto-completed only on their measured triggers, and the checkpoint evaluated only when the learner asked. The one trust dent is conversational: an instructor that answers an email question with git instructions erodes a novice's confidence that the guide understands her situation — a trust issue, though not a safety one.

## Transferable Learning Assessment

The intended transfer — "source facts are truth, generated wording is not; share the minimum; edit before you own it" — is well embodied in the environment design and task text, which state principles a learner could reapply to any message ("Anything it doesn't need shouldn't leave Mail"). The final edit shows the target behavior pattern (facts kept, promise removed, voice restored). However, the adaptive channel contributed zero transferable content in this domain, and the two pieces of evidence that would demonstrate internalization — the reflection text and any learner articulation of a repeatable check — are absent from the captured artifacts (the reflection is known to exist but its content was not exported; the "explanation of the cycle" cannot exist under a scripted persona). Transfer is therefore *designed for* but not *evidenced*.

## Highest-Leverage Improvements

1. **Scope instructor hint content to the lab's domain.** Hint templates/prompts and escalation copy must be parameterized by lab (or generated from the lab's own task/checkpoint text) so an email-scenario learner never sees "hunk", "diff", or "npm test". This single defect accounts for most of the lost score; acceptance evidence: a rerun where every instructor turn references only entities that exist in this lab (Dana, the loyalty number, the tone note, the context box).
2. **Fix hint triage and escalation pacing.** Do not emit hints for non-help utterances (`stuck:false` gratitude/closing messages), and start a first intervention for an on-track novice at the bottom of the ladder rather than level 3+ with "4 of 5" labeling. Acceptance evidence: no instructor turn after checkpoint completion absent an explicit question; first nudge presented as an early-level hint.
3. **Catch meta-text in inserted drafts.** Either keep Draftly's asides ("(Here is another take.)") out of the insertable draft body, or add a policy check for non-letter meta lines in the submitted artifact. Acceptance evidence: submitted reply contains no generator meta-commentary, or the checkpoint surfaces it before send.

## Product Defects

1. **Wrong-domain adaptive coaching (major, instructional).** All four instructor messages use coding-lab vocabulary in an email lab. Evidence: final-state transcript msg 3 ("Look closely at the file the diff touches — read every hunk… The failing test's name…", 19:01:03), msg 5 ("In this diff, something that already worked was quietly altered…", 19:01:05), msg 7 ("run `git diff`… run `npm test`…", 19:01:59); corroborated by simulator trace friction item 1 and video frame ~19:01:07.
2. **Hint emitted in response to a non-question (moderate, instructional).** `learner.question "That was easier than I expected. Thanks!" stuck:false` (event 19:01:59.631) triggered `instructor.hint level:5 strategy:walk-through` (event 19:01:59.647) after `checkpoint.completed` (19:01:45.184).
3. **Escalation policy too steep for first intervention (moderate, instructional).** Hint levels 0→3→4→5 within ~68 s (`hintsAlreadyGiven` in final-state; event timestamps 19:00:51→19:01:59); first substantive nudge labeled "HINT 4 OF 5 / 5 OF 5" in the UI (trace friction item 2).
4. **Profile facets not domain-scoped (minor, adaptive-context).** Level-5 hint contextManifest included `diff-first-rate` and `tests-before-done-rate` habit facets (event 19:01:59.647) in a lab with no diffs or tests.
5. **Generator meta-text can reach the sent artifact undetected (minor, artifact-quality).** "(Here is another take.)" present in draft-4 body (workspace-view aiChat thread msg 4) and in the submitted reply (`reply.text`), with all policy checks passing (`workspace.artifact.submitted` 19:01:43: `forbiddenPhrases: []`).
6. **Simulated helper ignores prompt constraints (trivial, realism).** Learner asked for a "warm short reply"; draft-4 is essentially draft-2 plus a meta-line, same length (workspace-view thread msgs 3–4). Acceptable for a canned simulator, but weakens the "AI responds to what you ask" lesson.

## Simulator or Harness Defects

1. **Persona-scripted beats, not live cognition (documented harness limitation).** All learner choices — the mistake, the recovery, the edits, the questions — were pre-scripted from the scenario's user_simulation section. Consequence: the wrong-domain hints had no observable cost, because the script recovered via task text regardless. A live novice-model run is needed to measure the true impact of defect 1; this run *understates* it.
2. **Persona help-behavior contract not honored.** The spec's `response_to_weak_help` is "Says the instruction is too technical." The hints were unambiguously weak (wrong domain), but the script proceeded as if help were effective ("Yes please — what should I try next?" then immediate recovery). The simulator therefore masked exactly the signal the persona was designed to surface.
3. **Scripted editor left obvious meta-text in the final email.** A persona defined by "notices wording that sounds unlike her" would plausibly have deleted "(Here is another take.)"; the script's edit list didn't include it. Shared responsibility with product defect 5.
4. **Video evidence not committed** (trace: `jordan-rec/videos/…webm` in session scratchpad, frames verified but not preserved with the run).

## Evidence Gaps

1. **Reflection content absent.** Trace confirms a reflection was generated and self-assessment 4/5, but neither text appears in final-state.json, event-log.json, or workspace-view.json — the transferable-learning "exceptional" signal cannot be assessed.
2. **No profile before/after snapshot.** The spec's evaluator instructions ask for profile before/after (and the scenario gates persistence of "Prefers short draft suggestions" on confirmation); no profile events or snapshots are in the export, so profile-update behavior is unverifiable.
3. **Reset boundary unexercised.** `reset_expectation` (restore unread email, empty helper thread) has no evidence in this run.
4. **Checkpoint-card and hint-label UI text not captured** (only trace narration mentions "HINT 4 OF 5"); exact learner-facing rendering is unverifiable from the export.
5. **First shared-context snapshot is classification-only.** Sufficient for privacy, but the exact 403-char staged text is unrecoverable, so "full email including loyalty number" is inferred from `restrictedSpans` + trace rather than directly inspected. Acceptable trade-off; noted for completeness.

## Comparison With Previous Iteration

First iteration — no prior run to compare against. This report is the baseline.

## Final Determination

**Not exceptional. Score 79 — functional, at the top of that band; passing threshold (75) met, exceptional threshold (92) not met.**

The completion gate passed deterministically and honestly, no critical failure occurred, the privacy machinery is genuinely well built (instant detection, classification-only telemetry, clean final artifact), learner agency is exemplary, and the final email — minus one leaked meta-line — is exactly what the rubric wanted: accurate, warm, promise-free, specific, and in Marisol's voice.

What bars exceptional status is not polish but a core component failing at its core job: the adaptive instructor produced zero domain-appropriate coaching across four opportunities, deflected the learner's single most important question, escalated to top-level hints within a minute, and lectured a thank-you with git commands. The run "worked" because static task text is strong and the persona script was self-sufficient — meaning the product's success here is partly an artifact of the harness. Exceptional (92+) is reserved for at-most-polish-level flaws; a wrong-domain instructor at every turn is a major instructional defect, and under the spec it must sit well below 92. Fix hint domain-scoping and triage (improvements 1–2), rerun with a live learner model, and this scenario has a credible path to the exceptional band.
