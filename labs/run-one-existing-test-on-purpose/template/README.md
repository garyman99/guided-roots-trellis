# Riverside Community Pickup — run one test on purpose

You already run manual test cases one at a time from a checklist. Automated
tests work the same way: there's a list of them, and you can run the whole list
or just the one you care about. Today you run **one** on purpose and confirm the
result belongs to the test you chose. **You don't change any files, and there is
no AI in this exercise.**

## What's in this workspace

- `app/index.html` — the pickup page. Open it in the Garden Site window to see it
  like a visitor. **Don't change it.**
- `tests/pickup.spec.js` — three prepared checks, all passing. Their names are:
  - `Weekday pickup hours are shown`  ← the one you'll run today
  - `Drop-off point is listed`
  - `Contact email is visible`
- `npm test` — runs the checks in a real (invisible) browser and prints what it
  found.

## The terminal, in one sentence

The terminal is the dark text box at the bottom of Code Studio. It's just where
you type a run instruction to this local practice project — it can't reach the
internet or anything real. Click once inside it so it has the keyboard, type a
command, and press Enter.

## Running all of them vs. running one

- **All three:** type `npm test` and press Enter. You'll see a summary that
  **3 tests ran**. That proves the suite is green — but it is *not* "run one test
  on purpose."
- **Just one:** add `--` and the test's name in quotes:

  ```
  npm test -- "Weekday pickup hours are shown"
  ```

  The `--` just means "the rest is the test name." Now the runner filters to that
  one title and you'll see **1 test ran** — and it names the test you chose.

You can copy part of the name if you like (`npm test -- Weekday` works too),
as long as it points at just the one test.

## Your task

1. Open `tests/pickup.spec.js` and find the test named
   `Weekday pickup hours are shown`.
2. Run **only that test** with the focused command above.
3. Read the result: it should say **1 test ran** (not 3) and show the title you
   chose, passing.
4. Use "Check my work" in the Trellis Guide.

## The one idea to take away

Running the **whole suite** and running **one named test** are different actions.
A green summary for three tests doesn't tell you that *your* test ran — the
number of tests and the title in the result do. Focus a run by its visible name,
then read the result to confirm it's the test you meant. That skill moves to any
test runner you'll ever use. There is no AI here — choosing and reading the run
is yours.
