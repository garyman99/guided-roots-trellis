/**
 * The write → auto-solve → publish contract every generated lab must clear:
 * broken as shipped (the verifier fails on the template the learner receives)
 * AND solvable (the blueprint's authored solution makes it pass), via the same
 * harness a hand-authored lab clears. Runs on the local driver (node + git).
 *
 * The generic "complete the stub" builder these tests used to exercise was
 * deleted (2026-07-22) — it graded `solution.txt` for every lesson regardless of
 * what the lesson taught. The contract it was proving is still the contract, so
 * these tests now prove it against a REAL curated lab (node-deps).
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";
import { buildNodeLabFiles } from "../src/nodeLabs.ts";

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ } });

const lab = (lessonId: string) => buildNodeLabFiles("node-deps", { lessonId, title: "Project setup", objective: "Declare the project's dependencies." }, ["express", "vitest"], "cg-node-x");

test("build produces a valid manifest, a broken template, and a blueprint with a solution", () => {
  const files = lab("node-101");
  const manifest = JSON.parse(files["lab.json"]);
  assert.equal(manifest.id, "node-101");
  assert.ok(manifest.tasks.length > 0, "the lab grades at least one task");
  assert.equal(manifest.checkpoint.requirements[0].kind, "verify");
  assert.ok(files["verify/checkpoint.mjs"], "ships a verifier");
  const bp = JSON.parse(files["blueprint.json"]);
  assert.equal(bp.driver, "local");
  assert.ok(Object.keys(bp.defects).length > 0, "ships at least one defect with an authored solution");
});

test("the generated lab auto-solves: broken as shipped AND solvable", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-"));
  tmp.push(root);
  const labDir = writeGeneratedLab(root, "node-102", lab("node-102"));

  const reports = await autoSolveGeneratedLab(labDir, "node-102");
  assert.ok(reports.length >= 1);
  assert.equal(reports[0].brokenAsShipped, true, "verifier fails on the shipped template");
  assert.equal(reports[0].solvable, true, "authored solution makes the verifier pass");
  assert.equal(reports[0].ok, true);
});

test("a tampered lab whose solution doesn't fix it is caught (not solvable)", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-bad-"));
  tmp.push(root);
  const files = lab("bad-101");
  // Break every authored solution so none of them satisfies the verifier.
  const bp = JSON.parse(files["blueprint.json"]);
  for (const defect of Object.values(bp.defects) as Array<{ solution: string[] }>) {
    defect.solution = ["node", "-e", "require('fs').writeFileSync('package.json','{\"name\":\"x\",\"dependencies\":{}}')"];
  }
  files["blueprint.json"] = JSON.stringify(bp);
  const labDir = writeGeneratedLab(root, "bad-101", files);

  const reports = await autoSolveGeneratedLab(labDir, "bad-101");
  assert.equal(reports[0].brokenAsShipped, true);
  assert.equal(reports[0].solvable, false, "the wrong solution must not pass the verifier");
  assert.equal(reports[0].ok, false);
});

test("a docker-driven lab with an unavailable image SKIPS LOUDLY, never fails on the local driver", async () => {
  // Part D (2026-07-22): a browser lab can't prove on the local process driver
  // (no chromium). With no daemon/image here it must ship UNPROVEN — a visible
  // gap — rather than block every browser lesson. Deterministic: the tag can't
  // exist, so `docker image inspect` fails whether or not a daemon is up.
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-dkr-"));
  tmp.push(root);
  const files = lab("dkr-101");
  const bp = JSON.parse(files["blueprint.json"]);
  bp.driver = "docker";
  files["blueprint.json"] = JSON.stringify(bp);
  const manifest = JSON.parse(files["lab.json"]);
  manifest.image = "trellis-nonexistent-image-xyz";
  files["lab.json"] = JSON.stringify(manifest);
  const labDir = writeGeneratedLab(root, "dkr-101", files);

  const reports = await autoSolveGeneratedLab(labDir, "dkr-101");
  assert.equal(reports[0].ok, true, "an unprovable-here docker lab is not a failure");
  assert.match(reports[0].detail ?? "", /UNPROVEN/, "but it says loudly it wasn't proven");
});

test("a docker-driven lab with NO image stamped is a hard failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-noimg-"));
  tmp.push(root);
  const files = lab("noimg-101");
  const bp = JSON.parse(files["blueprint.json"]);
  bp.driver = "docker";
  files["blueprint.json"] = JSON.stringify(bp);
  const labDir = writeGeneratedLab(root, "noimg-101", files);

  const reports = await autoSolveGeneratedLab(labDir, "noimg-101");
  assert.equal(reports[0].ok, false);
  assert.match(reports[0].detail ?? "", /no image is stamped/);
});
