// Deterministic checkpoint verifier for "tour-the-selenium-bench".
//
// This is an orientation lesson — there is nothing for the learner to author,
// so the checkpoint just confirms the bench is intact: the files they toured
// are all present, the shipped test still has its three moves, and the page was
// left exactly as seeded. Runs INSIDE the lab environment; prints one JSON line.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const checks = [];
const push = (id, ok, detail) => checks.push({ id, ok, ...(ok ? {} : { detail }) });

// BENCH PRESENT: the pieces the tour walks are all there.
const FILES = ["README.md", "app/index.html", "tests/first.test.ts", "package.json"];
const missing = FILES.filter((f) => {
  try {
    readFileSync(f);
    return false;
  } catch {
    return true;
  }
});
push(
  "bench-present",
  missing.length === 0,
  `Some bench files are missing (${missing.join(", ")}). Reset the lab to restore the tour.`,
);

// TEST INTACT: the shipped test still shows the three Selenium moves. Nothing to
// write here — this just catches an accidental gutting so "Watch it run" works.
let spec = "";
try {
  spec = readFileSync("tests/first.test.ts", "utf8");
} catch {
  spec = "";
}
const code = spec.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const intact =
  /driver\.get\(/.test(code) &&
  /findElement\(/.test(code) &&
  /\.getText\(/.test(code) &&
  /assert\.equal\(/.test(code) &&
  /driver\.quit\(/.test(code);
push(
  "test-intact",
  intact,
  "The prepared test lost one of its three moves (open, find & read, check). Nothing needs editing in this lesson — reset the lab to restore it.",
);

// PAGE UNTOUCHED: the seeded page must be byte-identical to the shipped page.
const PRISTINE_SHA256 = "65f616803807f3af6ac3269df7769947e350b83e5728a7374bbc684962e5f7e9";
try {
  const pageHash = createHash("sha256").update(readFileSync("app/index.html")).digest("hex");
  push(
    "page-untouched",
    pageHash === PRISTINE_SHA256,
    "app/index.html was modified. This is a look-around lesson — nothing here needs changing. Reset the lab to restore it.",
  );
} catch {
  push("page-untouched", false, "app/index.html is missing — reset the lab to restore the seeded page.");
}

console.log(JSON.stringify({ checks }));
