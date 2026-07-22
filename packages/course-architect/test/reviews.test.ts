/**
 * Review scoring: pedagogy is scored 1–5 per category; a category below the
 * revision threshold (4) fails the lesson unless justified; technical/cohesion
 * verdicts of "revise" also fail it. evaluateReviews is the gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReviews,
  evaluateBlueprintReviews,
  validatePedagogyReview,
  validateBlueprintPedagogyReview,
  validateTechnicalReview,
  REVISION_THRESHOLD,
  PEDAGOGY_CATEGORIES,
  BLUEPRINT_PEDAGOGY_CATEGORIES,
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

test("validateTechnicalReview enforces the verdict enum and tags issue severity", () => {
  assert.throws(() => validateTechnicalReview({ verdict: "ship it" }), ValidationError);
  assert.deepEqual(validateTechnicalReview({ verdict: "revise", issues: [{ severity: "minor", text: "stale flag" }] }).issues, [
    { severity: "minor", text: "stale flag" },
  ]);
  // A bare string (a model that ignored the schema) keeps its old blocking power.
  assert.deepEqual(validateTechnicalReview({ verdict: "revise", issues: ["deprecated API"] }).issues, [
    { severity: "blocker", text: "deprecated API" },
  ]);
  // Junk entries are dropped, not turned into empty blockers.
  assert.deepEqual(validateTechnicalReview({ verdict: "approved", issues: ["", null, { severity: "minor" }] }).issues, []);
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

test("a technical or cohesion blocker fails the lesson", () => {
  const tech = evaluateReviews("l-3", { verdict: "revise", issues: [{ severity: "blocker", text: "deprecated API" }] }, ped(allScores(5)), { verdict: "approved" });
  assert.equal(tech.passed, false);
  assert.ok(tech.blockers.some((b) => /technical/.test(b)));

  const coh = evaluateReviews("l-3", { verdict: "approved" }, ped(allScores(5)), { verdict: "revise", issues: [{ severity: "blocker", text: "terminology drift" }] });
  assert.equal(coh.passed, false);
  assert.ok(coh.blockers.some((b) => /cohesion/.test(b)));
});

test("a 'revise' carrying only MINOR issues ships the lesson and files them as advisory", () => {
  // The non-convergence fix: a nitpick-only review must not force another
  // full re-author round. Notes still reach the author and the gate.
  const o = evaluateReviews(
    "l-4",
    { verdict: "revise", issues: [{ severity: "minor", text: "f-string has no placeholder" }] },
    ped(allScores(5)),
    { verdict: "revise", issues: [{ severity: "minor", text: "heading could be tighter" }] },
  );
  assert.equal(o.passed, true);
  assert.deepEqual(o.blockers, []);
  assert.deepEqual(o.advisory, ["technical (minor): f-string has no placeholder", "cohesion (minor): heading could be tighter"]);
});

test("blockers and minors from the same review are separated", () => {
  const o = evaluateReviews(
    "l-5",
    { verdict: "revise", issues: [{ severity: "blocker", text: "the demo cannot print what it promises" }, { severity: "minor", text: "drop -UseBasicParsing" }] },
    ped(allScores(5)),
    { verdict: "approved" },
  );
  assert.equal(o.passed, false);
  assert.deepEqual(o.blockers, ["technical: the demo cannot print what it promises"]);
  assert.deepEqual(o.advisory, ["technical (minor): drop -UseBasicParsing"]);
});

test("the blueprint panel scores its OWN rubric and blocks on structural defects", () => {
  const bpScores = (v: number) => Object.fromEntries(BLUEPRINT_PEDAGOGY_CATEGORIES.map((c) => [c, v])) as Record<(typeof BLUEPRINT_PEDAGOGY_CATEGORIES)[number], number>;
  // The lesson rubric is NOT the blueprint rubric — a plan has no activeLearning.
  assert.throws(() => validateBlueprintPedagogyReview({ scores: allScores(5), verdict: "approved" }), ValidationError);
  const ok = validateBlueprintPedagogyReview({ scores: bpScores(5), verdict: "approved" });
  assert.equal(ok.scores.prerequisiteIntegrity, 5);

  // A sound plan passes.
  const good = evaluateBlueprintReviews({ verdict: "approved" }, { scores: bpScores(5), verdict: "approved" }, { verdict: "approved" });
  assert.equal(good.passed, true);
  assert.deepEqual(good.blockers, []);

  // An unjustified low score on a plan-level category blocks the BLUEPRINT —
  // the point of the panel: catch it here, not by blaming a lesson later.
  const bad = evaluateBlueprintReviews(
    { verdict: "approved" },
    { scores: { ...bpScores(5), prerequisiteIntegrity: 2 }, verdict: "revise" },
    { verdict: "approved" },
  );
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.failingCategories, ["prerequisiteIntegrity"]);
  assert.ok(bad.blockers.some((b) => /prerequisiteIntegrity=2/.test(b)));

  // Same severity discipline as the lesson panel: nitpicks can't loop the plan.
  const nitpicked = evaluateBlueprintReviews(
    { verdict: "revise", issues: [{ severity: "minor", text: "lesson 4's title could be punchier" }] },
    { scores: bpScores(5), verdict: "approved" },
    { verdict: "approved" },
  );
  assert.equal(nitpicked.passed, true);
  assert.deepEqual(nitpicked.advisory, ["technical (minor): lesson 4's title could be punchier"]);
});

test("a bare 'revise' with no itemised issues still blocks", () => {
  const o = evaluateReviews("l-6", { verdict: "revise" }, ped(allScores(5)), { verdict: "approved" });
  assert.equal(o.passed, false);
  assert.deepEqual(o.blockers, ["technical: revise"]);
});
