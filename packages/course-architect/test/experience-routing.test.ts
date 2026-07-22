/**
 * The shift-left gate's finding router (plan L9): a lesson revision can only fix
 * content/lab-design, so those become re-author blockers; guide-behavior and
 * platform findings (a broken terminal, a guide-prompt bug) route to the dev
 * outbox instead of being "fixed" by rewriting the lesson.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeExperienceFindings, type ExperienceFinding } from "../src/experience.ts";

const f = (area: ExperienceFinding["area"], severity: ExperienceFinding["severity"], description: string): ExperienceFinding => ({
  area,
  severity,
  description,
  evidence: "the persona's trace",
});

test("routeExperienceFindings: content/lab-design (high|medium) block; guide/platform go to the outbox", () => {
  const { blockers, outbox } = routeExperienceFindings([
    f("content", "high", "the objective isn't stated before the first task"),
    f("lab-design", "medium", "the editor pane has no visible cue"),
    f("guide-behavior", "high", "the guide invented a `notepad` command"),
    f("platform", "medium", "the terminal echoed garbled characters"),
  ]);
  assert.equal(blockers.length, 2);
  assert.ok(blockers[0].includes("content (high)"));
  assert.ok(blockers[1].includes("lab-design (medium)"));
  assert.deepEqual(outbox.map((o) => o.area), ["guide-behavior", "platform"]);
});

test("routeExperienceFindings: a low-severity content nit is advisory (outbox), not a blocker", () => {
  const { blockers, outbox } = routeExperienceFindings([f("content", "low", "a minor wording nit")]);
  assert.deepEqual(blockers, []);
  assert.equal(outbox.length, 1);
});

test("routeExperienceFindings: no findings → nothing to route", () => {
  assert.deepEqual(routeExperienceFindings([]), { blockers: [], outbox: [] });
});
