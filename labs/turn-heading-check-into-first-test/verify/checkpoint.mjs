// Deterministic checkpoint verifier for "turn-heading-check-into-first-test".
//
// Runs INSIDE the lab environment; prints one JSON line: { checks: [...] }.
// The scenario's contract: the learner-authored check must FIND the seeded
// heading by user-visible meaning and ASSERT its visibility, pass against
// the UNCHANGED page, and a green exit without a meaningful assertion must
// NOT count. Equivalent locator/assertion spellings are accepted (allowed
// variance); implementation-only targeting (raw tag/CSS) is rejected with a
// teaching detail.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const checks = [];
const push = (id, ok, detail) => checks.push({ id, ok, ...(ok ? {} : { detail }) });

// ── read the artifact ──────────────────────────────────────────────────────
let spec = "";
try {
  spec = readFileSync("tests/heading.spec.js", "utf8");
} catch {
  push("test-authored", false, "tests/heading.spec.js is missing — reset the lab if this wasn't you.");
}

// Strip comments so commented-out code never counts as authored work.
const code = spec
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// The learner's test body: from the prepared test title to the file end
// (the slot is the last test in the prepared file).
const bodyMatch = code.match(/test\(\s*["'`][^"'`]*heading[^"'`]*["'`]\s*,\s*async[^{]*\{([\s\S]*)\}\s*\)\s*;?\s*$/);
const body = bodyMatch ? bodyMatch[1] : "";

if (spec) {
  // Prepared structure intact: navigation beforeEach + exactly one test.
  const testCount = (code.match(/\btest\(/g) ?? []).length;
  const navIntact = /beforeEach[\s\S]*?goto\(\s*appUrl\s*\)/.test(code);
  push(
    "slot-only",
    testCount === 1 && navIntact,
    testCount !== 1
      ? "The prepared file should contain exactly the one prepared test — write your check inside its body."
      : "The prepared navigation (beforeEach → page.goto) was changed — only the empty test body is yours to edit.",
  );
  push("not-skipped", !/\.(skip|fixme)\s*\(/.test(code), "The check is skipped — a skipped check proves nothing. Un-skip it.");

  // FIND: a locator grounded in user-visible meaning (role or text), naming
  // the heading. Accepted variance: getByRole('heading', {name: …}),
  // getByText(…), getByRole with regex names. Rejected: raw tag/CSS locators.
  const headingText = /community\s+garden\s+signup/i;
  const roleLocator = /getByRole\(\s*["'`]heading["'`]\s*,\s*\{[^}]*name\s*:\s*(["'`\/])([\s\S]*?)\1/i;
  const textLocator = /getByText\(\s*(["'`\/])([\s\S]*?)\1/i;
  const roleMatch = body.match(roleLocator);
  const textMatch = body.match(textLocator);
  const namedTarget = (roleMatch?.[2] ?? textMatch?.[2] ?? "");
  const rawCssLocator = /locator\(\s*["'`](h1|h\d|#|\.|\[)/i.test(body);
  const found = (roleMatch || textMatch) && headingText.test(namedTarget.replace(/\\/g, ""));
  push(
    "locator-user-visible",
    Boolean(found),
    rawCssLocator
      ? "The check targets the page's internals (a tag or CSS selector). Find the heading the way a VISITOR would: by its text, or by its role — 'the heading that says Community Garden Signup'."
      : "No locator for the Community Garden Signup heading found in the test body yet. First job: FIND the heading the way a visitor would notice it.",
  );

  // CHECK: a visibility (or equivalent user-visible-outcome) assertion tied
  // to an expect(). Accepted: toBeVisible; toHaveText/toContainText naming
  // the heading text (states the same user-visible outcome).
  const hasExpect = /\bexpect\s*\(/.test(body) && /\bawait\s+expect\s*\(/.test(body);
  const visibility = /\.toBeVisible\s*\(/.test(body);
  const textAssertion = /\.to(HaveText|ContainText)\s*\(\s*(["'`\/])([\s\S]*?)\2/.exec(body);
  const textAssertsHeading = textAssertion ? headingText.test(textAssertion[3].replace(/\\/g, "")) : false;
  push(
    "assertion-visible",
    hasExpect && (visibility || textAssertsHeading),
    hasExpect
      ? "There's an expect(), but it doesn't state the manual expectation — that the heading is VISIBLE. Finding is step one; checking is step two."
      : "The check finds things but never CHECKS anything — there is no expect(...) stating what should be true. A check with no expectation passes without proving anything.",
  );
}

// Page integrity: the seeded page must be byte-identical to the shipped page.
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
