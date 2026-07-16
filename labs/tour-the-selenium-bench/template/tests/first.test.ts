// A complete Selenium test — nothing to write here. This is the bench you're
// touring: a real, passing test you'll run in the next lesson. Read it to see
// the three moves of every Selenium test, then move on.
//
//   MOVE 1 — OPEN a real browser and go to the page.
//   MOVE 2 — FIND an element and READ something off it.
//   MOVE 3 — CHECK that what you read is what you expected.

import { Builder, By, Browser } from "selenium-webdriver";
import { Options, ServiceBuilder } from "selenium-webdriver/chrome.js";
import { strict as assert } from "node:assert";

// The page under test — a plain HTML file opened straight from disk (file://),
// exactly like a visitor would see it. Nothing to start, nothing to install.
const pageUrl = new URL("../app/index.html", import.meta.url).href;

async function main(): Promise<void> {
  // ── MOVE 1: open the browser and go to the page ──────────────────────────
  const options = new Options().addArguments(
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  );
  options.setChromeBinaryPath(process.env.CHROME_BIN ?? "/usr/bin/chromium");
  const service = new ServiceBuilder(process.env.CHROMEDRIVER_BIN ?? "/usr/bin/chromedriver");
  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeService(service)
    .setChromeOptions(options)
    .build();

  try {
    await driver.get(pageUrl);

    // ── MOVE 2: find the heading and read its text ─────────────────────────
    const heading = await driver.findElement(By.css("h1"));
    const headingText: string = await heading.getText();
    console.log(`the page's heading reads: "${headingText}"`);

    // ── MOVE 3: check it ───────────────────────────────────────────────────
    assert.equal(headingText, "Community Garden Signup");
  } finally {
    // Always close the browser you opened — even if the check above failed.
    await driver.quit();
  }
}

main()
  .then(() => console.log("PASS — the check ran and held."))
  .catch((err: unknown) => {
    console.error("FAIL —", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
