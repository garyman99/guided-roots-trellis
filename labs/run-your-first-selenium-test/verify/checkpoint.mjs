// Deterministic checkpoint verifier for "run-your-first-selenium-test".
//
// Runs INSIDE the lab environment; prints one JSON line: { checks: [...] }.
// The scenario's contract: the learner leaves the prepared Selenium moves
// (open → find → read) intact and writes MOVE 3 — an assertion that the text
// Selenium READ off the page (headingText) matches the heading they EXPECTED
// ("Community Garden Signup"). A self-referential or always-true assertion
// proves nothing and must NOT count. Equivalent spellings are accepted
// (assert.equal / strictEqual / ok(...includes...) / assert(a === b)).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const checks = [];
const push = (id, ok, detail) => checks.push({ id, ok, ...(ok ? {} : { detail }) });

// ── read the artifact ────────────────────────────────────────────────────
let spec = "";
try {
  spec = readFileSync("tests/first.test.ts", "utf8");
} catch {
  push("harness-intact", false, "tests/first.test.ts is missing — reset the lab if this wasn't you.");
}

// Strip comments so commented-out code never counts as authored work.
const code = spec
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

if (spec) {
  // HARNESS INTACT: the prepared moves (open, find, read) are still there.
  // Only MOVE 3 — the learner's check — should have been added.
  const harnessOk =
    /driver\.get\(\s*pageUrl\s*\)/.test(code) &&
    /findElement\(\s*By\.css\(\s*["'`]h1["'`]\s*\)\s*\)/.test(code) &&
    /\.getText\(\s*\)/.test(code) &&
    /driver\.quit\(\s*\)/.test(code);
  push(
    "harness-intact",
    harnessOk,
    "The prepared moves — open (driver.get), find (findElement By.css('h1')), read (getText), and close (driver.quit) — should stay exactly as they were. Only MOVE 3, your check, is yours to write. Reset the lab to restore them.",
  );

  // Pull out the assertion statements and reason about them.
  const assertStmts = code.match(/assert[\w.]*\([\s\S]*?\)\s*;?/g) ?? [];
  const headingAsserts = assertStmts.filter((s) => /headingText/.test(s));
  const expected = /community\s+garden\s+signup/i;
  const realAsserts = headingAsserts.filter((s) => expected.test(s));

  // CHECK PRESENT: an assertion that actually references the value read off
  // the page (headingText).
  push(
    "check-present",
    headingAsserts.length > 0,
    assertStmts.length > 0
      ? "There's an assertion, but it never mentions headingText — the text Selenium read off the page. MOVE 3 is about checking THAT value."
      : "No check yet. MOVE 3 is one line: assert that headingText is the heading you expected. Selenium read the value for you; the checking is your job.",
  );

  // CHECK REAL: it compares headingText against the EXPECTED heading text,
  // not against itself and not something always-true.
  push(
    "check-real",
    realAsserts.length > 0,
    "Your check has to compare headingText against the heading you EXPECTED to see — the words \"Community Garden Signup\". Comparing headingText to itself (or asserting something always true) passes while proving nothing.",
  );
}

// PAGE UNTOUCHED: the seeded page must be byte-identical to the shipped page.
const PRISTINE_SHA256 = "65f616803807f3af6ac3269df7769947e350b83e5728a7374bbc684962e5f7e9";
try {
  const pageHash = createHash("sha256").update(readFileSync("app/index.html")).digest("hex");
  push(
    "page-untouched",
    pageHash === PRISTINE_SHA256,
    "app/index.html was modified. We test the page as-is — fix the TEST, never the page. Reset the lab to restore it.",
  );
} catch {
  push("page-untouched", false, "app/index.html is missing — reset the lab to restore the seeded page.");
}

console.log(JSON.stringify({ checks }));
