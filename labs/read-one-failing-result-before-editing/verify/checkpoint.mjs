// Deterministic checkpoint verifier for "read-one-failing-result-before-editing".
//
// Runs INSIDE the lab environment; prints one JSON line: { checks: [...] }.
// The scenario's contract: the learner RUNS one prepared failing test and
// records four facts from it into EVIDENCE.md — the failed test's name, the
// file-and-line the result points to, the text the test EXPECTED, and the text
// the page RECEIVED — WITHOUT editing the test or the page. Reversing the
// expected/received pair is a blocker. Equivalent wording (punctuation, quotes,
// terminal decoration) is accepted; guessing or a still-blank field is not.
//
// Ground truth: the seeded test asserts the status is "Plot requests are
// closed"; the seeded page says "Plot requests are open". With both files
// byte-identical to the seed, every run is red with exactly that pair — so
// integrity + the learner's own recorded run (the `ran-tests` session
// requirement in lab.json) establish gate-1 without a second run here.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const checks = [];
const push = (id, ok, detail) => checks.push({ id, ok, ...(ok ? {} : { detail }) });

const EXPECTED_TEXT = "plot requests are closed"; // what the TEST claims
const RECEIVED_TEXT = "plot requests are open"; //   what the PAGE shows
const TEST_TITLE = "garden status banner";

// ── integrity: the test and the page must be exactly as seeded ──────────────
const PRISTINE = {
  "tests/status.spec.js": "6cf5a526dd44b240aadb6ac93d2a26c8a7328d60b7eea5ad3783c9d74c831819",
  "app/index.html": "01b9333fa245d3a00083c510cdb991fb298165a0586b91ce94311f7150bea23d",
};
const integrity = (id, file, teach) => {
  try {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    push(id, hash === PRISTINE[file], teach);
  } catch {
    push(id, false, `${file} is missing — reset the lab to restore the seeded file.`);
  }
};
integrity(
  "test-untouched",
  "tests/status.spec.js",
  "tests/status.spec.js was changed. This lab is about READING the failure, not fixing it — reset the lab to restore the prepared test.",
);
integrity(
  "page-untouched",
  "app/index.html",
  "app/index.html was changed. We read the page as-is — never edit it to change the result. Reset the lab to restore it.",
);

// ── the evidence note ───────────────────────────────────────────────────────
let raw = "";
try {
  raw = readFileSync("EVIDENCE.md", "utf8");
} catch {
  push("note-test", false, "EVIDENCE.md is missing — reset the lab to restore your note.");
}

// Drop HTML comments so the reading-tips block never counts as a filled field.
const note = raw.replace(/<!--[\s\S]*?-->/g, "");

// Pull "- Field: value" (markdown bullet optional); value is the rest of the line.
const field = (name) => {
  const m = note.match(new RegExp(`^\\s*[-*]?\\s*${name}\\s*:\\s*(.+?)\\s*$`, "im"));
  return m ? m[1].trim() : "";
};
// Normalize for meaning-preserving comparison: lowercase, strip quotes/backticks
// and trailing punctuation, collapse whitespace.
const norm = (s) => s.toLowerCase().replace(/["'`]/g, "").replace(/[.,;]+$/g, "").replace(/\s+/g, " ").trim();
const unfilled = (v) => !v || /^[.…]+$/.test(v.trim());

if (raw) {
  const testVal = field("Test");
  const locVal = field("Location");
  const expVal = norm(field("Expected"));
  const recVal = norm(field("Received"));

  // Test: names the failed check by its title.
  push(
    "note-test",
    !unfilled(testVal) && norm(testVal).includes(TEST_TITLE),
    unfilled(testVal)
      ? "The Test field is still blank — copy the NAME the runner printed for the failed check."
      : "The Test field doesn't match the failed check's name. Look for the test title the runner printed (not the filename).",
  );

  // Location: the file-and-line the result points to (file + a line number).
  const hasFile = /status\.spec\.js/i.test(locVal);
  const hasLine = /\d+/.test(locVal);
  push(
    "note-location",
    !unfilled(locVal) && hasFile && hasLine,
    unfilled(locVal)
      ? "The Location field is still blank — copy the file-and-line the result points to, like tests/status.spec.js:20."
      : hasFile
        ? "The Location needs the line number too — the result points to a specific line, like tests/status.spec.js:20."
        : "The Location should be the file-and-line the result points to for the failed check, like tests/status.spec.js:20.",
  );

  // Expected / Received: the pair, the right way round.
  const reversed = /\bopen\b/.test(expVal) && /\bclosed\b/.test(recVal);
  const swapDetail =
    "Expected and Received look swapped. Expected is what the TEST asked for (…closed); Received is what the PAGE actually showed (…open). Read the paired labels again and put each on its own line.";
  push(
    "note-expected",
    !unfilled(field("Expected")) && !reversed && expVal.includes(EXPECTED_TEXT),
    unfilled(field("Expected"))
      ? "The Expected field is still blank — copy the text the TEST expected (the runner labels it 'Expected')."
      : reversed
        ? swapDetail
        : "The Expected field should be the text the TEST expected — the runner prints it after 'Expected'.",
  );
  push(
    "note-received",
    !unfilled(field("Received")) && !reversed && recVal.includes(RECEIVED_TEXT),
    unfilled(field("Received"))
      ? "The Received field is still blank — copy the text the PAGE actually showed (the runner labels it 'Received')."
      : reversed
        ? swapDetail
        : "The Received field should be the text the PAGE actually showed — the runner prints it after 'Received'.",
  );
}

console.log(JSON.stringify({ checks }));
