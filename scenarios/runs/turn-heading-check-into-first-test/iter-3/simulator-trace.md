# Simulator trace — turn-heading-check-into-first-test, iter-3 (instrumented rerun)

- **Session:** 298adef8-9b74-4ddb-b62d-4684f3a2a3aa (2026-07-12, run branch @ 6a3a6c3)
- **Simulator:** LIVE subagent, IDENTICAL contract and persona prompt as
  baseline/improved (self-discovery v1, Maya Torres) plus the new actuation
  note (terminal Enter typed as newline — see key-delivery-probe.md).
  28 beats, 69 tool uses, ~10.5 min.
- **Changes under test:** taskbar front-not-minimize + DOM focus, terminal
  input-compat shim, digest drain fix, intervention.delivered, multi-key
  concept observations, run-task fallback sentence, orient window note.
- **Evaluation:** folded into iter-4's report (same convention as
  improve-delayed-order-reply iter-3): this run surfaced ONE remaining
  product defect — the FAQ matcher answered Maya's mid-session recovery
  statement (msg 3) with the locator recipe (msg 4). Fixed immediately
  after this run (mock.ts interrogative/problem-report gate + acknowledge
  strategy, with unit tests) and re-run as iter-4.

## Headline measurements

| Metric | baseline | improved | iter-3 |
|---|---:|---:|---:|
| Beats to completion | 68 | 46 | **28** |
| Wall clock | ~50 min | ~20 min | **~10.5 min** |
| TTFPA | beat 15 | beat 5 | beat 11 (did the manual check first — persona-faithful) |
| Clarifying questions | 7 (0 answered) | 2 (2 answered) | **0 needed** |
| Checkpoint attempts | 3 | 1 (post-coaching) | 1 (post-recovery) |
| Terminal `npm test` executions | 0 (dead Enter) | 0 (dead Enter) | **2 (shim works)** |
| Taskbar fronting used | n/a (minimized) | n/a (fought z-order) | **3× clean** |
| Profile concept after | unknown | unknown | **emerging (0.5)** |
| Digest testsRun | — | 0 (untruthful) | **4 (truthful)** |
| Confidence | 3/5 | 4/5 | 4/5 |

## What the live run proved (fixes verified under real use)

1. **Terminal executes.** `npm test` ran from the terminal twice (B13, B24)
   through the input-compat shim — first live run in four where the
   terminal worked at all.
2. **Taskbar fronts covered windows** (B14, B16, B25) — zero z-order beats
   lost, no chat text in the terminal (baseline/improved lost ~6 beats).
3. **Digest truthful:** testsRun 4, concept observation recorded, profile
   moved unknown → emerging, reflection names the actual concept
   ("playwright.locators-and-assertions: unknown → emerging"), no diff
   advice in an authoring lab, "Verified with the test suite instead of
   assuming" habit recorded.
4. **The designed trap survived every scaffold**: Maya still wrote
   finder-only first (B11), still believed green meant done (B14), and the
   Check-my-work explanation ("finds things but never CHECKS anything")
   produced the find-vs-check articulation (B15).
5. **Editing fumble contained** (B18–B22): select-retype landed mid-line,
   learner recovered by reading the file and retyping; final artifact
   pristine.

## Residual defect found (fixed post-run, verified in iter-4)

- **msg 3 → msg 4:** Maya's recovery statement ("Oh, I get it now — finding
  and checking are separate jobs…") matched the locator FAQ regex and got
  the recipe she'd just outgrown. The earlier post-completion fix didn't
  cover mid-session statements. Fix: FAQ now requires interrogative intent
  or a problem-report; statements get a listening acknowledgment
  (strategy "acknowledge"). Closing feedback (msg 5 → 6) was handled
  correctly by the post-completion branch.

## Evidence files

session-export.json (25 events), final-state.json (transcript, tasks all
done), final-artifact.json (clean one-line check), profile-after.json
(emerging, digest inside evidence), reflection.json, key-delivery-probe.md.

## Full beat trace

(28 beats, OUTCOME: done, TTFPA 11, 0 clarifying questions — preserved
verbatim from the simulator's final message)

BEAT 1 [GOAL] | I see the Trellis desktop with a "Trellis Guide" chat window asking what I'm here to do, so I'm typing my goal into the message box | I want to tell Sage in my own words that I check the garden signup page's heading by hand and today I want to turn that into an automated test I write myself.
BEAT 2 | Sage has replied with several messages but they're cut off in my view, so I'm reading the full chat text before doing anything | I always read the whole instruction before I start a check — that's just good QA habit.
BEAT 3 | Sage says to open Code Studio and read README.md, and optionally look at Garden Site like a visitor first — I'm double-clicking the Garden Site desktop icon | Before I automate anything I want to do my manual check once the way I always do: open the page and see the heading with my own eyes.
BEAT 4 | A "Garden Site" window opened showing a local preview of garden-site/app/index.html, but the text extract doesn't show the page content — I'm taking a screenshot to see it | I need to actually see the heading, that's the whole point of my manual check.
BEAT 5 | The Garden Site shows the "Community Garden Signup" heading, a name field, plot size, and Sign up button — my manual check passes by eye, so now I'm double-clicking Code Studio to read README.md like Sage said | Seeing the heading myself first means I know exactly what the automated version has to prove.
BEAT 6 | Code Studio is open with a file list — I can see README.md, tests/heading.spec.js, and a terminal — I'm clicking README.md to read it | Sage said the README has my manual check written down plus a "words you'll need" list, and I always read the prepared check before touching anything.
BEAT 7 | I've read the README: my manual check is written down, the test file is tests/heading.spec.js with one empty test body, and there's a vocabulary list (getByText, getByRole for finding; await expect(...).toBeVisible() for checking) — now I'm opening tests/heading.spec.js to read it | I never edit anything before I've read what's already there; the README says opening the page is already written for me.
BEAT 8 | heading.spec.js opened but the Code Studio window is tiny and I can only see a sliver of the code — I'm clicking the window's Maximize button | I can't read the test file at this size, and I need to read every line before I edit.
BEAT 9 | The window is maximized and I can read the top comments of heading.spec.js — it says step 1 (open the page) is prepared and my job is step 2 inside the test body — I'm scrolling down in the editor to read the rest of the file | I want to see the empty test body and any hints before I type anything.
BEAT 10 | Now I can read the whole test file: page.goto is done for me in beforeEach, and there's a test "the page shows the Community Garden Signup heading" with an empty body marked "// step 2: your check goes here" — I'm clicking at the end of that comment line to put my cursor there | That comment is exactly where the README said my check goes, so that's where I'll type.
BEAT 11 [MISTAKE] | Cursor is at the end of the "your check goes here" comment — I'm typing my check: a line that finds the heading using page.getByRole from the README's vocabulary list | In my manual check I look for the heading and there it is — so if the test goes and finds the "Community Garden Signup" heading, that IS the check as far as I can tell.
BEAT 12 | My new line is in the test body and the tab shows unsaved changes — I'm pressing Ctrl+S to save | The Code Studio note said the dot on the tab disappears when the change is saved.
BEAT 13 | File saved — now I'm clicking into the terminal at the bottom and running npm test like the README told me | The README says npm test runs my check in a real invisible browser and prints what it found; green means it held.
BEAT 14 | The terminal shows green: "1 passed (817ms)" — my test ran and passed, so I believe I'm done and I'm bringing the Trellis Guide window forward via its taskbar button to use "Check my work" | Green means my check ran, and the README says to have the guide verify it's real when I'm ready.
BEAT 15 [RECOVERY] | The "Check my work" result says everything passes EXCEPT "States the expectation" — it says my check finds things but never CHECKS anything, and passes without proving anything — I'm telling Sage what I just understood before fixing it | That lands for me: in my manual work, spotting the heading and confirming it's actually showing are two separate jobs, and my test only did the first one.
BEAT 16 | Message sent to Sage — now I'm bringing Code Studio forward via its taskbar button to complete the assertion myself | The fix is mine to make: I'll turn my finder into a full check using the exact expect wording from the README.
BEAT 17 | Code Studio is forward and I can see my locator line — I'm clicking on it, selecting the whole line with Home then Shift+End, and retyping it with the expectation wrapped around my finder | The README's finished-check sentence is `await expect(` my finder `).toBeVisible();` — I'm putting my finder inside that.
BEAT 18 [MISTAKE] | Looking at the editor after typing, the line looks mangled — I can see leftover "{ nam" in front of my new await expect(...) text, so my retype landed mid-line instead of replacing the whole thing | I fumbled the select-then-retype; I'll select the entire line properly this time by triple-clicking it and type it fresh.
BEAT 19 | I can't tell from the screen whether my triple-click selected the line — I'm zooming in on the editor line to look closely before typing anything | I don't want to make the mess worse by typing blind.
BEAT 20 | The mangled line is still there — before fixing I'm reading the file text through the editor pane to see exactly what the line says now | I want to know precisely what characters are on that line so I can retype the whole thing correctly.
BEAT 21 | The file text confirms my new code got inserted into the middle of the old line, splitting "name" in two — the whole line is one broken jumble; I triple-clicked it to select the full line, so now I'm typing the clean replacement over it | One correct sentence of code should replace all of that mess at once.
BEAT 22 | My clean line replaced the jumble, but the selection also swallowed the line break, so the test's closing "});" is now glued to the end of my line — I'm triple-clicking the line once more and retyping it as two lines to put the closing bracket back on its own line | I want the file as tidy as the one I was given; a cramped line is how mistakes hide.
BEAT 23 [RECOVERY] | The file now reads exactly right — find the heading, then state it should be visible, with the closing bracket back on its own line — I'm pressing Ctrl+S to save | Now the check has both jobs: my finder AND the expectation.
BEAT 24 | Saved — I'm clicking into the terminal and running npm test again to see the check hold with the expectation in place | I rerun after every fix; a green run with the expect line in is what I've been aiming for.
BEAT 25 | Green again — "1 passed (813ms)" — and this time the file has both the finder and the expectation, so I'm bringing the Trellis Guide forward and clicking "Check my work" | Now I can point at the line that finds the heading and the part that states the expectation, which is what Sage said "done" means.
BEAT 26 | Everything checks out — the guide says pass on all seven items, my Playwright skill record moved to "emerging", and there's a reflection asking how confident I was that my fix was right on a 1–5 scale — I'm finding the rating buttons to answer honestly | I'll answer truthfully: I understood the fix, but I fumbled the editing twice on the way, so I'm not a 5.
BEAT 27 | The reflection has buttons 1–5 for how confident I was that my fix was right — I'm clicking 4 | I was sure about the idea (find, then check) once the feedback explained it and the green rerun confirmed it, but I'm not claiming a 5 after passing a test that proved nothing on my first try.
BEAT 28 | The reflection was recorded — now I'm sending Sage one honest sentence about how this session felt, which is how I want to end | The guide confirmed my work is complete, so it's time to close out in my own words.

OUTCOME: done — "the scariest part wasn't Playwright, it was discovering my
first 'green' run had proven nothing… the friction was mostly mechanical."
TIME-TO-FIRST-PRODUCTIVE-ACTION: 11
CLARIFYING-QUESTIONS-ASKED: 0
