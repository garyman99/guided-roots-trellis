/**
 * Generated-lab write + auto-solve proof.
 *
 * The materializer turns each authored lesson into a COMPLETE, playable lab —
 * template workspace, a deterministic verifier, and a blueprint whose single
 * defect ships broken and has an authored solution — then proves it with the
 * same auto-solve harness every hand-authored lab must pass (broken as shipped
 * AND solvable). A lab that can't prove itself never reaches learners.
 *
 * There is no generic lab BUILDER here any more. The "complete the stub"
 * exercise this module used to generate — replace TODO with SOLVED in
 * solution.txt — was deleted 2026-07-22: it was identical for every lesson and
 * ignored the lesson's own primaryAuto, so a course promising "learn PowerShell"
 * graded a text edit. Labs now come from the lesson author (lab.files) or a
 * curated kind (gitLabs.ts / nodeLabs.ts); a lesson that can't have a real lab
 * is blocked and raises a capability gap instead of shipping a fake one.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { LocalProcessDriver } from "../../../packages/lab-runtime/src/localDriver.ts";
import { DockerDriver } from "../../../packages/lab-runtime/src/dockerDriver.ts";
import { autoSolveAll, type AutoSolveReport } from "../../../packages/lab-runtime/src/autosolve.ts";
import { loadBlueprint } from "../../../packages/lab-runtime/src/variants.ts";

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

/** Is a docker daemon reachable AND is `image` present on it? Cheap gate before
 *  we try to auto-solve a baked-image lab in a container. */
function dockerImageAvailable(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["image", "inspect", image], { timeout: 20_000 }, (err) => resolve(!err));
  });
}

/**
 * Prove a generated lab: every blueprint variant broken-as-shipped AND solvable.
 *
 * Driver-aware (2026-07-22): a lab that declares the docker driver (or carries a
 * baked `lab.json.image`, e.g. a Selenium browser lab) CANNOT prove on the local
 * process driver — it needs its container. So:
 *  - docker lab + daemon and image present → auto-solve in the real container
 *    (the honest end-to-end proof, same path as the .docker.test);
 *  - docker lab + no daemon/image here → SKIP LOUDLY: one ok report whose detail
 *    says it shipped UNPROVEN, never a silent green and never a false failure
 *    (the local driver has no browser, so failing it would block every browser
 *    lesson on a host without Docker);
 *  - otherwise → the local process driver, as before.
 */
export async function autoSolveGeneratedLab(labDir: string, labId: string): Promise<AutoSolveReport[]> {
  const bp = loadBlueprint(labDir);
  if (!bp) throw new Error(`generated lab ${labId} has no blueprint.json`);

  let image: string | undefined;
  let shell: "bash" | "pwsh" | undefined;
  try {
    const manifest = JSON.parse(readFileSync(join(labDir, "lab.json"), "utf8")) as { image?: string; shell?: "bash" | "pwsh" };
    image = manifest.image;
    shell = manifest.shell;
  } catch { /* no/broken manifest → treat as a local lab */ }

  if (bp.driver === "docker" || image) {
    if (!image) {
      return [{ defect: "*", brokenAsShipped: false, solvable: false, ok: false, detail: `lab is docker-driven but no image is stamped on lab.json` }];
    }
    if (!(await dockerImageAvailable(image))) {
      return [{ defect: "*", brokenAsShipped: true, solvable: true, ok: true, detail: `docker auto-solve SKIPPED — daemon or image "${image}" not available here; lab ships UNPROVEN` }];
    }
    return autoSolveAll(new DockerDriver(), { labDir, labId, image, stageDir: labDir, ...(shell ? { shell } : {}) }, bp, "docker");
  }
  return autoSolveAll(new LocalProcessDriver(), { labDir, labId }, bp, "local");
}
