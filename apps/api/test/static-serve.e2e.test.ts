/**
 * Static serving of the built web app (autonomous-course-pipeline plan §3.3
 * "Durable host", slice C1) over the real API — apps/api/src/staticServe.ts,
 * wired into apps/api/src/server.ts's fall-through before its final 404.
 *
 * TRELLIS_STATIC_DIR is read LAZILY (per request, not at server.ts import
 * time — see staticServe.ts's comment), so unlike TRELLIS_RUNS_DIR etc. it's
 * safe to set it here even though ESM import-hoisting would otherwise read a
 * body-set env var too late.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-static-runs-"));
const PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-static-published-"));
process.env.TRELLIS_RUNS_DIR = RUNS_DIR;
process.env.TRELLIS_PUBLISHED_DIR = PUBLISHED_DIR;

const STATIC_DIR = mkdtempSync(join(tmpdir(), "trellis-static-dist-"));
mkdirSync(join(STATIC_DIR, "assets"), { recursive: true });
writeFileSync(join(STATIC_DIR, "index.html"), "<!doctype html><title>Trellis</title>index");
writeFileSync(join(STATIC_DIR, "assets", "app-abc123.js"), "console.log('app');");
process.env.TRELLIS_STATIC_DIR = STATIC_DIR;

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager, store } from "../src/server.ts";

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
  delete process.env.TRELLIS_STATIC_DIR;
  for (const d of [RUNS_DIR, PUBLISHED_DIR, STATIC_DIR]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* windows handle */
    }
  }
});

test("/ serves index.html with no-cache", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.match(await res.text(), /Trellis/);
});

test("/assets/<hashed>.js serves js content-type with immutable cache", async () => {
  const res = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /javascript/);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(await res.text(), /console\.log/);
});

test("/home (extension-less SPA route) falls back to index.html", async () => {
  const res = await fetch(`${base}/home`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.match(await res.text(), /Trellis/);
});

test("/lab (extension-less SPA route) falls back to index.html too", async () => {
  const res = await fetch(`${base}/lab?lab=some-lab`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Trellis/);
});

test("a path with an extension that doesn't exist 404s", async () => {
  const res = await fetch(`${base}/nope.js`);
  assert.equal(res.status, 404);
});

test("path-traversal attempts stay inside the static dir", async () => {
  // A literal ".." segment never reaches the handler: the WHATWG URL parser
  // (used both by fetch and by server.ts's own `new URL(req.url, ...)`)
  // collapses it during parsing before request routing ever sees it. The
  // defense that matters is against percent-encoded traversal, which is NOT
  // collapsed by the URL parser and must be caught by staticServe.ts's own
  // resolve()+relative() containment check.
  const res = await fetch(`${base}/assets/%2e%2e/%2e%2e/secret.txt`);
  assert.equal(res.status, 404);
});

test("/api/courses (an existing API route) is untouched by static serving", async () => {
  // No /api/health route exists in this build (checked before writing this
  // test); /api/courses is the closest unauthenticated JSON GET route and
  // proves static serving's fall-through never shadows real API routes.
  const res = await fetch(`${base}/api/courses`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.ok(Array.isArray(body.courses));
});
