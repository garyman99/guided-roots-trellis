# Community Garden — read one failing check

You already write "expected" and "actual" in your manual defect reports. An
automated test says the same two things — you just have to know where to look.
This workspace has ONE test that is **failing on purpose**. Your job is to run
it and write down what it tells you. **You do not fix anything today.**

## What's in this workspace

- `app/index.html` — the garden status page. Open it in the Garden Site window
  to see it like a visitor. **Don't change it** — we're reading a test, not
  editing the page.
- `tests/status.spec.js` — the prepared check. It expects the page to say one
  thing; the page says another, so the check fails. **Don't change it either.**
- `EVIDENCE.md` — your note. Four blank facts to fill in from the result.
- `npm test` — runs the check in a real (invisible) browser and prints what it
  found.

## Your task

1. Run `npm test` in the terminal and let it finish.
2. Read the result **all the way down** — the red summary at the top only says
   *that* it failed; the four useful facts are lower down.
3. Fill in `EVIDENCE.md` with what you read:
   - **Test** — the name the runner prints for the failed check.
   - **Location** — the file-and-line the result points to (looks like
     `tests/status.spec.js:20`). If two line numbers show up, use the one the
     code-frame arrow (`>`) points at — that's the line where the check failed.
   - **Expected** — the text the test said should be there.
   - **Received** — the text the page actually showed.
4. Use "Check my work" in the Trellis Guide when the note is filled in.

## The one idea to take away

A failing test is **evidence**, not a verdict. Before you touch anything, read
the two values it hands you:

- **Expected** = what the *test* claimed should be true.
- **Received** = what the *page* actually did.

Those are the same two columns you already fill in by hand. Keep them the right
way round and you can read any failure — no stack-trace knowledge needed.

There is no AI in this exercise. Reading the result is a skill you carry to
every test you'll ever run.
