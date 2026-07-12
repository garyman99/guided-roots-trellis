/**
 * Workspace-lab events: reducer folding + the two workspace intervention
 * rules. Pure functions, deterministic clocks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/reducer.ts";
import type { SessionEvent } from "../src/events.ts";
import { defaultInterventionConfig, evaluateInterventions } from "../src/interventions.ts";

const T0 = Date.parse("2026-07-11T10:00:00Z");
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const started: SessionEvent = {
  type: "session.started",
  lessonId: "improve-delayed-order-reply",
  learnerId: "l1",
  variantId: null,
  timestamp: at(0),
};

test("workspace events fold into measured workspace state", () => {
  const events: SessionEvent[] = [
    started,
    { type: "workspace.app.opened", appId: "email", timestamp: at(1000) },
    { type: "workspace.app.opened", appId: "email", timestamp: at(1500) }, // dedup
    { type: "workspace.artifact.opened", appId: "email", artifactId: "customer-email", timestamp: at(2000) },
    { type: "aichat.context.shared", chars: 500, restrictedSpans: ["loyalty-number"], requiredFacts: ["order-id"], timestamp: at(3000) },
    { type: "aichat.prompt.submitted", chars: 40, restrictedSpans: [], timestamp: at(3100) },
    { type: "aichat.response.generated", draftId: "draft-1", echoedRestricted: ["loyalty-number"], timestamp: at(3200) },
    // Recovery: a clean re-share replaces the "latest share" facts.
    { type: "aichat.context.shared", chars: 200, restrictedSpans: [], requiredFacts: ["order-id", "delivery-expectation"], timestamp: at(4000) },
    { type: "aichat.prompt.submitted", chars: 30, restrictedSpans: [], timestamp: at(4100) },
    { type: "aichat.response.generated", draftId: "draft-2", echoedRestricted: [], timestamp: at(4200) },
    { type: "workspace.draft.inserted", artifactId: "customer-email", draftId: "draft-2", timestamp: at(5000) },
    { type: "workspace.draft.updated", artifactId: "customer-email", revision: 1, similarityToGenerated: 0.62, chars: 480, timestamp: at(6000) },
    {
      type: "workspace.artifact.submitted",
      artifactId: "customer-email",
      revision: 1,
      similarityToGenerated: 0.62,
      restrictedSpans: [],
      forbiddenPhrases: [],
      requiredFactsMissing: [],
      acknowledgesInconvenience: true,
      simulated: true,
      timestamp: at(7000),
    },
  ];
  const s = reduce(events, { nowMs: T0 + 8000 });
  const ws = s.workspace;
  assert.deepEqual(ws.openedApps, ["email"]);
  assert.deepEqual(ws.openedArtifacts, ["customer-email"]);
  assert.equal(ws.aiContextShares, 2);
  assert.deepEqual(ws.restrictedEverShared, ["loyalty-number"]); // history survives recovery
  assert.deepEqual(ws.restrictedInLatestShare, []); // recovery is visible
  assert.deepEqual(ws.requiredFactsInLatestShare, ["order-id", "delivery-expectation"]);
  assert.equal(ws.aiPrompts, 2);
  assert.equal(ws.aiDraftsGenerated, 2);
  assert.equal(ws.draftInserted, true);
  assert.equal(ws.draftRevisions, 1);
  assert.equal(ws.latestDraft?.similarityToGenerated, 0.62);
  assert.ok(ws.submitted);
  assert.equal(ws.submitted.acknowledgesInconvenience, true);
  // Workspace actions count as learner activity.
  assert.equal(s.msSinceLastActivity, 1000);
});

test("session.reset clears workspace facts (scene change), keeps questions", () => {
  const events: SessionEvent[] = [
    started,
    { type: "learner.question", text: "what do I do?", stuck: false, timestamp: at(500) },
    { type: "aichat.context.shared", chars: 500, restrictedSpans: ["loyalty-number"], requiredFacts: [], timestamp: at(1000) },
    { type: "session.reset", timestamp: at(2000) },
  ];
  const s = reduce(events);
  assert.equal(s.workspace.aiContextShares, 0);
  assert.deepEqual(s.workspace.restrictedEverShared, []);
  assert.deepEqual(s.learnerQuestions, ["what do I do?"]);
});

test("restricted_context_shared fires while restricted content is in the latest share, resolves on clean re-share", () => {
  const dirty = reduce([
    started,
    { type: "aichat.context.shared", chars: 500, restrictedSpans: ["loyalty-number"], requiredFacts: ["order-id"], timestamp: at(1000) },
  ]);
  const triggers = evaluateInterventions(dirty, defaultInterventionConfig);
  const hit = triggers.find((t) => t.type === "restricted_context_shared");
  assert.ok(hit, "expected a restricted-context trigger");
  assert.deepEqual(hit.evidence.restrictedSpanIds, ["loyalty-number"]);

  const recovered = reduce([
    started,
    { type: "aichat.context.shared", chars: 500, restrictedSpans: ["loyalty-number"], requiredFacts: [], timestamp: at(1000) },
    { type: "aichat.context.shared", chars: 200, restrictedSpans: [], requiredFacts: ["order-id"], timestamp: at(2000) },
  ]);
  assert.equal(
    evaluateInterventions(recovered, defaultInterventionConfig).some((t) => t.type === "restricted_context_shared"),
    false,
  );
});

test("unedited_ai_draft nudges after the grace period, never after edits or submit", () => {
  const base: SessionEvent[] = [
    started,
    { type: "aichat.context.shared", chars: 200, restrictedSpans: [], requiredFacts: ["order-id"], timestamp: at(1000) },
    { type: "aichat.response.generated", draftId: "d1", echoedRestricted: [], timestamp: at(1100) },
    { type: "workspace.draft.inserted", artifactId: "customer-email", draftId: "d1", timestamp: at(2000) },
  ];
  const cfg = defaultInterventionConfig;

  // Sitting untouched past the grace period → nudge.
  const idle = reduce(base, { nowMs: T0 + 2000 + cfg.uneditedDraftGraceMs + 1 });
  assert.ok(evaluateInterventions(idle, cfg).some((t) => t.type === "unedited_ai_draft"));

  // Within the grace period → no nudge (don't nag someone who is reading).
  const reading = reduce(base, { nowMs: T0 + 2000 + cfg.uneditedDraftGraceMs - 5000 });
  assert.equal(evaluateInterventions(reading, cfg).some((t) => t.type === "unedited_ai_draft"), false);

  // After an edit → resolved.
  const edited = reduce(
    [...base, { type: "workspace.draft.updated", artifactId: "customer-email", revision: 1, similarityToGenerated: 0.7, chars: 300, timestamp: at(3000) }],
    { nowMs: T0 + 3000 + cfg.uneditedDraftGraceMs + 1 },
  );
  assert.equal(evaluateInterventions(edited, cfg).some((t) => t.type === "unedited_ai_draft"), false);
});
