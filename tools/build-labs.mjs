// Build the Docker images the `docker` lab driver expects.
//
// The driver looks for an image named `trellis-lab-<labId>` for each lab it
// launches (packages/lab-runtime/src/dockerDriver.ts). Those images are NOT
// built automatically, so a freshly-authored lab fails its first launch with
// "Unable to find image 'trellis-lab-<labId>' locally". This script builds
// them by convention so that never bites.
//
// Which labs: every directory under labs/ that ships a Dockerfile. Workspace
// labs (no Dockerfile — they run with no container) are skipped.
//
// Usage:
//   node tools/build-labs.mjs                 build any MISSING lab images
//   node tools/build-labs.mjs --force         rebuild ALL lab images
//   node tools/build-labs.mjs <labId> [...]   build (or rebuild) just these
//   node tools/build-labs.mjs --list          show labs + whether each is built
//   node tools/build-labs.mjs --help
//
// Docker connection: honors an existing DOCKER_HOST; on Windows it defaults to
// the Rancher Desktop named pipe (matching .claude/launch.json), so it "just
// works" with this project's documented setup.
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_PREFIX = "trellis-lab-"; // must match dockerDriver.ts

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const labsRoot = join(repoRoot, "labs");

if (!process.env.DOCKER_HOST && process.platform === "win32") {
  // Same daemon the API uses (Rancher Desktop; Docker Desktop conflicts).
  process.env.DOCKER_HOST = "npipe:////./pipe/docker_engine";
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const lines = [
    "Build the trellis-lab-<labId> Docker images the docker driver launches.",
    "",
    "  node tools/build-labs.mjs                 build any MISSING lab images",
    "  node tools/build-labs.mjs --force         rebuild ALL lab images",
    "  node tools/build-labs.mjs <labId> [...]   build (or rebuild) just these",
    "  node tools/build-labs.mjs --list          show labs + whether each is built",
  ];
  console.log(lines.join("\n"));
  process.exit(0);
}

const force = args.includes("--force");
const listOnly = args.includes("--list");
const named = args.filter((a) => !a.startsWith("-"));

/** Lab directories that ship a Dockerfile, in stable alphabetical order. */
function discoverLabs() {
  return readdirSync(labsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(labsRoot, e.name, "Dockerfile")))
    .map((e) => e.name)
    .sort();
}

const buildableLabs = discoverLabs();

// Validate any explicitly-named labs up front — a typo shouldn't silently no-op.
for (const name of named) {
  if (!buildableLabs.includes(name)) {
    console.error(`✖ "${name}" is not a lab with a Dockerfile under labs/.`);
    console.error(`  Buildable labs: ${buildableLabs.join(", ")}`);
    process.exit(2);
  }
}

const imageExists = (image) =>
  spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;

if (listOnly) {
  console.log("Lab images (image name = trellis-lab-<labId>):\n");
  for (const lab of buildableLabs) {
    console.log(`  ${imageExists(IMAGE_PREFIX + lab) ? "built  " : "MISSING"}  ${IMAGE_PREFIX + lab}`);
  }
  process.exit(0);
}

// Targets: the named labs if any were given (always (re)build those); otherwise
// every buildable lab, skipping ones already built unless --force.
const explicit = named.length > 0;
const targets = explicit ? named : buildableLabs;

const built = [];
const skipped = [];
const failed = [];

for (const lab of targets) {
  const image = IMAGE_PREFIX + lab;
  if (!explicit && !force && imageExists(image)) {
    skipped.push(lab);
    console.log(`• ${image} — already built (skip; use --force to rebuild)`);
    continue;
  }
  console.log(`\n=== building ${image} (labs/${lab}) ===`);
  const res = spawnSync("docker", ["build", "-t", image, join("labs", lab)], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (res.status === 0) built.push(lab);
  else failed.push(lab);
}

console.log("\n──────── summary ────────");
if (built.length) console.log(`built   (${built.length}): ${built.join(", ")}`);
if (skipped.length) console.log(`skipped (${skipped.length}): ${skipped.join(", ")}`);
if (failed.length) console.log(`FAILED  (${failed.length}): ${failed.join(", ")}`);

process.exit(failed.length ? 1 : 0);
