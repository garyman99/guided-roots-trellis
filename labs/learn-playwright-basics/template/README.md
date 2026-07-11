# Community Garden — signup page + end-to-end tests

This little project has two parts:

- `app/index.html` — the web page itself (the "product"). Open it in a
  browser and it's a signup form for garden plots.
- `tests/garden.spec.js` — Playwright tests. Each one opens the real page in
  a real (headless) browser, acts like a visitor, and checks what the page
  shows.

## Commands you'll use

| Command | What it does |
| --- | --- |
| `npm test` | Runs every test and prints pass/fail for each |
| `cat tests/garden.spec.js` | Shows the test file in the terminal |
| `nano tests/garden.spec.js` | Opens the test file in a simple editor (Ctrl+O saves, Ctrl+X exits) |
| `git diff` | Shows exactly what changed and hasn't been committed (press `q` to leave the view) |

## How to read a test

```js
test("signing up with a name shows a personal welcome", async ({ page }) => {
  await page.getByLabel("Your name").fill("Riley");            // find the field, type into it
  await page.getByRole("button", { name: "Sign up" }).click(); // find THE Sign up button, click it
  await expect(page.locator("#confirmation")).toContainText("Welcome to the garden, Riley!"); // check the page
});
```

Three moves, every time: **find** something (a locator), **act** on it,
**check** what the page shows (an assertion). When a test fails, Playwright
prints what it *expected* and what it actually *received* — read both lines
before touching anything.
