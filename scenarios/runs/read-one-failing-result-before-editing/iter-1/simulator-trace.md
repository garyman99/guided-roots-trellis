# Simulator trace — read-one-failing-result-before-editing / iter-1

- Run: 20260712T113600-0600 · Scenario: read-one-failing-result-before-editing
- Persona: Tessa Morgan (manual QA engineer, low technical confidence, no AI familiarity)
- Driver: recorded live run (Playwright recorder CLI, port 8799) against the real web UI
  (`http://localhost:5173/?lab=read-one-failing-result-before-editing`, api driver=docker)
- Session: a0416bd1-38c0-4a31-9a82-45e4a499694b · Learner: learner-e7f7c22881d1
- Recording: scenarios/recordings/20260712T113600-0600/read-one-failing-result-before-editing/iter-1/run.webm (git-ignored)

---

OUTCOME: done — The checkpoint passed with all eight verifications green (ran the test; note names the failed test, the file-and-line, the Expected, and the Received; test and page left unchanged; workspace valid). It felt genuinely like reading one of my own manual defect reports once I got past the red line. The friction was real: my eye locked onto the big red "failed" and I first wrote that as Received with Expected blank, and separately the chat box kept sitting behind the Code Studio window so my questions landed in the terminal until I raised the Trellis Guide window. The thing that transfers to my real work: the top red line is only a headline; the actual evidence is the Expected/Received pair lower down, and that's the same expected-vs-actual I already fill in by hand.

TIME-TO-FIRST-PRODUCTIVE-ACTION: BEAT 5 (running `npm test`)

CLARIFYING-QUESTIONS-ASKED: 1
- "I wrote failed in Received because the red line says the check failed. Is failed right for Received, or should it be text from the page? And where in the output is the Expected value?" (Sage replied that the red line is just the headline and to read down for the paired Expected/Received.)

Friction noted:
- Terminal focus trap: the Code Studio window covered the Sage chat box, so clicking at the chat coordinates and typing went into the terminal instead. Took three tries and raising the Trellis Guide window via its taskbar button before my message actually reached Sage. Left a few stray typed lines at the shell prompt (cleared with Ctrl+C, none executed).
- The Location field was genuinely ambiguous — the summary header says `:21:1` (test declaration) while the code-frame arrow and `at .../status.spec.js:22:49` point to line 22 (the failing assertion). I used `tests/status.spec.js:22` and it was accepted.

BEATS:
- BEAT 1 [GOAL] | Sage asks what I'm here to do | Stated my task plainly: run the one prepared status test and record the four facts, reading only, no edits.
- BEAT 2 | Sage says open Code Studio and read README.md | Double-clicked Code Studio to get my bearings.
- BEAT 3 | File list shows README.md | Opened it since Sage said it explains the workspace and my four facts.
- BEAT 4 | README offers a visitor view in Garden Site | Opened Garden Site to see what the page actually shows.
- BEAT 5 | Garden Site shows "Plot requests are open"; README says run `npm test` | Ran the prepared test in the terminal.
- BEAT 6 | Terminal shows "1 failed › garden status banner" and a code frame | Scrolled the terminal up to read the result from the top.
- BEAT 7 | Red line names the failed "garden status banner" check | Opened EVIDENCE.md to record the result; my eye went to the red "failed".
- BEAT 8 [MISTAKE] | Note wants Test/Location/Expected/Received | Wrote the name and location but put "failed" as Received and left Expected blank — the big word I saw.
- BEAT 9 | Note has blank Expected and "failed" Received | Saved with Ctrl+S.
- BEAT 10 [STUCK→ASK] | Unsure "failed" is right and Expected is blank | Tried to ask Sage rather than guess.
- BEAT 11 | My question landed in the terminal, not the chat | Cleared the stray terminal line, tried the chat again.
- BEAT 12 | Typing still hitting the terminal | Tried focusing the Trellis Guide by its title bar, then the chat box.
- BEAT 13 | Realized the chat window was behind Code Studio | Cleared the terminal and raised Trellis Guide via its taskbar button.
- BEAT 14 [STUCK→ASK] | Chat box finally on top and focused | Asked whether "failed" belongs in Received and where Expected is; Sage replied that the red line is just the headline — read down for the paired Expected/Received.
- BEAT 15 [RECOVERY] | Sage says keep reading down for the pair | Re-ran the test to get a clean result and read it carefully.
- BEAT 16 [RECOVERY] | Terminal shows Expected "Plot requests are closed" and Received "Plot requests are open", paired | Rewrote the note with the real text, right way round (Expected = test claim, Received = page value).
- BEAT 17 | Note complete and saved | Raised Trellis Guide and pressed "Check my work".
- BEAT 18 | Result: pass, all eight checks green; reflection asks confidence | Rated confidence 4 — shaky at first, solid once I found the pair.
- BEAT 19 | Everything passed | Told Sage honestly how it felt: the red line nearly fooled me, but the Expected/Received pair made it click as the same expected-vs-actual I do by hand.
