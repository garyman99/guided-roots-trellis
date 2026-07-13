/**
 * capture-baseline — snapshot the current ACCEPTED scenarios as an immutable,
 * reloadable baseline (ADR-0006 D38; plan Phase 2 item 4).
 *
 * A baseline pins, for every ACCEPTED scenario: its registry record (scores,
 * threshold, product commit), the sha256 of its immutable imported spec, and
 * a hash of every committed evidence file under scenarios/runs/<id>/ — so a
 * later experiment can prove it is comparing against exactly this state.
 *
 * Usage:
 *   node tools/experiments/capture-baseline.mjs            # capture
 *   node tools/experiments/capture-baseline.mjs --verify <baseline.json>
 *
 * Capture refuses to overwrite an existing baseline file (immutability).
 * Verify recomputes every hash and exits non-zero on drift.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const REGISTRY = join(ROOT, "scenarios", "registry.json");
const OUT_DIR = join(ROOT, "scenarios", "experiments", "baselines");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function hashTree(dir) {
  if (!existsSync(dir)) return [];
  return [...walk(dir)]
    .map((p) => ({ path: relative(ROOT, p).replaceAll("\\", "/"), sha256: sha256(p), bytes: statSync(p).size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function capture() {
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const accepted = Object.entries(registry.scenarios).filter(([, s]) => s.status === "ACCEPTED");
  if (accepted.length === 0) {
    console.error("no ACCEPTED scenarios in the registry — nothing to baseline");
    process.exit(1);
  }
  const baseline = {
    schemaVersion: "baseline@1",
    capturedAt: new Date().toISOString(),
    capturedAtCommit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    registrySha256: sha256(REGISTRY),
    scenarios: Object.fromEntries(
      accepted.map(([id, record]) => [
        id,
        {
          registryRecord: record,
          specSha256: sha256(join(ROOT, record.file)),
          evidence: hashTree(join(ROOT, "scenarios", "runs", id)),
        },
      ]),
    ),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `baseline-${baseline.capturedAt.slice(0, 10)}.json`);
  if (existsSync(out)) {
    console.error(`refusing to overwrite existing baseline: ${relative(ROOT, out)} (baselines are immutable)`);
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n", { flag: "wx" });
  console.log(`baseline captured: ${relative(ROOT, out).replaceAll("\\", "/")}`);
  console.log(`scenarios: ${accepted.map(([id]) => id).join(", ")}`);
}

function verify(path) {
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  let drift = 0;
  const complain = (msg) => { drift += 1; console.error(`DRIFT: ${msg}`); };
  for (const [id, snap] of Object.entries(baseline.scenarios)) {
    const specPath = join(ROOT, snap.registryRecord.file);
    if (!existsSync(specPath)) complain(`${id}: spec missing (${snap.registryRecord.file})`);
    else if (sha256(specPath) !== snap.specSha256) complain(`${id}: spec hash changed`);
    for (const ev of snap.evidence) {
      const p = join(ROOT, ev.path);
      if (!existsSync(p)) complain(`${id}: evidence missing (${ev.path})`);
      else if (sha256(p) !== ev.sha256) complain(`${id}: evidence changed (${ev.path})`);
    }
  }
  if (drift) {
    console.error(`baseline verify FAILED: ${drift} drifted item(s)`);
    process.exit(1);
  }
  console.log(`baseline verify OK: ${Object.keys(baseline.scenarios).length} scenario(s), all hashes match`);
}

const args = process.argv.slice(2);
const vi = args.indexOf("--verify");
if (vi !== -1) verify(args[vi + 1]);
else capture();
