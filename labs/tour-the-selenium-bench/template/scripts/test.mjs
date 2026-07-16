// Deterministic test runner for the Selenium lab.
//
// Runs the learner's TypeScript Selenium test (via tsx, so no build step),
// streams its output to the terminal, and — when TRELLIS_RESULTS_FILE is set —
// writes a machine-readable summary. The platform watches that file to record
// `tests.completed`, so the outcome is *measured* from the process exit code,
// never inferred by an LLM.
//
// This lab has a single end-to-end script rather than a test framework: the
// TypeScript file throws on a failed assertion (exit != 0) and prints PASS on
// success (exit 0). That maps cleanly onto one pass/fail here.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testFile = join(root, "tests", "first.test.ts");

// `--import tsx` registers the TypeScript loader from the workspace's own
// node_modules, so we can run the .ts file directly and offline.
const child = spawnSync(process.execPath, ["--import", "tsx", testFile], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

const ok = child.status === 0;
const summary = {
  passed: ok ? 1 : 0,
  failed: ok ? 0 : 1,
  total: 1,
  completedAt: new Date().toISOString(),
};

const out = process.env.TRELLIS_RESULTS_FILE;
if (out) {
  try {
    writeFileSync(out, JSON.stringify(summary) + "\n");
  } catch {
    // Results file is best-effort; never break the learner's test run.
  }
}

process.exitCode = child.status ?? 1;
