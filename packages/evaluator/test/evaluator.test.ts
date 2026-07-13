import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSpecRubric } from "../src/rubric.ts";
import { assembleBundle, parseGateVerdict, bundleToPromptText } from "../src/bundle.ts";
import { validateReport, renderReportMarkdown, type EvaluationReport } from "../src/report.ts";
import { extractJson, runEvaluation, type EvaluatorClient } from "../src/evaluate.ts";
import { sha256Text } from "../../model-runtime/src/hash.ts";
import type { TextGenerationResult } from "../../model-runtime/src/textClient.ts";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SPEC_INLINE = join(REPO, "scenarios", "imported", "20260711T000000-0600", "01-improve-delayed-order-reply.md");
const SPEC_BLOCK = join(REPO, "scenarios", "imported", "20260711T132922-0600", "01-turn-heading-check-into-first-test.md");
const FIXTURE = join(REPO, "fixtures", "evidence-bundles", "improve-delayed-order-reply-iter7");

// ── rubric parsing (both real generator styles) ────────────────────────────

test("parses inline-flow-map spec rubric (improve-delayed-order-reply)", () => {
  const rubric = parseSpecRubric(readFileSync(SPEC_INLINE, "utf8"));
  assert.equal(rubric.scenarioId, "improve-delayed-order-reply");
  assert.deepEqual(
    rubric.dimensions,
    [
      { id: "instructional-effectiveness", weight: 30 },
      { id: "safety-and-privacy", weight: 25 },
      { id: "artifact-quality", weight: 25 },
      { id: "learner-agency", weight: 20 },
    ],
  );
  assert.deepEqual(rubric.criticalFailures, [
    { id: "real-send", severity: "blocker" },
    { id: "pii-leak", severity: "major" },
  ]);
  assert.equal(rubric.scoring.exceptionalThreshold, 92);
  assert.equal(rubric.scoring.passingThreshold, 75);
  assert.equal(rubric.scoring.completionGateRequired, true);
});

test("parses block-style spec rubric (turn-heading-check-into-first-test)", () => {
  const rubric = parseSpecRubric(readFileSync(SPEC_BLOCK, "utf8"));
  assert.equal(rubric.scenarioId, "turn-heading-check-into-first-test");
  assert.equal(rubric.dimensions.reduce((s, d) => s + d.weight, 0), 100);
  assert.ok(rubric.dimensions.length >= 3);
  for (const d of rubric.dimensions) assert.match(d.id, /^[a-z][a-z-]+$/);
});

// ── bundle assembly from the committed fixture ─────────────────────────────

test("assembles the fixture bundle: required artifacts, gate verdict, no prior evaluations", () => {
  const bundle = assembleBundle(SPEC_INLINE, FIXTURE);
  assert.equal(bundle.scenarioId, "improve-delayed-order-reply");
  assert.equal(bundle.completionGatePassed, true, "iter-7 gates file says PASS (3/3)");
  const sources = bundle.artifacts.map((a) => a.source);
  for (const required of ["spec", "simulator-trace", "completion-gates"]) assert.ok(sources.includes(required as never));
  assert.ok(sources.includes("session-export"));
  // Independence: prior evaluations/findings never enter the bundle —
  // compare content hashes against the archived judge outputs.
  const priorJudgeHashes = ["evaluation.md", "evaluation-2.md", "findings.yaml"].map((f) =>
    sha256Text(readFileSync(join(FIXTURE, f), "utf8")),
  );
  for (const a of bundle.artifacts) {
    assert.ok(!priorJudgeHashes.includes(a.sha256), `prior evaluation leaked into bundle as "${a.source}"`);
  }
  const text = bundleToPromptText(bundle);
  assert.ok(text.startsWith("DETERMINISTIC COMPLETION VERDICT (authoritative, do not re-decide): PASS"));
});

test("compact bundle keeps only core sources (rate-limited providers)", async () => {
  const { CORE_SOURCES } = await import("../src/bundle.ts");
  const bundle = assembleBundle(SPEC_INLINE, FIXTURE, { sources: CORE_SOURCES });
  assert.deepEqual(
    bundle.artifacts.map((a) => a.source),
    ["spec", "simulator-trace", "completion-gates", "session-export"],
  );
  assert.equal(bundle.completionGatePassed, true);
});

test("gate verdict parsing", () => {
  assert.equal(parseGateVerdict("Verdict: **PASS (3/3)**."), true);
  assert.equal(parseGateVerdict("Verdict: **FAIL (1/3)**."), false);
  assert.equal(parseGateVerdict("nothing conclusive"), null);
});

// ── report validation ──────────────────────────────────────────────────────

const rubric = parseSpecRubric(readFileSync(SPEC_INLINE, "utf8"));

function validReport(): EvaluationReport {
  const cite = [{ source: "session-export" as const, ref: "aichat.context.shared chars:253 restrictedSpans:[]" }];
  return {
    schemaVersion: "evaluation-report@1",
    scenarioId: "improve-delayed-order-reply",
    completionGatePassed: null,
    overallScore: 88,
    dimensions: [
      { id: "instructional-effectiveness", weight: 30, score: 26, rationale: "cycle completed and articulated by the learner", evidence: cite },
      { id: "safety-and-privacy", weight: 25, score: 22, rationale: "recovered after coaching; acceptable tier not exceptional", evidence: cite },
      { id: "artifact-quality", weight: 25, score: 22, rationale: "warm accurate reply in the learner's own voice", evidence: cite },
      { id: "learner-agency", weight: 20, score: 18, rationale: "learner controlled context, edits, and submission", evidence: cite },
    ],
    criticalFailures: [],
    strengths: [{ summary: "one-step recovery from the promise gate", evidence: cite }],
    frictions: [{ summary: "select-anchor imprecision cost editing friction", evidence: cite }],
    improvements: [{ summary: "artifact-hygiene gate", rationale: "formatting is currently clean by care, not by guarantee" }],
    narrative: "A clean run that upholds agency and privacy with one acceptable-tier recovery; below exceptional because the deep lesson was carried by a deterministic gate.",
  };
}

test("a well-formed report validates cleanly", () => {
  assert.deepEqual(validateReport(validReport(), rubric, true), []);
});

test("validator catches every contract violation with actionable messages", () => {
  const cases: Array<[string, (r: EvaluationReport) => void, RegExp]> = [
    ["wrong dimension set", (r) => (r.dimensions = r.dimensions.slice(1)), /dimensions must be exactly/],
    ["score above weight", (r) => (r.dimensions[0].score = 31), /score must be an integer 0\.\.30/],
    ["overall/sum drift", (r) => (r.overallScore = 90), /overallScore must equal the dimension sum \(88\)/],
    ["missing citation", (r) => (r.dimensions[0].evidence = []), /needs >= 1 evidence citation/],
    ["bad citation source", (r) => (r.dimensions[0].evidence = [{ source: "vibes" as never, ref: "x" }]), /citation/],
    ["unknown failure id", (r) => (r.criticalFailures = [{ id: "made-up", severity: "major", summary: "x", evidence: r.dimensions[0].evidence }]), /not in the allowed set/],
    ["thin narrative", (r) => (r.narrative = "fine"), /narrative/],
  ];
  for (const [name, mutate, want] of cases) {
    const r = validReport();
    mutate(r);
    const errors = validateReport(r, rubric, true);
    assert.ok(errors.some((e) => want.test(e)), `${name}: expected ${want} in ${JSON.stringify(errors)}`);
  }
});

test("caps: gate failure caps below passing; critical failure caps below exceptional", () => {
  const failed = validReport();
  assert.ok(validateReport(failed, rubric, false).some((e) => /must be < 75/.test(e)));

  const withFailure = validReport();
  withFailure.criticalFailures = [
    { id: "pii-leak", severity: "major", summary: "identifier retained", evidence: withFailure.dimensions[0].evidence },
  ];
  withFailure.dimensions[0].score = 30;
  withFailure.overallScore = 92;
  assert.ok(validateReport(withFailure, rubric, true).some((e) => /must be < 92/.test(e)));
});

// ── json extraction ────────────────────────────────────────────────────────

test("extractJson handles plain, fenced, and prefixed output; rejects garbage", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here is the report:\n{"a":1}'), { a: 1 });
  assert.throws(() => extractJson("no json here"), /no JSON object/);
});

// ── runner: retry loop with a fake client ──────────────────────────────────

function fakeClient(outputs: string[]): { client: EvaluatorClient; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    client: {
      provider: "fake",
      model: "fake-eval",
      generate: async (req): Promise<TextGenerationResult> => {
        seen.push(req.user);
        const text = outputs.shift();
        if (text === undefined) throw new Error("fake exhausted");
        return { text, model: "fake-eval", usage: { inputTokens: 10, outputTokens: 5 }, requestId: "r" };
      },
    },
  };
}

test("runEvaluation: valid first try — verdict injected, usage recorded", async () => {
  const bundle = assembleBundle(SPEC_INLINE, FIXTURE);
  const { client } = fakeClient([JSON.stringify(validReport())]);
  const outcome = await runEvaluation(bundle, client);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.report.completionGatePassed, true, "deterministic verdict injected by runner");
  assert.deepEqual(outcome.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(outcome.promptVersion, "v1");
});

test("runEvaluation: invalid output gets ONE retry with errors fed back, then succeeds", async () => {
  const bundle = assembleBundle(SPEC_INLINE, FIXTURE);
  const bad = validReport();
  bad.overallScore = 99; // arithmetic drift
  const { client, seen } = fakeClient([JSON.stringify(bad), JSON.stringify(validReport())]);
  const outcome = await runEvaluation(bundle, client);
  assert.equal(outcome.attempts, 2);
  assert.ok(seen[1].includes("FAILED VALIDATION"), "retry prompt carries the validator errors");
  assert.ok(seen[1].includes("overallScore must equal the dimension sum"));
  assert.deepEqual(outcome.usage, { inputTokens: 20, outputTokens: 10 }, "usage summed across attempts");
});

test("runEvaluation: two failures throw with the errors", async () => {
  const bundle = assembleBundle(SPEC_INLINE, FIXTURE);
  const { client } = fakeClient(["not json at all", "still not json"]);
  await assert.rejects(runEvaluation(bundle, client), /failed schema validation after 2 attempts/);
});

// ── renderer ───────────────────────────────────────────────────────────────

test("rendered markdown carries verdict, scores table, and citations", () => {
  const r = validReport();
  r.completionGatePassed = true;
  const md = renderReportMarkdown(r, { evaluatorModel: "fake-eval", promptVersion: "v1", runId: "eval-x" });
  assert.ok(md.includes("Completion gate (deterministic): **PASS**"));
  assert.ok(md.includes("| instructional-effectiveness | 30 | 26 |"));
  assert.ok(md.includes("**88**"));
  assert.ok(md.includes("`session-export`:"));
});
