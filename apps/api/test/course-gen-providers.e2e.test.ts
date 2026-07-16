/**
 * Provider selection over the real API: the providers endpoint reflects key
 * availability, and a run's provider is validated at create time (keys live in
 * the server env, never the request). Only the mock provider is actually run
 * here — the live transport is covered by live-provider.test.ts with a fake
 * fetch, so this test makes no network calls.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
process.env.TRELLIS_SKIP_AUTOSOLVE = "1";
// Deterministic: no provider keys present (read at request time, so this holds).
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.COURSE_GEN_API_KEY;
delete process.env.COURSE_GEN_PROVIDER;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-prov-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-prov-pub-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, courseRuns, store } from "../src/server.ts";

let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  for (const r of store.listCourseRuns()) store.deleteCourseRun(r.runId);
  for (const c of store.listCourses()) if (c.sourceRunId) store.deleteCourse(c.courseId);
  for (const s of store.listScenarioEntries()) store.deleteScenarioEntry(s.labId);
  await manager.destroyAll();
  server.close();
});
const admin = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test("the providers endpoint lists mock + claude + openai with availability", async () => {
  const { status, body } = await admin("GET", "/api/admin/course-runs/providers");
  assert.equal(status, 200);
  const b = body as { defaultProvider: string; providers: Array<{ id: string; available: boolean; models?: Array<{ id: string }> }> };
  const byId = Object.fromEntries(b.providers.map((p) => [p.id, p]));
  assert.equal(byId.mock.available, true);
  assert.equal(byId.anthropic.available, false, "no ANTHROPIC_API_KEY in test env");
  assert.ok(byId.anthropic.models!.some((m) => m.id === "claude-opus-4-8"), "Claude model options offered");
  assert.ok(byId["openai-compatible"], "openai-compatible offered");
});

test("provider config is validated at create time (keys stay in the server env)", async () => {
  // Claude without a key → refused.
  const noKey = await admin("POST", "/api/admin/course-runs", { technology: "Rust", providerConfig: { provider: "anthropic", model: "claude-opus-4-8" } });
  assert.equal(noKey.status, 400);
  assert.match((noKey.body as { error: string }).error, /ANTHROPIC_API_KEY/);

  // Claude with a key present → accepted (we do NOT run it — no network here).
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const withKey = await admin("POST", "/api/admin/course-runs", { technology: "Rust", providerConfig: { provider: "anthropic", model: "claude-opus-4-8" } });
  assert.equal(withKey.status, 201);
  const run = (withKey.body as { run: { provider: string; model: string } }).run;
  assert.equal(run.provider, "anthropic");
  assert.equal(run.model, "claude-opus-4-8");
  delete process.env.ANTHROPIC_API_KEY;

  // OpenAI-compatible without a base URL → refused.
  const noBase = await admin("POST", "/api/admin/course-runs", { technology: "Rust", providerConfig: { provider: "openai-compatible", model: "m" } });
  assert.equal(noBase.status, 400);
  assert.match((noBase.body as { error: string }).error, /base URL/);
});

test("a mock-provider run still executes end to end (no keys needed)", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Widgets", providerConfig: { provider: "mock" } });
  assert.equal(created.status, 201);
  const runId = (created.body as { run: { runId: string; provider: string } }).run.runId;
  assert.equal((created.body as { run: { provider: string } }).run.provider, "mock");
  await courseRuns.settle();
  assert.equal(((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: { status: string } }).run.status, "awaiting-frame");

  // The live-activity endpoint responds (null once the phase has parked).
  const live = await admin("GET", `/api/admin/course-runs/${runId}/live`);
  assert.equal(live.status, 200);
  assert.equal((live.body as { live: unknown }).live, null);
});
