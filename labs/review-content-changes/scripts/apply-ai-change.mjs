// Applies the *simulated* AI-generated change to a lab workspace.
// SIMULATED BEHAVIOR — deterministic string surgery, left UNCOMMITTED.
//
// Usage: node apply-ai-change.mjs <workspace> [defectId]  (default: slug-collapse)
//
// Every variant: (a) adds the requested readingTimeMinutes feature correctly,
// (b) adds a passing test for it, (c) plants ONE defect from the curated
// library. Blanket revert removes the feature → surgical fixes only.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFECTS = {
  // Tier 1: one regex character quietly dropped; one named test fails.
  "slug-collapse": {
    apply(text) {
      const before = '    .replace(/[^a-z0-9]+/g, "-")';
      const after =
        "    // Simplified the character class while in here.\n" +
        '    .replace(/[^a-z0-9]/g, "-")';
      if (!text.includes(before)) throw new Error("expected slugify body not found; template drifted?");
      return text.replace(before, after);
    },
  },
  // Tier 2: off-by-one dressed up as intentional design.
  "excerpt-off-by-one": {
    apply(text) {
      const before = '  return words.slice(0, maxWords).join(" ") + "…";';
      const after =
        "  // Reserve room for the ellipsis so the excerpt never overflows.\n" +
        '  return words.slice(0, maxWords - 1).join(" ") + "…";';
      if (!text.includes(before)) throw new Error("expected excerpt body not found; template drifted?");
      return text.replace(before, after);
    },
  },
};

const workspace = process.argv[2];
const defectId = process.argv[3] ?? "slug-collapse";
if (!workspace) {
  console.error("usage: node apply-ai-change.mjs <workspace-path> [defectId]");
  process.exit(2);
}
const defect = DEFECTS[defectId];
if (!defect) {
  console.error(`unknown defect "${defectId}" — library has: ${Object.keys(DEFECTS).join(", ")}`);
  process.exit(2);
}

const srcPath = join(workspace, "src", "text.ts");
const testPath = join(workspace, "tests", "text.test.ts");

let text = readFileSync(srcPath, "utf8");
text = defect.apply(text);

// The requested feature (correct), identical across variants.
text += `
/**
 * Estimated reading time for a post body, in whole minutes (minimum 1),
 * assuming \`wordsPerMinute\` (default 200).
 */
export function readingTimeMinutes(body: string, wordsPerMinute = 200): number {
  const words = body.split(/\\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}
`;
writeFileSync(srcPath, text);

let tests = readFileSync(testPath, "utf8");
tests = tests.replace(
  'import { slugify, excerpt } from "../src/text.ts";',
  'import { slugify, excerpt, readingTimeMinutes } from "../src/text.ts";',
);
tests += `
test("readingTimeMinutes rounds up and never returns zero", () => {
  assert.equal(readingTimeMinutes("word ".repeat(200)), 1);
  assert.equal(readingTimeMinutes("word ".repeat(201)), 2);
  assert.equal(readingTimeMinutes("tiny"), 1);
});
`;
writeFileSync(testPath, tests);

console.log(`Simulated AI change applied (uncommitted, defect=${defectId}) to ${workspace}`);
