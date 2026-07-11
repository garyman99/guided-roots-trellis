// End-to-end tests for the Community Garden signup page.
//
// Each test opens the real page in a real (headless) browser, does what a
// visitor would do, and checks what the page really shows. If you can follow
// a manual test script, you can read these: find something on the page
// (a "locator"), act on it, then assert what you expect to see.
import { test, expect } from "@playwright/test";

// The app is a plain HTML file — tests open it straight from disk.
const appUrl = new URL("../app/index.html", import.meta.url).href;

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl);
});

test("the page shows the signup heading", async ({ page }) => {
  // getByRole finds elements the way a person does: "the heading that says…"
  await expect(page.getByRole("heading", { name: "Community Garden Signup" })).toBeVisible();
});

test("signing up with a name shows a personal welcome", async ({ page }) => {
  await page.getByLabel("Your name").fill("Riley");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.locator("#confirmation")).toContainText("Welcome to the garden, Riley!");
});

test("submitting without a name shows an error", async ({ page }) => {
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("alert")).toHaveText("Please enter your name.");
});
