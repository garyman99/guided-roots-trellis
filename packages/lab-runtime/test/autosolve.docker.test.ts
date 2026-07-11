/**
 * CI AUTO-SOLVE for docker-driver blueprint labs (blueprint.driver === "docker").
 *
 * Browser labs (e.g. Playwright) depend on tools baked into their lab image,
 * so their variants are proven broken-then-solvable against the REAL
 * DockerDriver — the same driver learners get. Where no docker daemon or lab
 * image is available this suite SKIPS loudly instead of passing silently:
 * "skipped" is a visible gap, "green without proof" would be a lie.
 *
 * Requires (when runnable): a reachable docker daemon (DOCKER_HOST honored)
 * and the lab image `trellis-lab-<labId>` built beforehand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DockerDriver } from "../src/dockerDriver.ts";
import { loadBlueprint } from "../src/variants.ts";
import { autoSolveAll } from "../src/autosolve.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const dockerLabs = readdirSync(join(repoRoot, "labs"))
  .filter((id) => existsSync(join(repoRoot, "labs", id, "blueprint.json")))
  .map((id) => ({ labId: id, labDir: join(repoRoot, "labs", id), bp: loadBlueprint(join(repoRoot, "labs", id))! }))
  .filter((l) => l.bp.driver === "docker");

function docker(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: 15_000 }, (err, stdout) =>
      resolve({ code: err ? 1 : 0, stdout: String(stdout) }),
    );
  });
}

test("CI AUTO-SOLVE (docker): every variant of every docker-driver blueprint lab is broken as shipped AND solvable", { timeout: 600_000 }, async (t) => {
  if (dockerLabs.length === 0) {
    t.skip("no docker-driver blueprint labs exist");
    return;
  }
  if ((await docker(["info"])).code !== 0) {
    t.skip("docker daemon not reachable — docker-lab variants NOT proven in this environment");
    return;
  }
  for (const lab of dockerLabs) {
    const image = `trellis-lab-${lab.labId}`;
    if ((await docker(["image", "inspect", image])).code !== 0) {
      t.skip(`image ${image} not built — run: docker build -t ${image} labs/${lab.labId}`);
      return;
    }
  }

  // Browser labs need real resources; mirrors the api's env-tunable limits.
  const driver = new DockerDriver({ cpus: "2", memory: "1g", pidsLimit: 512 });
  for (const lab of dockerLabs) {
    const reports = await autoSolveAll(driver, { labDir: lab.labDir, labId: lab.labId }, lab.bp, "docker");
    assert.equal(reports.length, Object.keys(lab.bp.defects).length);
    for (const r of reports) {
      assert.equal(r.brokenAsShipped, true, `${lab.labId}/${r.defect}: verifier must fail before the fix (${r.detail ?? ""})`);
      assert.equal(r.solvable, true, `${lab.labId}/${r.defect}: authored solution must pass the verifier (${r.detail ?? ""})`);
      assert.equal(r.ok, true);
    }
  }
});
