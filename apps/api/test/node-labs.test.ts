/**
 * The node-deps real lab kind (P0/P1 of the lab-authoring plan): a generated
 * lesson can now materialize a REAL project-setup lab instead of the stub —
 * package.json ships bare, the learner declares the required packages, and a
 * real verifier checks exactly those are present. Proven by the same auto-solve
 * harness on the local driver (offline: no install, no network, no Docker).
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNodeLabFiles, isNodeLabKind } from "../src/nodeLabs.ts";
import { writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";
import { validateLessonPlan } from "../../../packages/course-architect/src/schemas.ts";

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ } });

const SELENIUM_DEPS = ["selenium-webdriver", "typescript", "tsx", "@types/selenium-webdriver"];

test("node-deps: build produces a bare package.json (broken) and a deps verifier", () => {
  const files = buildNodeLabFiles(
    "node-deps",
    { lessonId: "s1-making-a-project", title: "Making a Project", objective: "Set up the project dependencies." },
    SELENIUM_DEPS,
    "cg-selenium-x",
    "pwsh",
  );
  const lab = JSON.parse(files["lab.json"]);
  assert.equal(lab.shell, "pwsh");
  assert.equal(lab.tasks[0].auto, "file-edited");
  assert.equal(lab.tasks[0].autoPath, "package.json");
  assert.equal(lab.checkpoint.requirements[0].id, "deps-declared");
  const template = JSON.parse(files["template/package.json"]);
  assert.deepEqual(template.dependencies, {}, "ships broken: no deps declared");
  assert.ok(files["verify/checkpoint.mjs"].includes("selenium-webdriver"), "verifier checks the required packages");
});

test("node-deps: the real lab auto-solves offline — broken as shipped AND solvable", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-nodelab-"));
  tmp.push(root);
  const labId = "s1-making-a-project";
  const files = buildNodeLabFiles(
    "node-deps",
    { lessonId: labId, title: "Making a Project", objective: "Declare the four dependencies." },
    SELENIUM_DEPS,
    "cg-selenium-x",
  );
  const labDir = writeGeneratedLab(root, labId, files);

  const reports = await autoSolveGeneratedLab(labDir, labId);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].brokenAsShipped, true, "bare package.json fails the deps verifier");
  assert.equal(reports[0].solvable, true, "declaring all four deps passes the verifier");
  assert.equal(reports[0].ok, true);
});

test("node-deps: a lesson plan declaring the kind must carry expectedPackages", () => {
  const base = {
    lessonId: "s1-making-a-project",
    markdown: "# lesson\n\ncontent",
    lab: { objective: "set up deps", primaryAuto: "file-edited", kind: "node-deps" },
  };
  // Missing expectedPackages → rejected.
  assert.throws(() => validateLessonPlan(base, "s1-making-a-project"), /expectedPackages/);
  // With a non-empty package list → valid.
  const ok = validateLessonPlan({ ...base, lab: { ...base.lab, expectedPackages: SELENIUM_DEPS } }, "s1-making-a-project");
  assert.equal(ok.lab.kind, "node-deps");
  assert.ok(isNodeLabKind(ok.lab.kind));
});
