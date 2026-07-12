# Simulator trace — improve-delayed-order-reply, iter-6 (completed, rough middle)

- **Session:** 7eb44693-ce04-4b43-98fb-095e83fe6f24 (2026-07-12, run branch
  @ 426b879)
- **Simulator:** LIVE subagent, self-discovery contract (Marisol Vega),
  actuation notes v2 (mouse selection, focus discipline). 74 beats, 240
  tool uses, ~42 min. OUTCOME: done — all 8 gates green on the 4th
  submission after 2 resets. Confidence 3/5.

## What worked

- Goal-first onboarding, Mail/tone-note orientation, characteristic
  mistake (full email incl. loyalty number at B15/B24), privacy nudge →
  clean re-share recovery, Draftly's stubborn "personal guarantee" caught
  by persona instinct every time, in-UI Reset confirmation (used TWICE,
  no freeze — iter-5's blocker verified fixed), latest-share-counts
  recovery after an environment-mangled share, truthful profile movement
  (ai-literacy.context-selection AND ai-literacy.output-verification →
  emerging), honest 3/5 reflection.

## The rough middle — and its deterministic attribution

Four submissions: rev1153ch [delivery-promise], rev1899ch
[delivery-promise], (reset) rev2684ch [delivery-promise], rev3382ch
[delivery-promise], (reset) rev648ch PASS.

**Draft sizes grew monotonically across her "rewrites."** Environment-class
editing (dead ctrl+a/Delete; insertText at a stale cursor) APPENDED her new
text around the old instead of replacing — so the AI draft's "I can promise
it will arrive tomorrow — you have my personal guarantee" line remained
buried in every submitted blob. **The check was right all four times.** Her
final clean pass (648 chars, one insertion into a truly empty box) confirms
it: her own wording never contained a promise.

## Product gap exposed (fixed post-run, commit c512249)

She asked THREE separate times some form of "which exact sentence is it
seeing?" — and no surface could answer: the gate detail taught the CATEGORY
(the new teaching text — she quoted it back at B60) but could not point at
the offending words; "What does Sage see?" shows context-manifest
scaffolding, not the reply. Fixed: the failing promise check now QUOTES the
matched wording with context from the server-side reply truth (ephemeral
check result only — the event log still never carries learner prose).

## Residual findings (carried)

- what-does-sage-see-not-learner-readable (low, ux): the transparency panel
  is technical scaffolding; for this persona it answered nothing.
- Sage repeated the same ladder hint 3× to her escalating stuck reports
  (mock-provider ceiling; the hint-context-manifest finding covers the
  class).
- Environment: browser-pane screenshots failed intermittently for this
  agent (read_page text was the workaround); message splicing corrupted one
  chat message and one context share (recovered via latest-share-counts).

## Evidence files

session-export.json (80 events; the 4-failure/1-pass submission history
above is its spine), final-state.json, workspace-view.json (final clean
648-char reply), profile-after.json (both ai-literacy concepts emerging),
reflection.json.

(Beat-by-beat trace preserved in the session log of the run report; the
critical beats are B15/B24 [MISTAKE shares], B26-28 [nudge recovery], B31
[guarantee caught], B38-65 [the four red checks and three unanswerable
"which sentence?" asks], B49/B65 [resets], B71-73 [clean pass].)
