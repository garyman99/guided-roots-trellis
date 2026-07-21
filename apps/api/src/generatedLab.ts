/**
 * Generated-lab builder + auto-solve proof.
 *
 * The materializer turns each authored lesson into a COMPLETE, playable lab —
 * template workspace, a deterministic verifier, and a blueprint whose single
 * defect ships broken and has an authored solution — then proves it with the
 * same auto-solve harness every hand-authored lab must pass (broken as shipped
 * AND solvable). A lab that can't prove itself never reaches learners.
 *
 * The lab is a cross-platform, node-only "complete the stub" exercise so it
 * auto-solves via the LOCAL driver without Docker or a browser. Richer,
 * lesson-specific labs authored by a dedicated role grow behind this shape;
 * what's real here is the build → auto-solve → publish contract.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { familyOf, versionOf } from "../../../packages/shared/src/ids.ts";
import { LocalProcessDriver } from "../../../packages/lab-runtime/src/localDriver.ts";
import { autoSolveAll, type AutoSolveReport } from "../../../packages/lab-runtime/src/autosolve.ts";
import { loadBlueprint } from "../../../packages/lab-runtime/src/variants.ts";

export interface GeneratedLabLesson {
  lessonId: string;
  title: string;
  objective: string;
}

/** The verifier: the workspace's solution.txt must say SOLVED (trimmed). */
const CHECKPOINT_MJS = `// Deterministic checkpoint verifier for a generated lab.
// Runs inside the workspace (cwd = workspace); prints one JSON line: { ok }.
import { readFileSync } from "node:fs";
let content = "";
let readError = null;
try {
  content = readFileSync("solution.txt", "utf8");
} catch (err) {
  readError = String(err && err.message ? err.message : err); // missing file → not solved
}
const ok = content.trim() === "SOLVED";
// Diagnostics ride along on the SAME JSON line the evaluator parses (it only
// reads .checks), so "Check my work" can explain a mismatch instead of a bare
// fail: cwd is where the verifier looked, saw is exactly what it read there.
console.log(JSON.stringify({
  ok,
  cwd: process.cwd(),
  saw: content.slice(0, 200),
  ...(readError ? { readError } : {}),
  checks: [{ id: "solution-complete", ok, ...(ok ? {} : { detail: "Replace TODO in solution.txt with SOLVED." }) }],
}));
`;

/** Files (relative path → content) for a lesson's lab. `shell` selects the
 *  learner-facing terminal ("pwsh" for targetPlatform=windows courses). */
export function buildGeneratedLabFiles(lesson: GeneratedLabLesson, runId: string, shell?: "bash" | "pwsh"): Record<string, string> {
  const labId = lesson.lessonId;
  const readme = [
    `# ${lesson.title}`,
    ``,
    lesson.objective,
    ``,
    `## Your task`,
    ``,
    `Open \`solution.txt\` and replace \`TODO\` with \`SOLVED\`, then check your work.`,
    ``,
    `_This lab was generated (run ${runId}) and is a draft until an operator takes its course live._`,
    ``,
  ].join("\n");

  const labJson = {
    id: labId,
    ...(shell ? { shell } : {}),
    // Lesson-version identity: a revision ships as `<family>-v<N>` (immutable
    // versions); v1 keeps the bare family id.
    version: versionOf(labId),
    family: familyOf(labId),
    title: lesson.title,
    objective: lesson.objective,
    scenario: `A generated lesson. Complete the stub in solution.txt to prove the observable action this lesson teaches.`,
    // Draft-lab honesty for the guide: the Objective above is the CONCEPT to
    // teach, but this generated practice lab MEASURES only the solution.txt
    // stub. Without this note the guide coached the full objective (e.g. "run
    // npm init / install the four deps") as if it were tracked — the learner
    // spent turns answering command questions that nothing measures, then had
    // to be redirected to the stub (live-sim finding, s1). The note keeps the
    // guide's tracked step aligned with what the checkpoint actually verifies.
    instructorNotes:
      "This is a GENERATED DRAFT practice lab. Teach the lesson's ideas from the Objective if the learner asks, " +
      "but the ONLY step that is measured and checkpoint-tracked here is the single task below: editing solution.txt to say SOLVED. " +
      "Do NOT present the Objective's commands (npm, installs, running tests, opening a browser, etc.) as tracked tasks or as the way to pass — " +
      "they are the concept, not this lab's measured work. The sandbox is offline (no network, no real browser). " +
      "Guide the learner to the solution.txt edit as their one concrete step, then 'Check my work'.",
    // The stub is completed by editing a file, so the task's observable action
    // is always file-edited (regardless of the lesson's declared primaryAuto,
    // which a richer per-lesson lab author would honor).
    tasks: [{ id: "complete", title: "Complete the stub", text: "Edit solution.txt: replace TODO with SOLVED.", auto: "file-edited" }],
    checkpoint: {
      id: "cp",
      title: "Lesson complete",
      requirements: [{ id: "solution-complete", kind: "verify", label: "solution.txt says SOLVED" }],
    },
    generated: { runId, draft: true },
  };

  // The single defect ships in the template itself (solution.txt = TODO); its
  // authored solution writes SOLVED. No apply-ai-change needed — the lab is
  // broken as shipped by construction.
  const blueprint = {
    blueprintId: labId,
    driver: "local",
    teaches: [],
    exercises: [],
    defects: {
      stub: {
        description: "solution.txt ships as TODO; the learner must complete it.",
        solution: ["node", "-e", "require('fs').writeFileSync('solution.txt','SOLVED')"],
      },
    },
    tiers: { "1": { defect: "stub" } },
    ciPolicy: "every-variant-auto-solved-before-release",
  };

  return {
    "lab.json": JSON.stringify(labJson, null, 2),
    "blueprint.json": JSON.stringify(blueprint, null, 2),
    "template/solution.txt": "TODO",
    "template/README.md": readme,
    "verify/checkpoint.mjs": CHECKPOINT_MJS,
  };
}

/**
 * Stamp a per-course Environment image onto a built lab's manifest, so the
 * docker driver runs it on the course's baked toolchain instead of the shared
 * base image (plan L5). No-op when no image is given (the common case).
 */
export function stampLabImage(files: Record<string, string>, image: string | undefined): Record<string, string> {
  if (!image || !files["lab.json"]) return files;
  const manifest = JSON.parse(files["lab.json"]);
  manifest.image = image;
  return { ...files, "lab.json": JSON.stringify(manifest, null, 2) };
}

/** Write a generated lab's files under <publishedDir>/<labId>/. */
export function writeGeneratedLab(publishedDir: string, labId: string, files: Record<string, string>): string {
  const labDir = join(publishedDir, labId);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(labDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return labDir;
}

/** Prove a generated lab: every blueprint variant broken-as-shipped AND solvable. */
export async function autoSolveGeneratedLab(labDir: string, labId: string): Promise<AutoSolveReport[]> {
  const bp = loadBlueprint(labDir);
  if (!bp) throw new Error(`generated lab ${labId} has no blueprint.json`);
  return autoSolveAll(new LocalProcessDriver(), { labDir, labId }, bp, "local");
}
