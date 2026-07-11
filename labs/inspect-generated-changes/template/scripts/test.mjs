// Deterministic test runner for the lab.
//
// Runs the repo's tests with node:test, prints a human-readable report to the
// terminal, and — if TRELLIS_RESULTS_FILE is set — writes a machine-readable
// JSON summary. The platform watches that file to record `tests.completed`
// events, so test outcomes are *measured*, never inferred by an LLM.
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(join(root, "tests"))
  .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.mjs"))
  .map((f) => join(root, "tests", f));

let passed = 0;
let failed = 0;

const stream = run({ files, concurrency: 1 });
stream.on("test:pass", (e) => {
  if (e.details?.type !== "suite") passed += 1;
});
stream.on("test:fail", (e) => {
  if (e.details?.type !== "suite") failed += 1;
});
stream.compose(spec).pipe(process.stdout);

stream.once("end", () => {
  const summary = {
    passed,
    failed,
    total: passed + failed,
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
  process.exitCode = failed > 0 ? 1 : 0;
});
