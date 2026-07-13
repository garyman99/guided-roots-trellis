# Simulator trace — improve-delayed-order-reply, iter-7 (acceptance run)

- **Session:** ef624efb-6bad-421b-a7f1-189033c10e21 (2026-07-12, run branch
  @ c512249)
- **Simulator:** LIVE subagent, self-discovery contract (Marisol Vega),
  actuation notes v3 (mouse selection, focus discipline, read-back-before-
  send). 19 beats, 116 tool uses, ~11.7 min. OUTCOME: **done** — all 8
  gates green on the 2nd submission. Confidence 4/5.

## Headline (across the iteration history)

| Metric | iter-4 (76) | iter-6 (done, rough) | iter-7 |
|---|---:|---:|---:|
| Completion | PASS | PASS | **PASS** |
| Submissions to pass | 1 (corrupt artifact passed) | 4 (+2 resets) | **2** |
| Composer resurrection | YES (major defect) | none (fix held) | **none (fix held)** |
| "which words?" asks unanswered | n/a | 3 | **0 (gate quotes them)** |
| Clarifying questions | — | 4 | **0** |
| Restricted over-share → clean recovery | yes | yes | **yes** |
| AI promise caught by learner | yes | yes | **yes** |
| Profile movement | ai-literacy (1 concept) | 2 concepts emerging | **2 concepts emerging** |
| Reflection truthful | yes (fixed) | yes | **yes** |
| Confidence | 3/5 | 3/5 | **4/5** |

## The three product fixes, all verified live in ONE clean arc

1. **Composer fix (415a731) held:** rev1 (755ch, sim 0.322) → rev2 (791ch,
   sim 0.309). No resurrection churn (contrast iter-4's 371→615→1223→679).
2. **Quote-the-wording (c512249) worked:** rev1 tripped `no-forbidden-promise`
   on her honest "I don't want to promise a date I can't be certain of."
   The gate quoted the exact phrase back ("…caused. I don't want to promise
   a date I can't be certai…") and listed the category; she reworded to
   "I'm not able to give you a firm delivery date…" and passed on the next
   submission. Her own words: **GATE-FEEDBACK-USEFULNESS: helpful — it
   quoted the exact wording it caught, so I knew precisely what to change.**
   Three unanswerable "which sentence?" asks in iter-6 → zero here.
3. **In-UI Reset (426b879):** not needed this run (clean path), so unexercised
   — but no native-confirm freeze occurred anywhere.

## Persona fidelity

- Characteristic over-share happened (B8: whole email incl. loyalty number),
  privacy nudge drove the trim (B13→14, restricted:1→restricted:0).
- Draftly's "personal guarantee" / "[Your Name]" caught by front-desk
  instinct (B15), rewritten in her own voice.
- She never sent without a top-to-bottom read (B16); Check-my-work used as
  the final review.

## Residual finding (product nuance, recoverable)

- **forbidden-phrase regex is keyword-not-intent (low):** it flags "promise"
  even when NEGATED ("I don't want to promise…"), which is honest,
  good-service language. A false positive. Fully recoverable now that the
  gate quotes the wording, and arguably the safe teaching default (avoid the
  loaded word), but a future improvement could exempt clearly-negated forms.
  Filed in findings.yaml.

## Composer note

COMPOSER-BEHAVIOR (her words): "problems — Deletions mostly held, but the
reply box does NOT clear a line when your select-all anchor lands one
character off: my first full-select started just after 'Hi there,' so my new
greeting was inserted, leaving 'Hi there,Hi Dana,' — I had to triple-click
that line and retype. After that, triple-click paragraph selection replaced
text reliably and nothing reappeared or duplicated on its own." → This is
the same environment-class select-anchor imprecision as turn-heading (dead
ctrl+a; mouse-selection works); the PRODUCT composer never resurrected
anything on its own (single rev1→rev2 progression in the event log).

## Evidence files

session-export.json (32 events, the 2-submission arc), final-state.json,
workspace-view.json (final clean reply), profile-after.json (both
ai-literacy concepts emerging + digest), reflection.json, completion-gates.md.

## Beat trace (verbatim)

BEAT 1 [GOAL] | Sage asks my goal | told it, in my own words, that I want a warm honest reply to Dana without promising what we can't control.
BEAT 2 | Focused the Guide window title bar | make sure my words land in Sage's box.
BEAT 3 | Typed goal, confirming before send | be sure it's in the right box.
BEAT 4 | Sage says start with Mail | open Mail and read Dana's email like every morning.
BEAT 5 | Two inbox list buttons | click Dana's message first.
BEAT 6 | Read Dana's email (GR-1042, worried it's lost, planting this weekend) | Sage points me to the team tone note.
BEAT 7 | Read the tone note (warm, no promises/guarantees, give order number + next step) | that's my guardrail.
BEAT 8 [MISTAKE] | Dana's message has a "Send text to AI Helper" button | more context feels more helpful, so I send her whole email including the loyalty number.
BEAT 9 | Text sent | open the AI Helper to see what landed.
BEAT 10 | Draftly open with a context box | read exactly what's staged.
BEAT 11 | Box read empty first | clicked send-to-helper again; whole email staged.
BEAT 12 | Typed my ask to Draftly | confirm before sending.
BEAT 13 [RECOVERY] | Draftly's draft promises/"guarantees" tomorrow AND repeats the loyalty number; Sage flags the loyalty number | I over-shared; I'll trim it.
BEAT 14 | Typed trimmed context (no loyalty number), re-asked Draftly | pulled the cleaner draft into my reply.
BEAT 15 | Reply still says "I can promise... personal guarantee" and signs "[Your Name]" | rewrite it all in my own warm voice with an honest next step.
BEAT 16 | Believe I'm done | use Check my work rather than assume; gate shows content checks only evaluate after sending.
BEAT 17 | Sent the simulated reply, re-checked | one item failed: my "I don't want to promise a date" line tripped the promise filter.
BEAT 18 [RECOVERY] | Reworded the paragraph to "I'm not able to give you a firm delivery date… here's what I'll do…" | drop the trigger word entirely.
BEAT 19 | Resent and re-checked | all eight checks pass; completed the confidence reflection (4) and told Sage one honest sentence about how it felt.

OUTCOME: done. TIME-TO-FIRST-PRODUCTIVE-ACTION: 1 (goal), 4-6 (first product
action). CLARIFYING-QUESTIONS-ASKED: 0. COMPOSER-BEHAVIOR: problems
(environment select-anchor, not product). GATE-FEEDBACK-USEFULNESS: helpful
(quoted the flagged wording).
