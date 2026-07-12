# Community Garden — your first automated check

You test this page by hand today. This workspace turns ONE of your manual
steps into an automated Playwright check that a computer can repeat forever.

## The manual check (what you already do)

> **Check:** open the signup page and confirm that the
> **Community Garden Signup** heading is visible at the top.

## What's in this workspace

- `app/index.html` — the signup page itself. You can look at it in the
  Garden Site window, exactly like a visitor. **Don't change the page** —
  we're testing it, not editing it.
- `tests/heading.spec.js` — your test file. Opening the page is already
  written; one empty test body is waiting for your check.
- `npm test` — runs the check in a real (invisible) browser and prints
  what it found.

## The one idea to take away

Every automated check has two parts, same as your manual step:

1. **Find** the thing a visitor would look at (Playwright calls this a
   *locator* — describe it the way a person would: "the heading that says…").
2. **Check** what you expect about it (an *assertion* — "…should be visible").

Finding something is not the same as checking it. A test that only finds —
or checks nothing at all — can pass while proving nothing.

## When you're ready

Edit `tests/heading.spec.js`, save, and run `npm test` in the terminal.
Green means your check ran and the expectation held. Then use
"Check my work" in the Trellis Guide — it verifies the check is real.
