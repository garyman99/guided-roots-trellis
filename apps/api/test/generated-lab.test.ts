/**
 * A generated lab is a COMPLETE, playable lab that proves itself: broken as
 * shipped (verifier fails on the TODO template) AND solvable (its authored
 * solution makes the verifier pass), via the same auto-solve harness every
 * hand-authored lab must clear. Runs on the local driver (node + git).
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGeneratedLabFiles, writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ } });

test("build produces a valid manifest, a broken template, and a blueprint with a solution", () => {
  const files = buildGeneratedLabFiles({ lessonId: "git-101", title: "Meet Git", objective: "Recognize the core workflow." }, "cg-git-x");
  const lab = JSON.parse(files["lab.json"]);
  assert.equal(lab.id, "git-101");
  assert.equal(lab.tasks[0].auto, "file-edited");
  assert.equal(lab.checkpoint.requirements[0].kind, "verify");
  assert.equal(files["template/solution.txt"], "TODO", "ships broken");
  const bp = JSON.parse(files["blueprint.json"]);
  assert.equal(bp.driver, "local");
  assert.ok(bp.defects.stub.solution.includes("SOLVED") || bp.defects.stub.solution.some((s: string) => s.includes("SOLVED")));
});

test("the generated lab auto-solves: broken as shipped AND solvable", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-"));
  tmp.push(root);
  const files = buildGeneratedLabFiles({ lessonId: "demo-101", title: "Demo", objective: "Complete the stub." }, "cg-demo-x");
  const labDir = writeGeneratedLab(root, "demo-101", files);

  const reports = await autoSolveGeneratedLab(labDir, "demo-101");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].brokenAsShipped, true, "verifier fails on the TODO template");
  assert.equal(reports[0].solvable, true, "authored solution makes the verifier pass");
  assert.equal(reports[0].ok, true);
});

test("a tampered lab whose solution doesn't fix it is caught (not solvable)", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-genlab-bad-"));
  tmp.push(root);
  const files = buildGeneratedLabFiles({ lessonId: "bad-101", title: "Bad", objective: "x" }, "cg-bad-x");
  // Break the solution so it writes the wrong value — auto-solve must reject it.
  const bp = JSON.parse(files["blueprint.json"]);
  bp.defects.stub.solution = ["node", "-e", "require('fs').writeFileSync('solution.txt','WRONG')"];
  files["blueprint.json"] = JSON.stringify(bp);
  const labDir = writeGeneratedLab(root, "bad-101", files);

  const reports = await autoSolveGeneratedLab(labDir, "bad-101");
  assert.equal(reports[0].brokenAsShipped, true);
  assert.equal(reports[0].solvable, false, "the wrong solution must not pass the verifier");
  assert.equal(reports[0].ok, false);
});
