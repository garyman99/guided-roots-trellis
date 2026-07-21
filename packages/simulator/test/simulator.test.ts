import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeSnapshot, renderObservation, type RawSnapshot } from "../src/observation.ts";
import { learnerVisibleSpec } from "../src/specView.ts";
import { validateDecision, type SimulatorDecision } from "../src/actions.ts";
import { resolveTarget, type SimScreenDriver } from "../src/driverClient.ts";
import { runSimulationLoop, type SimulatorClient } from "../src/loop.ts";
import type { TextGenerationResult } from "../../model-runtime/src/textClient.ts";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SPEC = readFileSync(join(REPO, "scenarios", "imported", "20260711T000000-0600", "01-improve-delayed-order-reply.md"), "utf8");

const target = (name: string, x = 100, y = 100) => ({ tag: "button", role: "button", name, x, y, w: 50, h: 20 });
const screen = (text: string, names: string[]): RawSnapshot => ({
  url: "http://localhost:60304/?lab=x",
  title: "Trellis",
  text,
  targets: names.map((n, i) => target(n, 100 + i * 10, 200)),
});

// ── sanitization boundary ──────────────────────────────────────────────────

test("sanitizeSnapshot whitelists fields — no coordinates, no unknown fields leak", () => {
  const raw = screen("hello", ["Send"]) as RawSnapshot & { secretVerifierState: string };
  raw.secretVerifierState = "answer-key";
  const obs = sanitizeSnapshot(raw);
  const json = JSON.stringify(obs);
  assert.ok(!json.includes("answer-key"), "unknown fields are dropped");
  assert.ok(!json.includes('"x"'), "coordinates stay executor-side");
  assert.deepEqual(obs.targets[0], { index: 0, tag: "button", role: "button", name: "Send" });
  assert.ok(renderObservation(obs).includes('[0] button(button) "Send"'));
  const unchanged = renderObservation(obs, { unchanged: true });
  assert.ok(unchanged.startsWith("SCREEN: visible text unchanged"));
  assert.ok(unchanged.includes('[0] button(button) "Send"'), "targets stay visible on unchanged screens");
  assert.ok(!unchanged.includes("VISIBLE TEXT"), "large text is elided on unchanged screens");
});

test("learnerVisibleSpec keeps the actor's script and strips the judge's material", () => {
  const view = learnerVisibleSpec(SPEC);
  for (const mustHave of ["Marisol Vega", "user_simulation", "learner_facing_prompt", "starting_state", "mistakes"]) {
    assert.ok(view.includes(mustHave), `learner view keeps ${mustHave}`);
  }
  // NOTE: the scripted mistake in user_simulation legitimately names the
  // over-share content — the ACTOR must know their script. What must never
  // leak is the judge's material and authoring-side hidden complications.
  for (const forbidden of [
    "quality_dimensions",
    "completion_gate",
    "critical_failures",
    "hidden_complications",
    "expected_artifacts",
    "prohibited_shortcuts",
    "exceptional_threshold",
    "downstream_guidance",
  ]) {
    assert.ok(!view.includes(forbidden), `learner view must not contain ${forbidden}`);
  }
});

// ── action schema ──────────────────────────────────────────────────────────

test("validateDecision enforces the strict schema", () => {
  const ok: SimulatorDecision = {
    status: "continue",
    beat: "I open the Mail icon to read the customer's message.",
    actions: [{ type: "dblclick", target: { kind: "name", value: "Mail" } }],
  };
  assert.deepEqual(validateDecision(ok), []);
  assert.ok(validateDecision({ status: "sprint", beat: "x".repeat(20), actions: [] })[0].includes("status"));
  assert.ok(validateDecision({ status: "continue", beat: "short", actions: [] })[0].includes("beat"));
  assert.ok(
    validateDecision({ ...ok, actions: Array(6).fill(ok.actions[0]) }).some((e) => e.includes("at most 5")),
    "long autonomous scripts rejected",
  );
  assert.ok(
    validateDecision({ ...ok, status: "done", actions: ok.actions }).some((e) => e.includes("actions must be empty")),
  );
  assert.ok(validateDecision({ ...ok, actions: [{ type: "hack" }] }).some((e) => e.includes("unknown action type")));
  assert.ok(validateDecision({ ...ok, actions: [{ type: "wait", ms: 60_000 }] }).some((e) => e.includes("1..5000")));
});

test("normalizeDecision tolerates documented drift: null special, key→press", async () => {
  const { normalizeDecision } = await import("../src/actions.ts");
  const drifted = {
    status: "continue",
    beat: "I press Enter to send my message to the guide.",
    special: null,
    actions: [{ type: "key", key: "Enter" }],
  };
  const normalized = normalizeDecision(drifted) as SimulatorDecision;
  assert.deepEqual(validateDecision(normalized), []);
  assert.equal(normalized.actions[0].type, "press");
  assert.ok(!("special" in normalized));
});

test("resolveTarget: index, exact, unique substring; ambiguity and misses are errors", () => {
  const raw = screen("t", ["Send", "Send draft", "Reset"]);
  assert.deepEqual(resolveTarget(raw, { kind: "index", value: 2 }), { x: 120, y: 200 });
  assert.deepEqual(resolveTarget(raw, { kind: "name", value: "send" }), { x: 100, y: 200 }); // exact beats substring
  assert.deepEqual(resolveTarget(raw, { kind: "name", value: "reset" }), { x: 120, y: 200 });
  assert.ok("error" in resolveTarget(raw, { kind: "name", value: "sen" }) && /matches 2/.test((resolveTarget(raw, { kind: "name", value: "sen" }) as { error: string }).error));
  assert.ok(/no visible target/.test((resolveTarget(raw, { kind: "name", value: "Quit" }) as { error: string }).error));
  assert.ok(/out of range/.test((resolveTarget(raw, { kind: "index", value: 9 }) as { error: string }).error));
});

// ── loop harness ───────────────────────────────────────────────────────────

class FakeDriver implements SimScreenDriver {
  actionsLog: string[] = [];
  current: RawSnapshot;
  private onAction: (kind: string, driver: FakeDriver) => void;

  constructor(current: RawSnapshot, onAction: (kind: string, driver: FakeDriver) => void = () => {}) {
    this.current = current;
    this.onAction = onAction;
  }
  async snapshot() { return this.current; }
  private act(kind: string) { this.actionsLog.push(kind); this.onAction(kind, this); }
  async click() { this.act("click"); }
  async dblclick() { this.act("dblclick"); }
  async type() { this.act("type"); }
  async press() { this.act("press"); }
  async replaceText() { this.act("replace-text"); }
  async scroll() { this.act("scroll"); }
  async wait() { this.act("wait"); }
}

function scriptedClient(replies: Array<object | string>): { client: SimulatorClient; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    client: {
      provider: "fake",
      model: "fake-sim",
      generate: async (req): Promise<TextGenerationResult> => {
        prompts.push(req.user);
        const next = replies.shift();
        if (next === undefined) throw new Error("fake model exhausted");
        return {
          text: typeof next === "string" ? next : JSON.stringify(next),
          model: "fake-sim",
          usage: { inputTokens: 100, outputTokens: 20 },
          requestId: "r",
        };
      },
    },
  };
}

const persona = learnerVisibleSpec(SPEC);
const beat = (s: string) => `I look at the screen and ${s} because that is what Marisol would do.`;

test("loop: goal → act → done produces completed with a well-formed trace", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail", "Chat"]), (kind, d) => {
    if (kind === "dblclick") d.current = screen("mail is open", ["Reply", "Check my work"]);
  });
  const { client } = scriptedClient([
    { status: "continue", beat: beat("state my goal"), special: "GOAL", belief: "I should read the email first", actions: [{ type: "dblclick", target: { kind: "name", value: "Mail" } }] },
    { status: "continue", beat: beat("check my work"), actions: [{ type: "click", target: { kind: "name", value: "Check my work" } }] },
    { status: "done", beat: beat("finish up"), actions: [] },
  ]);
  const result = await runSimulationLoop({ driver, client, personaContext: persona });
  assert.equal(result.status, "completed");
  assert.equal(result.decisions, 3);
  assert.equal(result.invalidActions, 0);
  assert.equal(result.beats.length, 3);
  assert.ok(result.beats[0].includes("[GOAL]"));
  assert.ok(result.trace.includes("OUTCOME: done"));
  assert.ok(result.trace.includes("FINAL-STATUS: completed"));
  assert.deepEqual(result.usage, { inputTokens: 300, outputTokens: 60 });
});

test("loop: repeated invalid decisions exhaust the invalid-action budget explicitly", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail"]));
  const { client, prompts } = scriptedClient(Array(10).fill("this is not json"));
  const result = await runSimulationLoop({ driver, client, personaContext: persona, budgets: { maxInvalidActions: 2 } });
  assert.equal(result.status, "budget_exceeded");
  assert.match(result.reason, /maxInvalidActions \(2\)/);
  assert.ok(prompts[1].includes("FEEDBACK ON YOUR LAST TURN"), "validation errors are fed back");
});

test("loop: unchanged screen across observations ends as stuck", async () => {
  const driver = new FakeDriver(screen("frozen screen", ["Mail"]));
  const wait = { status: "continue", beat: beat("wait for something to happen"), actions: [] };
  const { client, prompts } = scriptedClient(Array(10).fill(wait));
  const result = await runSimulationLoop({ driver, client, personaContext: persona, budgets: { maxRepeatedObservations: 3 } });
  assert.equal(result.status, "stuck");
  assert.match(result.reason, /unchanged across 4 consecutive observations/);
  assert.ok(prompts.some((p) => p.includes("SCREEN: visible text unchanged")), "unchanged marker replaces full text resend");
});

test("loop: maxDecisions is an explicit budget outcome", async () => {
  let n = 0;
  const driver = new FakeDriver(screen("s0", ["A"]), (_k, d) => { n += 1; d.current = screen(`s${n}`, ["A"]); });
  const act = { status: "continue", beat: beat("keep poking the same button"), actions: [{ type: "click", target: { kind: "name", value: "A" } }] };
  const { client } = scriptedClient(Array(10).fill(act));
  const result = await runSimulationLoop({ driver, client, personaContext: persona, budgets: { maxDecisions: 4 } });
  assert.equal(result.status, "budget_exceeded");
  assert.match(result.reason, /maxDecisions \(4\)/);
});

test("loop: action group stops when the target set changes materially", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail", "Chat"]), (kind, d) => {
    if (kind === "click") d.current = screen("a window opened", ["Reply", "Close"]); // material change
  });
  const { client, prompts } = scriptedClient([
    {
      status: "continue",
      beat: beat("click Mail then type a note"),
      actions: [
        { type: "click", target: { kind: "name", value: "Mail" } },
        { type: "type", text: "hello" },
        { type: "press", key: "Enter" },
      ],
    },
    { status: "gave-up", beat: beat("stop here for the test"), actions: [] },
  ]);
  const result = await runSimulationLoop({ driver, client, personaContext: persona });
  assert.deepEqual(driver.actionsLog, ["click"], "remaining actions cancelled after material change");
  assert.ok(prompts[1].includes("changed materially"), "cancellation is explained to the model");
  assert.equal(result.status, "gave_up");
});

test("loop: typing into a text field does NOT cancel a Send queued in the same decision", async () => {
  // Regression: the driver derives an editable field's `name` from its live
  // `value`, so the learner typing used to change targetsSignature and cancel
  // the `click Send` in the SAME group — splitting every "ask the guide" into a
  // type-turn + a send-turn (double LLM calls, often re-appending the text).
  // A composer = a textarea (addressed by index) + a Send button.
  const composer = (draft: string): RawSnapshot => ({
    url: "http://localhost:60304/?lab=x",
    title: "Trellis",
    text: "chat with the guide",
    targets: [
      { tag: "textarea", role: "textbox", name: draft || "Message Sage", x: 100, y: 300, w: 200, h: 40 },
      { tag: "button", role: "button", name: "Send", x: 320, y: 300, w: 50, h: 20 },
    ],
  });
  const driver = new FakeDriver(composer(""), (kind, d) => {
    // Typing mutates only the textarea's value→name (the real leak); the SET of
    // targets is structurally unchanged.
    if (kind === "type") d.current = composer("hello Sage");
  });
  const { client } = scriptedClient([
    {
      status: "continue",
      beat: beat("click the box, type my question, and hit Send in one go"),
      actions: [
        { type: "click", target: { kind: "index", value: 0 } },
        { type: "type", text: "hello Sage" },
        { type: "click", target: { kind: "name", value: "Send" } },
      ],
    },
    { status: "gave-up", beat: beat("stop here for the test"), actions: [] },
  ]);
  const result = await runSimulationLoop({ driver, client, personaContext: persona });
  assert.deepEqual(driver.actionsLog, ["click", "type", "click"], "the whole ask (type + Send) lands in ONE decision");
  assert.equal(result.decisions, 2, "no extra decision spent re-sending");
});

test("loop: unknown target is an invalid action with feedback, not a crash", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail"]));
  const { client, prompts } = scriptedClient([
    { status: "continue", beat: beat("click a button that is not there"), actions: [{ type: "click", target: { kind: "name", value: "Launch Rocket" } }] },
    { status: "stuck", beat: beat("give in and report being blocked"), special: "STUCK-ASK", actions: [] },
  ]);
  const result = await runSimulationLoop({ driver, client, personaContext: persona });
  assert.equal(result.status, "stuck");
  assert.equal(result.invalidActions, 1);
  assert.ok(prompts[1].includes('no visible target named "Launch Rocket"'));
  assert.equal(result.clarifyingQuestions, 1);
});

test("loop: cost budget uses the pricing table and ends explicitly", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail"]));
  const act = { status: "continue", beat: beat("keep going"), actions: [{ type: "wait", ms: 10 }] };
  const { client } = scriptedClient(Array(10).fill(act));
  const pricing = { version: 1, pricedAt: "2026-07-13", currency: "USD" as const, models: { "fake-sim": { inputPerMTok: 1_000_000, outputPerMTok: 0 } } };
  const result = await runSimulationLoop({ driver, client, personaContext: persona, pricing, budgets: { maxEstimatedCostUSD: 0.25 } });
  assert.equal(result.status, "budget_exceeded");
  assert.match(result.reason, /maxEstimatedCostUSD/);
});

test("loop: transient model failures are bounded retries; config failures are terminal", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail"]));
  // Transient: throws twice, then a clean give-up — run survives.
  let calls = 0;
  const flaky: SimulatorClient = {
    provider: "fake",
    model: "fake-sim",
    generate: async () => {
      calls += 1;
      if (calls <= 2) throw new Error("anthropic returned no text content (stop_reason=max_tokens)");
      return { text: JSON.stringify({ status: "gave-up", beat: beat("stop after the flaky patch"), actions: [] }), model: "fake-sim", usage: {}, requestId: "r" };
    },
  };
  const survived = await runSimulationLoop({ driver, client: flaky, personaContext: persona });
  assert.equal(survived.status, "gave_up");
  assert.equal(survived.invalidActions, 2);

  // Config-shaped: terminal simulator_failure immediately.
  const authErr = Object.assign(new Error("HTTP 401 (auth)"), { category: "auth" });
  const broken: SimulatorClient = { provider: "fake", model: "fake-sim", generate: async () => { throw authErr; } };
  const dead = await runSimulationLoop({ driver, client: broken, personaContext: persona });
  assert.equal(dead.status, "simulator_failure");
  assert.match(dead.reason, /HTTP 401/);
});

test("loop: driver failure is environment_failure with the cause", async () => {
  const driver = new FakeDriver(screen("desktop", ["Mail"]));
  driver.snapshot = async () => { throw new Error("ECONNREFUSED"); };
  const { client } = scriptedClient([]);
  const result = await runSimulationLoop({ driver, client, personaContext: persona });
  assert.equal(result.status, "environment_failure");
  assert.match(result.reason, /ECONNREFUSED/);
});

test("loop: system prompt is stable across turns (cacheable prefix)", async () => {
  const systems: string[] = [];
  const driver = new FakeDriver(screen("desktop", ["Mail"]), (_k, d) => { d.current = screen("next", ["Mail"]); });
  const client: SimulatorClient = {
    provider: "fake",
    model: "fake-sim",
    generate: async (req) => {
      systems.push(req.system);
      const n = systems.length;
      return {
        text: JSON.stringify(n < 3 ? { status: "continue", beat: beat(`turn ${n}`), actions: [{ type: "click", target: { kind: "index", value: 0 } }] } : { status: "done", beat: beat("wrap"), actions: [] }),
        model: "fake-sim",
        usage: {},
        requestId: "r",
      };
    },
  };
  await runSimulationLoop({ driver, client, personaContext: persona });
  assert.equal(new Set(systems).size, 1, "identical system prefix every turn");
  assert.ok(systems[0].includes("Marisol Vega"), "persona rides in the stable prefix");
});
