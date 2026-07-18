/**
 * Per-role model tiers (quality-rework Phase 0): each pipeline role rides the
 * cheapest Claude tier that fits its job, resolved per CALL, with a documented
 * precedence chain. These tests pin the chain and prove the LiveRoleInvoker
 * actually sends a different model per role.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveRoleInvoker, ROLE_MODEL_TIERS, resolveRoleModel, COURSE_GEN_ROLES } from "../src/roles.ts";

test("tier defaults: generative roles ride Opus, judgment roles ride Sonnet", () => {
  assert.equal(ROLE_MODEL_TIERS.architect, "claude-opus-4-8");
  assert.equal(ROLE_MODEL_TIERS["lesson-author"], "claude-opus-4-8");
  for (const role of COURSE_GEN_ROLES.filter((r) => r !== "architect" && r !== "lesson-author")) {
    assert.equal(ROLE_MODEL_TIERS[role], "claude-sonnet-5", `${role} defaults to Sonnet`);
  }
});

test("resolveRoleModel precedence: per-role pick → run model → role env → tier → shared env", () => {
  const env = { COURSE_GEN_ARCHITECT_MODEL: "env-role-model", COURSE_GEN_MODEL: "env-shared-model" };

  // 1. The run's per-role pick wins over everything.
  assert.equal(
    resolveRoleModel("architect", { provider: "anthropic", model: "run-wide", roleModels: { architect: "per-role" } }, env),
    "per-role",
  );
  // 2. The run's explicit run-wide model beats env and tiers.
  assert.equal(resolveRoleModel("architect", { provider: "anthropic", model: "run-wide" }, env), "run-wide");
  // 3. COURSE_GEN_<ROLE>_MODEL beats the tier default.
  assert.equal(resolveRoleModel("architect", { provider: "anthropic" }, env), "env-role-model");
  // 4. The anthropic tier default beats the shared env model.
  assert.equal(resolveRoleModel("lesson-author", { provider: "anthropic" }, env), "claude-opus-4-8");
  assert.equal(resolveRoleModel("pedagogy-reviewer", { provider: "anthropic" }, env), "claude-sonnet-5");
  // 5. Non-anthropic providers have no tier defaults — the shared env model is the floor.
  assert.equal(resolveRoleModel("lesson-author", { provider: "openai-compatible" }, env), "env-shared-model");
  assert.equal(resolveRoleModel("lesson-author", { provider: "openai-compatible" }, {}), undefined);
});

test("LiveRoleInvoker sends the per-role model on the wire", async () => {
  const seen: string[] = [];
  const capture = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { model: string };
    seen.push(body.model);
    const envelope = { model: body.model, content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 2 } };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const inv = new LiveRoleInvoker({
    provider: "anthropic",
    apiKey: "sk-fake",
    roleModels: { architect: "claude-opus-4-8", "pedagogy-reviewer": "claude-sonnet-5" },
    model: "claude-haiku-4-5-20251001", // run-wide fallback for unlisted roles
    fetchImpl: capture,
  });
  const p = { task: "t", context: {}, system: "s", user: "u" };
  const a = await inv.invoke("architect", p);
  const r = await inv.invoke("pedagogy-reviewer", p);
  const c = await inv.invoke("cohesion-editor", p); // not in roleModels → fallback
  assert.deepEqual(seen, ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"]);
  assert.equal(a.model, "claude-opus-4-8");
  assert.equal(r.model, "claude-sonnet-5");
  assert.equal(c.model, "claude-haiku-4-5-20251001");
});

test("LiveRoleInvoker accepts roleModels without a run-wide model, rejects neither", () => {
  const inv = new LiveRoleInvoker({ provider: "anthropic", roleModels: { architect: "claude-opus-4-8" } });
  assert.ok(inv);
  assert.throws(() => new LiveRoleInvoker({ provider: "anthropic" }), /requires a model/);
  // A role with no roleModels entry and no fallback fails loudly at invoke.
  assert.rejects(
    () => inv.invoke("cohesion-editor", { task: "t", context: {}, system: "s", user: "u" }),
    /no model for role "cohesion-editor"/,
  );
});
