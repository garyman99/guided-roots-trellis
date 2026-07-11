// Applies the *simulated* AI-generated change to a lab workspace.
//
// SIMULATED BEHAVIOR: this stands in for "an AI coding agent edited your
// repo". Deterministic string surgery, run once at session start, left
// UNCOMMITTED so `git diff` shows exactly what the "agent" did.
//
// ADAPTIVE LABS: the planted defect is selected from a CURATED library —
// authored, finite, and CI auto-solved before release. Usage:
//
//   node apply-ai-change.mjs <workspace> [defectId]   (default: stale-welcome-copy)
//
// Every variant: (a) adds the requested plot-size test correctly, (b) plants
// ONE defect from the library inside an EXISTING test. A blanket
// `git checkout -- .` removes the requested test too, so surgical fixes are
// the only path through the checkpoint.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFECTS = {
  // Tier 1: a stale expected-string. The failure output shows expected vs
  // received copy side by side — the most beginner-readable failure there is.
  "stale-welcome-copy": {
    apply(spec) {
      const before =
        '  await expect(page.locator("#confirmation")).toContainText("Welcome to the garden, Riley!");';
      const after =
        "  // Refreshed this assertion to match the new confirmation copy.\n" +
        '  await expect(page.locator("#confirmation")).toContainText("You\'re all signed up, Riley!");';
      if (!spec.includes(before)) throw new Error("expected welcome assertion not found; template drifted?");
      return spec.replace(before, after);
    },
  },
  // Tier 2: an ambiguous locator. The page has TWO buttons, so
  // page.locator("button") violates strict mode — the error message itself
  // teaches why locators must uniquely identify one element.
  "ambiguous-button-locator": {
    apply(spec) {
      const before =
        'test("submitting without a name shows an error", async ({ page }) => {\n' +
        '  await page.getByRole("button", { name: "Sign up" }).click();';
      const after =
        'test("submitting without a name shows an error", async ({ page }) => {\n' +
        "  // Simplified the selector while I was in here.\n" +
        '  await page.locator("button").click();';
      if (!spec.includes(before)) throw new Error("expected error-case test not found; template drifted?");
      return spec.replace(before, after);
    },
  },
};

const workspace = process.argv[2];
const defectId = process.argv[3] ?? "stale-welcome-copy";
if (!workspace) {
  console.error("usage: node apply-ai-change.mjs <workspace-path> [defectId]");
  process.exit(2);
}
const defect = DEFECTS[defectId];
if (!defect) {
  console.error(`unknown defect "${defectId}" — library has: ${Object.keys(DEFECTS).join(", ")}`);
  process.exit(2);
}

const specPath = join(workspace, "tests", "garden.spec.js");
let spec = readFileSync(specPath, "utf8");

// (1) Plant the selected defect inside an existing test.
spec = defect.apply(spec);

// (2) The requested feature (implemented correctly) — identical across variants.
spec += `
test("choosing a plot size is reflected in the confirmation", async ({ page }) => {
  await page.getByLabel("Your name").fill("Sam");
  await page.getByLabel("Plot size").selectOption("large");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.locator("#confirmation")).toContainText("Your large plot is reserved.");
});
`;
writeFileSync(specPath, spec);

console.log(`Simulated AI change applied (uncommitted, defect=${defectId}) to ${workspace}`);
