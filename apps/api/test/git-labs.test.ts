/**
 * The lesson-specific Git labs are real, playable git exercises that prove
 * themselves via the auto-solve harness (broken-as-shipped AND solvable) on the
 * local driver — the same bar as a hand-authored lab.
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGitLabFiles, GIT_LAB_KINDS, isGitLabKind } from "../src/gitLabs.ts";
import { writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows */ } });

test("isGitLabKind guards the known kinds", () => {
  assert.ok(isGitLabKind("git-commit"));
  assert.ok(isGitLabKind("git-discard"));
  assert.ok(!isGitLabKind("git-rebase"));
  assert.ok(!isGitLabKind(undefined));
});

for (const kind of GIT_LAB_KINDS) {
  test(`the ${kind} lab auto-solves (broken-as-shipped AND solvable)`, async () => {
    const root = mkdtempSync(join(tmpdir(), `trellis-gitlab-${kind}-`));
    tmp.push(root);
    const files = buildGitLabFiles(kind, { lessonId: `${kind}-1`, title: "T", objective: "O" }, "cg-git-x");
    // The blueprint's id is the lab id (not the kind).
    assert.equal(JSON.parse(files["blueprint.json"]).blueprintId, `${kind}-1`);
    assert.equal(JSON.parse(files["lab.json"]).generated.kind, kind);

    const labDir = writeGeneratedLab(root, `${kind}-1`, files);
    const reports = await autoSolveGeneratedLab(labDir, `${kind}-1`);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].brokenAsShipped, true);
    assert.equal(reports[0].solvable, true);
    assert.equal(reports[0].ok, true);
  });
}
