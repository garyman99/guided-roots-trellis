/**
 * rrweb screen-replay storage over the real API (quality-rework Phase 3):
 * session-authed ingest appends NDJSON, the byte cap truncates with a marker,
 * the admin fetch streams it back, deletes cascade, and the kill-switch drops.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";
delete process.env.TRELLIS_RRWEB;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.TRELLIS_REPLAYS_DIR = mkdtempSync(join(tmpdir(), "trellis-rrweb-"));
process.env.TRELLIS_RUNS_DIR = mkdtempSync(join(tmpdir(), "trellis-rrweb-runs-"));
process.env.TRELLIS_PUBLISHED_DIR = mkdtempSync(join(tmpdir(), "trellis-rrweb-pub-"));

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { server, manager } from "../src/server.ts";
import { appendReplayEvents, rrwebEnabled, rrwebMaxBytes } from "../src/replayStore.ts";

let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  await manager.destroyAll();
  server.close();
});

async function newSession(): Promise<{ sessionId: string; token: string; rrweb: boolean }> {
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labId: "inspect-generated-changes", consentAnalytics: false }),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as { sessionId: string; token: string; rrweb: boolean };
}

const EV = (n: number) => ({ type: 3, timestamp: 1700000000000 + n, data: { source: 1, n } });

test("ingest appends NDJSON; the admin fetch streams it; delete cascades", async () => {
  const s = await newSession();
  assert.equal(s.rrweb, true, "session advertises recording");

  for (const batch of [[EV(1), EV(2)], [EV(3)]]) {
    const res = await fetch(`${base}/api/sessions/${s.sessionId}/rrweb`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ events: batch }),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { stored: number; capped: boolean };
    assert.equal(body.stored, batch.length);
    assert.equal(body.capped, false);
  }

  // Query-token auth works too (the sendBeacon path can't set headers).
  const beacon = await fetch(`${base}/api/sessions/${s.sessionId}/rrweb?token=${encodeURIComponent(s.token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [EV(4)] }),
  });
  assert.equal(beacon.status, 202);

  const file = join(process.env.TRELLIS_REPLAYS_DIR!, s.sessionId, "events.ndjson");
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 4);

  // Wrong token → 401; admin fetch → the NDJSON back.
  const bad = await fetch(`${base}/api/sessions/${s.sessionId}/rrweb`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong" },
    body: JSON.stringify({ events: [EV(9)] }),
  });
  assert.equal(bad.status, 401);

  const adm = await fetch(`${base}/api/admin/sessions/${s.sessionId}/rrweb`, { headers: { authorization: "Bearer test-admin-token" } });
  assert.equal(adm.status, 200);
  assert.equal(adm.headers.get("content-type"), "application/x-ndjson");
  const lines = (await adm.text()).trim().split("\n");
  assert.equal(lines.length, 4);
  assert.equal((JSON.parse(lines[0]) as { data: { n: number } }).data.n, 1);

  // DELETE the session → the replay directory goes with it.
  const del = await fetch(`${base}/api/sessions/${s.sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}` } });
  assert.equal(del.status, 200);
  assert.ok(!existsSync(file), "replay removed with the session");
  const gone = await fetch(`${base}/api/admin/sessions/${s.sessionId}/rrweb`, { headers: { authorization: "Bearer test-admin-token" } });
  assert.equal(gone.status, 404);
});

test("the byte cap truncates with a single marker line and closes the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "trellis-rrweb-cap-"));
  const big = { type: 3, data: "x".repeat(100) };
  const first = appendReplayEvents(dir, "sess-cap", [big, big, big], 260);
  assert.equal(first.capped, true);
  assert.ok(first.stored < 3);
  const file = readFileSync(join(dir, "sess-cap", "events.ndjson"), "utf8").trim().split("\n");
  assert.match(file.at(-1)!, /trellis-cap-reached/);

  // Every later batch is dropped without another marker.
  const second = appendReplayEvents(dir, "sess-cap", [big], 260);
  assert.deepEqual(second, { stored: 0, dropped: 1, capped: true });
  assert.equal(readFileSync(join(dir, "sess-cap", "events.ndjson"), "utf8").trim().split("\n").length, file.length);
});

test("TRELLIS_RRWEB=off flips the session flag and the ingest to a no-op", async () => {
  process.env.TRELLIS_RRWEB = "off";
  try {
    assert.equal(rrwebEnabled(), false);
    const s = await newSession();
    assert.equal(s.rrweb, false, "clients are told not to record");
    const res = await fetch(`${base}/api/sessions/${s.sessionId}/rrweb`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ events: [EV(1)] }),
    });
    assert.equal(res.status, 202);
    assert.equal(((await res.json()) as { disabled?: boolean }).disabled, true);
    assert.ok(!existsSync(join(process.env.TRELLIS_REPLAYS_DIR!, s.sessionId)));
    await fetch(`${base}/api/sessions/${s.sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${s.token}` } });
  } finally {
    delete process.env.TRELLIS_RRWEB;
  }
});

test("defaults: enabled, 25 MB cap", () => {
  assert.equal(rrwebEnabled({}), true);
  assert.equal(rrwebMaxBytes({}), 25 * 1024 * 1024);
  assert.equal(rrwebMaxBytes({ TRELLIS_RRWEB_MAX_BYTES: "1000" }), 1000);
});
