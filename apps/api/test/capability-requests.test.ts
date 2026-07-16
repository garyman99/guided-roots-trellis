/**
 * The capability-request outbox: a commissioned gap becomes a structured brief
 * on disk (request.json + request.md) that a dev skill can pick up, and the
 * list round-trips it. Idempotent per gap id.
 */
process.env.NODE_ENV = "test";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCapabilityRequest, listCapabilityRequests } from "../src/capabilityRequests.ts";
import type { CapabilityGap } from "../../../packages/course-architect/src/gaps.ts";

const tmp: string[] = [];
after(() => { for (const d of tmp) try { rmSync(d, { recursive: true, force: true }); } catch { /* windows */ } });

const gap = (id: string, lessons: string[]): CapabilityGap => ({ capabilityId: id, lessons, disposition: "commission" });

test("writes request.json + request.md and lists it", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-cap-req-"));
  tmp.push(dir);
  const rec = writeCapabilityRequest(dir, { gap: gap("http-client", ["postman-201"]), runId: "cg-postman-x", technology: "Postman", rationale: "Needs an HTTP client app." }, "2026-07-16T00:00:00.000Z");
  assert.equal(rec.gapId, "http-client");
  assert.equal(rec.status, "requested");
  assert.deepEqual(rec.blockedLessons, ["postman-201"]);

  const md = readFileSync(join(dir, "http-client", "request.md"), "utf8");
  assert.match(md, /Capability request: `http-client`/);
  assert.match(md, /AUTHORING\.md/);
  assert.match(md, /postman-201/);

  const list = listCapabilityRequests(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].gapId, "http-client");
});

test("re-commissioning the same gap overwrites (idempotent), different gaps accumulate", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-cap-req2-"));
  tmp.push(dir);
  writeCapabilityRequest(dir, { gap: gap("http-client", ["a"]), runId: "r1", technology: "Postman", rationale: "v1" }, "2026-07-16T00:00:00.000Z");
  writeCapabilityRequest(dir, { gap: gap("http-client", ["a", "b"]), runId: "r1", technology: "Postman", rationale: "v2" }, "2026-07-16T00:01:00.000Z");
  writeCapabilityRequest(dir, { gap: gap("db-browser", ["c"]), runId: "r1", technology: "SQL", rationale: "needs db" }, "2026-07-16T00:02:00.000Z");

  const list = listCapabilityRequests(dir);
  assert.equal(list.length, 2, "one entry per gap id");
  const http = list.find((r) => r.gapId === "http-client")!;
  assert.deepEqual(http.blockedLessons, ["a", "b"], "latest commission wins");
});

test("listing an empty/absent outbox is safe", () => {
  assert.deepEqual(listCapabilityRequests(join(tmpdir(), "does-not-exist-xyz")), []);
});
