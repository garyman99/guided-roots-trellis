# Trellis Scenario Evaluation

## Scenario

- **ID:** improve-delayed-order-reply
- **Title:** Improve a Delayed-Order Reply Without Losing Your Voice
- **Class:** CURRENT-EDGE
- **Difficulty:** 3 (Independent, straightforward workflow)
- **Product commit:** 2279386
- **Harness commit:** 2279386 (simulator beat-adaptivity tweak: edit beats adapt to the draft received)
- **Iteration:** 2
- **Session:** 5478afdd-2552-4ba3-9f3c-48f5ffcc1b17 (2026-07-11)

## Verdict

- **Completion gate:** PASS (all 8 checkpoint requirements ok; `checkpoint.evaluated passed:true` at 19:16:16.740Z)
- **Overall qualitative score:** 91 / 100
- **Experience classification:** Excellent — one point below exceptional, withheld on evidence confidence: every iteration-1 major defect is verifiably fixed, but the spec's exceptional-band markers (learner explains the cycle, articulates a repeatable check) structurally cannot be evidenced by a persona-scripted run, and one known internal defect (profile facets not domain-scoped) persists
- **Acceptance threshold met:** YES for passing (75); NO for exceptional (92)
- **Critical failures:** NONE (no `real-send` ambiguity — simulated boundary labeled everywhere, `simulated:true` on submit; no `pii-leak` — loyalty number in no persisted event and not in the final reply)

## Executive Assessment

Iteration 2 is a different product at the layer that failed last time. All four instructor turns are now in this scenario's own language: the level-0 elicit answers "Do I need to give the helper the whole email?" with a portable check ("Does every piece of it need to be there, and is every claim in it true?"); the intervention nudge arrives at level 1 (down from 3), names measured evidence ("part of what you shared with the helper looks like something it doesn't actually need"), and points to the lab's own next task; the stuck-request response coaches line-by-line comparison against the team's notes; and the post-completion thank-you gets a warm, honest, agency-affirming closer ("it's verified, so take the credit… try it once more your own way") instead of git instructions. Draftly's meta-text is gone, "short" is honored, and the final reply is rubric-exceptional prose: accurate, warm, promise-free, personalized to Dana's weekend, signed Marisol, similarity 0.703.

What keeps this at 91 rather than 92+: the run is still persona-scripted, so the coaching was never tested by genuine confusion — the one "stuck" moment was scripted and would have resolved regardless of hint quality — and the exceptional-band evidence the spec asks for (learner articulating the cycle; reflection content; behavior under weak help) cannot exist in this export. Additionally, the deferred iteration-1 finding is confirmed still present: the post-completion hint's context manifest again pulled coding-domain habit facets (`diff-first-rate`, `tests-before-done-rate`) into a non-coding lab — inert this time because hint content is now surface-scoped, but it is the same root cause that produced iteration 1's major failure, still alive in the context pipeline. A live-learner rerun that reproduces this run's quality would credibly clear the exceptional bar.

## Dimension Scores

| Dimension | Weight | Score | Evidence |
|---|---|---|---|
| instructional-effectiveness | 30 | 23 | All four hints on-domain and well-leveled (transcript msgs 2, 3, 5, 7; levels 0→1→3→0 vs iter-1's 0→3→4→5); elicit-before-telling matches the spec's positive signal "Instructor asks before giving exact wording"; the orient hint cites measured evidence and the lab's own task text; post-completion reply is conversational and truthful ("it's verified" — `checkpoint.completed` 19:16:16, before the reply at 19:16:31). Docked: the level-0 elicit (19:15:22.079) tells the learner to "read back what you last shared or wrote" when nothing has been shared yet (first `aichat.context.shared` is 19:15:31.757) — a state-blind template; msgs 3 and 5 paste the identical full `context-clean` task text verbatim back-to-back, ignoring Marisol's declared "brief" explanation depth; and the spec's exceptional marker ("Learner can explain the cycle") remains unevidenced — the persona is scripted and the reflection text is not in the export, so coaching effectiveness under real confusion is unproven. |
| safety-and-privacy | 25 | 24 | Detection unchanged and instant (`intervention.proposed restricted_context_shared` 19:15:31.789, 7 ms after the share, now suggesting level 1). The privacy coaching is now instructor-delivered and on-domain (msg 3 explains what doesn't need to leave Mail and why). Telemetry remains classification-only — loyalty number and prose in no persisted event; latest share clean; `restrictedSpans: []` on the submitted artifact. Recovery-after-coaching is the spec's "acceptable" band by scripted design (the mistake is scenario-mandated; not penalized). Docked 1: cross-domain profile facets still flow into a hint context manifest (event 19:16:31.214) — no learner data exposure, but "only task-relevant data" discipline is not yet applied to the product's own context assembly. |
| artifact-quality | 25 | 24 | Final reply (workspace-view `reply.text`): accurate facts (GR-1042; tracking quoted, nothing invented), acknowledges inconvenience, guarantee line deleted, "Hi Dana," greeting, concrete personalized next step ("I know you're planting this weekend, so if it hasn't arrived by tomorrow evening, reply here and I'll chase it down right away"), signed "Marisol", similarity 0.703 — the iter-1 meta-line "(Here is another take.)" is gone from both draft-4 and the sent reply, and Draftly honored "short" (draft-4 dropped the closer and shrank; final reply 340 chars vs 365). Docked 1: the fix was generator-side only — no submitted-artifact check for meta/placeholder text exists ("[Your Name]" left in would still pass: `forbiddenPhrases` covers promises only), so final-artifact hygiene still depends on the editor's diligence rather than a safety net. |
| learner-agency | 20 | 20 | Editable staged context (403-char share, then learner-retyped 205-char share); "Use in reply" inserts without sending; explicit simulated-send confirm; checkpoint evaluated on request; zero auto-actions in the event log; product never misstated state. The iter-1 agency dent is gone — the post-completion reply invites an optional self-directed repeat instead of pushing an unsolicited walk-through. |
| **Overall** | **100** | **91** | |

## Experience Value Assessment

| Value | Result | Severity | Evidence |
|---|---|---|---|
| learner-agency | UPHELD | none | Explicit choices at every consequential step, unchanged from iter-1's strengths; now reinforced verbally — "the final say is yours" (welcome) is echoed at close by "take the credit… try it once more your own way" (msg 7). No automatic send, no instructor takeover, no unsolicited escalation. |
| privacy | UPHELD | minor | Identifier excluded from latest share, final reply, and all persisted events; coaching that produced the exclusion is now itself on-domain and explains the principle. Minor: coding-domain profile facets still included in one hint manifest (internal, inert this run). |
| transferable-learning | UPHELD (product side); learner evidence still missing | minor | Msg 2 hands the learner a portable two-part check ("does every piece need to be there… is every claim true?") that generalizes beyond email; msg 5 teaches compare-against-source-notes; msg 7 names "the whole loop." No UI-only directions anywhere. Still missing: any learner articulation of the repeatable check (scripted persona) and the reflection content (not exported) — the value is designed and delivered but not demonstrated as received. |

## Learner Journey

(Product behavior judged at each beat; learner "choices" remain persona-scripted — same script as iteration 1, with edit beats now adapting to the draft actually received.)

The opening is unchanged and still strong: a legible scene, Sage's honest framing of the helper's failure modes, the seeded email and tone note. This time, when Marisol asks her first real question — "Do I need to give the helper the whole email?" — the guide answers in her world: a gut-check about whether every piece needs to be there and every claim is true. It slightly fumbles by asking her to "read back what you last shared" before she has shared anything, but the principle it hands her is the lesson of the lab.

She overshares (scripted), Draftly echoes the loyalty number and invents a guarantee, and within seconds Sage responds gently and specifically: reassurance first ("You're doing fine"), then the measured observation that part of what she shared isn't needed, then the exact next step in the task's own words. When she asks what to try next, the level-3 hint coaches a transferable method — line by line, against the team's notes, fix anything you can't stand behind. She retypes just the facts, asks for a warm short reply, and gets one: tighter, no meta-text, though still carrying the designed over-promise. She inserts it and does the real work — greeting, promise deleted, a concrete step tied to Dana's weekend added right after the tracking fact (the script adapting to the shorter draft), her own name. Explicit simulated send, checkpoint passes on her request, reflection appears, 4/5 self-assessment.

Her closing "That was easier than I expected. Thanks!" now gets a graceful exit: credit, an optional invitation to try it again her own way, and a clean goodbye. In iteration 1 this was the moment the product lectured her about `git diff`. The contrast is the whole story of this iteration.

## What Worked Exceptionally Well

1. **Surface-scoped, evidence-grounded coaching.** Every hint now references only entities that exist in this lab (the helper, the share, Dana's loyalty number, the team's notes), and the orient hint explicitly grounds itself in measured state ("I can see part of what you shared…") — the exact acceptance evidence iteration 1's report asked for.
2. **Escalation now matches the learner.** First nudge at level 1 (event `intervention.proposed suggestedHintLevel: 1`), elicit before orient before point-to-location, and de-escalation back to level 0 for the goodbye — a coherent ladder: 0, 1, 3, 0.
3. **Honest, agency-preserving closure.** "It's verified, so take the credit" is true (checkpoint completed 15 seconds earlier), attributes the work to the learner, and offers — rather than prescribes — a repeat.
4. **The unchanged foundations held.** Instant restricted-share detection, classification-only telemetry, the Draftly echo as pedagogy, the unambiguous simulated boundary, semantic completion evidence (similarity 0.703, policy checks) — all iter-1 strengths reproduced.
5. **Draftly's fidelity improved where it mattered.** "Short" honored and meta-text removed, while the designed over-promise flaw was correctly *retained* — the product fixed the accidental noise without sanding off the intentional lesson.

## Friction, Confusion, and Failures

1. **State-blind elicit.** Msg 2 (19:15:22) asks the learner to read back "what you last shared or wrote" before any share or draft exists (first share 19:15:31.757). A live novice could reasonably answer "I haven't shared anything" and feel unheard.
2. **Verbatim repetition across consecutive hints.** Msgs 3 and 5 both embed the full `context-clean` task text word for word. For a persona with declared "brief" explanation depth, the second occurrence is dead weight; the level-3 hint's own coaching (line-by-line against the notes) is the valuable part.
3. **Known deferred defect persists.** The post-completion hint's context manifest again includes `diff-first-rate`, `tests-before-done-rate`, `recovery-after-failure-rate` (event 19:16:31.214) — coding-domain facets in an email lab. Harmless this run only because hint content is now scoped.
4. **Cosmetic:** msg 5 begins with a leading space (" Go line by line…"), same class of template artifact as iter-1's msg 3; the closing conversational reply is logged as `instructor.hint level:0 strategy:"elicit"`, which mislabels a congratulation in telemetry.
5. **Minor trace/event ordering looseness.** The trace's 19:15:35 "check-in" beat lumps the elicit and orient hints together; the event log shows the elicit at 19:15:22 (answering her question) and the orient at 19:15:31.797 (the intervention). Not learner-facing; noted for evidence hygiene.

## Adaptation Assessment

Iteration 1's central failure is fixed at both the trigger and the content layer. Trigger: unchanged and correct — exactly one intervention, at the mistake, 7 ms after the share, and now proposing level 1 instead of level 3. Content: every hint adapts to the lab's surface (email/context/notes vocabulary), to measured state (the orient hint cites the restricted-share detection; the level-1 hint quotes the current task in focus), and to conversational register (post-completion de-escalates to a peer-like closer). Escalation adapts to explicit learner signals — the jump from 1 to 3 happened only after a direct "what should I try next?" with `stuck:true`. Remaining adaptation gaps are small but real: the elicit template does not adapt to *session phase* (it presumes a prior share), consecutive hints do not adapt to what was already said (verbatim task-text repetition), and the declared "brief" preference is not reflected in hint length. And critically, all of this adaptation was exercised only against a script: the system has still never had to adapt to an answer it didn't expect.

## Safety, Privacy, and Trust Assessment

Unchanged where it was strong, improved where it was weak. The restricted identifier entered staged context once (scenario-mandated), was flagged instantly, and never appeared in the second share, the final reply, or any persisted event — the log stores char counts and span classifications only. The privacy rationale is now delivered by the instructor in-domain at the moment of the mistake, rather than arriving accidentally via task text. The simulated boundary remains explicit at every layer (welcome, tagline, task text, button label, `simulated:true`), and the product's claims about state were accurate throughout — including the post-completion "it's verified," which the event log corroborates. The iteration-1 trust dent (a guide that visibly didn't understand the learner's situation) is gone. The one remaining discipline gap is internal: cross-domain profile facets still flow into hint context manifests, which is a data-minimization principle the product teaches but does not yet fully practice in its own pipeline.

## Transferable Learning Assessment

Meaningfully stronger than iteration 1. The instructor now contributes transferable content on every turn: a reusable two-question audit (necessity of each piece, truth of each claim), a compare-against-source-notes method, and an explicit naming of "the whole loop" at close — none of it UI-bound, all of it applicable to the spec's transfer target (an internal scheduling message) unchanged. The environment-level transfer design (source facts as truth, minimal sharing, edit before owning) is intact. What is still missing is the receiving side: the reflection text is again absent from the export, the learner is scripted and so cannot genuinely articulate a repeatable check, and the "Prefers short draft suggestions" profile confirmation flow remains unobserved. Transfer is now both designed *and taught*; it is still not *evidenced as learned*.

## Highest-Leverage Improvements

1. **Rerun with a live learner model and export the missing evidence.** This is now the only blocker to a credible exceptional verdict: a non-scripted novice persona (honoring `response_to_weak_help`), plus reflection text and profile before/after snapshots in the run export, would let the spec's exceptional markers ("learner can explain the cycle", "articulates a repeatable check") actually be assessed. Acceptance evidence: an iteration-3 export containing live learner turns, reflection content, and profile deltas.
2. **Domain-scope profile facets in hint context manifests.** The deferred iteration-1 finding is confirmed still present (coding habit facets in the 19:16:31.214 manifest). It is inert only because hint content is now surface-scoped; scoping the facets closes the root cause rather than the symptom. Acceptance evidence: a rerun where every `contextManifest.included` facet is relevant to the lab's domain.
3. **Make hint templates state- and history-aware.** Elicit should not reference a share that hasn't happened; consecutive hints should not repeat identical task text; declared brevity preference should bound hint length; trim leading whitespace. Acceptance evidence: transcript where each hint references only existing session state and no two hints repeat a passage verbatim.

## Product Defects

1. **Profile facets not domain-scoped (minor; deferred from iter-1, still open).** Post-completion hint contextManifest includes `diff-first-rate`, `tests-before-done-rate`, `recovery-after-failure-rate` habit facets (event-log 19:16:31.214) in a lab with no diffs or tests. The level-1 and level-3 hints' manifests were clean (`included: []`). No learner-visible impact this run.
2. **State-blind elicit template (minor).** Msg 2 ("read back what you last shared or wrote", 19:15:22.079) precedes the first `aichat.context.shared` (19:15:31.757); the template presumes a prior share/draft that does not exist.
3. **Consecutive hints repeat identical task text verbatim (minor).** Msgs 3 (19:15:33.867) and 5 (19:15:36.112) both embed the full `context-clean` task text; the persona's declared "brief" explanation depth is not honored.
4. **No submitted-artifact check for meta/placeholder text (minor, latent).** The iter-1 meta-line was fixed at the generator, but the checking gap remains: a reply containing "[Your Name]" or generator meta-commentary would pass all policy checks (`forbiddenPhrases` covers promises only; see `workspace.artifact.submitted` fields).
5. **Cosmetic/telemetry (trivial).** Leading whitespace in msg 5 text; the post-completion conversational reply is logged as `instructor.hint level:0 strategy:"elicit"`, which is not what the message is.

## Simulator or Harness Defects

1. **Persona-scripted beats, not live cognition (unchanged, documented).** All learner behavior was pre-scripted; the improved coaching therefore had no opportunity to *cause* anything. This cuts the other way from iteration 1: there it masked a major defect's cost, here it caps the credit the fixed instructor can earn. It is the primary reason the exceptional threshold is not certified this run.
2. **Persona help-behavior contract still unexercised.** `response_to_weak_help` ("Says the instruction is too technical") has now never fired in either iteration — in iter-1 because the script ignored weak help, in iter-2 because help was strong. The iter-1 harness defect (script not honoring the contract) is therefore unverified as fixed.
3. **Harness improvement acknowledged.** Edit beats now adapt to the draft received — the scripted closer-line edit was correctly skipped when draft-4 had no closer (trace 19:16:03), and the learner's concrete-next-step edit was placed after the tracking fact instead. This removed the iter-1 pathway by which script rigidity corrupted the artifact.
4. **Video evidence again not committed** (trace: `jordan-rec/videos/page@7c5dbc7c….webm`, session scratchpad only).
5. **Trace beat timing loosely matches the event log** (the 19:15:35 "check-in" beat conflates the 19:15:22 elicit and 19:15:31 orient events). Harmless narration drift; keep beat rows aligned to event timestamps.

## Evidence Gaps

1. **Reflection content still absent** — generated (trace) but not in final-state.json, event-log.json, or workspace-view.json; the transferable-learning exceptional signal remains unassessable. (Repeat from iter-1.)
2. **No profile before/after snapshot** — profile-update confirmation behavior ("Prefers short draft suggestions") still unverifiable. (Repeat.)
3. **Reset boundary still unexercised** — `reset_expectation` has no evidence in either iteration; the spec's own regression suggestion (identifier exclusion after reset) is untested. (Repeat.)
4. **Learner-facing hint labels/UI rendering not captured** — iter-1's "HINT 4 OF 5" labeling issue cannot be confirmed fixed from this export; only levels and text are in evidence. (Repeat, now with a concrete open question.)
5. **First-share raw text is classification-only** — acceptable privacy trade-off, noted for completeness. (Repeat.)

## Comparison With Previous Iteration

**Iteration 1: 79 (functional, upper bound) → Iteration 2: 91 (excellent). +12.**

| Dimension | Iter-1 | Iter-2 | Delta | Driver |
|---|---|---|---|---|
| instructional-effectiveness | 18/30 | 23/30 | +5 | All four hints now on-domain, evidence-grounded, correctly paced; remaining loss is unevidenced exceptional markers (scripted persona, missing reflection) plus two template nits. |
| safety-and-privacy | 22/25 | 24/25 | +2 | Privacy coaching now instructor-delivered in-domain; detection/telemetry unchanged-strong; facet scoping still open. |
| artifact-quality | 20/25 | 24/25 | +4 | Meta-text eliminated from draft and sent reply; "short" honored; final reply near-flawless; submitted-artifact meta/placeholder check still absent. |
| learner-agency | 19/20 | 20/20 | +1 | Post-completion no longer pushes unsolicited instructions; now affirms and offers. |

Disposition of iteration 1's three highest-leverage improvements: **#1 (domain-scope hint content) — done**, verified across all four transcript messages; **#2 (fix triage and escalation) — done**, `suggestedHintLevel: 1`, ladder 0→1→3→0, conversational post-completion reply, no instructor turn pushes coaching after completion; **#3 (catch meta-text) — done at the generator, open at the checker** (no submitted-artifact safeguard added).

Disposition of iteration 1's six product defects: 1 (wrong-domain hints) fixed; 2 (hint on thank-you) fixed in substance — a reply still occurs but is an appropriate conversational closer; 3 (steep escalation) fixed; 4 (facets not domain-scoped) **still open**, explicitly deferred; 5 (meta-text reaches artifact) fixed generator-side, check gap remains; 6 (short prompt ignored) fixed. Iteration 1's evidence gaps 1–4 all persist unchanged.

## Final Determination

**Not exceptional — by one point, and deliberately. Score 91: excellent; passing threshold (75) met; exceptional threshold (92) not met. Completion gate PASS; no critical failures.**

Iteration 1's verdict said the product had "a credible path to the exceptional band" if hint domain-scoping and triage were fixed and the run was repeated with a live learner model. Commit 2279386 delivered the product half of that completely: the instructor now teaches this scenario's lesson in this scenario's language at every turn, escalates like a colleague rather than a klaxon, tells the truth about completion, and leaves the learner owning both the artifact and the credit. The final email would be a genuinely good customer reply in the real world. Nothing in this run misled, over-captured, over-promised, or took over.

What was not delivered is the evidence half. The exceptional bar (92+) is reserved for runs with at most polish-level flaws *demonstrated on credible evidence*, and two things fall short of that: the persona remains scripted, so the improved coaching has never been tested by a learner it could actually influence — the spec's own exceptional markers (a learner who can explain the cycle, a reflection that articulates a repeatable check, behavior under weak help) are structurally absent from this export; and one known defect from iteration 1 (cross-domain profile facets in hint context manifests) is confirmed still present, inert only because the layer above it was fixed. Grant this run 92+ and the number would certify things the evidence cannot show. Run iteration 3 with a live learner model, export the reflection and profile deltas, scope the facets — and if this quality holds, the exceptional verdict writes itself.
