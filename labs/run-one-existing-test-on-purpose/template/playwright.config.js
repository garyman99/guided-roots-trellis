// Playwright configuration for this lab. Kept deliberately small.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // One test at a time: output stays readable and the "1 test ran" line is easy
  // to see when you focus a single test.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  use: {
    headless: true,
    // The lab runs inside a container without Chromium's user-namespace sandbox.
    chromiumSandbox: false,
  },
});
