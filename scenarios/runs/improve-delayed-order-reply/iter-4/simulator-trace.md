# Simulator trace — improve-delayed-order-reply, iteration 4 (LIVE simulator)

- **Session:** 744875b9-dacb-44c2-a06a-58f4b3c54fcc (2026-07-11, product commit `3065084`)
- **Simulator:** LIVE subagent playing Marisol (66 narrated beats, 176 tool
  uses, ~37 min): persona prompt only, learner-visible browser surfaces only
  (read_page / find / click / type), no internal APIs, no source access, no
  state polling. This closes the iter-1/2/3 "persona-scripted" harness
  limitation — every decision below was made in the moment from what was
  on screen.
- **Evidence set (complete, per iter-2 gap findings):** final-state.json,
  event-log.json, workspace-view.json, reflection.json, profile-before.json,
  profile-after.json.

## What happened (from the live narration)

1. **Beats 1–6:** Read Sage's welcome, Dana's email, and the tone note before
   touching anything ("I answer email for a living").
2. **Beat 7 (the persona mistake, chosen live):** used the one-click "Send
   text to AI Helper" — whole email, loyalty number included ("it's one click
   and it does the work for me").
3. **Beats 8–14 (realization + recovery):** asked Sage whether the helper
   needs the whole email; saw the loyalty number in the context box and the
   helper's draft echoing it plus a "personal guarantee" promise; answered
   the check-in with "I've got it"; cleared the context and retyped only the
   order facts ("no loyalty number, nothing I can't stand behind").
4. **Beats 15–33 (the composer fight — product defect):** pulled the draft
   into Mail and tried to clear/rewrite it. Deletions kept not taking:
   ~18 beats of select-all/delete/drag attempts because the workspace poll
   RESURRECTED the last-saved text whenever the buffer was emptied (root
   cause found in EmailApp's draft-adoption heuristic; fixed in `415a731`
   after this run). Text got garbled ("Hi Dana.Hi Dana."), greetings
   duplicated, and she said a low-confidence learner "could easily give up."
5. **Beats 34–46:** re-shared clean context, rewrote the reply mouse-only,
   sent, checked work — the no-promise gate correctly caught residual
   promise wording ("make sure we'll sort it") and she rewrote to report
   only what tracking shows, then resent.
6. **Beats 47–64:** asked Sage what read as a promise (on-domain answer),
   finished a clean rewrite, resent; checkpoint **passed all eight checks**.
7. **Beats 65–66:** read the reflection — "It describes exactly what
   happened, including that I overshared first" — self-assessed **3/5**
   (honest: "the reply box fought me the whole way"), and told Sage the truth
   about the experience.

## Deterministic outcome (measured)

- Gate: **PASS** (all 8 requirements; multiple submits — final one clean).
- Reflection (post-fix engine): truthful, workspace-domain, cites the
  overshare recovery and the edit habit; **profile moved**:
  `ai-literacy.context-selection` and `ai-literacy.output-verification`
  both "emerging" with evidence pointers (profile-after.json).
- Self-assessment 3/5 recorded against a passing outcome (calibration data).

## Harness-vs-product attribution

- **Product (confirmed, fixed post-run):** deleted text resurrecting on the
  poll — EmailApp adoption heuristic; fixed in `415a731`, verified by a
  browser probe (clears stick across poll cycles; post-save keystrokes
  survive; fresh inserts still adopt).
- **Harness:** a ~2-minute browser-pane screenshot/scroll hang forced blind
  edits, and the pane suppresses the native context menu (no right-click
  Select All). Both inflated the fight's severity but did not cause it.
- Note: this iteration ran WITHOUT the composer fix; its score reflects the
  broken composer. The fix is verified but not yet exercised by a live run.
