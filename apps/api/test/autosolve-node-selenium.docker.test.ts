/**
 * End-to-end proof of the per-course Environment image (plan L5/P2): a GENERATED
 * node-deps lab, stamped with a baked image (stampLabImage), auto-solves inside
 * the REAL container on THAT image via the DockerDriver — proving the whole
 * runtime path (def.image → container on the course's toolchain → template/verify
 * staged in → verifier runs there → broken-as-shipped AND solvable).
 *
 * Skips LOUDLY where no docker daemon or the image is missing (ADR-0003 D26) —
 * "skipped" is a visible gap, "green without proof" would be a lie. On this dev
 * machine, run against Rancher:
 *   DOCKER_HOST=npipe:////./pipe/docker_engine \
 *   node --test apps/api/test/autosolve-node-selenium.docker.test.ts
 */
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerDriver } from "../../../packages/lab-runtime/src/dockerDriver.ts";
import { loadBlueprint } from "../../../packages/lab-runtime/src/variants.ts";
import { autoSolveAll } from "../../../packages/lab-runtime/src/autosolve.ts";
import { buildNodeLabFiles } from "../src/nodeLabs.ts";
import { stampLabImage, writeGeneratedLab } from "../src/generatedLab.ts";

const IMAGE = "trellis-lab-node-selenium";
const SELENIUM_DEPS = ["selenium-webdriver", "typescript", "tsx", "@types/selenium-webdriver"];

function docker(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: 20_000 }, (err, stdout) => resolve({ code: err ? 1 : 0, stdout: String(stdout) }));
  });
}

test("CI AUTO-SOLVE (docker): a stamped node-deps lab is broken-as-shipped AND solvable ON its course image", { timeout: 300_000 }, async (t) => {
  if ((await docker(["info"])).code !== 0) {
    t.skip("docker daemon not reachable — the per-course-image runtime is NOT proven here");
    return;
  }
  if ((await docker(["image", "inspect", IMAGE])).code !== 0) {
    t.skip(`image ${IMAGE} not built — run: docker build -t ${IMAGE} docker/lab-node-selenium`);
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "trellis-nodesel-"));
  try {
    const labId = "selenium-setup";
    const files = stampLabImage(
      buildNodeLabFiles("node-deps", { lessonId: labId, title: "Set up dependencies", objective: "Declare the four deps." }, SELENIUM_DEPS, "cg-selenium-x", "pwsh"),
      IMAGE,
    );
    const labDir = writeGeneratedLab(root, labId, files);
    const bp = loadBlueprint(labDir)!;

    // The def carries the stamped image + stageDir exactly as labRuntime() supplies
    // them at runtime, so DockerDriver runs the container ON trellis-lab-node-selenium
    // and docker-cp's this lab's template/verify into /opt/lab.
    const driver = new DockerDriver();
    const reports = await autoSolveAll(driver, { labDir, labId, image: IMAGE, stageDir: labDir, shell: "pwsh" }, bp, "docker");

    assert.equal(reports.length, 1);
    for (const r of reports) {
      assert.equal(r.brokenAsShipped, true, `verifier must fail on the bare package.json in-container (${r.detail ?? ""})`);
      assert.equal(r.solvable, true, `declaring the deps must pass the verifier in-container (${r.detail ?? ""})`);
      assert.equal(r.ok, true);
    }
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* windows handle */ }
  }
});
