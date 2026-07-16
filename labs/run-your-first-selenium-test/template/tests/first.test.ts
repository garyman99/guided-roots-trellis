// Your first Selenium test — in TypeScript.
//
// A Selenium test is three plain moves, done in order:
//
//   MOVE 1 — OPEN a real browser and go to the page.
//   MOVE 2 — FIND an element and READ something off it.
//   MOVE 3 — CHECK that what you read is what you expected.
//
// The big idea: Selenium hands you the browser as a set of manual controls.
// It will open the page and read the heading for you — but it will NOT decide
// whether the heading is right. Reading and checking are two separate jobs,
// and the checking is yours.
//
// Moves 1 and 2 are already written below. Your job is MOVE 3: one line.
// Write it yourself — this exercise has no AI and no snippets to paste.

import { Builder, By, Browser } from "selenium-webdriver";
import { Options, ServiceBuilder } from "selenium-webdriver/chrome.js";
import { strict as assert } from "node:assert";

// The page under test — a plain HTML file opened straight from disk (file://),
// exactly like a visitor would see it. Nothing to start, nothing to install.
const pageUrl = new URL("../app/index.html", import.meta.url).href;

async function main(): Promise<void> {
  // ── MOVE 1: open the browser and go to the page (prepared for you) ────────
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

    // ── MOVE 2: find the heading and read its text (prepared for you) ───────
    const heading = await driver.findElement(By.css("h1"));
    const headingText: string = await heading.getText();
    console.log(`the page's heading reads: "${headingText}"`);

    // ── MOVE 3: CHECK it. ← YOUR ONE LINE GOES HERE. ───────────────────────
    // Write an assertion that headingText is the heading you expected to see
    // on the signup page. Selenium read the text for you above; deciding
    // whether it's correct is your job. (See README.md for the exact words.)

  } finally {
    // Always close the browser you opened — even if the check above failed.
    await driver.quit();
  }
}

main()
  .then(() => console.log("PASS — your check ran and held."))
  .catch((err: unknown) => {
    console.error("FAIL —", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
