/**
 * The served scenario catalog is the seed overlaid by runtime entries: a
 * runtime entry supersedes a seed entry with the same labId, and runtime-only
 * entries are appended. This is what lets a materialized generated course add a
 * scenario without a web rebuild (plan D2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIO_SEED, mergeScenarios, type Scenario } from "../src/scenarios.ts";

const runtime = (labId: string, title: string, level: Scenario["level"] = "beginner"): Scenario => ({
  labId,
  title,
  blurb: "b",
  tag: "T",
  role: "QA & Testing",
  technologies: ["Playwright"],
  level,
});

test("empty runtime returns the seed unchanged and in order", () => {
  const merged = mergeScenarios(SCENARIO_SEED, []);
  assert.deepEqual(merged.map((s) => s.labId), SCENARIO_SEED.map((s) => s.labId));
});

test("a runtime entry with a new labId is appended after the seed", () => {
  const merged = mergeScenarios(SCENARIO_SEED, [runtime("gen-git-101", "Generated Git 101")]);
  assert.equal(merged.length, SCENARIO_SEED.length + 1);
  assert.equal(merged.at(-1)!.labId, "gen-git-101");
});

test("a runtime entry supersedes a seed entry with the same labId, keeping position", () => {
  const seedId = SCENARIO_SEED[0].labId;
  const merged = mergeScenarios(SCENARIO_SEED, [runtime(seedId, "OVERRIDDEN TITLE")]);
  assert.equal(merged.length, SCENARIO_SEED.length, "no new row for an override");
  assert.equal(merged[0].labId, seedId, "position preserved");
  assert.equal(merged[0].title, "OVERRIDDEN TITLE", "runtime content wins");
});
