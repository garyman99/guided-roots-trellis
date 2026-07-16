/**
 * The capability registry must stay honest: every auto-rule it advertises to
 * course generation is one taskAutoDone() actually implements, and its shape
 * covers the surfaces/apps/checkpoint-kinds the runtime really has. A drift
 * here would let the generator design a lesson around a signal the framework
 * can't observe — the exact failure AUTHORING.md §13 exists to prevent.
 */
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_REGISTRY, CAPABILITY_REGISTRY_VERSION } from "../src/capabilities.ts";
import { TASK_AUTO_RULES } from "../src/sessions.ts";

test("every advertised auto-rule is one the framework implements", () => {
  const advertised = CAPABILITY_REGISTRY.autoRules.map((r) => r.id).sort();
  const implemented = [...TASK_AUTO_RULES].sort();
  assert.deepEqual(advertised, implemented, "registry auto-rules must equal TASK_AUTO_RULES exactly");
});

test("auto-rules carry a surface, label, and description", () => {
  for (const r of CAPABILITY_REGISTRY.autoRules) {
    assert.ok(r.label && r.description, `${r.id} needs label + description`);
    assert.ok(r.surface === "terminal" || r.surface === "workspace", `${r.id} surface must be terminal|workspace`);
  }
});

test("registry declares both lab surfaces and both drivers", () => {
  assert.deepEqual(CAPABILITY_REGISTRY.surfaces.map((s) => s.id).sort(), ["terminal", "workspace"]);
  assert.deepEqual(CAPABILITY_REGISTRY.runtime.drivers.map((d) => d.id).sort(), ["docker", "local"]);
});

test("checkpoint kinds match the evaluator's CheckpointRequirementSpec union", () => {
  // Mirror of packages/lab-runtime/src/evaluator.ts CheckpointRequirementSpec.kind.
  assert.deepEqual(
    CAPABILITY_REGISTRY.checkpointKinds.map((k) => k.id).sort(),
    ["repo", "session", "tests", "verify", "workspace"],
  );
});

test("built-in apps are present and the network-none fact is declared", () => {
  const builtin = CAPABILITY_REGISTRY.apps.filter((a) => a.builtin).map((a) => a.id);
  assert.ok(builtin.includes("guide") && builtin.includes("code"), "guide + code are built in");
  assert.ok(
    CAPABILITY_REGISTRY.runtime.facts.some((f) => /--network none/.test(f)),
    "the no-network runtime fact must be advertised",
  );
  assert.equal(CAPABILITY_REGISTRY.version, CAPABILITY_REGISTRY_VERSION);
});
