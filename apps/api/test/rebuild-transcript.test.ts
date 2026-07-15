/**
 * Pure-function coverage for rebuildTranscript() (apps/api/src/sessions.ts):
 * the resume-after-restart path replays the stored event log alone to
 * reconstruct the InstructorMessage transcript a live session would have
 * built via ask()/progressMessage()/answerIntervention(). No server boot,
 * no pty — just events in, transcript out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildTranscript } from "../src/sessions.ts";
import type { SessionEvent } from "../../../packages/session-events/src/events.ts";

const t0 = Date.parse("2026-07-10T10:00:00Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();

/** A synthetic event log mixing every transcript-bearing type with terminal
 *  noise that must be ignored entirely (never consumes an id). */
function events(): SessionEvent[] {
  return [
    { type: "session.started", lessonId: "inspect-generated-changes", learnerId: "learner-1", variantId: null, timestamp: at(0) },
    // Greeting is excluded from the transcript (fetched separately via /greeting).
    { type: "instructor.greeting", text: "Hey! Ready to start?", contextManifest: null, timestamp: at(1) },
    { type: "terminal.command.started", command: "git status", timestamp: at(2) },
    { type: "terminal.command.completed", command: "git status", exitCode: 0, outputSummary: "clean", timestamp: at(3) },
    { type: "learner.goal.stated", text: "I want to fix the pricing bug", timestamp: at(4) },
    { type: "file.changed", path: "src/pricing.ts", timestamp: at(5) },
    { type: "learner.question", text: "Where do I start?", stuck: false, timestamp: at(6) },
    { type: "instructor.hint", level: 1, strategy: "point-to-tool", text: "Try running the tests first.", contextManifest: null, timestamp: at(7) },
    { type: "tests.completed", passed: 5, failed: 1, timestamp: at(8) },
    { type: "instructor.progress", completedTaskIds: ["inspect"], text: "Nice — next, review the diff.", contextManifest: null, timestamp: at(9) },
    { type: "intervention.proposed", triggerType: "tests_not_run", suggestedHintLevel: 1, timestamp: at(10) },
    { type: "intervention.delivered", triggerType: "tests_not_run", level: 1, strategy: "nudge", text: "Have you run the tests yet?", timestamp: at(11) },
    { type: "checkpoint.evaluated", checkpointId: "c1", passed: false, incomplete: ["review-diff"], timestamp: at(12) },
  ];
}

test("rebuildTranscript: roles, order, and sequential ids from 1 — greeting excluded", () => {
  const transcript = rebuildTranscript(events());

  // Exactly the five transcript-bearing events, in event order.
  assert.deepEqual(
    transcript.map((m) => m.role),
    ["learner", "learner", "instructor", "instructor", "instructor"],
  );
  assert.deepEqual(
    transcript.map((m) => m.text),
    [
      "I want to fix the pricing bug",
      "Where do I start?",
      "Try running the tests first.",
      "Nice — next, review the diff.",
      "Have you run the tests yet?",
    ],
  );

  // Sequential ids from 1, in event order — never consumed by terminal noise.
  assert.deepEqual(
    transcript.map((m) => m.id),
    [1, 2, 3, 4, 5],
  );

  // Greeting never enters the transcript (fetched separately via /greeting).
  assert.ok(!transcript.some((m) => m.text.includes("Ready to start")), "instructor.greeting must be excluded");
});

test("level is preserved on hint/intervention.delivered, and absent on goal/question/progress", () => {
  const transcript = rebuildTranscript(events());
  const byText = (text: string) => transcript.find((m) => m.text === text)!;

  assert.equal(byText("I want to fix the pricing bug").level, undefined, "learner.goal.stated has no level");
  assert.equal(byText("Where do I start?").level, undefined, "learner.question has no level");
  assert.equal(byText("Try running the tests first.").level, 1, "instructor.hint level is preserved");
  assert.equal(byText("Nice — next, review the diff.").level, undefined, "instructor.progress has no level");
  assert.equal(byText("Have you run the tests yet?").level, 1, "intervention.delivered level is preserved");
});

test("timestamps carry through unchanged from the source events", () => {
  const transcript = rebuildTranscript(events());
  assert.equal(transcript[0].at, at(4), "learner.goal.stated timestamp");
  assert.equal(transcript[4].at, at(11), "intervention.delivered timestamp");
});

test("empty log and a log with only ignored event types produce an empty transcript", () => {
  assert.deepEqual(rebuildTranscript([]), []);
  const noise: SessionEvent[] = [
    { type: "session.started", lessonId: "l", learnerId: "learner-1", variantId: null, timestamp: at(0) },
    { type: "instructor.greeting", text: "hi", contextManifest: null, timestamp: at(1) },
    { type: "terminal.command.started", command: "ls", timestamp: at(2) },
    { type: "session.resumed", timestamp: at(3) },
  ];
  assert.deepEqual(rebuildTranscript(noise), []);
});
