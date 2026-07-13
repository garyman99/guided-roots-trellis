# Simulator trace — run-one-existing-test-on-purpose · iter-1 (LIVE, recorded)

Persona: **Renee Park**, manual QA engineer beginning Playwright, low technical
confidence, no AI familiarity. Recorded live run against the real web UI
(`http://localhost:5173/?lab=run-one-existing-test-on-purpose`, docker driver,
session `3e744ea8-51e2-4ef0-a800-51c74e1888b2`). Video:
`scenarios/recordings/20260711T233636-0600/run-one-existing-test-on-purpose/iter-1/run.webm`.

> Note: the live run was interrupted once by a transient API error at BEAT 16
> and resumed from the same session (progress intact). The session state,
> event log, and checkpoint result are the authoritative evidence; the trace
> below is the simulator's own account, stitched across the resume.

OUTCOME: **done**. "It felt genuinely nerve-wracking at first — the terminal is
not my comfort zone, and the most obvious instruction (`npm test`) is exactly
the trap: it went green with '3 passed' and I very nearly walked away thinking
I'd succeeded. The confidence came from a small, transferable habit: don't trust
the color, read the numbers and the title. Once my focused run said '1 test' and
printed 'Weekday pickup hours are shown,' I actually believed the result was
mine, and the checkpoint confirmed it — that's the part I'll carry into real work
with any test runner."

TIME-TO-FIRST-PRODUCTIVE-ACTION: BEAT 8 (first real run — typing `npm test` into
the terminal; beats 1–7 were orientation).

CLARIFYING-QUESTIONS-ASKED: 1
- BEAT 2 (to Sage, up front): "I have one test case named 'Weekday pickup hours
  are shown' — I just want to run that one and confirm it passes, not the whole
  set. Where do I start?"
- (No mid-task [STUCK→ASK] was needed — the README's "Running all of them vs.
  running one" section answered the scope question directly.)

## Full ordered BEAT trace
- BEAT 1 | Windows-style desktop with Code Studio, Trellis Guide, Garden Site icons; Sage asks what I'm here to do | I should tell Sage my goal in plain words before I open anything.
- [GOAL] BEAT 2 | Chat box focused; I'll state what I came to do | I want to be clear with Sage up front so she can guide me.
- BEAT 3 | Sent my goal to Sage; now I'll read her reply | I want to see how she suggests I begin.
- BEAT 4 | Sage says to get my bearings: open Code Studio, read README.md, find the named test; she notes `npm test` runs all three and the README shows how to run just one | I'll follow the guided steps and open Code Studio first.
- BEAT 5 | Code Studio open; file explorer shows README.md, tests/pickup.spec.js, and a terminal below | I read instructions before touching the terminal, so I'll open README.md first.
- BEAT 6 | README is thorough: `npm test` runs all three ("3 tests ran"); focused form is `npm test -- "Weekday pickup hours are shown"` ("1 test ran") | Sage told me to open the spec and find my test, so I'll open tests/pickup.spec.js next.
- BEAT 7 | Found my test at the top of pickup.spec.js: `test("Weekday pickup hours are shown", ...)` — first of three, all passing | That's the one from my checklist; now I'll run the tests.
- [MISTAKE] BEAT 8 | Terminal has the keyboard; the big instruction is to run the tests, so I'll type `npm test` | This is the most obvious run command, so I'll start there to make sure everything passes.
- BEAT 9 | Pressed Enter on `npm test`; tests run in an invisible browser | I'll wait a beat, then read the output.
- BEAT 10 | Green checkmarks — "3 passed (926ms)". First reaction: relief, I'm done | It all passed, so at a glance I feel finished.
- BEAT 11 | Reading again: "Running 3 tests using 1 worker" and "3 passed" — this ran all THREE, not just my one | I was asked to run just my one test on purpose; the whole suite ran — that's not my task.
- [RECOVERY] BEAT 12 | README's "Running all of them vs. running one" covers this: add `--` and the quoted test name — `npm test -- "Weekday pickup hours are shown"` | I'll run the focused command so only my named test runs.
- BEAT 13 | Focused command typed correctly with quotes around the full name | I'll press Enter and watch for "1 test ran".
- BEAT 14 | Now it reads "Running 1 test using 1 worker", "✓ Weekday pickup hours are shown (133ms)", "1 passed (684ms)" | Count says 1 (not 3) and the printed title is exactly my test — this result is really mine.
- BEAT 15 | Clicked "Check my work" but the guide's newest messages may be behind Code Studio | Sage said to click the Trellis Guide taskbar button if her chat is hidden — I'll bring it to the front.
- BEAT 16 | (connection dropped and resumed) Snapshot confirms Sage's chat is in front: I can see "Check my work", my focused run in the terminal, and three green "Saw that — nicely done ✓" notes | Good, the guide is reachable; before checking I'll re-read my result.
- BEAT 17 | Re-reading the focused result: "Running 1 test using 1 worker" (one, not three), single "✓ Weekday pickup hours are shown", "1 passed (684ms)" | Both checks hold — count is 1 and the title is exactly my test — so I'll click "Check my work."
- BEAT 18 | Checkpoint all green: "Everything checks out — that's a pass! 🎉" — verified I ran the runner, my LAST run was ONE test (not the whole suite), it was "Weekday pickup hours are shown", it passed, and tests + page were unchanged | Relief — it confirmed the result was genuinely mine.
- BEAT 19 | Rated my confidence a 4 | I got there and verified properly, but the early scope slip keeps me from a full 5.
- BEAT 20 | Honest sentence sent; Sage replied "That's the whole loop — and it's verified, so take the credit... you're all set here" | I'm confident I'm actually done — one named test ran and passed, nothing changed. Closing out.
