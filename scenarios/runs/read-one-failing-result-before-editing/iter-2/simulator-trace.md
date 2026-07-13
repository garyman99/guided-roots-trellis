# Simulator trace — read-one-failing-result-before-editing / iter-2

- Run: 20260712T113600-0600 · Scenario: read-one-failing-result-before-editing
- Persona: Tessa Morgan (manual QA engineer, low technical confidence, no AI familiarity)
- Driver: recorded live run (Playwright recorder CLI, port 8799) against the real web UI
  (`http://localhost:5173/?lab=read-one-failing-result-before-editing`, api driver=docker)
- Session: c73fcc36-60af-49e9-a0b8-23ed0a90480c · Learner: learner-e1be3667c3fc
- Recording: scenarios/recordings/20260712T113600-0600/read-one-failing-result-before-editing/iter-2/run.webm (git-ignored)
- Product delta vs iter-1: intervention guard (tests_not_run/diff_not_viewed silent after checkpoint), plus opening cues (read-past-the-red in the welcome + note header, reach-Sage-via-taskbar in the welcome, which-line-for-Location in README/note/FAQ).

---

**OUTCOME: done.** It felt approachable but I did stumble exactly where I expected to. The big red "failed" line grabbed my attention first and I nearly recorded that as the result while leaving Expected blank — that felt like my normal instinct. Re-reading the note's own reminder ("Expected is what the TEST asked for, Received is what the PAGE actually showed") and scrolling down to the paired `Expected:`/`Received:` lines is what rescued me, and after that it mapped cleanly onto the expected-vs-actual columns I already fill in by hand. My confidence landed at a 4: sure of the four facts once I found them, humbled that the headline almost fooled me. This transfers directly to real work — read past the summary to the paired values.

**TIME-TO-FIRST-PRODUCTIVE-ACTION: BEAT 6** (running `npm test` — the first real task work after orientation).

**CLARIFYING-QUESTIONS-ASKED: 0.** The chat welcome, the README, and the note's own header answered everything before I got stuck enough to ask.

**Friction hit:** The confidence 1-5 rating renders as clickable text, not tagged buttons, so I had to screenshot to locate it; and the chat did not auto-scroll to the newest messages, so I had to hunt for the right scroll target to reach the reflection. Neither blocked me. Taskbar toggling also briefly minimized the guide instead of fronting it once.

**Full BEAT trace:**
- BEAT 1 [GOAL] | Chat asks what I'm here to do | Stated my task: run the one prepared status test and record four facts, no code changes.
- BEAT 2 | Sage says open Code Studio and read README.md, read past the red | Getting my bearings before running anything.
- BEAT 3 | Code Studio file list shown | Opened README.md to learn the workspace and my four facts.
- BEAT 4 | README says I can view the page as a visitor | Opened Garden Site to see the real page.
- BEAT 5 | Garden Site hidden behind Code Studio | Clicked its taskbar button to bring it forward.
- BEAT 6 | Page shows "Plot requests are open" | Switched to Code Studio to run the check.
- BEAT 7 | Typed `npm test` and pressed Enter; test running ("garden status banner") | Let it finish before reading.
- BEAT 8 | "1 failed" + code frame `>` at line 22 | Scrolled up to read the whole result from the top.
- BEAT 9 | Result fully read | Opened EVIDENCE.md to see the four fields.
- BEAT 10 [MISTAKE] | Red "1 failed" was loudest | Filled Received: failed and left Expected blank.
- BEAT 11 [RECOVERY] | Terminal prints paired Expected "Plot requests are closed" / Received "Plot requests are open" | Corrected the note with the real values, right way round.
- BEAT 12 | Tab shows unsaved changes | Saved with Ctrl+S ("Saved EVIDENCE.md ✓").
- BEAT 13 | Note complete | Fronted the Trellis Guide and clicked "Check my work".
- BEAT 14 | All checks passed; reflection asks confidence | Prepared to answer honestly.
- BEAT 15 | 1-5 scale | Chose 4 — stumbled first, corrected, values were unambiguous, passed first try.
- BEAT 16 | Contract says close with one honest sentence | Told Sage the red line pulled my eye first but the paired values made it click.

Final note contents (saved, verified):
- Test: garden status banner
- Location: tests/status.spec.js:22
- Expected: Plot requests are closed
- Received: Plot requests are open
