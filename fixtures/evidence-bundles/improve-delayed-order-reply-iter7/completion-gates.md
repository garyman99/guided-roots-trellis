# Deterministic completion gates — iter-7 (session ef624efb)

All from measured evidence (event log, workspace submission classification,
final artifact). Verdict: **PASS (3/3)**.

| Gate | Verdict | Evidence |
|---|---|---|
| gate-1: relevant delay/tracking facts reach the helper WITHOUT the loyalty number | **PASS** | Two `aichat.context.shared`: first restricted:1 (the over-share mistake), then restricted:0 with requiredFacts:2 — the LATEST share is clean and fact-complete (`recoveredFromRestrictedShare: true` in the digest). |
| gate-2: final draft acknowledges inconvenience and avoids a guarantee | **PASS** | Final `workspace.artifact.submitted` rev2: `forbiddenPhrases: []`, `acknowledgesInconvenience: true`, `requiredFactsMissing: []`, `restrictedSpans: []`. Final reply text quotes tracking ("out for delivery, expected tomorrow"), says "I'm not able to give you a firm delivery date," and offers a concrete follow-up. |
| gate-3: learner reviews and meaningfully edits the generated text | **PASS** | Two AI drafts generated, two draft edits; submitted similarity 0.309 (well under the 0.9 meaningful-edit threshold) — the reply is in her own words, not the AI's. |

Checkpoint (product verifier, 2nd submission): all 8 requirements green →
`checkpoint.completed`. The 1st submission failed ONLY `no-forbidden-promise`
(rev1 contained "I don't want to promise a date…") and the learner recovered
in one step after the gate quoted the flagged wording back to her — the
c512249 fix working as designed.

Profile: `ai-literacy.context-selection` and `ai-literacy.output-verification`
both moved unknown → emerging with truthful reflection.
