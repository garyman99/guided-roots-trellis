import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/reducer.ts";
import { evaluateInterventions, defaultInterventionConfig } from "../src/interventions.ts";

const base = () => ({ ...initialState("lab", "learner-1") });

test("repeated_failure fires at the threshold with escalating hint level", () => {
  const s = base();
  s.repeatedFailures = [{ command: "npm test", count: 3 }];
  const triggers = evaluateInterventions(s);
  const t = triggers.find((x) => x.type === "repeated_failure");
  assert.ok(t);
  assert.equal(t.evidence.command, "npm test");
  assert.equal(t.suggestedHintLevel, 3);

  s.repeatedFailures = [{ command: "npm test", count: 5 }];
  const t2 = evaluateInterventions(s).find((x) => x.type === "repeated_failure");
  assert.equal(t2?.suggestedHintLevel, 4);
});

test("repeated_failure stays silent below the threshold", () => {
  const s = base();
  s.repeatedFailures = [{ command: "npm test", count: 2 }];
  assert.equal(evaluateInterventions(s).some((t) => t.type === "repeated_failure"), false);
});

test("tests_not_run fires only after the grace period, and only when untested changes exist", () => {
  const s = base();
  s.filesChanged = ["src/pricing.ts"];
  s.changedSinceLastTestRun = true;
  s.msSinceLastFileChange = 5_000; // just saved — leave them alone
  assert.equal(evaluateInterventions(s).some((t) => t.type === "tests_not_run"), false);
  s.msSinceLastFileChange = defaultInterventionConfig.testsNotRunGraceMs;
  assert.equal(evaluateInterventions(s).some((t) => t.type === "tests_not_run"), true);
  s.changedSinceLastTestRun = false;
  assert.equal(evaluateInterventions(s).some((t) => t.type === "tests_not_run"), false);
});

test("diff_not_viewed requires real activity and no prior diff view", () => {
  const s = base();
  s.recentCommands = [
    { command: "ls", at: "t" },
    { command: "cat src/pricing.ts", at: "t" },
    { command: "npm test", at: "t" },
  ];
  s.testsRun = 1;
  assert.equal(evaluateInterventions(s).some((t) => t.type === "diff_not_viewed"), true);
  s.viewedGitDiff = true;
  assert.equal(evaluateInterventions(s).some((t) => t.type === "diff_not_viewed"), false);
});

test("inactivity fires after the configured window, suggesting a gentle level-0 nudge", () => {
  const s = base();
  s.msSinceLastActivity = defaultInterventionConfig.inactivityMs;
  const t = evaluateInterventions(s).find((x) => x.type === "inactivity");
  assert.ok(t);
  assert.equal(t.suggestedHintLevel, 0);
});

test("a fresh session proposes nothing", () => {
  assert.deepEqual(evaluateInterventions(base()), []);
});
