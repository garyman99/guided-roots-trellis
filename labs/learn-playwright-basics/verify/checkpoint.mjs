// Deterministic behavioral verification for the "learn-playwright-basics" lab.
//
// Runs INSIDE the lab workspace (untrusted code executes only in the lab
// environment, never on the platform host). Prints a single JSON line so the
// evaluator parses results instead of scraping prose.
//
// One real Playwright run answers everything: the whole suite must pass,
// every original test and the agent's requested test must still EXIST and
// pass (feature kept — no deleting tests, no blanket reverts, no .skip),
// and the app itself must be byte-identical to how it shipped (this lab
// fixes TESTS; changing the product to make a test pass is the failure mode
// the lesson exists to teach against).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const checks = [];

// SHA-256 of the SHIPPED app/index.html (line endings normalized). The app is
// the fixed ground truth of this lab: tests are on trial, the product is not.
const SHIPPED_APP_SHA256 = "65f616803807f3af6ac3269df7769947e350b83e5728a7374bbc684962e5f7e9";

// Every test that must exist AND pass, by exact title.
const ORIGINAL_TITLES = [
  "the page shows the signup heading",
  "signing up with a name shows a personal welcome",
  "submitting without a name shows an error",
];
const REQUESTED_TITLE = "choosing a plot size is reflected in the confirmation";

// ── Check 1: the app was left untouched ─────────────────────────────────────
try {
  const raw = readFileSync(join(cwd, "app", "index.html"), "utf8").replace(/\r\n/g, "\n");
  const sha = createHash("sha256").update(raw).digest("hex");
  if (sha !== SHIPPED_APP_SHA256) {
    checks.push({
      id: "app-untouched",
      label: "the app itself was left unchanged",
      ok: false,
      detail: "app/index.html differs from how it shipped — fix the test, not the product. `git checkout -- app/index.html` restores it.",
    });
  } else {
    checks.push({ id: "app-untouched", label: "the app itself was left unchanged", ok: true });
  }
} catch (err) {
  checks.push({ id: "app-untouched", label: "the app itself was left unchanged", ok: false, detail: String(err?.message ?? err).slice(0, 300) });
}

// ── Check 2: the agent's misleading comments are gone ───────────────────────
// Each variant plants ONE defect under a plausible-but-false comment. A fixed
// assertion beneath a comment that still claims the old story is a lie in the
// codebase — the lesson's own moral, enforced. Checking both strings is
// variant-blind: only one was ever planted, the other simply never appears.
const PLANTED_COMMENTS = [
  "Refreshed this assertion to match the new confirmation copy.",
  "Simplified the selector while I was in here.",
];
try {
  const spec = readFileSync(join(cwd, "tests", "garden.spec.js"), "utf8");
  const lingering = PLANTED_COMMENTS.filter((c) => spec.includes(c));
  checks.push({
    id: "comments-honest",
    label: "the agent's misleading comment was removed",
    ok: lingering.length === 0,
    detail:
      lingering.length === 0
        ? undefined
        : `the agent's comment "${lingering[0]}" is still in tests/garden.spec.js — after your fix it no longer tells the truth. Delete that comment line.`,
  });
} catch (err) {
  checks.push({ id: "comments-honest", label: "the agent's misleading comment was removed", ok: false, detail: String(err?.message ?? err).slice(0, 300) });
}

// ── One real Playwright run (JSON reporter) feeds the remaining checks ──────
let report = null;
let runError = "";
try {
  const require = createRequire(join(cwd, "package.json"));
  let cli;
  try {
    cli = require.resolve("playwright/cli");
  } catch {
    cli = require.resolve("@playwright/test/cli");
  }
  const res = spawnSync(process.execPath, [cli, "test", "--reporter=json"], {
    cwd,
    encoding: "utf8",
    timeout: 100_000,
  });
  const jsonStart = res.stdout.indexOf("{");
  if (jsonStart >= 0) report = JSON.parse(res.stdout.slice(jsonStart));
  else runError = (res.stderr || res.stdout || "no output").slice(-300);
} catch (err) {
  runError = String(err?.message ?? err).slice(0, 300);
}

/** Flatten the report into { title -> ok } (specs carry an `ok` verdict). */
function collectSpecs(suites, out = new Map()) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) out.set(spec.title, spec.ok === true);
    collectSpecs(suite.suites, out);
  }
  return out;
}
const specs = report ? collectSpecs(report.suites) : new Map();
const unexpected = report?.stats?.unexpected ?? -1;
const skipped = report?.stats?.skipped ?? -1;

if (!report) {
  checks.push({ id: "defect-fixed", label: "the broken test was fixed", ok: false, detail: `Playwright did not produce a report: ${runError}` });
  checks.push({ id: "feature-kept", label: "the requested plot-size test was kept", ok: false, detail: "Playwright did not produce a report." });
} else {
  const missingOrFailing = ORIGINAL_TITLES.filter((t) => specs.get(t) !== true);
  const suiteClean = unexpected === 0 && skipped === 0;
  checks.push({
    id: "defect-fixed",
    label: "the broken test was fixed",
    ok: suiteClean && missingOrFailing.length === 0,
    detail:
      suiteClean && missingOrFailing.length === 0
        ? undefined
        : missingOrFailing.length > 0
          ? `these tests must exist and pass (no renaming, no .skip): ${missingOrFailing.join("; ")}`
          : `${unexpected} test(s) still failing, ${skipped} skipped — the whole suite must run green.`,
  });
  checks.push({
    id: "feature-kept",
    label: "the requested plot-size test was kept",
    ok: specs.get(REQUESTED_TITLE) === true,
    detail:
      specs.get(REQUESTED_TITLE) === true
        ? undefined
        : `the test "${REQUESTED_TITLE}" is missing or failing — the agent's requested feature must survive your fix.`,
  });
}

console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks }));
process.exitCode = 0; // Structured result carries pass/fail; exit 0 means "verifier ran".
