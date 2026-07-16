/**
 * The capability commission loop over the real API: at the blueprint gate the
 * operator dispositions a gap "commission" — which writes the outbox brief,
 * records the disposition on capability-gaps.json, and leaves the gapped lesson
 * blocked from authoring while the supported lessons proceed.
 *
 * The default mock produces a gap-free course, so this test PLANTS a gap into
 * the run's capability-gaps.json (it owns the runs dir) before the blueprint
 * decision — exercising the real HTTP disposition path.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
process.env.TRELLIS_SKIP_AUTOSOLVE = "1"; // this test is about gaps, not lab proofs
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-runs-cc-"));
const PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-pub-cc-"));
const OUTBOX_DIR = mkdtempSync(join(tmpdir(), "trellis-outbox-cc-"));
process.env.TRELLIS_RUNS_DIR = RUNS_DIR;
process.env.TRELLIS_PUBLISHED_DIR = PUBLISHED_DIR;
process.env.TRELLIS_CAPABILITY_REQUESTS_DIR = OUTBOX_DIR;

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
  for (const d of [RUNS_DIR, PUBLISHED_DIR, OUTBOX_DIR]) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows */ }
});

const admin = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

interface RunDetail { runId: string; status: string; artifacts: string[]; events: Array<{ type: string; payload?: Record<string, unknown> }> }

test("commissioning a gap at the blueprint gate writes the outbox and blocks the lesson", async () => {
  const created = await admin("POST", "/api/admin/course-runs", { technology: "Postman" });
  const runId = (created.body as { run: RunDetail }).run.runId;
  await courseRuns.settle();

  // Approve the frame gate → designing runs and writes capability-gaps.json.
  await admin("POST", `/api/admin/course-runs/${runId}/gates/frame/decision`, { decision: "approved" });
  await courseRuns.settle();
  let run = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.equal(run.status, "awaiting-blueprint");

  // PLANT a gap: the mock's second lesson (postman-102) needs a capability the
  // build lacks. Overwrite the run's capability-gaps.json before the decision.
  const gapReport = { available: ["file-viewed", "code", "tests-run"], gaps: [{ capabilityId: "http-client", lessons: ["postman-102"], disposition: null }] };
  writeFileSync(join(RUNS_DIR, runId, "capability-gaps.json"), JSON.stringify(gapReport));

  // Approve the blueprint gate WITH a commission disposition.
  const decided = await admin("POST", `/api/admin/course-runs/${runId}/gates/blueprint/decision`, {
    decision: "approved",
    gaps: [{ capabilityId: "http-client", disposition: "commission" }],
  });
  assert.equal(decided.status, 200);
  await courseRuns.settle();

  // The outbox now has a capability request for http-client.
  const reqs = (await admin("GET", "/api/admin/capability-requests")).body as { requests: Array<{ gapId: string; blockedLessons: string[]; status: string }> };
  const req = reqs.requests.find((r) => r.gapId === "http-client");
  assert.ok(req, "http-client was commissioned to the outbox");
  assert.deepEqual(req.blockedLessons, ["postman-102"]);
  assert.equal(req.status, "requested");

  // The gap report on disk records the disposition.
  const updated = JSON.parse(readFileSync(join(RUNS_DIR, runId, "capability-gaps.json"), "utf8"));
  assert.equal(updated.gaps[0].disposition, "commission");

  // Authoring blocked the gapped lesson but authored the supported one.
  run = ((await admin("GET", `/api/admin/course-runs/${runId}`)).body as { run: RunDetail }).run;
  assert.ok(run.events.some((e) => e.type === "lesson.blocked" && (e.payload as { lessonId?: string })?.lessonId === "postman-102"), "gapped lesson blocked");
  assert.ok(run.events.some((e) => e.type === "lesson.authored" && (e.payload as { lessonId?: string })?.lessonId === "postman-101"), "supported lesson authored");
});
