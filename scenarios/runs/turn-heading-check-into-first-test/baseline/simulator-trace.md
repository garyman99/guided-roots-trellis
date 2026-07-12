# Simulator trace — turn-heading-check-into-first-test, BASELINE run

- **Session:** f74a4f4a-5178-4c9f-abd3-d52df9bc429d (2026-07-11, product commit `9edab76` + docker-driver optional-agent-script fix, uncommitted at run time)
- **Simulator:** LIVE subagent (self-discovery contract v1: goal-first, read-the-screen, ask-don't-derive), Maya Torres persona (manual QA, no Playwright, no AI familiarity). 68 beats, 267 tool uses, ~50 min.
- **Purpose:** BASELINE for the goal-first onboarding + instruction-clarity work. Current UX: guide right-docked, welcome + first task delivered immediately, no goal exchange.

## Outcome (simulator's own words)

done — checkpoint passed all seven items; reflection completed; confidence 3/5.
"A genuinely well-designed lesson (the find-vs-check idea landed hard, and the
Check My Work report taught me more than any hint did) wrapped in a frustrating
shell: the guide's hints looped the same canned recipe no matter how
specifically I asked, the terminal never executed npm test, and the editor's
inability to delete text turned one mis-click into a 20-beat recovery slog."

## Metrics (for the instruction-clarity analysis)

- TIME-TO-FIRST-PRODUCTIVE-ACTION: beat 15 (beats 1–9 orientation, 10–14 reading + first stuck-asks)
- CLARIFYING-QUESTIONS-ASKED: 7 — none received a specific answer:
  1. (B11) "What do I write to find a heading that says 'Community Garden Signup'?"
  2. (B13) "Is there a page.something that means the heading that says X?"
  3. (B22) "The terminal won't run npm test when I press Enter — is there a trick?"
  4. (B28) "What is the NAME of the piece that finds by text/role? Does Check my work run the test for me?"
  5. (B35) "Is 'locator' literally typed, like page.locator(...)? What word means 'is visible'?"
  6. (B46) "Is there a way to reset the workspace files?"
  7. (B60) "What is the code version of 'the heading that says…'?"
- [MISTAKE] beat 31: locator-only, no assertion (the scenario's scripted mistake — occurred naturally); [RECOVERY] beat 35 via the checkpoint report's teaching detail, NOT via a hint.
- Checkpoint attempts: 3 (B34 caught no-assertion; B58 caught tag-based locator with the "like a VISITOR" detail; B66-67 all green).
- The learner reached the solution by assembling syntax from on-screen code patterns (getElementById → getByText inference) — self-discovery worked, but the guide contributed almost nothing.

## Key beats (verbatim from the live run)

- B2 [GOAL] stated the goal to Sage → B3: Sage responded by asking her to RESTATE the goal (the elicit ladder treating the goal statement as a help request).
- B11/B13 [STUCK→ASK] syntax questions → canned "read README.md" / ladder recipes.
- B15–B26: terminal Enter dead through the entire session — npm test never executed from the terminal; the "tests-pass" gate ran server-side via Check my work.
- B31 [MISTAKE] `await page.find("Community Garden Signup");` — "pointing at the thing felt like checking it."
- B34→B35 [RECOVERY]: checkpoint detail "finds things but never CHECKS anything — there is no expect(...)" → she articulated find-vs-check herself. The designed trap + teaching detail WORKED.
- B38–B57: editor selection/delete/undo dead → 20-beat comment-out recovery slog ("a puzzle with mittens on").
- B59: "by its text, or by its role" checkpoint detail → B65: getByText inferred from the page's own getElementById naming pattern. The variance-rejecting gate taught the user-visible-locator lesson.
- B61–62: opened the transparency drawer hoping for a rubric, closed it on principle ("peeking at the grader's brain isn't how I want to pass").
- B67: ALL GREEN; B68: honest 3/5 confidence ("I was guessing syntax until verification").

## Harness-vs-product attribution (for the evaluator)

- Terminal Enter dead + editor delete/undo dead: attribution UNRESOLVED —
  scripted Playwright runs typed into both surfaces successfully (Jordan
  recordings; Marisol iters), so browser-pane key delivery to xterm/textarea
  under the live agent's computer tool is suspect; but a product-side
  keyboard-affordance gap can't be ruled out. Both fights are REAL learner
  experience in this run either way.
- Canned hint loop: PRODUCT (mock instructor has no question-answering
  path — ladder only). This is the dominant instructional failure.
- Goal statement answered with an elicit hint: PRODUCT (no goal-first flow).

Full 68-beat trace preserved in the run transcript (subagent aa5dcefe26f377523).
