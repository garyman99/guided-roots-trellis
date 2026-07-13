// Playwright configuration for this lab. Kept deliberately small.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // One test at a time: output stays readable and results deterministic.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  // The prepared check fails on purpose; a short assertion timeout means the
  // failure — with its Expected/Received pair — prints quickly instead of
  // making the learner wait out a long auto-retry.
  expect: { timeout: 3_000 },
  use: {
    headless: true,
    // The lab runs inside a container without Chromium's user-namespace sandbox.
    chromiumSandbox: false,
  },
});
