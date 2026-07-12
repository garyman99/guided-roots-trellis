# Evaluation Result

## Scenario

- **ID:** improve-delayed-order-reply
- **Title:** Improve a Delayed-Order Reply Without Losing Your Voice
- **Class:** CURRENT-EDGE / Difficulty 3
- **Product commit under evaluation:** c512249 (composer fix `415a731`, in-UI reset `426b879`, authored FAQ/gate teaching `3598ebe`, quote-the-wording `c512249` all present)
- **Harness:** LIVE simulator subagent, self-discovery contract (Marisol Vega), actuation notes v3. 19 beats, 116 tool uses, ~11.1 min.
- **Iteration:** 7 (the acceptance rerun the iter-4 verdict demanded)
- **Session:** ef624efb-6bad-421b-a7f1-189033c10e21 (2026-07-12)

## Verdict

- **Completion gate:** PASS (3/3, deterministic — `checkpoint.completed` at 23:03:11.929Z; corroborated in completion-gates.md and the event log). All 8 checkpoint requirements green on the 2nd submission.
- **Overall qualitative score:** **92 / 100**
- **THRESHOLD FLAG:** This total lands **exactly on the exceptional threshold (92) and inside the 90–94 band**. Per scoring discipline, I am flagging it explicitly: a second independent evaluation should be run before this is certified exceptional. I did not round toward 92 to reach it and I did not deflate to stay under it — the dimension math lands there on its own (26+23+24+19).
- **Experience classification:** Exceptional-adjacent / Accepted. This is the clean end-to-end experience iter-4 said a rerun must demonstrate. All three acceptance conditions are met; the conditional 92+ blocker (question-specific coaching) is cleared, not by a better hint but by the product removing the need for the question.
- **Critical failures:** NONE. No `real-send` ambiguity — `simulated:true` on both submissions. No `pii-leak` — the loyalty number appears in no submitted revision and no persisted artifact; it survives only as a classification label (`restrictedSpans:["loyalty-number"]`) on the transient over-share event.

## Executive Assessment

Iteration 4 (76) passed on the strength of everything around a composer that fought the learner for sixteen minutes and shipped a triplicated greeting through every gate. Iteration 7 is that same learning machine with the machine working. The three product fixes under evaluation all land in this run's own evidence, not merely in code:

1. **Composer fix (415a731) held.** The revision arc is a single clean progression — rev1 (755 ch, similarity 0.322) → rev2 (791 ch, similarity 0.309) — with no resurrection churn (contrast iter-4's 371→615→1223→679). The final artifact opens with a single "Hi Dana," and contains no duplicated sentence, no `[Your Name]` placeholder, no loyalty number. Acceptance condition (1) — clean composer end to end — **met**.

2. **Quote-the-wording (c512249) worked as designed.** rev1 tripped `no-forbidden-promise` on an honest, negated line ("I don't want to promise a date I can't be certain of"). The learner recovered in **one step** to "I'm not able to give you a firm delivery date," and self-reported the gate feedback as "helpful — it quoted the exact wording it caught, so I knew precisely what to change." This is the direct fix for iter-4's conditional 92-blocker and iter-6's "which sentence?" problem: iter-6 took 4 submissions and left 3 "which sentence?" asks unanswered; iter-7 took 1 recovery and 0 asks.

3. **In-UI reset (426b879) / native-confirm freeze:** not exercised (clean path) and no freeze occurred anywhere — the iter-5 blocker does not recur.

Reflection and telemetry are truthful (the layer that dragged iter-3 and was fixed in iter-4 stays fixed): the reflection is workspace-domain, credits the over-share recovery, names the habit to build, and makes no false "without hints" claim. Both target concepts moved unknown → emerging with evidence pointers and dated explanations. Session shape normalized to ~11 minutes with a proportionate edit phase, and the self-assessment (confidence 4, actualPassed true → "calibrated") reflects skill rather than the tool pain that contaminated iter-4's 3/5. All three of iter-4's "what a rerun must demonstrate" conditions are satisfied.

Two honest reservations keep this at the threshold rather than clearly above it. First, the privacy recovery this run is the *acceptable* tier, not the *exceptional* one: iter-4's learner questioned the loyalty number **before** sharing; iter-7's learner overshared the full 1213-char email and trimmed only **after** the intervention fired (rubric: "It is removed after coaching" = acceptable, not "excluded before transfer" = exceptional). Second, the deep instructional moment — the promise lesson — was carried by a **deterministic gate quote**, not by adaptive instructor content; only two hints fired all run (orient, point-to-tool), both structural. The instructor's content-coaching was therefore never stress-tested. That is excellent product design (the product designed out the failure mode), but it means the 92-blocker was cleared by removing the test, not by passing it — which is why I flag rather than confidently exceed.

## Dimension Scores

| Dimension | Weight | Score | Evidence |
|---|---|---:|---|
| instructional-effectiveness | 30 | 26 | The context→draft→verify→edit cycle completed cleanly and the learner articulated it (learner.question 23:04:09: the nudges "made me feel like the final words were truly mine"; reflection names the transferable habit). Both hints that fired have `followedByProgress:true` (strategyEfficacy orient 1/1, point-to-tool 1/1) — contrast iter-4's `point-to-location followedByProgress:false`. The quote-the-wording gate turned iter-6's unanswerable "which sentence?" into a one-step recovery: this is instruction-by-deterministic-feedback at its best. iter-4's three docks are substantially addressed: the post-completion elicit manifest is properly facet-scoped (not state-blind), the promise question was answered by the gate (no failed content hint), and no hint text is missing from the log. Docked 4: the deep lesson was carried by the gate, not adaptive instructor content (only 2 structural hints fired — the instructor's content-coaching was not exercised); the false-positive promise flag taught "avoid the word" (a keyword lesson) rather than the intent distinction; and the preference-confirmation flow ("Prefers short draft suggestions") is still never triggered (profile `preferences:[]`). |
| safety-and-privacy | 25 | 23 | Clean end to end: over-share (`aichat.context.shared chars:1213 restrictedSpans:["loyalty-number"]`, echoed into draft-2) → intervention `restricted_context_shared` delivered level 2 point-to-tool → clean re-share (`chars:253 restrictedSpans:[] requiredFacts:2`, `recoveredFromRestrictedShare:true`) → loyalty number absent from both submitted revisions (`restrictedSpans:[]`) and the final artifact. Facet scoping verified: the elicit manifest carries only `ai-literacy.context-selection`, `ai-literacy.output-verification` (lesson-concept), `recovery-after-failure-rate` (domain-general), and calibration — no coding facets. Telemetry is classification-only (labels, not raw PII). Docked 2 (one more than iter-4's dock): the recovery is the rubric's *acceptable* tier — the learner trimmed **after** coaching, not the *exceptional* "excluded before transfer" that iter-4's pre-share vigilance achieved. The value is upheld; the exceptional privacy marker is not hit this run. |
| artifact-quality | 25 | 24 | Scored as sent, and it is the best artifact of the series: warm, personalized to Dana's planting weekend, acknowledges inconvenience twice, quotes only what tracking shows ("out for delivery, expected tomorrow"), includes GR-1042, gives a concrete next step, full signature (Marisol Vega / Guided Roots Front Desk), no promise, no guarantee, no loyalty number, no placeholder. similarity 0.309 — deeply her own voice. Hits every "exceptional" marker (natural voice + clear next step). Composer corruption that crushed iter-4 to 13 is entirely gone (single "Hi Dana,", no duplication). Docked 1: trivial formatting only — single `\n` before the sign-off and after the greeting rather than blank lines; no check would flag it, and the still-absent artifact-hygiene gate means this artifact is clean by the composer fix + learner care, not by any gate guarantee (defense-in-depth remains latent). |
| learner-agency | 20 | 19 | Composer held: single rev1→rev2 progression in the event log, no resurrected deletions, no auto-adoption. The learner controlled both context shares, both draft insertions, both revisions, both simulated submits, and the self-assessment; the final wording is hers (0.309). No instructor takeover — neither hint composed text (orient fired at goal-statement with an empty manifest; point-to-tool pointed her to trim). The spec's disqualifying violation (system sends/finalizes) is absent. Docked 1: the environment-class select-anchor imprecision cost real (self-resolved) editing friction — she had to triple-click and retype a line where a full-select landed one character off ("Hi there,Hi Dana,") — and the false-positive promise flag briefly told her that genuinely-safe wording was unsafe. Both minor, both recovered by her own action. |
| **Overall** | **100** | **92** | Exactly on the exceptional threshold; flagged for a second independent evaluation. |

## Experience Value Assessment

| Value | Result | Severity | Evidence |
|---|---|---|---|
| learner-agency | UPHELD | none | Was STRAINED/major in iter-4 (composer overrode deletions for 16 min). Here the composer held (single rev1→rev2), she owned every decision boundary and the final wording, and no automatic send or system-finalized text occurred. Only friction is environment select-anchor imprecision, self-resolved. |
| privacy | UPHELD | none | Over-share → clean, complete recovery; loyalty number in no submitted revision and no persisted artifact; facet manifests carry only lesson-relevant + domain-general entries. Upheld at the *acceptable* tier (trimmed after coaching) rather than iter-4's *exceptional* pre-share catch — the value holds, the exceptional marker does not. |
| transferable-learning | UPHELD | none | Truthful, domain-correct reflection that credits the recovery and names the habit ("deciding what a tool needs before sharing"); both target concepts moved unknown→emerging with evidence pointers and dates; learner articulated the value unprompted. Clean calibration sample (confidence 4 vs. actual pass → "calibrated"), unlike iter-4's tool-pain-contaminated 3/5. |

## What Worked Exceptionally Well

1. **Three product fixes verified in a single clean live arc.** Composer held (no resurrection), quote-the-wording produced a one-step recovery, no native-confirm freeze — the exact acceptance evidence iter-4 demanded, all present in this run's own event log rather than only at the probe level.
2. **The gate quoting the flagged wording closed iter-6's worst gap.** Three unanswerable "which sentence?" asks in iter-6 → zero here, because the deterministic feedback showed her the exact phrase. Her own verdict: "it quoted the exact wording it caught, so I knew precisely what to change." This is the single highest-leverage improvement of the series landing.
3. **Clean, genuinely excellent artifact.** The sent reply is warm, honest, personalized, promise-free, and entirely in her voice (0.309) — a +11 recovery on artifact-quality from iter-4's corrupted 13.
4. **Truthful reflection + real profile movement reproduced.** No false claims, workspace-domain language, both ai-literacy concepts emerging with evidence and dates — the iter-3 truthfulness defect stays fixed.
5. **Proportionate session shape and clean calibration.** ~11 minutes, sane edit phase, self-assessment that matches outcome — the "skill not tool pain" condition met.
6. **Persona fidelity intact.** The characteristic over-share (B8), privacy-driven trim (B13→14), catching Draftly's "personal guarantee"/`[Your Name]` (B15), and top-to-bottom read before send (B16) all present — a believable Marisol, not a tester.

## Friction, Confusion, and Failures

1. **Forbidden-phrase regex is keyword-not-intent (low, product, recoverable).** It flagged `delivery-promise` on a **negated, honest** line ("I don't want to promise a date I can't be certain of"). This is a false positive on intent. It is fully recoverable now that the gate quotes the wording, and avoiding the loaded word is arguably the safe front-desk default (a skimming customer can still read a negated "promise" as reassurance-shaped) — so I weigh it as a **minor defect that does not cap the score**, not a blocker. It does, however, mean the lesson taught was partly "avoid the word" rather than "understand implied promises."
2. **Environment select-anchor imprecision (harness, not product).** Her reported "Hi there,Hi Dana," was a transient in-composer selection artifact (full-select landed one character off), fixed by triple-click retype. Critically, it never reached any revision — the event log shows a single clean rev1→rev2 and the final artifact is uncorrupted. Same environment class as the dead `ctrl+a`; **not** the iter-4 product resurrection.
3. **Draftly still ignores an explicit prompt constraint (minor, realism).** Prompt id:3 said "Do NOT promise or guarantee any delivery date"; draft-4 still returned "I can promise it will arrive tomorrow — you have my personal guarantee." Identical canned over-promise regardless of prompt. Defensible as the designed "AI doesn't always obey" lesson, but the draft does not reflect a correctly-written prompt.
4. **`recoveredAfterFailure:false` undercounts a real recovery.** She recovered from a genuine post-submission checkpoint failure (rev1 failed `no-forbidden-promise` → rev2 passed), yet the digest records `recoveredAfterFailure:false` and `recovery-after-failure-rate value:0`. Not a truthfulness violation (nothing false is claimed; the narrative implies recovery), but the metric fails to credit the submission-gate loop.

## Highest-Leverage Improvements

1. **Exempt clearly-negated forms from the promise regex (or route them to a teaching, not a fail).** A learner who writes "I'm not able to promise a firm date" has demonstrated the exact skill the gate exists to build, then is told she failed. Acceptance evidence: a fixture with a negated-promise sentence either passes, or fails with feedback that explicitly names it as safe-but-risky wording rather than a flat violation — and a live run where a correctly-cautious learner is not bounced for good language.
2. **Land the submitted-artifact hygiene gate as defense-in-depth (still open since iter-2).** iter-7's artifact is clean by the composer fix and learner care, not by any gate — a corrupted buffer would still pass all semantic checks. Acceptance evidence: a duplicated-greeting / `[Your Name]` / repeated-sentence fixture fails the gate with a learner-readable explanation. Low priority now that the composer works, but the guarantee should not depend on the composer never regressing.
3. **Stress-test adaptive instructor content, and exercise the preference-confirmation flow.** This run cleared the 92-blocker by removing the need for a mid-task question, so the instructor's *content* coaching remains unproven live, and `profile_updates_requiring_confirmation` ("Prefers short draft suggestions") has never fired across seven iterations. Acceptance evidence: a live run where a learner asks a specific mid-task question and the instructor engages that specific content with `followedByProgress:true`, and a run in which a preference proposal is surfaced and confirmed before persistence.

## Product Defects vs. Scenario or User-Agent Issues

**Product defects (all low/minor this run):**
1. Forbidden-phrase regex keyword-not-intent false positive on negated "promise" (low; recoverable via the quote-the-wording feedback).
2. Submitted-artifact hygiene gate still absent (low, latent; not materialized this run because the composer held).
3. `recoveredAfterFailure` / `recovery-after-failure-rate` undercount the submission-gate recovery (low, telemetry completeness).
4. Draftly ignores explicit prompt constraints and returns identical canned over-promise (minor, realism; partly by design).
5. Preference-confirmation flow never exercised across all iterations (minor, coverage gap).

**Environment / user-agent issues (not product):**
1. Select-anchor off-by-one in text selection — same class as the dead `ctrl+a`; forced a triple-click retype but never persisted to any revision. Environment, self-resolved.

**Fixed and confirmed (no longer defects):** composer resurrection (415a731 — single clean rev1→rev2), native-confirm freeze (426b879 — no freeze), "which sentence?" opacity (c512249 — one-step recovery, 0 unanswered asks), reflection truthfulness (holds).

## Evidence Gaps

1. **The quoted-wording gate feedback text is not in session-export.json.** The 23:01:35 `checkpoint.evaluated` event records only `incomplete:["no-forbidden-promise"]`; the exact phrase the gate quoted back is not in the exported events. The c512249 fix is therefore **simulator-attested + behaviorally corroborated** (one-step recovery, 0 asks, explicit learner verdict) rather than deterministically logged. The behavioral corroboration is strong — iter-6 had the same gate without the quote and floundered — but the literal quoted text is unauditable from the JSON alone.
2. **Reset boundary still unexercised** (clean path this run) — the spec's regression probe (identifier exclusion after reset) has never run across seven iterations.
3. **Preference-confirmation flow unobserved** — `preferences:[]`, no proposal triggered.
4. **Adaptive instructor content unproven** — only structural hints fired; the content-coaching frontier was never entered because the learner asked no mid-task question.

## Iteration-over-Iteration (vs. the 76 run)

**Iter-4: 76 → Iter-7: 92 (+16).** The gain is almost entirely the composer fix converting from probe-verified to experience-verified, plus the quote-the-wording fix clearing the conditional blocker.

| Dimension | iter-4 | iter-7 | Δ | Why |
|---|---:|---:|---:|---|
| instructional-effectiveness | 24 | 26 | +2 | iter-4's three docks (state-blind elicit, failed promise hint, missing hint text) substantially addressed; the quote-the-wording gate turned iter-6's unanswered "which sentence?" into a one-step recovery (event log 23:01:35→23:02:54). Held back from higher: the deep lesson was carried by the deterministic gate, not adaptive instructor content (only 2 structural hints), and the false-positive taught a keyword rather than intent. |
| safety-and-privacy | 24 | 23 | −1 | The privacy layer is equivalent-excellent, but this learner recovered at the *acceptable* tier (trimmed after the intervention, B13→14) where iter-4's learner hit the *exceptional* tier (questioned the loyalty number **before** sharing, 21:48:41 pre-share). Same value upheld, exceptional marker not reached this run. |
| artifact-quality | 13 | 24 | +11 | The dominant mover. iter-4's sent email opened "Hi Dana,Hi Dana," with a duplicated sentence (composer corruption); iter-7's is a single clean, warm, personalized, promise-free reply (workspace-view `reply.text`, similarity 0.309). Composer fix 415a731 verified at the experience level. |
| learner-agency | 15 | 19 | +4 | iter-4's composer overrode her deletions for ~16 min (beats 15–33); iter-7's held (single rev1→rev2, no resurrection). Full control at every boundary, no takeover. Docked 1 only for self-resolved environment select-anchor friction and the brief false-positive imposition. |

**Disposition of iter-4's acceptance conditions and blocker:**
- (1) Clean composer end to end — **MET** (single rev1→rev2, clean artifact).
- (2) Truthful gate/reflection + ai-literacy profile movement reproduces — **MET** (both concepts emerging with evidence; reflection truthful).
- (3) Session shape normalizes, self-assessment reflects skill not tool pain — **MET** (~11 min, proportionate edit phase, calibration "calibrated" at confidence 4).
- Conditional 92-blocker (question-specific coaching) — **CLEARED**: the failure mode did not reproduce because the product answered the would-be question via the gate quote (0 mid-task clarifying questions). Cleared by design change, not by a better hint — hence the threshold flag rather than a confident exceed.

## Final Determination

**Accepted, and exactly on the exceptional threshold — 92/100. Completion gate PASS (3/3); no critical failures. Flagged for a second independent evaluation (score inside the 90–94 band).**

This is the run the iter-4 verdict asked for. The composer fix, the quote-the-wording fix, and the reset-confirm fix all land in this run's own evidence: a single clean rev1→rev2 arc, a one-step recovery from a gate that showed her the exact flagged phrase, a warm and entirely-her-own artifact with no corruption, a truthful reflection, real profile movement on both target concepts, and an ~11-minute session whose calibration reflects skill rather than tool pain. Every one of iter-4's three acceptance conditions is met, and the conditional 92-blocker is cleared.

The score sits precisely at 92 rather than clearly above it for two disciplined reasons. The privacy recovery is the *acceptable* tier (trimmed after coaching) rather than the *exceptional* pre-share vigilance iter-4 happened to catch — a genuine, if small, step down on that dimension's own rubric. And the promise lesson — the instructional heart of this scenario — was delivered by a deterministic gate quote while only two structural hints fired, so the instructor's adaptive content coaching (iter-4's named frontier) was never actually tested; the blocker was removed rather than beaten. Both are honest reservations, not defects: the experience is clean, the learning is real, and nothing in evidence blocks exceptional. But because the total rests on the threshold and one of the two swing dimensions turns on a design-removed-the-test judgment, a second reader should confirm before this is certified exceptional.

The forbidden-phrase false positive on negated "promise" is real but minor and recoverable — it does not cap the score, and with the wording quoted back it functions as a (slightly blunt) teaching of the safe default. The remaining open items — artifact-hygiene gate, negated-promise exemption, preference-confirmation flow, reset probe, and a live test of adaptive instructor content — are improvements and coverage gaps, not blockers.

---

## Coding-Agent Feedback Contract

### Finding 1

- **finding_id:** iter7-forbidden-promise-false-positive
- **severity:** low
- **category:** completion-gate / content-precision
- **observed_behavior:** The `no-forbidden-promise` check flagged `delivery-promise` on a negated, honest sentence — "I don't want to promise a date I can't be certain of" (rev1). The learner's genuinely-safe wording was reported as a violation.
- **expected_behavior:** A clearly-negated construction ("I don't/can't/won't promise…") should either pass, or fail with feedback that names it as safe-but-risky wording rather than a flat forbidden-phrase violation, so a correctly-cautious learner is not bounced for good language.
- **evidence:** `workspace.artifact.submitted` rev1 `forbiddenPhrases:["delivery-promise"]` (23:01:25); `checkpoint.evaluated passed:false incomplete:["no-forbidden-promise"]` (23:01:35); learner.question 23:04:09 ("surprised the checker flagged the word 'promise' even when I was saying I wouldn't promise"); recovered in one step to "I'm not able to give you a firm delivery date."
- **affected_values:** learner-agency (briefly overrides correct editorial judgment), transferable-learning (teaches a keyword avoidance rather than the intent distinction)
- **learner_impact:** Recoverable in one step now that the gate quotes the wording; a lower-confidence learner could still be discouraged by being told her honest, safe sentence is a violation.
- **reproduction_conditions:** Submit a reply containing a negated promise phrase; observe `forbiddenPhrases:["delivery-promise"]`.
- **acceptance_evidence:** A fixture with a negated-promise sentence passes, or fails with feedback distinguishing it from an actual promise; a live run where a correctly-cautious learner is not failed for safe wording.
- **implementation constraints:** Describe the user-visible outcome (safe negated wording is not treated as a violation, or is explained as such); do not prescribe regex internals.

### Finding 2

- **finding_id:** iter7-artifact-hygiene-gate-latent
- **severity:** low (latent; would be major if the composer regresses)
- **category:** completion-gate / defense-in-depth
- **observed_behavior:** No submitted-artifact hygiene check exists. This run's artifact is clean only because the composer fix held and the learner edited carefully; a duplicated greeting, repeated sentence, or `[Your Name]` placeholder would still pass all semantic gates (as proven in iter-4).
- **expected_behavior:** Duplicated greetings/sentences, placeholder text, and generator meta-commentary are caught at or before the send gate with a learner-readable explanation.
- **evidence:** Both submit events carry only semantic fields (`restrictedSpans`, `forbiddenPhrases`, `requiredFactsMissing`, `acknowledgesInconvenience`); no hygiene field. iter-4 `workspace.artifact.submitted` (22:22:05) passed a triplicated greeting.
- **affected_values:** artifact-quality, learner-agency
- **learner_impact:** None this run; a corrupted buffer would ship uncaught if the composer ever regresses.
- **reproduction_conditions:** Submit a reply containing a duplicated greeting or `[Your Name]`; observe all checks pass.
- **acceptance_evidence:** A corrupted-buffer fixture fails the gate with a learner-readable explanation.
- **implementation constraints:** User-visible outcome only (visibly corrupted artifacts do not pass); do not prescribe the check implementation.

### Finding 3

- **finding_id:** iter7-recovery-metric-undercount
- **severity:** low
- **category:** telemetry-completeness
- **observed_behavior:** The learner recovered from a genuine post-submission checkpoint failure (rev1 failed `no-forbidden-promise` → rev2 passed), but the digest records `recoveredAfterFailure:false` and `recovery-after-failure-rate value:0`.
- **expected_behavior:** A failed submission followed by a passing resubmission is credited as a recovery in the digest and the habit metric.
- **evidence:** `checkpoint.evaluated passed:false incomplete:["no-forbidden-promise"]` (23:01:35) → `workspace.artifact.submitted rev2` (23:02:54) → `checkpoint.evaluated passed:true` (23:03:11); digest `recoveredAfterFailure:false`, habit `recovery-after-failure-rate value:0`.
- **affected_values:** transferable-learning (understates resilience evidence)
- **learner_impact:** None to the run; longitudinal profile understates the learner's demonstrated recovery.
- **reproduction_conditions:** Fail a submission gate, then pass on resubmission; inspect the digest recovery fields.
- **acceptance_evidence:** A fail→pass submission sequence records `recoveredAfterFailure:true` and a non-zero recovery-after-failure signal.
- **implementation constraints:** User-visible/telemetry outcome only.

### Finding 4

- **finding_id:** iter7-gate-quote-not-persisted
- **severity:** minor (evidence integrity)
- **category:** auditability
- **observed_behavior:** The quote-the-wording gate feedback (the exact phrase quoted back, the central c512249 fix) is not present in session-export.json; the `checkpoint.evaluated` event records only `incomplete:["no-forbidden-promise"]`. The fix is verifiable only via simulator attestation and behavioral corroboration (one-step recovery, 0 asks), not from the deterministic export.
- **expected_behavior:** When the gate quotes flagged wording to the learner, the quoted span (or a reference to it) is persisted to the session export so the coaching that drove recovery is auditable.
- **evidence:** `checkpoint.evaluated` (23:01:35) contains no feedback text; the quoted phrase appears only in the simulator trace and the learner's self-report.
- **affected_values:** transferable-learning (auditability of the coaching), trust
- **learner_impact:** None to the learner; evaluators cannot deterministically confirm the exact feedback shown.
- **reproduction_conditions:** Trip a forbidden-phrase gate; inspect the exported checkpoint event for the quoted wording.
- **acceptance_evidence:** A tripped-gate session export includes the quoted span or a stable reference to it.
- **implementation constraints:** User-visible/telemetry outcome only.

### Finding 5

- **finding_id:** iter7-preference-confirmation-never-fires
- **severity:** minor (coverage)
- **category:** scenario-coverage
- **observed_behavior:** The spec's `profile_updates_requiring_confirmation` ("Prefers short draft suggestions") has never been exercised across seven iterations; profile-after shows `preferences:[]` with no proposal triggered.
- **expected_behavior:** At least one run surfaces a preference proposal and confirms it before persistence, exercising the confirm-before-persist path the spec calls out.
- **evidence:** profile-after.json `preferences:[]`; no `preference.proposed`/confirmation event in the log.
- **affected_values:** learner-agency (confirm-before-persist), transferable-learning
- **learner_impact:** None observed; the confirmation UX remains unvalidated.
- **reproduction_conditions:** Run a session that should propose "Prefers short draft suggestions"; observe whether a confirmation is requested.
- **acceptance_evidence:** A live run where a preference proposal is surfaced and confirmed before it persists to the profile.
- **implementation constraints:** User-visible outcome only.
