/**
 * The shift-left experience gate's decision logic (plan L9): a lesson is usable
 * only if the simulated persona COMPLETED it, its checkpoint passed, and friction
 * stayed within budget. Pure — no browser or model needed.
 */
process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { simVerdict } from "../src/courseSimTest.ts";
import type { SimLessonResult } from "../src/courseSimTest.ts";

const base: SimLessonResult = { labId: "s1", status: "completed", checkpointPassed: true, frictionScore: 10 };

test("simVerdict: a clean completion within budget passes", () => {
  assert.deepEqual(simVerdict(base, { frictionBudget: 50 }), { ok: true });
});

test("simVerdict: a persona that didn't finish is blocked", () => {
  const v = simVerdict({ ...base, status: "gave_up", reason: "too many hints" });
  assert.equal(v.ok, false);
  assert.match(v.detail!, /did not finish \(gave_up/);
});

test("simVerdict: completed but checkpoint failed is blocked", () => {
  const v = simVerdict({ ...base, checkpointPassed: false });
  assert.equal(v.ok, false);
  assert.match(v.detail!, /checkpoint did not pass/);
});

test("simVerdict: friction over budget is blocked", () => {
  const v = simVerdict({ ...base, frictionScore: 80, clarifyingQuestions: 4 }, { frictionBudget: 50 });
  assert.equal(v.ok, false);
  assert.match(v.detail!, /friction score 80 exceeded the budget of 50/);
  assert.match(v.detail!, /4 clarifying questions/);
});

test("simVerdict: no budget → friction is not checked", () => {
  assert.deepEqual(simVerdict({ ...base, frictionScore: 999 }), { ok: true });
});
