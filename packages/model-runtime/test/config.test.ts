import { test } from "node:test";
import assert from "node:assert/strict";

import { isLocalBaseUrl, ModelConfigError, resolveRoleConfig } from "../src/config.ts";

test("defaults to mock for every role with an empty env", () => {
  for (const role of ["guide", "simulator", "evaluator"] as const) {
    assert.deepEqual(resolveRoleConfig(role, {}), { role, provider: "mock" });
  }
});

test("guide falls back to legacy INSTRUCTOR_PROVIDER and 'openai' normalizes", () => {
  const cfg = resolveRoleConfig("guide", {
    INSTRUCTOR_PROVIDER: "openai",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OPENAI_API_KEY: "k",
    OPENAI_MODEL: "some-model",
  });
  assert.equal(cfg.provider, "openai-compatible");
  assert.equal(cfg.model, "some-model");
  // Legacy fallback is guide-only:
  assert.equal(resolveRoleConfig("simulator", { INSTRUCTOR_PROVIDER: "openai" }).provider, "mock");
});

test("role-scoped vars beat legacy/shared vars", () => {
  const cfg = resolveRoleConfig("guide", {
    INSTRUCTOR_PROVIDER: "mock",
    GUIDE_PROVIDER: "anthropic",
    GUIDE_MODEL: "role-model",
    GUIDE_API_KEY: "role-key",
    ANTHROPIC_API_KEY: "shared-key",
  });
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.model, "role-model");
  assert.equal(cfg.apiKey, "role-key");
  assert.equal(cfg.baseUrl, "https://api.anthropic.com");
});

test("roles resolve independently (guide anthropic, simulator local, evaluator mock)", () => {
  const env = {
    GUIDE_PROVIDER: "anthropic",
    GUIDE_MODEL: "m1",
    ANTHROPIC_API_KEY: "k",
    SIMULATOR_PROVIDER: "openai-compatible",
    SIMULATOR_MODEL: "local-model",
    SIMULATOR_BASE_URL: "http://localhost:1234/v1",
  };
  assert.equal(resolveRoleConfig("guide", env).provider, "anthropic");
  const sim = resolveRoleConfig("simulator", env);
  assert.equal(sim.provider, "openai-compatible");
  assert.equal(sim.baseUrl, "http://localhost:1234/v1");
  assert.equal(sim.apiKey, undefined, "local endpoint needs no key");
  assert.equal(resolveRoleConfig("evaluator", env).provider, "mock");
});

test("anthropic without model or key fails naming the exact variable", () => {
  assert.throws(
    () => resolveRoleConfig("guide", { GUIDE_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }),
    (e: ModelConfigError) => e.name === "ModelConfigError" && e.message.includes("GUIDE_MODEL"),
  );
  assert.throws(
    () => resolveRoleConfig("evaluator", { EVALUATOR_PROVIDER: "anthropic", EVALUATOR_MODEL: "m" }),
    (e: ModelConfigError) => e.message.includes("EVALUATOR_API_KEY") && e.message.includes("ANTHROPIC_API_KEY"),
  );
});

test("openai-compatible: key required for remote, optional for local; model always required", () => {
  assert.throws(
    () => resolveRoleConfig("guide", { GUIDE_PROVIDER: "openai-compatible", GUIDE_MODEL: "m" }),
    (e: ModelConfigError) => e.message.includes("OPENAI_API_KEY"),
  );
  assert.throws(
    () =>
      resolveRoleConfig("guide", {
        GUIDE_PROVIDER: "openai-compatible",
        GUIDE_BASE_URL: "http://localhost:1234/v1",
      }),
    (e: ModelConfigError) => e.message.includes("GUIDE_MODEL"),
  );
  const ok = resolveRoleConfig("guide", {
    GUIDE_PROVIDER: "openai-compatible",
    GUIDE_BASE_URL: "http://127.0.0.1:8080/v1",
    GUIDE_MODEL: "local-model",
  });
  assert.equal(ok.apiKey, undefined);
});

test("unknown provider strings fail loudly instead of silently mocking", () => {
  assert.throws(
    () => resolveRoleConfig("guide", { GUIDE_PROVIDER: "opeanai" }),
    (e: ModelConfigError) => e.message.includes('"opeanai"') && e.message.includes("valid:"),
  );
});

test("isLocalBaseUrl recognizes loopback shapes only", () => {
  assert.equal(isLocalBaseUrl("http://localhost:1234/v1"), true);
  assert.equal(isLocalBaseUrl("http://127.0.0.1:8080/v1"), true);
  assert.equal(isLocalBaseUrl("http://[::1]:8080/v1"), true);
  assert.equal(isLocalBaseUrl("https://api.openai.com/v1"), false);
  assert.equal(isLocalBaseUrl("not a url"), false);
});
