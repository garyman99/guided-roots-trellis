/**
 * Real, playable Node/npm lab builders — the lesson-specific labs a generated
 * Node course materializes into, instead of the generic "complete the stub"
 * lab. Sibling of gitLabs.ts; same contract (template + verifier + blueprint +
 * authored solution, proven by the auto-solve harness on the local driver).
 *
 * `node-deps` — the project-setup lesson. The workspace ships a bare
 * package.json; the learner declares the course's dependencies. The verifier
 * asserts the EXACT expected packages appear in dependencies/devDependencies —
 * an OFFLINE end-state check (no `npm install`/network needed), which is the
 * plan's L7 principle: assert the artifact the offline box can produce. (The
 * full "`npm install` prints `added`" fidelity arrives with a baked offline npm
 * cache; declaring the shopping list is checkable today.)
 *
 * The generator declares WHICH lab a lesson needs (lesson.lab.kind) and the
 * structured data it requires (lesson.lab.expectedPackages); the materializer
 * calls the matching builder here.
 */
import { familyOf, versionOf } from "../../../packages/shared/src/ids.ts";

export type NodeLabKind = "node-deps";
export const NODE_LAB_KINDS: NodeLabKind[] = ["node-deps"];

export interface NodeLabLesson {
  lessonId: string;
  title: string;
  objective: string;
}

export function isNodeLabKind(kind: string | undefined): kind is NodeLabKind {
  return kind === "node-deps";
}

/** Build a real node lab's files for the given kind. `packages` is the exact
 *  set the verifier requires package.json to declare. */
export function buildNodeLabFiles(
  kind: NodeLabKind,
  lesson: NodeLabLesson,
  packages: string[],
  runId: string,
  shell?: "bash" | "pwsh",
): Record<string, string> {
  // kind is a single value today; the switch keeps room for siblings (scripts, tests).
  return nodeDepsFiles(lesson, packages, runId, shell);
}

function nodeDepsFiles(
  lesson: NodeLabLesson,
  packages: string[],
  runId: string,
  shell?: "bash" | "pwsh",
): Record<string, string> {
  const required = JSON.stringify(packages);
  // A conventional caret range per package for the authored solution — the
  // verifier checks PRESENCE, not the range, so any valid range solves it.
  const solutionDeps = JSON.stringify(Object.fromEntries(packages.map((p) => [p, "^1.0.0"])));

  const labJson = JSON.stringify(
    {
      id: lesson.lessonId,
      ...(shell ? { shell } : {}),
      version: versionOf(lesson.lessonId),
      family: familyOf(lesson.lessonId),
      title: lesson.title,
      objective: lesson.objective,
      scenario: `A generated Node lesson. Your project's package.json is missing its dependencies; declare them so the project can run.`,
      tasks: [
        {
          id: "declare-deps",
          title: "Declare the dependencies",
          text: `Add these packages to package.json's dependencies: ${packages.join(", ")}.`,
          auto: "file-edited",
          autoPath: "package.json",
        },
      ],
      // The requirement id MUST match the id the verifier emits.
      checkpoint: {
        id: "cp",
        title: "Lesson complete",
        requirements: [{ id: "deps-declared", kind: "verify", label: "package.json declares the required dependencies" }],
      },
      generated: { runId, draft: true, kind: "node-deps" },
    },
    null,
    2,
  );

  const blueprint = JSON.stringify(
    {
      blueprintId: lesson.lessonId,
      driver: "local",
      teaches: [],
      exercises: [],
      defects: {
        "no-deps": {
          description: "package.json ships with no dependencies; the learner declares the required ones.",
          // Authored solution: merge the required packages into dependencies.
          solution: [
            "node",
            "-e",
            `const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies=Object.assign(p.dependencies||{},${solutionDeps});fs.writeFileSync('package.json',JSON.stringify(p,null,2));`,
          ],
        },
      },
      tiers: { "1": { defect: "no-deps" } },
      ciPolicy: "every-variant-auto-solved-before-release",
    },
    null,
    2,
  );

  const verifier = `// Real verifier: package.json must DECLARE every required package.
// Offline-checkable end-state (no install/network). Prints one JSON line.
import { readFileSync } from "node:fs";
const REQUIRED = ${required};
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

  const readme = `# ${lesson.title}\n\n${lesson.objective}\n\n## Task\n\nYour \`package.json\` has no dependencies yet. Open it and add these packages to its \`dependencies\`:\n\n${packages.map((p) => `- \`${p}\``).join("\n")}\n\nThen check your work.\n`;

  return {
    "lab.json": labJson,
    "blueprint.json": blueprint,
    // Ships BROKEN by construction: a bare package.json with no dependencies.
    "template/package.json": JSON.stringify({ name: lesson.lessonId, version: "1.0.0", private: true, dependencies: {} }, null, 2),
    "template/README.md": readme,
    "verify/checkpoint.mjs": verifier,
  };
}
