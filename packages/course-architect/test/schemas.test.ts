/**
 * Parser + validation robustness for real-model output: tolerate code fences,
 * trailing commas, snake_case keys, and a single-key wrapper object.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJson, camelizeKeys, validateWithUnwrap, validateCourseRequest, ValidationError } from "../src/schemas.ts";

test("parseJson tolerates code fences and trailing commas", () => {
  assert.deepEqual(parseJson('```json\n{"a":1,}\n```'), { a: 1 });
  assert.deepEqual(parseJson('here is your object: {"a": [1, 2,], "b": 3,}'), { a: [1, 2], b: 3 });
});

test("parseJson prefers the WHOLE object when a string value contains a ``` code block", () => {
  // The exact failure: a valid lesson JSON whose markdown holds a bash block.
  const lesson = { lessonId: "selenium-102", markdown: "## Setup\n```bash\npython3 --version\n```\nRun it.", lab: { objective: "o", primaryAuto: "any-command" } };
  const raw = JSON.stringify(lesson);
  assert.deepEqual(parseJson(raw), lesson, "must not extract the inner ```bash block");
  // Even wrapped in prose + an outer json fence.
  assert.deepEqual(parseJson("Here's the lesson:\n```json\n" + raw + "\n```\nDone."), lesson);
});

test("camelizeKeys renames snake_case / kebab-case keys, not values", () => {
  assert.deepEqual(camelizeKeys({ target_learner: "a_b", "out-of-scope": [{ foo_bar: 1 }] }), { targetLearner: "a_b", outOfScope: [{ fooBar: 1 }] });
});

test("validateWithUnwrap unwraps a single-key wrapper object", () => {
  const doc = { title: "T", technology: "Git", targetLearner: "x", startingPoint: "x", endingCapability: "x", assumptions: [], outOfScope: [] };
  // Direct.
  assert.equal(validateWithUnwrap(doc, validateCourseRequest).title, "T");
  // Wrapped as { courseRequest: {…} }.
  assert.equal(validateWithUnwrap({ courseRequest: doc }, validateCourseRequest).technology, "Git");
  // A wrapper whose inner is ALSO invalid still throws.
  assert.throws(() => validateWithUnwrap({ wrap: { nope: 1 } }, validateCourseRequest), ValidationError);
});

test("a snake_case + trailing-comma course-request validates end to end", () => {
  const raw = '{ "title": "T", "technology": "Git", "target_learner": "devs", "starting_point": "none", "ending_capability": "fluent", "assumptions": ["a",], "out_of_scope": ["b",], }';
  const doc = validateWithUnwrap(camelizeKeys(parseJson(raw)), validateCourseRequest);
  assert.equal(doc.targetLearner, "devs");
  assert.deepEqual(doc.outOfScope, ["b"]);
});
