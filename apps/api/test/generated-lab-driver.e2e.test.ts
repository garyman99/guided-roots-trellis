/**
 * A generated (published) lab must launch even when the deployment default is
 * the DOCKER driver — generated labs are built/proven for the LOCAL driver and
 * never get a Docker image, so a docker session would fail with
 * "Unable to find image 'trellis-lab-<id>'". The SessionManager runs published
 * labs locally regardless of LAB_DRIVER. Reproduces the reported 500.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.LAB_DRIVER = "docker"; // the configuration that surfaced the bug

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-published-drv-"));
const RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-drv-"));
process.env.TRELLIS_PUBLISHED_DIR = PUBLISHED_DIR;
process.env.TRELLIS_RUNS_DIR = RUNS_DIR; // isolate: never touch the real curriculum/runs
process.env.TRELLIS_CAPABILITY_REQUESTS_DIR = mkdtempSync(join(tmpdir(), "trellis-caps-drv-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { buildGeneratedLabFiles, writeGeneratedLab } from "../src/generatedLab.ts";
import { server, manager } from "../src/server.ts";

let base = "";
before(async () => {
  writeGeneratedLab(
    PUBLISHED_DIR,
    "orient-101",
    buildGeneratedLabFiles({ lessonId: "orient-101", title: "Orientation", objective: "Get oriented." }, "cg-test"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  await manager.destroyAll();
  server.close();
  for (const d of [PUBLISHED_DIR, RUNS_DIR]) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows handle */ }
});

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("a generated lab launches under LAB_DRIVER=docker (runs on the local driver, no image)", async () => {
  const started = await api("POST", "/api/sessions", { labId: "orient-101" });
  assert.equal(started.status, 201, "generated lab started despite the docker default (was a 500)");
  const sess = started.body as { sessionId: string; token: string };

  // And it's a real, broken-as-shipped lab the learner can evaluate.
  const evald = await api("POST", `/api/sessions/${sess.sessionId}/checkpoint/evaluate`, undefined, sess.token);
  assert.equal(evald.status, 200);
  assert.equal((evald.body as { passed: boolean }).passed, false, "broken as shipped");
});
