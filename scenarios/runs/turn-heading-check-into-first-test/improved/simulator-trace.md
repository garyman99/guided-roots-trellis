# Simulator trace — turn-heading-check-into-first-test, IMPROVED run

- **Session:** c6793f45-3689-4c01-ae7d-54f90f5b78e0 (2026-07-12, product commit `dd0bff3` + single-flight boot fix, uncommitted at run time)
- **Simulator:** LIVE subagent, IDENTICAL contract and persona prompt as the
  baseline run (self-discovery, ask-don't-derive). 46 beats, 142 tool uses,
  ~20 min.
- **What changed since baseline (`9edab76`):** goal-first onboarding (only
  the centered guide at start; scenario context after the goal statement),
  authored FAQ answers, README "words you'll need" vocabulary box, welcome
  copy pointing at both, Reset chip, session single-flight boot.

## Baseline → improved (same persona, same contract)

| Metric | Baseline | Improved |
|---|---:|---:|
| Beats to completion | 68 | **46** |
| Wall clock | ~50 min | **~20 min** |
| Time-to-first-productive-action | beat 15 | **beat 5** |
| Clarifying questions asked | 7 | **2** |
| … of which usefully answered | 0 | **2** (FAQ: terminal + fallback) |
| Checkpoint attempts to pass | 3 | **1** (after the coached fix) |
| Recovery of the scripted mistake driven by | checkpoint report only | **Sage's find-vs-check coaching** (B36) |
| Self-assessed confidence | 3/5 | **4/5** |
| Syntax acquisition | inferred from page source after 5 unanswered asks | **read from the README vocabulary box** (B13 uses getByRole directly) |

## Outcome (simulator's own words)

done — "genuinely winnable but bumpy: the README's find-then-check framing
plus the vocabulary list was exactly enough scaffolding… the friction was
almost all machinery, not testing." Transfer: "I can now read a Playwright
test as finder + expectation, and I know a test with no assertion can go
green while proving nothing."

## Remaining friction (both runs, unresolved)

1. **Terminal Enter dead** (B21–B26, B33–34): `npm test` never executed from
   the terminal in EITHER live run; the FAQ's authored fallback ("Check my
   work also runs your test") converted this from a wall into a detour.
   Harness-vs-product attribution still unresolved (scripted Playwright
   typing works; live-agent key delivery to xterm doesn't).
2. **Window z-order / keyboard focus** (B24–B31, B42): her chat message
   twice landed in the terminal because the Guide was behind Code Studio;
   reaching a hidden window cost several beats. Product improvement worth
   considering: clicking a taskbar button of a covered-but-not-focused
   window should FRONT it rather than minimize.
3. Editor delete/backspace still unreliable under the live agent (B14–B19) —
   same attribution question as baseline; she recovered with select+retype.

## Key beats

- B1–B2 [GOAL]: only the centered guide on screen; stated her goal; context
  + first step arrived in response. No Socratic bounce.
- B5: reading README (first productive action). B6: vocabulary box read.
- B13 [MISTAKE]: finder-only line — written directly from the vocabulary box.
- B27→B36 [RECOVERY]: accepted check-in → find-vs-check coaching → "my
  manual checklists always have an expected-result column and my code had
  none" → fixed it herself (B39).
- B33: FAQ answer to the terminal question, including the fallback that
  kept the session moving.
- B44: checkpoint PASS on the first post-fix attempt. B45: confidence 4/5.
