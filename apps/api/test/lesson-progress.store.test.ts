/**
 * Store-level coverage for persistent lesson progress (apps/api/src/store.ts),
 * parameterized over BOTH EventStore implementations. createStore(env) is the
 * only exported factory (SqliteStore/MemoryStore classes are not exported),
 * so each suite below passes its own env object straight to createStore() —
 * this sidesteps the process.env-at-module-load hazard entirely (see
 * resume.e2e.test.ts for the long version) since env is read synchronously
 * inside createStore() itself, not at some other module's load time.
 *
 * No server boot, no pty — store-only.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type EventStore, type SessionMeta } from "../src/store.ts";

const tmpDirs: string[] = [];

function memoryStore(): EventStore {
  return createStore({ TRELLIS_PERSISTENCE: "off" });
}

function sqliteStore(): EventStore {
  const dir = mkdtempSync(join(tmpdir(), "trellis-lesson-progress-test-"));
  tmpDirs.push(dir);
  return createStore({ TRELLIS_PERSISTENCE: "on", TRELLIS_DB_PATH: join(dir, "trellis.db") });
}

let seq = 0;
function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  seq += 1;
  return {
    sessionId: overrides.sessionId ?? `sess-${seq}`,
    learnerId: overrides.learnerId ?? "learner-1",
    labId: overrides.labId ?? "lab-a",
    createdAt: overrides.createdAt ?? new Date(Date.parse("2026-07-10T10:00:00Z") + seq * 1000).toISOString(),
    consentAnalytics: overrides.consentAnalytics ?? false,
    status: overrides.status ?? "open",
    endedAt: overrides.endedAt ?? null,
  };
}

function suite(name: string, factory: () => EventStore): void {
  describe(name, () => {
    test("createSession -> sessionMeta round-trips status:open / endedAt:null", () => {
      const store = factory();
      const m = meta();
      store.createSession(m);
      const got = store.sessionMeta(m.sessionId);
      assert.ok(got, "session meta exists");
      assert.equal(got!.status, "open");
      assert.equal(got!.endedAt, null);
      assert.equal(got!.sessionId, m.sessionId);
      assert.equal(got!.learnerId, m.learnerId);
      assert.equal(got!.labId, m.labId);
      store.close();
    });

    test("setSessionStatus -> abandoned + endedAt reflected in sessionMeta and listSessions", () => {
      const store = factory();
      const m = meta();
      store.createSession(m);
      const endedAt = "2026-07-14T00:00:00.000Z";
      store.setSessionStatus(m.sessionId, "abandoned", endedAt);

      const got = store.sessionMeta(m.sessionId)!;
      assert.equal(got.status, "abandoned");
      assert.equal(got.endedAt, endedAt);

      const listed = store.listSessions().find((s) => s.sessionId === m.sessionId)!;
      assert.ok(listed, "abandoned session still appears in listSessions");
      assert.equal(listed.status, "abandoned");
      assert.equal(listed.endedAt, endedAt);
      store.close();
    });

    test("latestOpenSession: picks newest open among several, ignores abandoned, null when none", () => {
      const store = factory();
      assert.equal(store.latestOpenSession("learner-x", "lab-x"), null, "no sessions yet -> null");

      const a = meta({ sessionId: "a", learnerId: "learner-x", labId: "lab-x", createdAt: "2026-01-01T00:00:00.000Z" });
      const b = meta({ sessionId: "b", learnerId: "learner-x", labId: "lab-x", createdAt: "2026-01-02T00:00:00.000Z" });
      const c = meta({ sessionId: "c", learnerId: "learner-x", labId: "lab-x", createdAt: "2026-01-03T00:00:00.000Z" });
      store.createSession(a);
      store.createSession(b);
      store.createSession(c);

      // Different learner/lab must never be picked up.
      store.createSession(meta({ sessionId: "other", learnerId: "learner-y", labId: "lab-x", createdAt: "2026-01-04T00:00:00.000Z" }));
      store.createSession(meta({ sessionId: "other-lab", learnerId: "learner-x", labId: "lab-y", createdAt: "2026-01-05T00:00:00.000Z" }));

      // The newest (c) is abandoned; the newest still-OPEN is b.
      store.setSessionStatus("c", "abandoned", "2026-01-03T01:00:00.000Z");
      const latest = store.latestOpenSession("learner-x", "lab-x");
      assert.equal(latest?.sessionId, "b", "newest OPEN session, not the newest overall");

      store.setSessionStatus("b", "abandoned", "2026-01-02T01:00:00.000Z");
      assert.equal(store.latestOpenSession("learner-x", "lab-x")?.sessionId, "a", "falls back to the next-newest open one");

      store.setSessionStatus("a", "abandoned", "2026-01-01T01:00:00.000Z");
      assert.equal(store.latestOpenSession("learner-x", "lab-x"), null, "none left open -> null");
      store.close();
    });

    test("saveSnapshot/snapshotFor: upsert semantics (second save wins), files/workspace kinds independent", () => {
      const store = factory();
      const m = meta();
      store.createSession(m);
      assert.equal(store.snapshotFor(m.sessionId, "files"), null, "no snapshot yet");
      assert.equal(store.snapshotFor(m.sessionId, "workspace"), null, "no snapshot yet");

      store.saveSnapshot({ sessionId: m.sessionId, kind: "files", payload: "files-v1", updatedAt: "t1" });
      store.saveSnapshot({ sessionId: m.sessionId, kind: "workspace", payload: "workspace-v1", updatedAt: "t1" });
      assert.equal(store.snapshotFor(m.sessionId, "files")!.payload, "files-v1");
      assert.equal(store.snapshotFor(m.sessionId, "workspace")!.payload, "workspace-v1");

      store.saveSnapshot({ sessionId: m.sessionId, kind: "files", payload: "files-v2", updatedAt: "t2" });
      assert.equal(store.snapshotFor(m.sessionId, "files")!.payload, "files-v2", "second save for the same kind wins");
      assert.equal(store.snapshotFor(m.sessionId, "workspace")!.payload, "workspace-v1", "the other kind is untouched");
      store.close();
    });

    test("deleteSession removes snapshots too", () => {
      const store = factory();
      const m = meta();
      store.createSession(m);
      store.saveSnapshot({ sessionId: m.sessionId, kind: "files", payload: "files-v1", updatedAt: "t1" });
      store.saveSnapshot({ sessionId: m.sessionId, kind: "workspace", payload: "workspace-v1", updatedAt: "t1" });

      store.deleteSession(m.sessionId);

      assert.equal(store.sessionMeta(m.sessionId), null);
      assert.equal(store.snapshotFor(m.sessionId, "files"), null, "files snapshot cascades on delete");
      assert.equal(store.snapshotFor(m.sessionId, "workspace"), null, "workspace snapshot cascades on delete");
      store.close();
    });
  });
}

suite("MemoryStore", memoryStore);
suite("SqliteStore", sqliteStore);

process.on("exit", () => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
