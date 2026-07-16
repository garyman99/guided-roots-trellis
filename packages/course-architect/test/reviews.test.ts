/**
 * Review scoring: pedagogy is scored 1–5 per category; a category below the
 * revision threshold (4) fails the lesson unless justified; technical/cohesion
 * verdicts of "revise" also fail it. evaluateReviews is the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReviews,
  validatePedagogyReview,
  validateTechnicalReview,
  REVISION_THRESHOLD,
  PEDAGOGY_CATEGORIES,
  type PedagogyReview,
} from "../src/reviews.ts";
import { ValidationError } from "../src/schemas.ts";

const allScores = (v: number) => Object.fromEntries(PEDAGOGY_CATEGORIES.map((c) => [c, v])) as PedagogyReview["scores"];
const ped = (scores: PedagogyReview["scores"], justifications?: PedagogyReview["justifications"]): PedagogyReview => ({ scores, verdict: "approved", ...(justifications ? { justifications } : {}) });

test("validatePedagogyReview requires every category as a 1–5 number", () => {
  assert.throws(() => validatePedagogyReview({ scores: { priorKnowledge: 5 }, verdict: "approved" }), ValidationError);
  assert.throws(() => validatePedagogyReview({ scores: allScores(9), verdict: "approved" }), ValidationError);
  assert.throws(() => validatePedagogyReview({ scores: allScores(5), verdict: "maybe" }), ValidationError);
  const ok = validatePedagogyReview({ scores: allScores(4), verdict: "approved" });
  assert.equal(ok.scores.mastery, 4);
});

test("validateTechnicalReview enforces the verdict enum", () => {
  assert.throws(() => validateTechnicalReview({ verdict: "ship it" }), ValidationError);
  assert.deepEqual(validateTechnicalReview({ verdict: "revise", issues: ["stale flag"] }).issues, ["stale flag"]);
});

test("a lesson passes when all three clear the bar", () => {
  const o = evaluateReviews("l-1", { verdict: "approved" }, ped(allScores(5)), { verdict: "approved" });
  assert.equal(o.passed, true);
  assert.deepEqual(o.failingCategories, []);
  assert.deepEqual(o.blockers, []);
});

test("an unjustified low pedagogy score fails the lesson; a justified one does not", () => {
  const low = { ...allScores(5), activeLearning: 2 };
  const failing = evaluateReviews("l-2", { verdict: "approved" }, ped(low), { verdict: "approved" });
  assert.equal(failing.passed, false);
  assert.deepEqual(failing.failingCategories, ["activeLearning"]);
  assert.ok(failing.blockers.some((b) => /activeLearning=2/.test(b)));

  const justified = evaluateReviews("l-2", { verdict: "approved" }, ped(low, { activeLearning: "intro tour is intentionally passive; active work starts next lesson" }), { verdict: "approved" });
  assert.equal(justified.passed, true, "a justified low score does not fail the lesson");
  assert.ok(REVISION_THRESHOLD === 4);
});

test("a technical or cohesion 'revise' verdict fails the lesson", () => {
  const tech = evaluateReviews("l-3", { verdict: "revise", issues: ["deprecated API"] }, ped(allScores(5)), { verdict: "approved" });
  assert.equal(tech.passed, false);
  assert.ok(tech.blockers.some((b) => /technical/.test(b)));

  const coh = evaluateReviews("l-3", { verdict: "approved" }, ped(allScores(5)), { verdict: "revise", issues: ["terminology drift"] });
  assert.equal(coh.passed, false);
  assert.ok(coh.blockers.some((b) => /cohesion/.test(b)));
});
