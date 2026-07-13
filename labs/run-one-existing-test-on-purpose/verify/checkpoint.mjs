// Deterministic checkpoint verifier for "run-one-existing-test-on-purpose".
//
// Runs INSIDE the lab environment (cwd = the learner's /workspace); prints one
// JSON line: { checks: [...] }.
//
// The scenario's contract: the learner RUNS one prepared, already-passing test
// ON PURPOSE — the test named "Weekday pickup hours are shown" — and confirms
// the result belongs to that test, WITHOUT editing, skipping, renaming, or
// deleting any test or the page. A green full-suite run is NOT completion
// (scenario blocker "wrong-scope-accepted"); changing the project to leave one
// runnable test is NOT completion either (blocker "project-mutated").
//
// Evidence, measured from the learner's own run: scripts/test.mjs writes
// .trellis/last-run.json naming exactly which tests the LAST run executed and
// whether they passed. We read that record here plus a byte-for-byte integrity
// check of the tests and the page. Focus mechanism and result presentation are
// deliberately not prescribed by the scenario; we check the run's *scope,
// identity, and result*, not one command spelling.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const checks = [];
const push = (id, ok, detail) => checks.push({ id, ok, ...(ok ? {} : { detail }) });

const TARGET_TITLE = "Weekday pickup hours are shown";

// ── integrity: the tests and the page must be exactly as seeded ─────────────
// Changing tests/pickup.spec.js to leave one runnable test, or editing the page
// to change a result, is not "running one test on purpose".
const PRISTINE = {
  "tests/pickup.spec.js": "09b6e0faae359ab1b7bb5ca4999fe574d06a850f002e9b864db6753c39159c83",
  "app/index.html": "18a56d4baa1733000b172753d86e11d11e74e3b241dbc11f297abf78b41de2c4",
};
const integrity = (id, file, teach) => {
  try {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    push(id, hash === PRISTINE[file], teach);
  } catch {
    push(id, false, `${file} is missing — reset the lab to restore the seeded files.`);
  }
};

// ── the run-record the learner's own `npm test` wrote ───────────────────────
let record = null;
let recordError = null;
try {
  record = JSON.parse(readFileSync(".trellis/last-run.json", "utf8"));
} catch {
  recordError =
    "No test run was recorded yet. Run the test in the terminal first (e.g. npm test), then Check my work.";
}

const ran = Array.isArray(record?.ran) ? record.ran : [];
const isFocused = ran.length === 1;
const only = ran[0] ?? null;
const norm = (s) => String(s ?? "").trim();

// focused-scope: the LAST run executed exactly one test, not the whole suite.
push(
  "focused-scope",
  isFocused,
  recordError
    ? recordError
    : ran.length === 0
      ? "Your last run matched no test — check the name against tests/pickup.spec.js and run one test by its title, e.g. npm test -- \"Weekday pickup hours are shown\"."
      : `Your last run was ${ran.length} tests, not one. Running the whole suite isn't "run one test on purpose" — focus a single test by name: npm test -- "${TARGET_TITLE}".`,
);

// named-test-ran: that one test was the requested title.
push(
  "named-test-ran",
  isFocused && norm(only.title) === TARGET_TITLE,
  recordError
    ? recordError
    : !isFocused
      ? `Focus the run down to just "${TARGET_TITLE}" first, then this will confirm the right test ran.`
      : `The one test you ran was "${norm(only.title)}". The task asks for "${TARGET_TITLE}" — run that title instead.`,
);

// test-passed: the focused test passed (and nothing failed in that run).
push(
  "test-passed",
  isFocused && only.ok === true && record?.failed === 0,
  recordError
    ? recordError
    : !isFocused
      ? "Once you've run just the one test, this confirms it passed."
      : `"${norm(only.title)}" did not pass on that run. It ships green — reset the lab if the page or test was changed, then run it again.`,
);

integrity(
  "tests-untouched",
  "tests/pickup.spec.js",
  "tests/pickup.spec.js was changed. This lab is about RUNNING one existing test, not editing the suite — reset the lab to restore the prepared tests.",
);
integrity(
  "page-untouched",
  "app/index.html",
  "app/index.html was changed. We run the tests against the page as-is — never edit it. Reset the lab to restore it.",
);

console.log(JSON.stringify({ checks }));
