// Deterministic test runner for the lab.
//
// Runs the repo's Playwright suite, prints the human-readable report to the
// terminal, and — if TRELLIS_RESULTS_FILE is set — writes a machine-readable
// JSON summary. The platform watches that file to record `tests.completed`
// events, so test outcomes are *measured*, never inferred by an LLM.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

// Resolve the Playwright CLI from the workspace's own node_modules.
let cli;
try {
  cli = require.resolve("playwright/cli");
} catch {
  cli = require.resolve("@playwright/test/cli");
}

const reportPath = join(root, "test-results", ".trellis-report.json");
mkdirSync(dirname(reportPath), { recursive: true });

const child = spawnSync(
  process.execPath,
  [cli, "test", "--reporter=list,json"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
  },
);

let passed = 0;
let failed = 0;
try {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  passed = report.stats?.expected ?? 0;
  failed = (report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0);
} catch {
  // No parseable report (e.g. the runner crashed): count the run as one failure
  // so the platform records a red run rather than silence.
  failed = 1;
}

const summary = { passed, failed, total: passed + failed, completedAt: new Date().toISOString() };
const out = process.env.TRELLIS_RESULTS_FILE;
if (out) {
  try {
    writeFileSync(out, JSON.stringify(summary) + "\n");
  } catch {
    // Results file is best-effort; never break the learner's test run.
  }
}

process.exitCode = child.status ?? 1;
