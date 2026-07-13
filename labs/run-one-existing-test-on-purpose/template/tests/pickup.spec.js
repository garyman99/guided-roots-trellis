// Three prepared Playwright checks for the Riverside Community Pickup page.
//
// All three are GREEN as shipped. This lab is NOT about fixing anything — it is
// about running ONE of them on purpose and confirming the result belongs to the
// test you chose. Read the titles below; you'll run the one named
// "Weekday pickup hours are shown".
//
// DO NOT edit, skip, rename, or delete any test. Changing the file to leave one
// test is NOT the same as running one test.
import { test, expect } from "@playwright/test";

// The page is a plain HTML file — each test opens it straight from disk.
const appUrl = new URL("../app/index.html", import.meta.url).href;

test.beforeEach(async ({ page }) => {
  await page.goto(appUrl);
});

test("Weekday pickup hours are shown", async ({ page }) => {
  await expect(page.getByTestId("weekday-hours")).toContainText("Tuesday to Friday");
});

test("Drop-off point is listed", async ({ page }) => {
  await expect(page.getByTestId("dropoff-location")).toContainText("220 River Road");
});

test("Contact email is visible", async ({ page }) => {
  await expect(page.getByTestId("contact-email")).toContainText("pickup@riverside.example");
});
