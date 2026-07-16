# Getting started with Selenium — tour the bench

Brand new to Selenium? Start here. This first lesson has **nothing to write and
nothing to run against a grade** — it's a look around. By the end you'll know
what Selenium is and where everything lives, so the next lessons feel familiar.

## What Selenium is (the short version)

**Selenium drives a real web browser from code.** Instead of a person clicking
through a site by hand, you write instructions — open this page, find that
button, read this text, click here — and Selenium carries them out in an actual
browser (Chrome, Firefox, and others). It's one of the oldest and most widely
used tools for **end-to-end testing**: checking that a whole site behaves the
way a real visitor would experience it.

Two ideas worth holding onto:

- **A browser you control from code.** Everything a visitor can do, Selenium can
  do — but written down, repeatable, and fast.
- **It reads; you decide.** Selenium will happily open a page and read text off
  it. Whether that text is *correct* is a judgment you make with a check. (That's
  the line you'll write yourself once you reach the Foundations course.)

## The bench you're touring

Run `npm run tour` in the terminal to print this same map, annotated:

- `app/index.html` — the web page under test. Open it in the **Garden Site**
  window to see it exactly like a visitor.
- `tests/first.test.ts` — a complete, passing Selenium test. Read it to see the
  three moves every Selenium test makes: **open** a browser, **find & read** an
  element, **check** what it read. You'll run this one next lesson.
- `scripts/test.mjs` — what `npm test` runs: it drives the test in a real
  (invisible) browser and reports pass or fail.
- `scripts/tour.mjs` — the tour you just ran.
- `package.json` — the project's scripts and its Selenium dependencies.
- `tsconfig.json` — TypeScript settings so the editor understands the test.

## Your tour

1. Read this README.
2. Open **Garden Site** and look at the page a visitor sees.
3. Open **Code Studio** and read `tests/first.test.ts` — the three moves.
4. Run `npm run tour` in the terminal to connect the file names to their jobs.

That's it — no code, no grade to beat. When you've had a look around, use
**"Check my work"** to wrap up and move on to *Watch it run*.
