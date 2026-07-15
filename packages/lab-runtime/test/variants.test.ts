import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalProcessDriver } from "../src/localDriver.ts";
import { loadBlueprint, resolveVariant, chooseTier, findVariant } from "../src/variants.ts";
import { autoSolveVariant, autoSolveAll } from "../src/autosolve.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const labDir = join(repoRoot, "labs", "inspect-generated-changes");
const def = { labDir, labId: "inspect-generated-changes" };
const bp = loadBlueprint(labDir)!;

/** Discover every lab that declares a blueprint — the harness must generalize. */
const allBlueprintLabs = readdirSync(join(repoRoot, "labs"))
  .filter((id) => existsSync(join(repoRoot, "labs", id, "blueprint.json")))
  .map((id) => ({ labId: id, labDir: join(repoRoot, "labs", id), bp: loadBlueprint(join(repoRoot, "labs", id))! }));

test("blueprint loads; variant resolution is deterministic; unknown tiers fall back", () => {
  assert.ok(bp);
  assert.deepEqual(resolveVariant(bp, 1), { variantId: "tier1:rounding-floor", tier: 1, defect: "rounding-floor" });
  assert.deepEqual(resolveVariant(bp, 2), { variantId: "tier2:subtotal-accumulation", tier: 2, defect: "subtotal-accumulation" });
  assert.equal(resolveVariant(bp, 99).tier, 1, "unknown tier falls back to the lowest");
  assert.deepEqual(resolveVariant(bp, 2), resolveVariant(bp, 2), "same inputs, same variant, forever");
});

test("findVariant: round-trips resolveVariant's own output (resume support)", () => {
  for (const tier of [1, 2]) {
    const resolved = resolveVariant(bp, tier);
    assert.deepEqual(findVariant(bp, resolved.variantId), resolved, `tier ${tier} round-trips through its own variantId`);
  }
});

test("findVariant: null when the tier no longer exists on the blueprint", () => {
  assert.equal(findVariant(bp, "tier99:rounding-floor"), null, "no tier 99 in this blueprint");
});

test("findVariant: null when the tier's defect assignment changed since the session started", () => {
  // Same shape as a real recorded variantId, but tier 1 now maps to a
  // DIFFERENT defect than the one recorded — the blueprint invariant no
  // longer holds, so this must be treated as "lab changed", not silently
  // resolved to whatever tier 1 is today.
  assert.equal(findVariant(bp, "tier1:subtotal-accumulation"), null, "tier 1's defect is rounding-floor, not this one");
});

test("findVariant: null on a garbage/malformed variantId", () => {
  for (const garbage of ["", "not-a-variant-id", "tier:rounding-floor", "tierX:rounding-floor", "1:rounding-floor", "tier1"]) {
    assert.equal(findVariant(bp, garbage), null, garbage);
  }
});

test("tier selection has hysteresis: immediate promotion, damped demotion, never mid-lab", () => {
  assert.equal(chooseTier(false, []), 1, "cold start is tier 1");
  assert.equal(chooseTier(true, [1]), 2, "mastery promotes (rule already demanded sustained evidence)");
  assert.equal(chooseTier(false, [1, 2]), 2, "ONE noisy non-mastered read does not demote");
  assert.equal(chooseTier(false, [2, 2]), 1, "two consecutive reads without the signal demote");
  assert.equal(chooseTier(true, [2]), 2, "capped at max tier");
});

test("CI AUTO-SOLVE: every variant of EVERY local-driver blueprint lab is broken as shipped AND solvable", async () => {
  const driver = new LocalProcessDriver();
  // Labs whose blueprint declares driver:"docker" need tools baked into their
  // image (e.g. Playwright browsers) and are auto-solved by the docker harness
  // in autosolve.docker.test.ts instead — same ciPolicy, different runner.
  const localLabs = allBlueprintLabs.filter((l) => (l.bp.driver ?? "local") === "local");
  assert.ok(localLabs.length >= 2, "the axes must generalize: at least two local blueprint labs expected");
  for (const lab of localLabs) {
    const reports = await autoSolveAll(driver, { labDir: lab.labDir, labId: lab.labId }, lab.bp);
    assert.equal(reports.length, Object.keys(lab.bp.defects).length);
    for (const r of reports) {
      assert.equal(r.brokenAsShipped, true, `${lab.labId}/${r.defect}: verifier must fail before the fix (${r.detail ?? ""})`);
      assert.equal(r.solvable, true, `${lab.labId}/${r.defect}: authored solution must pass the verifier (${r.detail ?? ""})`);
      assert.equal(r.ok, true);
    }
  }
});

test("LAB LINT: manifests parse, blueprint concepts are registered, tiers reference real defects, timelines authored", () => {
  const curriculum = JSON.parse(readFileSync(join(repoRoot, "curriculum", "concepts.json"), "utf8")) as {
    concepts: Array<{ id: string }>;
  };
  const registered = new Set(curriculum.concepts.map((c) => c.id));
  for (const lab of allBlueprintLabs) {
    const manifest = JSON.parse(readFileSync(join(lab.labDir, "lab.json"), "utf8"));
    assert.equal(manifest.id, lab.labId, `${lab.labId}: manifest id matches folder`);
    assert.ok(Array.isArray(manifest.agentTimeline) && manifest.agentTimeline.length >= 4, `${lab.labId}: agent timeline authored`);
    assert.ok(
      manifest.agentTimeline.every((b: { atOffsetMs: number }) => b.atOffsetMs < 0),
      `${lab.labId}: agent beats precede the learner's arrival`,
    );
    for (const c of [...lab.bp.teaches, ...lab.bp.exercises]) {
      assert.ok(registered.has(c), `${lab.labId}: concept "${c}" must exist in the registry`);
    }
    for (const [tier, spec] of Object.entries(lab.bp.tiers)) {
      assert.ok(lab.bp.defects[spec.defect], `${lab.labId}: tier ${tier} references a real defect`);
    }
    assert.ok(existsSync(join(lab.labDir, "verify", "checkpoint.mjs")), `${lab.labId}: verifier present`);
    assert.ok(existsSync(join(lab.labDir, "template", "scripts", "test.mjs")), `${lab.labId}: results channel present`);
  }
});

test("CI AUTO-SOLVE rejects an unsolvable variant instead of shipping it", async () => {
  const driver = new LocalProcessDriver();
  // Fixture: a defect whose "solution" does nothing. The harness must catch it.
  const broken = {
    ...bp,
    defects: { ...bp.defects, "rounding-floor": { ...bp.defects["rounding-floor"], solution: ["true"] } },
  };
  const report = await autoSolveVariant(driver, def, broken, "rounding-floor");
  assert.equal(report.brokenAsShipped, true);
  assert.equal(report.solvable, false);
  assert.equal(report.ok, false, "unsolvable variants cannot ship");
});
