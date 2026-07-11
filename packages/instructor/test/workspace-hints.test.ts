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

test("terminal labs keep their diff/tests ladder", async () => {
  const mock = new MockInstructorProvider();
  const req = workspaceReq({ hintLevel: 5 });
  req.lab.surface = "terminal";
  const hint = await mock.generateHint(req, { system: "", user: "", promptVersion: "test" });
  assert.ok(/git diff/.test(hint.message));
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

test("a stuck learner after completion still gets real help (no false-positive damping)", () => {
  const state = initialState("x", "l1");
  state.completedCheckpoints.push("done-1");
  const policy = choosePolicy(state, { kind: "question", text: "wait, I broke it again", stuck: true });
  assert.ok(policy.level >= 3, policy.because);
});
