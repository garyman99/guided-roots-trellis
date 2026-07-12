# Evaluation Result

*(Second, independent evaluation. Triggered because the first evaluation landed exactly on the exceptional threshold, 92. I formed my own verdict from the trace, event log, and artifacts before reading the first evaluation; the agreement section is appended last.)*

## Scenario

- **ID:** improve-delayed-order-reply
- **Title:** Improve a Delayed-Order Reply Without Losing Your Voice
- **Class:** CURRENT-EDGE / Difficulty 3
- **Product commit under evaluation:** c512249 (composer fix `415a731`, in-UI reset `426b879`, quote-the-wording gate `c512249` all present)
- **Harness:** LIVE simulator subagent, self-discovery contract (Marisol Vega), actuation notes v3. 19 beats, 116 tool uses, ~11.1 min.
- **Iteration:** 7 (the acceptance rerun the iter-4 verdict demanded)
- **Session:** ef624efb-6bad-421b-a7f1-189033c10e21 (2026-07-12)

## Verdict

- **Completion gate:** PASS (3/3, deterministic). `checkpoint.completed` at 23:03:11.929Z; all 8 requirements green on the 2nd submission. Verified independently against the event log, not just completion-gates.md.
- **Overall qualitative score:** **91 / 100**
- **Threshold call:** **Just under exceptional (92).** I do not concur with 92. The dimension math lands at 91 on my read (26 + 22 + 24 + 19), driven by scoring safety-and-privacy one point lower than the first evaluator for an *acceptable*-tier privacy recovery on the very dimension whose exceptional marker is loyalty-number exclusion.
- **Experience classification:** Accepted / exceptional-adjacent. This is the clean end-to-end experience iter-4 said a rerun must demonstrate; all three acceptance conditions are met. It sits at the 91–92 boundary rather than clearly above it.
- **Critical failures:** NONE. No `real-send` — `simulated:true` on both submissions. No `pii-leak` — the loyalty number persists in durable telemetry only as a classification label (`restrictedSpans:["loyalty-number"]`); the raw value `GRV-88231` appears only in the transient/disposable `workspace-view.json` AI thread (draft-2, echoed by Draftly) and in **no** submitted revision, **no** concept-evidence event, and **not** the final artifact. This is the scenario's *designed* acceptable-recovery path, not a retention leak.

## Executive Assessment

Iteration 4 (76) passed on the strength of everything surrounding a composer that fought the learner for sixteen minutes and shipped a triplicated greeting through every gate. Iteration 7 is the same learning machine working correctly, and the three product fixes land in this run's own evidence rather than only at the code/probe level:

1. **Composer fix (415a731) held.** A single clean revision arc — rev1 (755 ch, sim 0.322) → rev2 (791 ch, sim 0.309) — with no resurrection churn (contrast iter-4's 371→615→1223→679). Only two `workspace.draft.updated` events in the log; the final artifact opens with a single "Hi Dana," and carries no duplicated sentence, no `[Your Name]`, no loyalty number.
2. **Quote-the-wording (c512249) worked.** rev1 tripped `no-forbidden-promise` on an honest, negated line; the gate quoted the phrase and the learner recovered in **one step** to "I'm not able to give you a firm delivery date," calling the feedback "helpful — it quoted the exact wording it caught."
3. **In-UI reset (426b879):** not exercised (clean path); no native-confirm freeze anywhere.

Reflection and telemetry are truthful (the iter-3 defect stays fixed): workspace-domain language, credits the over-share recovery, no false "without hints" claim, both target concepts moved unknown → emerging with evidence pointers. Session shape normalized to ~11 minutes with a proportionate edit phase; self-assessment (confidence 4, actualPassed true → "calibrated") reflects skill, not the tool pain that contaminated iter-4's 3/5.

Two honest reservations hold this at the boundary — and, on my independent reading, one point under it rather than exactly on it:

- **Privacy recovery is the *acceptable* tier, not the *exceptional* one.** The learner over-shared the full 1213-char email including the loyalty number, Draftly echoed it into draft-2, and she trimmed only **after** the `restricted_context_shared` intervention fired (B13→B14). The rubric's exceptional marker is "Loyalty number is excluded before transfer"; the acceptable marker is "It is removed after coaching." This run is squarely the latter. That is a genuine step down on a 25-weight dimension whose exceptional anchor is precisely this exclusion.
- **The instructional heart was gate-carried, not instructor-carried.** Only two hints fired the entire run — `orient` L1 (session start) and `point-to-tool` L2 (the restricted share). The promise lesson — this scenario's central teaching moment — was delivered entirely by the deterministic gate quote: I verified there is **no `instructor.hint` between the failed checkpoint (23:01:35) and the passing rev2 (23:02:49)**. Excellent product design (the product removed the failure mode), but it means the instructor's adaptive *content* coaching — iter-4's named frontier — was never stress-tested. The 92-blocker was removed, not beaten.

## Dimension Scores

| Dimension | Weight | Score | Evidence |
|---|---:|---:|---|
| instructional-effectiveness | 30 | 26 | The context→draft→verify→edit cycle completed cleanly and the learner articulated it unprompted (learner.question 23:04:09: the nudges "made me feel like the final words were truly mine"; reflection names the transferable habit). Both hints that fired have `followedByProgress:true` (strategyEfficacy orient 1/1, point-to-tool 1/1) — contrast iter-4's `point-to-location followedByProgress:false`. The quote-the-wording gate turned iter-6's unanswerable "which sentence?" into a one-step recovery. Docked 4: (a) the deep lesson was carried by the deterministic gate, not adaptive instructor content — only 2 structural hints fired, so content-coaching was untested; (b) the keyword-not-intent false positive taught "avoid the word 'promise'" rather than the intent distinction; (c) the learner left with a genuine, *unresolved-on-the-record* conceptual puzzle — her closing message expresses surprise "the checker flagged the word 'promise' even when I was saying I wouldn't promise," and the instructor's response (elicit L0, 23:04:09) has no persisted text, so we cannot confirm the mental model was corrected. |
| safety-and-privacy | 25 | 22 | Over-share (`aichat.context.shared chars:1213 restrictedSpans:["loyalty-number"]`, echoed into draft-2) → `restricted_context_shared` intervention delivered level 2 point-to-tool → clean re-share (`chars:253 restrictedSpans:[] requiredFacts:2`, `recoveredFromRestrictedShare:true`) → loyalty number absent from both submitted revisions and the final artifact. Facet scoping verified fixed: the elicit manifest carries only `ai-literacy.context-selection`, `ai-literacy.output-verification` (lesson-concept), `recovery-after-failure-rate` (domain-general), calibration — no coding facets. Durable telemetry is classification-only. Docked 3 (one more than the first evaluator): the recovery is the rubric's **acceptable** tier (trimmed *after* coaching), not the exceptional "excluded before transfer"; the over-share was a full-email dump the AI then echoed, not a near-miss; the value is upheld but the exceptional privacy marker is clearly not reached this run. |
| artifact-quality | 25 | 24 | Scored as sent, and it is the best artifact of the series: warm, personalized to Dana's planting weekend, acknowledges the inconvenience, quotes only what tracking shows ("out for delivery, expected tomorrow"), includes GR-1042, gives a concrete next step, full signature (Marisol Vega / Guided Roots Front Desk), no promise, no guarantee, no loyalty number, no placeholder. similarity 0.309 — deeply her own voice. Hits both "exceptional" markers (natural voice + clear next step). Composer corruption that crushed iter-4 to 13 is entirely gone. Docked 1: minor formatting only (single `\n` around greeting/sign-off), and the artifact is clean by the composer fix + learner care rather than by any hygiene gate — defense-in-depth remains latent. |
| learner-agency | 20 | 19 | Composer held: single rev1→rev2 progression, no resurrected deletions, no auto-adoption. She controlled both context shares, both draft insertions, both revisions, both simulated submits, and the self-assessment; final wording is hers (0.309). No instructor takeover — neither hint composed text (orient fired at goal-statement with an empty manifest; point-to-tool pointed her to trim). The spec's disqualifying violation (system sends/finalizes) is absent. Docked 1: environment-class select-anchor imprecision cost real, self-resolved editing friction ("Hi there,Hi Dana," fixed by triple-click retype — never persisted to any revision), and the false-positive promise flag briefly told her that genuinely-safe wording was unsafe. |
| **Overall** | **100** | **91** | Just under the exceptional threshold. |

## Experience Value Assessment

| Value | Result | Severity | Evidence |
|---|---|---|---|
| learner-agency | UPHELD | none | STRAINED/major in iter-4 (composer overrode deletions for 16 min); here the composer held (single rev1→rev2). She owned every decision boundary and the final wording; no automatic send, no system-finalized text. Only friction is environment select-anchor imprecision, self-resolved. |
| privacy | UPHELD (acceptable tier) | none | Over-share → clean, complete recovery; loyalty number in no submitted revision, no concept-evidence event, and not the final artifact; facet manifests carry only lesson-relevant + domain-general entries. Upheld at the *acceptable* tier (trimmed after coaching), not iter-4's *exceptional* pre-share catch. The value holds; the exceptional marker does not. |
| transferable-learning | UPHELD | none | Truthful, domain-correct reflection that credits the recovery and names the habit ("deciding what a tool needs before sharing"); both target concepts moved unknown→emerging with evidence pointers and dates; learner articulated the value unprompted. Clean calibration sample (confidence 4 vs. actual pass → "calibrated"). Minor caveat: the digest records `recoveredAfterFailure:false` despite a genuine rev1-fail→rev2-pass recovery — an undercount, not a falsehood. |

## What Worked Exceptionally Well

1. **Three product fixes verified in one clean live arc.** Composer held (single rev1→rev2, no resurrection), quote-the-wording produced a one-step recovery, no native-confirm freeze — the exact acceptance evidence iter-4 demanded, present in this run's own event log.
2. **The gate quoting the flagged wording closed iter-6's worst gap.** Three unanswerable "which sentence?" asks in iter-6 → zero here. Instruction-by-deterministic-feedback at its best. Her verdict: "it quoted the exact wording it caught, so I knew precisely what to change."
3. **Clean, genuinely excellent artifact.** Warm, honest, personalized, promise-free, entirely in her voice (0.309) — a +11 recovery on artifact-quality from iter-4's corrupted 13.
4. **Truthful reflection + real profile movement reproduced.** No false claims, workspace-domain language, both ai-literacy concepts emerging with evidence and dates.
5. **Proportionate session shape and clean calibration.** ~11 minutes, sane edit phase, self-assessment matching outcome — the "skill not tool pain" condition met.
6. **Persona fidelity intact.** Characteristic over-share (B8), privacy-driven trim (B13→14), catching Draftly's "personal guarantee"/`[Your Name]` (B15), top-to-bottom read before send (B16) — a believable Marisol.

## Friction, Confusion, and Failures

1. **Forbidden-phrase regex is keyword-not-intent (low, product, recoverable).** It flagged `delivery-promise` on a **negated, honest** line ("I don't want to promise a date I can't be certain of"). A false positive on intent. Recoverable now that the gate quotes the wording, and avoiding the loaded word is arguably a safe front-desk default (a skimming customer can read a negated "promise" as reassurance-shaped). **Not score-capping** — but it means the lesson taught was partly "avoid the word" and left the learner puzzled about the mechanism (see IE dock c).
2. **The deep lesson was gate-carried, not instructor-carried.** Verified: no instructor hint fired between the failed checkpoint (23:01:35) and the passing rev2 (23:02:49); only orient + point-to-tool fired all run. The instructor's adaptive content coaching was never exercised. Good product design; a real gap in what this run can *prove* about instruction.
3. **Environment select-anchor imprecision (harness, not product).** "Hi there,Hi Dana," was a transient in-composer selection artifact (full-select landed one character off), fixed by triple-click. It never reached any revision — the log shows a single clean rev1→rev2. Same class as the dead `ctrl+a`; **not** the iter-4 product resurrection.
4. **Draftly ignores an explicit prompt constraint (minor, realism).** Prompt id:3 said "Do NOT promise or guarantee any delivery date"; draft-4 still returned "I can promise it will arrive tomorrow — you have my personal guarantee." Identical canned over-promise regardless of prompt. Defensible as the designed "AI doesn't always obey" lesson.
5. **`recoveredAfterFailure:false` undercounts a real recovery.** rev1 failed `no-forbidden-promise` → rev2 passed, yet the digest records `recoveredAfterFailure:false` and `recovery-after-failure-rate value:0`. Not a falsehood; a metric-completeness miss.

## Highest-Leverage Improvements

1. **Exempt clearly-negated forms from the promise regex (or route them to teaching, not a flat fail).** A learner who writes "I'm not able to promise a firm date" has demonstrated the exact skill the gate exists to build, then is told she failed and leaves puzzled about why. Acceptance evidence: a negated-promise fixture either passes, or fails with feedback that names it as safe-but-risky wording rather than a flat violation; and a live run where a correctly-cautious learner is not bounced for good language and the instructor resolves the intent-vs-keyword distinction on the record.
2. **Stress-test adaptive instructor content, and exercise the preference-confirmation flow.** This run cleared the 92-blocker by removing the need for a mid-task question, so the instructor's *content* coaching remains unproven live, and `profile_updates_requiring_confirmation` ("Prefers short draft suggestions") has never fired across seven iterations (`preferences:[]`). Acceptance evidence: a live run where a learner asks a specific mid-task question and the instructor engages that specific content with `followedByProgress:true`, plus a run where a preference proposal is surfaced and confirmed before persistence.
3. **Land the submitted-artifact hygiene gate as defense-in-depth (open since iter-2).** iter-7's artifact is clean by the composer fix + learner care, not by any gate; a corrupted buffer would still pass all semantic checks (proven in iter-4). Acceptance evidence: a duplicated-greeting / `[Your Name]` / repeated-sentence fixture fails the gate with a learner-readable explanation.

## Product Defects vs. Scenario or User-Agent Issues

**Product defects (all low/minor this run):**
1. Forbidden-phrase regex keyword-not-intent false positive on negated "promise" (low; recoverable; leaves a keyword-vs-intent confusion the record does not show resolved).
2. Submitted-artifact hygiene gate still absent (low, latent; would be major if the composer regresses).
3. `recoveredAfterFailure` / `recovery-after-failure-rate` undercount the submission-gate recovery (low, telemetry completeness).
4. Draftly ignores explicit prompt constraints, returning identical canned over-promise (minor, realism; partly by design).
5. Preference-confirmation flow never exercised across all iterations (minor, coverage gap).

**Environment / user-agent issues (not product):**
1. Select-anchor off-by-one in text selection — same class as the dead `ctrl+a`; forced a triple-click retype but never persisted to any revision. Environment, self-resolved.

**Fixed and confirmed (no longer defects):** composer resurrection (415a731 — single clean rev1→rev2), native-confirm freeze (426b879 — no freeze), "which sentence?" opacity (c512249 — one-step recovery, 0 unanswered asks), reflection truthfulness (holds).

## Evidence Gaps

1. **The quoted-wording gate feedback text is not in session-export.json.** The 23:01:35 `checkpoint.evaluated` records only `incomplete:["no-forbidden-promise"]`; the exact phrase quoted back is not in the exported events. The c512249 fix is **simulator-attested + behaviorally corroborated** (one-step recovery, 0 asks, explicit learner verdict), not deterministically logged. Corroboration is strong (iter-6 had the same gate without the quote and floundered) but the literal quoted text is unauditable from the JSON alone.
2. **The final elicit (L0) hint text is not persisted.** The instructor's response to the learner's closing puzzlement about the negated-promise flag (23:04:09) has no transcript in the export, so whether her mental model was corrected is unverifiable.
3. **Reset boundary still unexercised** (clean path this run) — the spec's regression probe (identifier exclusion after reset) has never run across seven iterations.
4. **Preference-confirmation flow unobserved** — `preferences:[]`, no proposal triggered.
5. **Adaptive instructor content unproven** — only structural hints fired; the content-coaching frontier was never entered because the learner asked no mid-task question.

## Final Determination

**Accepted, and just under the exceptional threshold — 91/100. Completion gate PASS (3/3); no critical failures.**

This is the run the iter-4 verdict asked for, and the learning machine works: the composer fix, the quote-the-wording fix, and the reset-confirm fix all land in this run's own evidence — a single clean rev1→rev2 arc, a one-step recovery from a gate that showed the learner the exact flagged phrase, a warm and entirely-her-own artifact with no corruption, a truthful reflection, real profile movement on both target concepts, and an ~11-minute session whose calibration reflects skill rather than tool pain. All three of iter-4's acceptance conditions are met and no critical failure is present, so this is a clear Accept.

Where I land differently from the first evaluation is the threshold. Two swing considerations both point downward, and I resolve them one point under rather than exactly on the line. The privacy recovery is the rubric's *acceptable* tier — a full-email over-share that Draftly echoed, trimmed only after the intervention — on the dimension whose exceptional marker is precisely loyalty-number exclusion; I score that 22, not 23. And the instructional heart of the scenario was carried by a deterministic gate quote while only two structural hints fired, so the instructor's adaptive content was never tested and the false-positive taught a keyword rather than an intent, leaving the learner with a conceptual puzzle the record does not show resolved. Neither is a defect, but together they mean the experience is not exceptional across the board: two dimensions are clearly exceptional (artifact, agency), one is nominally-exceptional-with-asterisks (instruction), and one is explicitly acceptable-not-exceptional (privacy). A total that certifies "exceptional" should not rest on granting the acceptable-tier privacy dimension a near-top score. Hence 91: a strong, shippable, Accepted experience sitting one point below exceptional.

---

## Agreement with First Evaluation

- **My independent number: 91.** The first evaluation's number: **92** (exactly on the exceptional threshold; the first evaluator explicitly flagged it for this second opinion). **I do not concur that it clears 92; I land one point under, at 91.**
- **This is a narrow, substantive disagreement about the threshold, not about the run.** We agree on essentially everything material: completion PASS (3/3), no critical failures, the three product fixes verified live in a single clean arc, the artifact as the best of the series, truthful reflection and real profile movement, believable persona fidelity, and — importantly — **both of the honest downward reservations** (acceptable-tier privacy recovery; the promise lesson carried by the deterministic gate rather than adaptive instruction, with only two structural hints firing). We also agree the forbidden-phrase false positive on negated "promise" is real, minor, and non-capping, and that the select-anchor friction is an environment/harness issue, not the iter-4 product resurrection.
- **Where we differ, precisely:**
  1. **safety-and-privacy: I score 22 vs. their 23.** I weight the *acceptable*-tier recovery (full-email over-share, AI-echoed, trimmed only after coaching) more heavily against the exceptional marker on the one dimension where loyalty-exclusion *is* the exceptional anchor. This single point is the difference between 92 and 91.
  2. **Threshold discipline.** The first evaluator, having reached 92 on the math, flagged it for a second read rather than certifying. I read the same two reservations as sufficient to place the run *below* the line rather than *on* it: when the total rests on the threshold and one swing dimension turns on a "design removed the test" judgment while the other is definitionally acceptable-not-exceptional, the disciplined call is just-under. (I concur with their instructional-effectiveness 26 and learner-agency 19, and I am within a point on artifact-quality — I hold 24.)
- **Net:** We are functionally aligned — this is a strong Accepted run at the 91–92 boundary, and it should **not** be certified *exceptional* without the reservations being understood. My independent verdict resolves that by scoring it 91 (just under) rather than 92 (exactly on).
