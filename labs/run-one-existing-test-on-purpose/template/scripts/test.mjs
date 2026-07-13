// Deterministic test runner for the lab.
//
// Runs the workspace's Playwright tests, prints the human-readable report to the
// terminal, and — if TRELLIS_RESULTS_FILE is set — writes a machine-readable
// JSON summary the platform watches to record `tests.completed` events. Test
// outcomes are therefore *measured*, never inferred by an LLM.
//
// FOCUS SUPPORT (what makes this lab work): any words you pass after `npm test --`
// become a title filter, so you can run ONE named test instead of the whole
// suite. Examples, both of which run only the first test:
//   npm test -- "Weekday pickup hours are shown"
//   npm test -- Weekday
// With no words, `npm test` runs all three. Either way this script also writes a
// small run-record (.trellis/last-run.json) naming exactly which tests ran, so
// "which test did I run" is a measured fact, not a guess.
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

// Turn everything after `npm test --` into a Playwright title filter (--grep).
// Tolerate a learner who types an explicit `--grep`/`-g` flag themselves: drop
// the flag token and keep the words, so both spellings focus the same test.
const focusTerms = process.argv.slice(2).filter((a) => a !== "--grep" && a !== "-g");
const focus = focusTerms.join(" ").trim();
const grepArgs = focus ? ["--grep", focus] : [];

const reportPath = join(root, "test-results", ".trellis-report.json");
mkdirSync(dirname(reportPath), { recursive: true });

const child = spawnSync(
  process.execPath,
  [cli, "test", "--reporter=list,json", ...grepArgs],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
  },
);

// Walk the Playwright JSON report for the specs that actually RAN (a --grep run
// only includes matched specs), with each one's pass/fail state.
function collectSpecs(node, out) {
  for (const spec of node.specs ?? []) out.push({ title: spec.title, ok: spec.ok === true });
  for (const suite of node.suites ?? []) collectSpecs(suite, out);
  return out;
}

let ran = [];
let passed = 0;
let failed = 0;
try {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  ran = collectSpecs(report, []);
  passed = report.stats?.expected ?? ran.filter((s) => s.ok).length;
  failed = (report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0);
} catch {
  // No parseable report (e.g. the runner crashed, or a title filter matched no
  // test): record the run as one failure so the platform sees a red run, not
  // silence.
  failed = 1;
}

// Machine-readable summary for the platform's tests.completed event.
const summary = { passed, failed, total: passed + failed, completedAt: new Date().toISOString() };
const out = process.env.TRELLIS_RESULTS_FILE;
if (out) {
  try {
    writeFileSync(out, JSON.stringify(summary) + "\n");
  } catch {
    // Results file is best-effort; never break the learner's test run.
  }
}

// Deterministic run-record: exactly which tests this run executed and whether
// they passed, plus the focus words used. The checkpoint reads this to confirm
// the LAST run was one chosen test — measured from the learner's own run.
try {
  const recordDir = join(root, ".trellis");
  mkdirSync(recordDir, { recursive: true });
  const record = {
    focus: focus || null,
    ran, // [{ title, ok }] for the tests this run actually executed
    passed,
    failed,
    total: passed + failed,
    completedAt: summary.completedAt,
  };
  writeFileSync(join(recordDir, "last-run.json"), JSON.stringify(record, null, 2) + "\n");
} catch {
  // Run-record is best-effort; never break the learner's test run.
}

process.exitCode = child.status ?? 1;
