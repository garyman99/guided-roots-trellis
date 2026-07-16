# Your first Selenium test

Welcome — this is your first time driving a browser with **Selenium**. No
experience needed. By the end you'll have watched Selenium open a real browser,
read a heading off the page, and you'll have written the one line Selenium never
writes for you: the **check**.

Everything here is local and disposable. Nothing you do can break anything real.

## The one idea to take away

A Selenium test is **three moves**, in order:

1. **Open** — Selenium opens a real browser and goes to the page.
2. **Find & read** — Selenium finds an element and reads something off it
   (here: the page's heading text).
3. **Check** — *you* decide whether what was read is what you expected.

Selenium will happily open the page and read the heading for you. It will **not**
tell you whether the heading is correct — that judgment is yours. Reading and
checking are two different jobs, and move 3 is the one you write.

## What's in this workspace

- `app/index.html` — the signup page under test. Look at it in the **Garden
  Site** window, exactly like a visitor. **Don't change the page** — we're
  testing it, not editing it.
- `tests/first.test.ts` — your Selenium test. Moves 1 and 2 are written for
  you; move 3 is an empty spot waiting for your one line.
- `npm test` — runs the test in a real (invisible) browser and prints what it
  found, then `PASS` or `FAIL`.

## Move 3 — the line you write (vocabulary, not the answer)

Move 2 already put the heading's text into a variable called `headingText`.
Your line checks that variable against the heading you expected to see. You
don't have to guess the spelling — here are the pieces:

- `assert.equal(actual, expected)` — "these two should be equal"
- The value you read: `headingText`
- The heading a visitor sees on this page: **Community Garden Signup**

So your one line reads out loud as: *"assert that `headingText` equals the
heading I expected."* Put it where the comment says **MOVE 3**, then save.

A check that compares a value to itself (`assert.equal(headingText, headingText)`)
or asserts something always-true proves nothing — the point is to compare what
the page showed against what you *expected*.

## When you're ready

Edit `tests/first.test.ts`, save (Ctrl+S), and run `npm test` in the terminal.
`PASS` means Selenium opened the page, read the heading, and your check held.
Then use **"Check my work"** in the Trellis Guide — it verifies your check is
real (it catches empty and self-referential checks, don't worry).
