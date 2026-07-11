/**
 * Integration test for the lab runtime: exercises the REAL LocalProcessDriver
 * against the real lab — no mocks. Covers create → observe → evaluate →
 * fix → pass → reset → destroy, i.e. Slice 1 + Slice 3 end to end.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalProcessDriver } from "../src/localDriver.ts";
import { SessionInstrumentation } from "../src/instrumentation.ts";
import { evaluateCheckpoint, verifyScriptPathFor, type CheckpointSpec } from "../src/evaluator.ts";
import { reduce } from "../../session-events/src/reducer.ts";
import type { SessionEvent } from "../../session-events/src/events.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const labDir = join(repoRoot, "labs", "inspect-generated-changes");
const labJson = await import(join(labDir, "lab.json"), { with: { type: "json" } });
const checkpoint: CheckpointSpec = labJson.default.checkpoint;

const driver = new LocalProcessDriver();
const handle = await driver.create({ labDir, labId: "inspect-generated-changes" }, "test-session");
const events: SessionEvent[] = [];
const instr = new SessionInstrumentation(handle, (e) => events.push(e));
await instr.start(); // baseline only; we drive drains manually for determinism

after(async () => {
  instr.stop();
  await handle.destroy();
});

const paths = verifyScriptPathFor("local", labDir);
const state = () => reduce(events);

function typeCounts() {
  const m = new Map<string, number>();
  for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return m;
}

test("fresh workspace: repo initialized with the AI change uncommitted", async () => {
  const status = await handle.exec(["git", "status", "--porcelain"]);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /M src\/pricing\.ts/);
  const log = await handle.exec(["git", "log", "--oneline"]);
  assert.match(log.stdout, /Initial commit/);
});

test("checkpoint fails on a fresh session with every requirement reported", async () => {
  const result = await evaluateCheckpoint(checkpoint, state(), handle, paths);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.incomplete.sort(),
    ["defect-fixed", "ran-tests", "tests-pass", "viewed-diff"].sort(),
  );
  // Clear feedback exists for each incomplete requirement.
  for (const r of result.requirements.filter((x) => !x.ok)) {
    assert.ok(r.detail, `requirement ${r.id} should explain itself`);
  }
});

test("instrumented terminal captures commands, diff views, file edits, and test runs", async () => {
  const term = handle.attachTerminal();
  term.onData((chunk) => instr.onTerminalOutput(chunk));

  const type = async (line: string, settleMs = 900) => {
    term.write(line + "\n");
    await new Promise((r) => setTimeout(r, settleMs));
    await instr.drain();
  };

  await new Promise((r) => setTimeout(r, 800)); // shell startup
  await type("git status");
  await type("git diff", 1200);
  await type("npm test", 6000);
  await type("sed -i 's/Math.floor(discounted)/Math.round(discounted)/' src/pricing.ts");
  await type("npm test", 6000);

  const counts = typeCounts();
  assert.ok((counts.get("terminal.command.started") ?? 0) >= 5, `commands captured: ${counts.get("terminal.command.started")}`);
  assert.ok((counts.get("git.diff.viewed") ?? 0) >= 1, "git diff view detected");
  assert.ok((counts.get("tests.completed") ?? 0) >= 2, `test runs detected: ${counts.get("tests.completed")}`);
  assert.ok((counts.get("file.changed") ?? 0) >= 1, "learner file edit detected");

  const s = state();
  assert.equal(s.viewedGitDiff, true);
  assert.ok(s.testsRun >= 2);
  assert.deepEqual(s.latestTestResult, { passed: 6, failed: 0 });
  assert.ok(s.filesChanged.includes("src/pricing.ts"));
  const npmTest = s.recentCommands.filter((c) => c.command === "npm test");
  assert.ok(npmTest.length >= 2);
  assert.equal(npmTest.at(-1)?.exitCode, 0);
  assert.equal(npmTest[0]?.exitCode, 1, "first test run should have failed");
});

test("checkpoint passes after the surgical fix", async () => {
  const result = await evaluateCheckpoint(checkpoint, state(), handle, paths);
  assert.equal(result.passed, true, JSON.stringify(result.requirements, null, 2));
});

test("reset returns the workspace to the broken start state", async () => {
  await handle.reset();
  await instr.onLabReset();
  const verify = await handle.exec(["node", paths.verifyScript]);
  const parsed = JSON.parse(verify.stdout.trim().split("\n").pop()!);
  assert.equal(parsed.ok, false, "defect should be back after reset");
  const status = await handle.exec(["git", "status", "--porcelain"]);
  assert.match(status.stdout, /M src\/pricing\.ts/);
});

test("destroy removes the workspace", async () => {
  const workspace = (handle as unknown as { workspace: string }).workspace;
  assert.ok(existsSync(workspace));
  await handle.destroy();
  assert.equal(existsSync(workspace), false);
});
