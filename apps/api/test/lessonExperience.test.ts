/**
 * Per-lesson experience metrics (Phase A of the improvement loop): fold
 * synthesized session event logs into per-session summaries + family
 * aggregates, deterministically. Also covers the lesson-family id helpers.
 */
process.env.TRELLIS_PERSISTENCE = "off";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, type EventStore } from "../src/store.ts";
import { lessonExperience, sessionExperience } from "../src/lessonExperience.ts";
import { familyOf, versionOf, versionedLabId } from "../../../packages/shared/src/ids.ts";
import type { SessionEvent } from "../../../packages/session-events/src/events.ts";

test("familyOf / versionOf / versionedLabId round-trip", () => {
  assert.equal(familyOf("orient-101"), "orient-101");
  assert.equal(familyOf("orient-101-v2"), "orient-101");
  assert.equal(familyOf("waits-301-v12"), "waits-301");
  assert.equal(versionOf("orient-101"), 1);
  assert.equal(versionOf("orient-101-v2"), 2);
  assert.equal(versionedLabId("orient-101", 1), "orient-101");
  assert.equal(versionedLabId("orient-101", 3), "orient-101-v3");
  // ids that merely end in digits are NOT versions
  assert.equal(familyOf("locators-301"), "locators-301");
  assert.equal(versionOf("locators-301"), 1);
});

function freshStore(): EventStore {
  return createStore({ TRELLIS_PERSISTENCE: "off" } as NodeJS.ProcessEnv);
}

let tick = 0;
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes, tick++ % 60)).toISOString();

function addSession(
  store: EventStore,
  sessionId: string,
  labId: string,
  status: "open" | "abandoned",
  events: SessionEvent[],
): void {
  store.createSession({
    sessionId,
    learnerId: `learner-${sessionId}`,
    labId,
    createdAt: events[0]?.timestamp ?? at(0),
    consentAnalytics: false,
    status,
    endedAt: null,
  });
  for (const e of events) store.appendEvent(sessionId, e);
}

test("sessionExperience folds one log into friction signals", () => {
  const store = freshStore();
  addSession(store, "s1", "demo-101", "open", [
    { type: "session.started", lessonId: "demo-101", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "terminal.command.completed", command: "npm test", exitCode: 1, outputSummary: "", timestamp: at(1) },
    { type: "terminal.command.completed", command: "npm test", exitCode: 1, outputSummary: "", timestamp: at(2) },
    { type: "terminal.command.completed", command: "npm test", exitCode: 1, outputSummary: "", timestamp: at(3) }, // burst at 3rd
    { type: "instructor.hint", level: 2, strategy: "orient", text: "look at the README", contextManifest: null, timestamp: at(4) },
    { type: "intervention.delivered", triggerType: "repeated_failure", level: 1, strategy: "nudge", text: "try -h", timestamp: at(5) },
    { type: "learner.question", text: "I have no idea what a terminal is", stuck: true, timestamp: at(6) },
    { type: "task.validated", taskId: "t1", passed: false, reason: "solution.txt still says TODO", contentHash: "x", timestamp: at(7) },
    { type: "checkpoint.evaluated", checkpointId: "cp", passed: false, incomplete: ["solution-complete"], timestamp: at(8) },
    // a long stall (> 3 min) before finally completing
    { type: "checkpoint.completed", checkpointId: "cp", timestamp: at(20) },
  ]);

  const s = sessionExperience(store, store.listSessions()[0]);
  assert.equal(s.commands, 3);
  assert.equal(s.commandFailures, 3);
  assert.equal(s.failureBursts, 1);
  assert.equal(s.hints, 1);
  assert.equal(s.maxHintLevel, 2);
  assert.deepEqual(s.interventions, { repeated_failure: 1 });
  assert.deepEqual(s.taskFailReasons, ["solution.txt still says TODO"]);
  assert.equal(s.checkpointFailures, 1);
  assert.deepEqual(s.blockingRequirements, { "solution-complete": 1 });
  assert.equal(s.questions.length, 1);
  assert.equal(s.questions[0].stuck, true);
  assert.equal(s.completed, true);
  assert.ok(s.stalls >= 1, "the 12-minute gap counts as a stall");
  assert.ok(s.friction > 0);
});

test("lessonExperience aggregates a family across versions", () => {
  const store = freshStore();
  // v1: one completed struggle, one abandonment
  addSession(store, "a", "demo-101", "open", [
    { type: "session.started", lessonId: "demo-101", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "instructor.hint", level: 3, strategy: "direct", text: "…", contextManifest: null, timestamp: at(1) },
    { type: "checkpoint.evaluated", checkpointId: "cp", passed: false, incomplete: ["solution-complete"], timestamp: at(2) },
    { type: "checkpoint.completed", checkpointId: "cp", timestamp: at(3) },
  ]);
  addSession(store, "b", "demo-101", "abandoned", [
    { type: "session.started", lessonId: "demo-101", learnerId: "l2", variantId: null, timestamp: at(0) },
    { type: "learner.question", text: "what am I even supposed to do?", stuck: true, timestamp: at(1) },
  ]);
  // v2: one clean completion
  addSession(store, "c", "demo-101-v2", "open", [
    { type: "session.started", lessonId: "demo-101-v2", learnerId: "l3", variantId: null, timestamp: at(0) },
    { type: "checkpoint.completed", checkpointId: "cp", timestamp: at(1) },
  ]);
  // an unrelated lab must not leak into the family
  addSession(store, "z", "other-201", "open", [
    { type: "session.started", lessonId: "other-201", learnerId: "l4", variantId: null, timestamp: at(0) },
  ]);

  const exp = lessonExperience(store, "demo-101");
  assert.equal(exp.family, "demo-101");
  assert.equal(exp.requestedVersion, 1);
  assert.equal(exp.totalSessions, 3, "other-201 excluded");
  assert.equal(exp.versions.length, 2);
  assert.equal(exp.versions[0].version, 2, "newest version first");

  const v1 = exp.versions[1];
  assert.equal(v1.sessions, 2);
  assert.equal(v1.completed, 1);
  assert.equal(v1.abandoned, 1);
  assert.equal(v1.completionRate, 0.5);
  assert.equal(v1.abandonmentRate, 0.5);
  assert.deepEqual(v1.topBlockingRequirements, [{ id: "solution-complete", count: 1 }]);
  assert.equal(v1.quotes.length, 1);

  const v2 = exp.versions[0];
  assert.equal(v2.sessions, 1);
  assert.equal(v2.completionRate, 1);

  // per-session summaries are for the REQUESTED version (v1 here)…
  assert.deepEqual(exp.sessions.map((s) => s.labId).sort(), ["demo-101", "demo-101"]);
  // …and asking via the v2 labId flips the drill-down set.
  const exp2 = lessonExperience(store, "demo-101-v2");
  assert.equal(exp2.requestedVersion, 2);
  assert.deepEqual(exp2.sessions.map((s) => s.labId), ["demo-101-v2"]);
  assert.equal(exp2.totalSessions, 3, "family totals unchanged");
});

test("digest hint outcomes feed hintFollowedByProgressRate", () => {
  const store = freshStore();
  addSession(store, "d1", "demo-101", "open", [
    { type: "session.started", lessonId: "demo-101", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "checkpoint.completed", checkpointId: "cp", timestamp: at(1) },
  ]);
  const learnerId = store.listSessions()[0].learnerId;
  store.appendEvidence(learnerId, {
    type: "session.digest",
    timestamp: at(2),
    digest: {
      sessionId: "d1", labId: "demo-101", variantId: null, learnerId,
      startedAt: at(0), completedAt: at(1), durationMs: 60000,
      checkpointCompleted: true, testsRun: 0, recoveredAfterFailure: false,
      hintsRequested: 2, interventions: [], diffViewedBeforeFirstEdit: false,
      filesChanged: [],
      hintOutcomes: [
        { strategy: "orient", level: 1, followedByProgress: true },
        { strategy: "direct", level: 2, followedByProgress: false },
      ],
      conceptObservations: [],
    },
  });

  const exp = lessonExperience(store, "demo-101");
  assert.equal(exp.versions[0].hintFollowedByProgressRate, 0.5);
});
