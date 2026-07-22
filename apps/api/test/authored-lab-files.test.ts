/**
 * P4 — the model authors the FULL lab artifact set (lab.files), the same
 * contract a human authors (plan L1). Two guarantees:
 *  1. the authoring contract is enforced (lab.files must carry the minimum a
 *     provable lab needs) — validateLessonPlan;
 *  2. an authored file set is used verbatim and is TRUSTED ONLY because the
 *     auto-solve gate proves it (plan L3): broken-as-shipped AND solvable, and a
 *     bad authored lab (verifier that passes on the shipped template) is caught.
 *
 * The live model producing GOOD files is exercised in a full env; here the
 * MECHANISM is proven with a hand-authored set standing in for the model's.
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";
import { validateLessonPlan } from "../../../packages/course-architect/src/schemas.ts";

/** A complete authored artifact set — what the lesson-author emits as lab.files.
 *  A "declare a marker in notes.txt" lab (local driver, offline). */
function authoredFiles(opts: { solutionWrites: string } = { solutionWrites: "READY" }): Record<string, string> {
  return {
    "lab.json": JSON.stringify({
      id: "authored-1",
      version: 1,
      family: "authored-1",
      title: "Mark the notes ready",
      objective: "Change notes.txt to say READY.",
      scenario: "The project notes still say DRAFT.",
      tasks: [{ id: "mark", title: "Mark ready", text: "Set notes.txt to READY.", auto: "file-edited", autoPath: "notes.txt" }],
      checkpoint: { id: "cp", title: "Done", requirements: [{ id: "ready", kind: "verify", label: "notes.txt says READY" }] },
    }, null, 2),
    "blueprint.json": JSON.stringify({
      blueprintId: "authored-1",
      driver: "local",
      teaches: [],
      exercises: [],
      defects: { draft: { description: "notes.txt ships as DRAFT", solution: ["node", "-e", `require('fs').writeFileSync('notes.txt','${opts.solutionWrites}')`] } },
      tiers: { "1": { defect: "draft" } },
      ciPolicy: "every-variant-auto-solved-before-release",
    }, null, 2),
    "template/notes.txt": "DRAFT",
    "verify/checkpoint.mjs": `import { readFileSync } from "node:fs";
let c = ""; try { c = readFileSync("notes.txt","utf8"); } catch {}
const ok = c.trim() === "READY";
console.log(JSON.stringify({ ok, checks: [{ id: "ready", ok, ...(ok?{}:{detail:"notes.txt must say READY"}) }] }));
`,
  };
}

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ } });

test("P4 contract: lab.files must carry the minimum provable artifact set", () => {
  const base = { lessonId: "authored-1", markdown: "# lesson\n\nx", lab: { objective: "o", primaryAuto: "file-edited" } };
  const full = authoredFiles();
  // Complete set → valid.
  assert.doesNotThrow(() => validateLessonPlan({ ...base, lab: { ...base.lab, files: full } }, "authored-1"));
  // Missing the verifier → rejected.
  const { ["verify/checkpoint.mjs"]: _drop, ...noVerifier } = full;
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, files: noVerifier } }, "authored-1"), /verify\/checkpoint\.mjs/);
  // Non-string contents → rejected.
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, files: { "lab.json": 5 } } }, "authored-1"), /relativePath: contents/);
});

test("P1: a lab must be REAL — under-specified is rejected, and so is kind:\"stub\"", () => {
  const base = { lessonId: "x-1", markdown: "# l\n\nx", lab: { objective: "o", primaryAuto: "any-command" } };
  // An under-specified lab is invalid.
  assert.throws(() => validateLessonPlan(base, "x-1"), /must declare a real "kind".*author "files".*blockedBy/s);
  // The generic stub is gone (2026-07-22): it measured solution.txt for every
  // lesson, so it could never demonstrate what a given lesson taught.
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, kind: "stub" } }, "x-1"), /is not a lab — it measures nothing this lesson teaches/);
  for (const kind of ["none", "placeholder", "conceptual"]) {
    assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, kind } }, "x-1"), /is not a lab/, `kind:"${kind}" must not be a way back to a fake lab`);
  }
});

test("authored lab SHAPE is validated, not just file presence", () => {
  // Field finding 2026-07-22: a live author shipped blueprint.json as
  // { solutionFiles, notes } — plausible, but not the contract — and
  // loadBlueprint's Object.entries(bp.tiers) threw on undefined, interrupting a
  // 19-lesson run on lesson 1. Catch the shape here so it's a cheap retry.
  const base = { lessonId: "authored-1", markdown: "# lesson\n\nx", lab: { objective: "o", primaryAuto: "file-edited" } };
  const withFiles = (mutate: (f: Record<string, string>) => void) => {
    const files = authoredFiles();
    mutate(files);
    return { ...base, lab: { ...base.lab, files } };
  };

  // The exact blueprint the live model invented.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { f["blueprint.json"] = JSON.stringify({ solutionFiles: { "a.md": "solution/a.md" }, notes: "copy it over" }); }), "authored-1"),
    /blueprint\.json" must declare a non-empty "defects"/,
  );
  // checkpoint as a STRING (the other defect in that same lab).
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { const m = JSON.parse(f["lab.json"]); m.checkpoint = "verify/checkpoint.mjs"; f["lab.json"] = JSON.stringify(m); }), "authored-1"),
    /must declare a "checkpoint" OBJECT/,
  );
  // A tier pointing at a defect that doesn't exist — what loadBlueprint throws on.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { const b = JSON.parse(f["blueprint.json"]); b.tiers = { "1": { defect: "nope" } }; f["blueprint.json"] = JSON.stringify(b); }), "authored-1"),
    /does not name a defect declared in defects/,
  );
  // solution must be argv, not a path or prose.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { const b = JSON.parse(f["blueprint.json"]); b.defects.draft.solution = "solution/notes.txt"; f["blueprint.json"] = JSON.stringify(b); }), "authored-1"),
    /solution must be a non-empty string\[\]/,
  );
  // No tasks → nothing is graded.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { const m = JSON.parse(f["lab.json"]); m.tasks = []; f["lab.json"] = JSON.stringify(m); }), "authored-1"),
    /non-empty "tasks" array/,
  );
  // No workspace for the learner to work in.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { delete f["template/notes.txt"]; }), "authored-1"),
    /at least one "template\/…" file/,
  );
  // Malformed JSON is reported as such, not as a crash.
  assert.throws(
    () => validateLessonPlan(withFiles((f) => { f["blueprint.json"] = "{ not json"; }), "authored-1"),
    /is not valid JSON/,
  );
  // The good set still passes.
  assert.doesNotThrow(() => validateLessonPlan({ ...base, lab: { ...base.lab, files: authoredFiles() } }, "authored-1"));
});

test("the honest escape: lab.blockedBy withdraws a lesson that cannot be labbed", () => {
  const base = { lessonId: "x-1", markdown: "# l\n\nx", lab: { objective: "o", primaryAuto: "any-command" } };
  const why = "The bench is a Linux container, so a Windows GUI installer cannot be run or observed here.";
  assert.doesNotThrow(() => validateLessonPlan({ ...base, lab: { ...base.lab, blockedBy: { capability: "windows-installer", why } } }, "x-1"));
  // A vague gap is the new cheap path out of authoring — it must not open.
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, blockedBy: { capability: "windows-installer", why: "too hard" } } }, "x-1"), /why must explain/);
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, blockedBy: { capability: "Windows Installer", why } } }, "x-1"), /must be kebab-case/);
  assert.throws(() => validateLessonPlan({ ...base, lab: { ...base.lab, blockedBy: { why } } }, "x-1"), /blockedBy\.capability is required/);
  // Blocked AND labbed is incoherent — pick one.
  assert.throws(
    () => validateLessonPlan({ ...base, lab: { ...base.lab, kind: "node-deps", expectedPackages: ["x"], blockedBy: { capability: "windows-installer", why } } }, "x-1"),
    /either labbable or blocked, not both/,
  );
});

test("P4 gate: an authored file set auto-solves — broken as shipped AND solvable", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-authored-"));
  tmp.push(root);
  const labDir = writeGeneratedLab(root, "authored-1", authoredFiles());
  const reports = await autoSolveGeneratedLab(labDir, "authored-1");
  assert.equal(reports[0].brokenAsShipped, true, "verifier fails on the DRAFT template");
  assert.equal(reports[0].solvable, true, "the authored solution makes it pass");
  assert.equal(reports[0].ok, true);
});

test("P4 gate: a bad authored lab (solution doesn't satisfy the verifier) is caught", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-authored-bad-"));
  tmp.push(root);
  // The authored solution writes the WRONG value → verifier never passes.
  const labDir = writeGeneratedLab(root, "authored-1", authoredFiles({ solutionWrites: "NOPE" }));
  const reports = await autoSolveGeneratedLab(labDir, "authored-1");
  assert.equal(reports[0].brokenAsShipped, true);
  assert.equal(reports[0].solvable, false, "a lab whose solution doesn't satisfy its verifier must NOT ship");
  assert.equal(reports[0].ok, false);
});
