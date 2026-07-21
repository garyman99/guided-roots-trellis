/**
 * P0 tracer for docs/plans/lab-authoring-control-plane.md.
 *
 * Proves the load-bearing claim of the new control plane: a REAL lab — a real
 * task and a real, ordinary-JS verifier that checks a genuine artifact — is
 * broken-as-shipped AND solvable under the SAME auto-solve harness the stub
 * uses, entirely OFFLINE on the local driver (no network, no Docker, no baked
 * image). This is the contract the generator will later author into (L1/L2);
 * here it's hand-authored as the reference shape (cf. learn-playwright-basics).
 *
 * The lesson is Selenium s1 ("Making a Project"). Its offline-checkable
 * success signal is NOT "npm fetched from the registry" (impossible under
 * --network none) but the end-state artifact: package.json DECLARES the four
 * dependencies. That is the L7 principle in miniature — assert the artifact the
 * offline box can actually produce. (The full "npm install prints `added`"
 * fidelity arrives in P2 with a baked offline npm cache.)
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedLab, autoSolveGeneratedLab } from "../src/generatedLab.ts";

const REQUIRED = ["selenium-webdriver", "typescript", "tsx", "@types/selenium-webdriver"];

/**
 * The real lab's files — exactly the artifact set a human (or, later, the
 * generator) authors: lab.json + template/ + verify/checkpoint.mjs +
 * blueprint.json. No stub, no LabSpec intermediate; the verifier is plain JS.
 */
function buildProjectSetupLab(labId: string): Record<string, string> {
  const verifier = `// Real verifier: package.json must DECLARE the four course dependencies.
// Offline-checkable end-state (no install/network needed). Prints one JSON line.
import { readFileSync } from "node:fs";
const REQUIRED = ${JSON.stringify(REQUIRED)};
let pkg = null, readError = null;
try { pkg = JSON.parse(readFileSync("package.json", "utf8")); }
catch (err) { readError = String(err && err.message ? err.message : err); }
const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
const missing = REQUIRED.filter((d) => !(d in deps));
const ok = !readError && missing.length === 0;
console.log(JSON.stringify({
  ok,
  cwd: process.cwd(),
  saw: Object.keys(deps),
  ...(readError ? { readError } : {}),
  checks: [{ id: "deps-declared", ok, ...(ok ? {} : { detail: readError ? \`package.json unreadable: \${readError}\` : \`package.json is missing: \${missing.join(", ")}\` }) }],
}));
`;

  // Auto-solve's authored solution: declare the four deps. This is what a
  // perfect solver does; the harness runs it to prove the lab is solvable.
  const solution = [
    "node",
    "-e",
    `const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies=Object.assign(p.dependencies||{},{'selenium-webdriver':'^4.18.1','typescript':'^5.4.2','tsx':'^4.7.1','@types/selenium-webdriver':'^4.1.22'});fs.writeFileSync('package.json',JSON.stringify(p,null,2));`,
  ];

  return {
    "lab.json": JSON.stringify(
      {
        id: labId,
        shell: "pwsh",
        version: 1,
        family: labId,
        title: "Making a Project — declare your four dependencies",
        objective:
          "Add selenium-webdriver, typescript, tsx and @types/selenium-webdriver to package.json's dependencies.",
        scenario: "You have an empty selenium-course project. Set up its shopping list of dependencies.",
        tasks: [
          {
            id: "declare-deps",
            title: "Declare the dependencies",
            text: "Open package.json and add the four course packages to its dependencies.",
            auto: "file-edited",
            autoPath: "package.json",
          },
        ],
        checkpoint: {
          id: "cp",
          title: "Lesson complete",
          requirements: [
            { id: "deps-declared", kind: "verify", label: "package.json declares the four dependencies" },
          ],
        },
      },
      null,
      2,
    ),
    "blueprint.json": JSON.stringify(
      {
        blueprintId: labId,
        driver: "local",
        teaches: [],
        exercises: [],
        defects: {
          "no-deps": {
            description: "package.json ships with no dependencies; the learner declares the four.",
            solution,
          },
        },
        tiers: { "1": { defect: "no-deps" } },
        ciPolicy: "every-variant-auto-solved-before-release",
      },
      null,
      2,
    ),
    // Ships BROKEN by construction: a bare package.json with no dependencies.
    "template/package.json": JSON.stringify(
      { name: "selenium-course", version: "1.0.0", private: true, dependencies: {} },
      null,
      2,
    ),
    "verify/checkpoint.mjs": verifier,
  };
}

const tmp: string[] = [];
after(() => {
  for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ }
});

test("P0: a REAL lab (real task + real verifier) auto-solves offline — broken as shipped AND solvable", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-reallab-"));
  tmp.push(root);
  const labId = "project-setup-tracer";
  const labDir = writeGeneratedLab(root, labId, buildProjectSetupLab(labId));

  const reports = await autoSolveGeneratedLab(labDir, labId);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].brokenAsShipped, true, "verifier FAILS on the bare package.json (no deps declared)");
  assert.equal(reports[0].solvable, true, "declaring the four deps makes the verifier PASS");
  assert.equal(reports[0].ok, true);
});

test("P0: the fail-closed gate has teeth — a solution that under-declares does NOT pass", async () => {
  const root = mkdtempSync(join(tmpdir(), "trellis-reallab-bad-"));
  tmp.push(root);
  const labId = "project-setup-tracer-bad";
  const files = buildProjectSetupLab(labId);
  // Break the solution: declare only THREE of the four deps. Auto-solve must
  // reject it (not solvable) — exactly what stops a wrong lab from shipping.
  const bp = JSON.parse(files["blueprint.json"]);
  bp.defects["no-deps"].solution = [
    "node",
    "-e",
    `const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies={'selenium-webdriver':'^4.18.1','typescript':'^5.4.2','tsx':'^4.7.1'};fs.writeFileSync('package.json',JSON.stringify(p,null,2));`,
  ];
  files["blueprint.json"] = JSON.stringify(bp);
  const labDir = writeGeneratedLab(root, labId, files);

  const reports = await autoSolveGeneratedLab(labDir, labId);
  assert.equal(reports[0].brokenAsShipped, true);
  assert.equal(reports[0].solvable, false, "under-declaring the deps must NOT pass the verifier");
  assert.equal(reports[0].ok, false);
});
