/**
 * Workspace-kind checkpoint requirements: pure functions of measured state —
 * no lab environment involved (handle is null).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCheckpoint, type CheckpointSpec } from "../src/evaluator.ts";
import { initialState, type LearningSessionState } from "../../session-events/src/reducer.ts";

const SPEC: CheckpointSpec = {
  id: "delayed-order-reply",
  title: "test",
  requirements: [
    { id: "used-ai-helper", kind: "workspace", label: "asked for a draft" },
    { id: "context-clean", kind: "workspace", label: "clean context" },
    { id: "reviewed-and-edited", kind: "workspace", label: "edited" },
    { id: "facts-preserved", kind: "workspace", label: "facts" },
    { id: "no-forbidden-promise", kind: "workspace", label: "no promise" },
    { id: "no-restricted-in-reply", kind: "workspace", label: "no restricted" },
    { id: "acknowledges-inconvenience", kind: "workspace", label: "acknowledges" },
    { id: "reply-submitted", kind: "workspace", label: "submitted" },
  ],
};
const PATHS = { verifyScript: "unused" };
const POLICY = { meaningfulEditMaxSimilarity: 0.9 };

function passingState(): LearningSessionState {
  const s = initialState("lab", "l1");
  s.workspace = {
    ...s.workspace,
    aiContextShares: 2,
    restrictedEverShared: ["loyalty-number"],
    restrictedInLatestShare: [],
    requiredFactsInLatestShare: ["order-id"],
    aiPrompts: 2,
    aiDraftsGenerated: 2,
    draftInserted: true,
    draftRevisions: 1,
    latestDraft: { revision: 1, similarityToGenerated: 0.6 },
    submitted: {
      artifactId: "customer-email",
      revision: 1,
      similarityToGenerated: 0.6,
      restrictedSpans: [],
      forbiddenPhrases: [],
      requiredFactsMissing: [],
      acknowledgesInconvenience: true,
      at: "2026-07-11T10:00:00Z",
    },
  };
  return s;
}

const resultFor = async (state: LearningSessionState) => evaluateCheckpoint(SPEC, state, null, PATHS, POLICY);

test("a clean, edited, submitted reply passes every workspace gate", async () => {
  const r = await resultFor(passingState());
  assert.equal(r.passed, true, JSON.stringify(r.requirements.filter((x) => !x.ok)));
});

test("an unedited submitted AI draft fails reviewed-and-edited", async () => {
  const s = passingState();
  s.workspace.submitted!.similarityToGenerated = 0.97;
  const r = await resultFor(s);
  assert.deepEqual(r.incomplete, ["reviewed-and-edited"]);
});

test("a manually written reply (no AI baseline) counts as the learner's own words", async () => {
  const s = passingState();
  s.workspace.submitted!.similarityToGenerated = null;
  const r = await resultFor(s);
  assert.equal(r.requirements.find((x) => x.id === "reviewed-and-edited")?.ok, true);
});

test("restricted content in the LATEST share fails context-clean; recovery passes", async () => {
  const s = passingState();
  s.workspace.restrictedInLatestShare = ["loyalty-number"];
  const r = await resultFor(s);
  assert.equal(r.requirements.find((x) => x.id === "context-clean")?.ok, false);
});

test("policy violations in the submitted reply fail their gates with teaching details", async () => {
  const s = passingState();
  s.workspace.submitted = {
    ...s.workspace.submitted!,
    restrictedSpans: ["loyalty-number"],
    forbiddenPhrases: ["delivery-promise"],
    requiredFactsMissing: ["order-id"],
    acknowledgesInconvenience: false,
  };
  const r = await resultFor(s);
  assert.deepEqual(
    r.incomplete.sort(),
    ["acknowledges-inconvenience", "facts-preserved", "no-forbidden-promise", "no-restricted-in-reply"].sort(),
  );
  for (const req of r.requirements.filter((x) => !x.ok)) assert.ok(req.detail, `${req.id} should explain itself`);
});

test("nothing submitted: submission-dependent gates fail, sharing gates unaffected", async () => {
  const s = passingState();
  s.workspace.submitted = undefined;
  const r = await resultFor(s);
  assert.equal(r.requirements.find((x) => x.id === "context-clean")?.ok, true);
  assert.equal(r.requirements.find((x) => x.id === "reply-submitted")?.ok, false);
});

test("workspace-only checkpoints never require a lab environment", async () => {
  // evaluateCheckpoint(handle: null) must not throw for workspace-only specs.
  await resultFor(initialState("lab", "l1"));
});
