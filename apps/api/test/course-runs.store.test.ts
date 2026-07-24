/**
 * Store-level coverage for the course-run persistence (CourseRunStore), run
 * against BOTH implementations so the SQLite SQL (columns, JSON payload split,
 * pending-gate update) is exercised, not just the in-memory map. No server boot.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type EventStore } from "../src/store.ts";
import type { CourseRun } from "../../../packages/course-architect/src/types.ts";

const tmpDirs: string[] = [];
const openStores: EventStore[] = [];
function track(store: EventStore): EventStore {
  openStores.push(store);
  return store;
}
function sqliteStore(): EventStore {
  const dir = mkdtempSync(join(tmpdir(), "trellis-course-runs-store-"));
  tmpDirs.push(dir);
  return track(createStore({ TRELLIS_PERSISTENCE: "on", TRELLIS_DB_PATH: join(dir, "trellis.db") }));
}
after(() => {
  for (const s of openStores) try { s.close(); } catch { /* already closed */ }
  for (const d of tmpDirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows may still hold the handle */ }
});

const sampleRun = (runId: string): CourseRun => ({
  runId,
  status: "queued",
  request: { technology: "Git", title: "Git Fundamentals", outcome: "confident reviewer" },
  pendingPhase: "framing",
  pendingChangeNotes: null,
  lastError: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
});

for (const [name, make] of [
  ["memory", () => track(createStore({ TRELLIS_PERSISTENCE: "off" }))],
  ["sqlite", sqliteStore],
] as const) {
  describe(`course-run store — ${name}`, () => {
    test("create/get/update round-trips the payload and status", () => {
      const store = make();
      store.createCourseRun(sampleRun("cg-git-a1"));
      const got = store.getCourseRun("cg-git-a1")!;
      assert.equal(got.status, "queued");
      assert.equal(got.request.title, "Git Fundamentals");
      assert.equal(got.pendingPhase, "framing");

      store.updateCourseRun({ ...got, status: "framing", pendingChangeNotes: [{ comment: "narrow scope" }], updatedAt: "2026-07-15T00:01:00.000Z" });
      const after1 = store.getCourseRun("cg-git-a1")!;
      assert.equal(after1.status, "framing");
      assert.equal(after1.pendingChangeNotes![0].comment, "narrow scope");
      assert.equal(after1.updatedAt, "2026-07-15T00:01:00.000Z");

      assert.equal(store.getCourseRun("missing"), null);
      assert.deepEqual(store.listCourseRuns().map((r) => r.runId), ["cg-git-a1"]);
    });

    test("a bounce's scope and chain survive a round-trip", () => {
      // rehearsal-phase §5. These two fields are how an interrupted run resumes
      // mid-bounce. The sqlite store serializes an explicit field list, so a
      // field missing from it is dropped SILENTLY: the run would come back and
      // re-run the phase unscoped — rebuilding the whole course instead of the
      // one bounced lesson — and then park instead of continuing the chain.
      const store = make();
      store.createCourseRun(sampleRun("cg-git-bounce"));
      const got = store.getCourseRun("cg-git-bounce")!;
      store.updateCourseRun({
        ...got,
        status: "queued",
        pendingPhase: "authoring",
        pendingLessonScope: ["git-102"],
        pendingChain: ["materializing", "rehearsing"],
      });
      const after = store.getCourseRun("cg-git-bounce")!;
      assert.deepEqual(after.pendingLessonScope, ["git-102"]);
      assert.deepEqual(after.pendingChain, ["materializing", "rehearsing"]);
    });

    test("events append in order with ids", () => {
      const store = make();
      store.createCourseRun(sampleRun("cg-git-e1"));
      const a = store.appendCourseRunEvent({ runId: "cg-git-e1", at: "t1", type: "phase.started", payload: { phase: "framing" } });
      const b = store.appendCourseRunEvent({ runId: "cg-git-e1", at: "t2", type: "phase.completed" });
      assert.ok((a.id ?? 0) < (b.id ?? 0));
      const events = store.courseRunEvents("cg-git-e1");
      assert.deepEqual(events.map((e) => e.type), ["phase.started", "phase.completed"]);
      assert.deepEqual(events[0].payload, { phase: "framing" });
    });

    test("gate request then decide updates only the pending row", () => {
      const store = make();
      store.createCourseRun(sampleRun("cg-git-g1"));
      // Two requests for the same gate (a changes loop re-requests it).
      store.requestCourseRunGate("cg-git-g1", "frame", "t1");
      store.decideCourseRunGate("cg-git-g1", "frame", "changes", "eva", [{ comment: "again" }], "t2");
      store.requestCourseRunGate("cg-git-g1", "frame", "t3");

      // Only the still-open (t3) row is pending; deciding hits exactly it.
      store.decideCourseRunGate("cg-git-g1", "frame", "approved", "eva", null, "t4");
      const gates = store.courseRunGates("cg-git-g1");
      assert.equal(gates.length, 2);
      assert.deepEqual(gates.map((g) => g.decision), ["changes", "approved"]);
      assert.equal(gates.find((g) => g.decision === "changes")!.notes![0].comment, "again");
      assert.ok(gates.every((g) => g.decidedAt !== null), "no pending rows remain");
    });

    test("delete removes the run and its events + gates", () => {
      const store = make();
      store.createCourseRun(sampleRun("cg-git-d1"));
      store.appendCourseRunEvent({ runId: "cg-git-d1", at: "t1", type: "run.queued" });
      store.requestCourseRunGate("cg-git-d1", "frame", "t1");
      store.deleteCourseRun("cg-git-d1");
      assert.equal(store.getCourseRun("cg-git-d1"), null);
      assert.deepEqual(store.courseRunEvents("cg-git-d1"), []);
      assert.deepEqual(store.courseRunGates("cg-git-d1"), []);
    });

    test("token usage carries an optional runId", () => {
      const store = make();
      store.recordTokenUsage({ learnerId: "sys", sessionId: "-", runId: "cg-git-a1", model: "m", promptTokens: 10, completionTokens: 5, createdAt: "t1" });
      const rec = store.tokenUsage().find((u) => u.runId === "cg-git-a1");
      assert.ok(rec, "usage row carries the runId");
      assert.equal(rec.promptTokens, 10);
    });
  });
}
