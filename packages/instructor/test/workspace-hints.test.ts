/**
 * Surface-scoped coaching (scenario evaluation iter-1 findings): workspace
 * learners must never receive terminal-lab vocabulary, first privacy nudges
 * must not open high on the ladder, and post-completion thanks must not be
 * answered with a walk-through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockInstructorProvider } from "../src/mock.ts";
import { choosePolicy } from "../src/policy.ts";
import { initialState } from "../../session-events/src/reducer.ts";
import type { HintRequest } from "../src/types.ts";

const FORBIDDEN_IN_WORKSPACE = /\b(diff|hunk|git|npm test|failing test|test suite|working tree|commit)\b/i;

function workspaceReq(overrides: Partial<HintRequest> = {}): HintRequest {
  const state = initialState("improve-delayed-order-reply", "l1");
  return {
    state,
    lab: {
      id: "improve-delayed-order-reply",
      title: "Improve a delayed-order reply",
      objective: "context → draft → verify → edit",
      surface: "workspace",
      tasks: [
        { id: "open-email", text: "Read the customer's message.", done: true },
        { id: "context-clean", text: "Trim the context down to the useful facts and share that instead.", done: false },
      ],
    },
    reason: { kind: "question", text: "help?", stuck: false },
    hintLevel: 0,
    promptVersion: "test",
    ...overrides,
  };
}

test("workspace labs never receive terminal vocabulary at ANY hint level", async () => {
  const mock = new MockInstructorProvider();
  for (let level = 0; level <= 5; level++) {
    const hint = await mock.generateHint(workspaceReq({ hintLevel: level }), { system: "", user: "", promptVersion: "test" });
    assert.ok(
      !FORBIDDEN_IN_WORKSPACE.test(hint.message),
      `level ${level} leaked terminal vocabulary: ${hint.message}`,
    );
  }
});

test("workspace orient hint points at the lab's own next task", async () => {
  const mock = new MockInstructorProvider();
  const hint = await mock.generateHint(workspaceReq({ hintLevel: 1 }), { system: "", user: "", promptVersion: "test" });
  assert.ok(hint.message.includes("Trim the context down"), hint.message);
});

test("restricted-context check-in carries privacy evidence, phrased for the workspace", async () => {
  const mock = new MockInstructorProvider();
  const req = workspaceReq({
    reason: {
      kind: "intervention",
      trigger: { type: "restricted_context_shared", evidence: { restrictedSpanIds: ["loyalty-number"] }, suggestedHintLevel: 1 },
    },
    hintLevel: 1,
  });
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(/doesn't actually need/.test(hint.message), hint.message);
  assert.ok(!FORBIDDEN_IN_WORKSPACE.test(hint.message), hint.message);
});

test("agent-review terminal labs keep their diff/tests ladder", async () => {
  const mock = new MockInstructorProvider();
  const req = workspaceReq({ hintLevel: 5 });
  req.lab.surface = "terminal";
  req.lab.agentReview = true;
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(/git diff/.test(hint.message));
});

test("authoring labs (terminal, no agent change) never hear about diffs or agents", async () => {
  const mock = new MockInstructorProvider();
  for (let level = 0; level <= 5; level++) {
    const req = workspaceReq({ hintLevel: level });
    req.lab.surface = "terminal";
    req.lab.agentReview = false;
    req.lab.tasks = [
      { id: "orient", text: "Read README.md.", done: true },
      { id: "author", text: "Turn your manual step into code in tests/heading.spec.js.", done: false },
    ];
    const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
    assert.ok(!/\b(diff|hunk|agent's|git)\b/i.test(hint.message), `level ${level}: ${hint.message}`);
  }
  // Orient still points at the lab's own next task.
  const req = workspaceReq({ hintLevel: 1 });
  req.lab.surface = "terminal";
  req.lab.agentReview = false;
  req.lab.tasks = [{ id: "author", text: "Turn your manual step into code.", done: false }];
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(hint.message.includes("Turn your manual step into code"), hint.message);
});

test("after completion, a casual thanks gets conversation — not a hint ladder", async () => {
  const state = initialState("improve-delayed-order-reply", "l1");
  state.completedCheckpoints.push("delayed-order-reply");
  state.hintsAlreadyGiven.push({ level: 4, strategy: "explain-concept" });

  const policy = choosePolicy(state, { kind: "question", text: "That was easier than I expected. Thanks!", stuck: false });
  assert.equal(policy.level, 0, policy.because);

  const mock = new MockInstructorProvider();
  const req = workspaceReq({ state, reason: { kind: "question", text: "Thanks!", stuck: false }, hintLevel: policy.level });
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(/take the credit|all set/i.test(hint.message), hint.message);
  assert.equal(hint.level, 0);
});

test("a stated goal gets orientation with the first step — never a Socratic bounce or ladder tag", async () => {
  const state = initialState("turn-heading-check-into-first-test", "l1");
  const policy = choosePolicy(state, { kind: "goal", text: "I want to turn my manual heading check into an automated one" });
  assert.equal(policy.level, 1, policy.because);

  const mock = new MockInstructorProvider();
  const req = workspaceReq({
    state,
    reason: { kind: "goal", text: "I want to turn my manual heading check into an automated one" },
    hintLevel: policy.level,
  });
  req.lab.tasks = [{ id: "orient", text: "Open Code Studio from the desktop and read README.md.", done: false }];
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(hint.message.includes("Open Code Studio"), hint.message);
  assert.ok(!/what do you \*expect\*|prediction/i.test(hint.message), "no elicit bounce at a goal statement");
});

test("an authored FAQ answers the learner's actual question; unmatched questions fall to the ladder", async () => {
  const mock = new MockInstructorProvider();
  const req = workspaceReq({ reason: { kind: "question", text: "Where do I say the heading must be visible?", stuck: false }, hintLevel: 0 });
  req.lab.faq = [
    { match: "visible|expect", answer: "The checking piece starts with await expect(…) and ends with .toBeVisible()." },
  ];
  const hit = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.equal(hit.strategy, "faq-answer");
  assert.ok(hit.message.includes("toBeVisible"), hit.message);

  const req2 = workspaceReq({ reason: { kind: "question", text: "what's the weather like", stuck: false }, hintLevel: 0 });
  req2.lab.faq = req.lab.faq;
  const miss = await mock.generateHint(req2, { system: "", user: "", promptVersion: "test" });
  assert.notEqual(miss.strategy, "faq-answer");
});

test("a stuck learner after completion still gets real help (no false-positive damping)", () => {
  const state = initialState("x", "l1");
  state.completedCheckpoints.push("done-1");
  const policy = choosePolicy(state, { kind: "question", text: "wait, I broke it again", stuck: true });
  assert.ok(policy.level >= 3, policy.because);
});
