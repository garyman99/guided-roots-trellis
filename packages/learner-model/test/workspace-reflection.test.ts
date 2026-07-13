/**
 * Workspace sessions must produce TRUTHFUL digests and reflections: no
 * terminal-lab phrasing ("diff", "surgical fix", "requested feature"), no
 * "without hints" when a check-in happened, and ai-literacy concept
 * observations that feed the learner's long-term record. (A live simulated
 * learner caught the wrong-domain reflection — scenario finding, iter 3.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDigest, digestToEvidence } from "../src/evidence.ts";
import { buildReflection } from "../src/reflection.ts";
import { reduceProfile } from "../src/profileReducer.ts";
import { loadCurriculum } from "../src/curriculum.ts";
import type { SessionEvent } from "../../session-events/src/events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const curriculum = loadCurriculum(join(repoRoot, "curriculum", "concepts.json"));

const T0 = Date.parse("2026-07-11T21:00:00Z");
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();

/** The live iter-3 session's shape: overshare → check-in → recover → edit → send. */
function marisolEvents(): SessionEvent[] {
  return [
    { type: "session.started", lessonId: "improve-delayed-order-reply", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "workspace.artifact.opened", appId: "email", artifactId: "customer-email", timestamp: at(10) },
    { type: "aichat.context.shared", chars: 400, restrictedSpans: ["loyalty-number"], requiredFacts: ["order-id"], timestamp: at(30) },
    { type: "aichat.prompt.submitted", chars: 40, restrictedSpans: [], timestamp: at(31) },
    { type: "aichat.response.generated", draftId: "d1", echoedRestricted: ["loyalty-number"], timestamp: at(32) },
    { type: "intervention.proposed", triggerType: "restricted_context_shared", suggestedHintLevel: 1, timestamp: at(35) },
    { type: "instructor.hint", level: 1, strategy: "orient", text: "hint", contextManifest: null, timestamp: at(36) },
    { type: "aichat.context.shared", chars: 200, restrictedSpans: [], requiredFacts: ["order-id", "delivery-expectation"], timestamp: at(60) },
    { type: "aichat.prompt.submitted", chars: 30, restrictedSpans: [], timestamp: at(61) },
    { type: "aichat.response.generated", draftId: "d2", echoedRestricted: [], timestamp: at(62) },
    { type: "workspace.draft.inserted", artifactId: "customer-email", draftId: "d2", timestamp: at(80) },
    { type: "workspace.draft.updated", artifactId: "customer-email", revision: 1, similarityToGenerated: 0.7, chars: 400, timestamp: at(100) },
    {
      type: "workspace.artifact.submitted",
      artifactId: "customer-email",
      revision: 1,
      similarityToGenerated: 0.7,
      restrictedSpans: [],
      forbiddenPhrases: [],
      requiredFactsMissing: [],
      acknowledgesInconvenience: true,
      simulated: true,
      timestamp: at(120),
    },
    { type: "checkpoint.evaluated", checkpointId: "delayed-order-reply", passed: true, incomplete: [], timestamp: at(130) },
    { type: "checkpoint.completed", checkpointId: "delayed-order-reply", timestamp: at(131) },
  ];
}

test("workspace digest carries workspace facts and ai-literacy observations", () => {
  const d = extractDigest(marisolEvents(), { sessionId: "s1", labId: "improve-delayed-order-reply", learnerId: "l1" });
  assert.ok(d.workspace, "workspace digest present");
  assert.equal(d.workspace.contextShares, 2);
  assert.equal(d.workspace.restrictedShares, 1);
  assert.equal(d.workspace.recoveredFromRestrictedShare, true);
  assert.equal(d.workspace.submitted, true);
  assert.equal(d.workspace.submittedSimilarity, 0.7);
  const obs = d.conceptObservations.map((o) => o.observation);
  assert.ok(obs.includes("clean-context-share"), String(obs));
  assert.ok(obs.includes("ai-output-edited-before-use"), String(obs));
});

test("workspace reflection is truthful: no terminal phrasing, no false independence", () => {
  const d = extractDigest(marisolEvents(), { sessionId: "s1", labId: "improve-delayed-order-reply", learnerId: "l1" });
  const empty = reduceProfile("l1", [], curriculum);
  const after = reduceProfile("l1", digestToEvidence(d, curriculum.concepts).map((e, i) => ({ ...e, seq: i + 1 })), curriculum);
  const r = buildReflection(d, empty, after);

  const all = JSON.stringify(r);
  for (const banned of ["diff", "surgical", "requested feature", "test suite"]) {
    assert.ok(!all.toLowerCase().includes(banned), `terminal phrasing leaked: "${banned}" in ${all}`);
  }
  // An intervention happened: "independently, without hints" must not appear.
  assert.ok(!all.includes("without hints"), all);

  assert.ok(r.demonstrated.some((s) => s.includes("re-shared just the useful facts")), String(r.demonstrated));
  assert.ok(r.demonstrated.some((s) => s.includes("Reviewed and reshaped the AI draft")), String(r.demonstrated));
  assert.ok(r.habitsToImprove.some((s) => s.includes("before sharing")), String(r.habitsToImprove));
  assert.ok(r.habitsPositive.some((s) => s.includes("starting point")), String(r.habitsPositive));

  // The long-term record moved on the ai-literacy concepts.
  const emerging = after.skills.filter((s) => s.status !== "unknown").map((s) => s.conceptId).sort();
  assert.deepEqual(emerging, ["ai-literacy.context-selection", "ai-literacy.output-verification"]);
});

test("a clean-first-try session earns the privacy line and true independence", () => {
  const events = marisolEvents().filter(
    (e) =>
      !(e.type === "aichat.context.shared" && e.restrictedSpans.length > 0) &&
      e.type !== "intervention.proposed" &&
      e.type !== "instructor.hint",
  );
  const d = extractDigest(events, { sessionId: "s2", labId: "improve-delayed-order-reply", learnerId: "l1" });
  const empty = reduceProfile("l1", [], curriculum);
  const r = buildReflection(d, empty, empty);
  assert.ok(r.demonstrated.some((s) => s.includes("nothing personal went along")), String(r.demonstrated));
  assert.ok(r.habitsPositive.some((s) => s.includes("without hints")), String(r.habitsPositive));
  assert.equal(r.habitsToImprove.length, 0, String(r.habitsToImprove));
});

test("terminal-lab reflections are unchanged (regression guard)", () => {
  const events: SessionEvent[] = [
    { type: "session.started", lessonId: "inspect-generated-changes", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "git.diff.viewed", command: "git diff", timestamp: at(10) },
    { type: "file.changed", path: "src/pricing.ts", timestamp: at(20) },
    { type: "tests.completed", passed: 5, failed: 1, timestamp: at(30) },
    { type: "tests.completed", passed: 6, failed: 0, timestamp: at(40) },
    { type: "checkpoint.completed", checkpointId: "inspect-fix-verify", timestamp: at(50) },
  ];
  const d = extractDigest(events, { sessionId: "s3", labId: "inspect-generated-changes", learnerId: "l1", agentReview: true });
  assert.equal(d.workspace, undefined);
  const empty = reduceProfile("l1", [], curriculum);
  const r = buildReflection(d, empty, empty);
  assert.ok(r.demonstrated.some((s) => s.includes("surgical fix")), String(r.demonstrated));
  assert.ok(r.demonstrated.some((s) => s.includes("failing test suite to green")), String(r.demonstrated));
});

test("authoring labs (terminal, no agent change) get truthful reflections — no diff advice, no 'requested feature'", () => {
  const events: SessionEvent[] = [
    { type: "session.started", lessonId: "turn-heading-check-into-first-test", learnerId: "l1", variantId: null, timestamp: at(0) },
    { type: "file.changed", path: "tests/heading.spec.js", timestamp: at(20) },
    { type: "intervention.proposed", triggerType: "inactivity", suggestedHintLevel: 0, timestamp: at(30) },
    { type: "instructor.hint", level: 1, strategy: "orient", text: "hint", contextManifest: null, timestamp: at(31) },
    { type: "checkpoint.completed", checkpointId: "first-authored-check", timestamp: at(50) },
  ];
  const d = extractDigest(events, { sessionId: "s4", labId: "turn-heading-check-into-first-test", learnerId: "l1", agentReview: false });
  const empty = reduceProfile("l1", [], curriculum);
  const r = buildReflection(d, empty, empty);
  const all = JSON.stringify(r).toLowerCase();
  assert.ok(!all.includes("diff"), all);
  assert.ok(!all.includes("requested feature"), all);
  assert.ok(r.demonstrated.some((s) => s.includes("verified every requirement")), String(r.demonstrated));
});
