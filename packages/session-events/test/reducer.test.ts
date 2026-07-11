import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/reducer.ts";
import { isDiffViewingCommand, type SessionEvent } from "../src/events.ts";

const t0 = Date.parse("2026-07-10T10:00:00Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();

function baseEvents(): SessionEvent[] {
  return [
    { type: "session.started", lessonId: "inspect-generated-changes", learnerId: "learner-1", timestamp: at(0) },
  ];
}

test("reduce is deterministic: same events, same state", () => {
  const events = baseEvents();
  events.push({ type: "terminal.command.started", command: "git status", timestamp: at(1) });
  const a = reduce(events, { nowMs: t0 + 10_000 });
  const b = reduce(events, { nowMs: t0 + 10_000 });
  assert.deepEqual(a, b);
});

test("commands pair started/completed and record exit codes", () => {
  const events = baseEvents();
  events.push({ type: "terminal.command.started", command: "npm test", timestamp: at(1) });
  events.push({
    type: "terminal.command.completed",
    command: "npm test",
    exitCode: 1,
    outputSummary: "1 failing",
    timestamp: at(3),
  });
  const s = reduce(events);
  assert.equal(s.recentCommands.length, 1);
  assert.equal(s.recentCommands[0].exitCode, 1);
  assert.equal(s.recentCommands[0].outputSummary, "1 failing");
});

test("recentCommands is capped at the configured limit", () => {
  const events = baseEvents();
  for (let i = 0; i < 20; i++) {
    events.push({ type: "terminal.command.started", command: `echo ${i}`, timestamp: at(i + 1) });
  }
  const s = reduce(events, { recentCommandLimit: 5 });
  assert.equal(s.recentCommands.length, 5);
  assert.equal(s.recentCommands[0].command, "echo 15");
});

test("viewedGitDiff flips on diff-viewing commands, including git show and log -p", () => {
  for (const cmd of ["git diff", "git diff --staged src/", "git show HEAD", "git log -p -1", "git -C . diff"]) {
    assert.equal(isDiffViewingCommand(cmd), true, cmd);
  }
  for (const cmd of ["git status", "git log --oneline", "diff a b", "git config diff.tool vimdiff"]) {
    assert.equal(isDiffViewingCommand(cmd), false, cmd);
  }
  const events = baseEvents();
  events.push({ type: "terminal.command.started", command: "git diff", timestamp: at(1) });
  assert.equal(reduce(events).viewedGitDiff, true);
});

test("repeated failures require >=2 failures of the same command, sorted by count", () => {
  const events = baseEvents();
  const fail = (command: string, s: number): SessionEvent => ({
    type: "terminal.command.completed",
    command,
    exitCode: 1,
    outputSummary: "boom",
    timestamp: at(s),
  });
  events.push(fail("npm test", 1), fail("npm test", 2), fail("npm test", 3), fail("node x.mjs", 4));
  const s = reduce(events);
  assert.deepEqual(s.repeatedFailures, [{ command: "npm test", count: 3 }]);
});

test("tests.completed updates counters and clears changedSinceLastTestRun", () => {
  const events = baseEvents();
  events.push({ type: "file.changed", path: "src/pricing.ts", timestamp: at(1) });
  let s = reduce(events);
  assert.equal(s.changedSinceLastTestRun, true);
  events.push({ type: "tests.completed", passed: 5, failed: 1, timestamp: at(2) });
  s = reduce(events);
  assert.equal(s.testsRun, 1);
  assert.deepEqual(s.latestTestResult, { passed: 5, failed: 1 });
  assert.equal(s.changedSinceLastTestRun, false);
  assert.deepEqual(s.filesChanged, ["src/pricing.ts"]);
});

test("session.reset clears workspace facts but keeps questions and hints", () => {
  const events = baseEvents();
  events.push({ type: "learner.question", text: "what is a diff?", stuck: false, timestamp: at(1) });
  events.push({ type: "instructor.hint", level: 1, strategy: "point-to-tool", timestamp: at(2) });
  events.push({ type: "file.changed", path: "src/pricing.ts", timestamp: at(3) });
  events.push({ type: "tests.completed", passed: 6, failed: 0, timestamp: at(4) });
  events.push({ type: "session.reset", timestamp: at(5) });
  const s = reduce(events);
  assert.equal(s.filesChanged.length, 0);
  assert.equal(s.testsRun, 0);
  assert.equal(s.viewedGitDiff, false);
  assert.deepEqual(s.learnerQuestions, ["what is a diff?"]);
  assert.equal(s.hintsAlreadyGiven.length, 1);
  assert.equal(s.lessonId, "inspect-generated-changes");
});

test("msSinceLastActivity is measured from learner activity, not instructor hints", () => {
  const events = baseEvents();
  events.push({ type: "terminal.command.started", command: "ls", timestamp: at(10) });
  events.push({ type: "instructor.hint", level: 0, strategy: "diagnostic", timestamp: at(50) });
  const s = reduce(events, { nowMs: t0 + 70_000 });
  assert.equal(s.msSinceLastActivity, 60_000);
});

test("checkpoint completion is idempotent", () => {
  const events = baseEvents();
  events.push({ type: "checkpoint.completed", checkpointId: "c1", timestamp: at(1) });
  events.push({ type: "checkpoint.completed", checkpointId: "c1", timestamp: at(2) });
  assert.deepEqual(reduce(events).completedCheckpoints, ["c1"]);
});
