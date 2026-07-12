// Your first Playwright check.
//
// The manual test step you already do by hand (it's also in README.md):
//
//   1. Open the signup page.
//   2. Confirm the "Community Garden Signup" heading is visible.
//
// Step 1 is prepared for you below. Your job is step 2: inside the test
// body, FIND the heading the way a visitor would notice it, then STATE
// what you expect to be true about it. Two parts — find, then check.
//
// Write it yourself — this exercise has no AI and no snippets to paste.
import { test, expect } from "@playwright/test";

// The page is a plain HTML file — the test opens it straight from disk.
const appUrl = new URL("../app/index.html", import.meta.url).href;

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl); // step 1: already done for you
});

test("the page shows the Community Garden Signup heading", async ({ page }) => {
  // step 2: your check goes here
});
