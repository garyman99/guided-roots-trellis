/**
 * The capability-request outbox: writing a brief, listing open requests, and the
 * per-run cascade that a run deletion uses to retract its outstanding asks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCapabilityRequest, listCapabilityRequests, deleteCapabilityRequestsForRun } from "../src/capabilityRequests.ts";

test("deleteCapabilityRequestsForRun removes only the given run's requests", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-outbox-"));
  try {
    const at = "2026-07-16T00:00:00.000Z";
    writeCapabilityRequest(dir, { gap: { capabilityId: "browser-driver", lessons: ["l1"] }, runId: "cg-a", technology: "Selenium", rationale: "need a browser" }, at);
    writeCapabilityRequest(dir, { gap: { capabilityId: "db-console", lessons: ["l2"] }, runId: "cg-a", technology: "Selenium", rationale: "need a db" }, at);
    writeCapabilityRequest(dir, { gap: { capabilityId: "http-recorder", lessons: ["l3"] }, runId: "cg-b", technology: "REST", rationale: "record http" }, at);
    assert.equal(listCapabilityRequests(dir).length, 3);

    const removed = deleteCapabilityRequestsForRun(dir, "cg-a");
    assert.deepEqual(removed.sort(), ["browser-driver", "db-console"]);
    assert.ok(!existsSync(join(dir, "browser-driver")));
    assert.ok(!existsSync(join(dir, "db-console")));

    const left = listCapabilityRequests(dir);
    assert.equal(left.length, 1);
    assert.equal(left[0].gapId, "http-recorder");
    assert.equal(left[0].runId, "cg-b");

    // No-op for a run with no requests, and safe on a missing dir.
    assert.deepEqual(deleteCapabilityRequestsForRun(dir, "cg-zzz"), []);
    assert.deepEqual(deleteCapabilityRequestsForRun(join(dir, "nope"), "cg-a"), []);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows handle */ }
  }
});
