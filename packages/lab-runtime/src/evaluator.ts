/**
 * Deterministic checkpoint evaluator.
 *
 * Completion is NEVER judged by the LLM. Each requirement in lab.json has a
 * `kind` that maps to a measurable check:
 *
 *   session — a fact from the reduced session state (diff viewed, tests run)
 *   verify  — the lab's behavioral verifier, executed INSIDE the lab env
 *   tests   — the repo's real test suite, executed INSIDE the lab env
 *   repo    — git-level sanity (HEAD exists, status readable)
 *
 * Untrusted code (verifier imports learner-edited files) only ever runs
 * inside the lab environment via handle.exec — never on the platform host.
 */
import { join } from "node:path";
import type { LearningSessionState } from "../../session-events/src/reducer.ts";
import type { LabHandle } from "./driver.ts";

export interface CheckpointRequirementSpec {
  id: string;
  kind: "session" | "verify" | "tests" | "repo";
  label: string;
}

export interface CheckpointSpec {
  id: string;
  title: string;
  requirements: CheckpointRequirementSpec[];
}

export interface RequirementResult {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface CheckpointResult {
  checkpointId: string;
  passed: boolean;
  requirements: RequirementResult[];
  incomplete: string[];
}

/** Where the lab's verify script lives, per driver. */
export interface EvaluatorPaths {
  /** Absolute path (inside the lab env) to verify/checkpoint.mjs. */
  verifyScript: string;
}

export async function evaluateCheckpoint(
  spec: CheckpointSpec,
  state: LearningSessionState,
  handle: LabHandle,
  paths: EvaluatorPaths,
): Promise<CheckpointResult> {
  const results: RequirementResult[] = [];

  // Cache the expensive checks so multiple requirements can share them.
  let verifyChecks: Array<{ id: string; label: string; ok: boolean; detail?: string }> | null | undefined;
  let testsExit: number | undefined;

  for (const req of spec.requirements) {
    switch (req.kind) {
      case "session": {
        if (req.id === "viewed-diff") {
          results.push({
            id: req.id,
            label: req.label,
            ok: state.viewedGitDiff,
            detail: state.viewedGitDiff ? undefined : "No `git diff` / `git show` / `git log -p` observed yet.",
          });
        } else if (req.id === "ran-tests") {
          results.push({
            id: req.id,
            label: req.label,
            ok: state.testsRun > 0,
            detail: state.testsRun > 0 ? undefined : "No test run observed yet — try `npm test`.",
          });
        } else {
          results.push({ id: req.id, label: req.label, ok: false, detail: `Unknown session requirement '${req.id}'.` });
        }
        break;
      }

      case "verify": {
        if (verifyChecks === undefined) {
          // 90s cap: browser-based verifiers (e.g. Playwright labs) launch a real
          // headless browser inside the lab env. Node-only verifiers finish in <2s.
          const res = await handle.exec(["node", paths.verifyScript], { timeoutMs: 90_000 });
          try {
            verifyChecks = JSON.parse(res.stdout.trim().split("\n").pop() ?? "").checks ?? null;
          } catch {
            verifyChecks = null;
          }
        }
        const check = verifyChecks?.find((c) => c.id === req.id);
        results.push({
          id: req.id,
          label: req.label,
          ok: check?.ok ?? false,
          detail: check?.ok ? undefined : (check?.detail ?? "Verifier did not report this check."),
        });
        break;
      }

      case "tests": {
        if (testsExit === undefined) {
          // 120s cap for the same reason as `verify`: browser labs run real browsers.
          const res = await handle.exec(["node", "scripts/test.mjs"], { timeoutMs: 120_000 });
          testsExit = res.exitCode;
        }
        results.push({
          id: req.id,
          label: req.label,
          ok: testsExit === 0,
          detail: testsExit === 0 ? undefined : "The test suite is not passing yet.",
        });
        break;
      }

      case "repo": {
        const head = await handle.exec(["git", "rev-parse", "HEAD"], { timeoutMs: 10_000 });
        const status = await handle.exec(["git", "status", "--porcelain"], { timeoutMs: 10_000 });
        const ok = head.exitCode === 0 && status.exitCode === 0;
        results.push({
          id: req.id,
          label: req.label,
          ok,
          detail: ok ? undefined : "Git can no longer read the repository — consider resetting the lab.",
        });
        break;
      }
    }
  }

  const incomplete = results.filter((r) => !r.ok).map((r) => r.id);
  return { checkpointId: spec.id, passed: incomplete.length === 0, requirements: results, incomplete };
}

export function verifyScriptPathFor(driverKind: "local" | "docker", labDir: string): EvaluatorPaths {
  return driverKind === "docker"
    ? { verifyScript: "/opt/lab/verify/checkpoint.mjs" }
    : { verifyScript: join(labDir, "verify", "checkpoint.mjs") };
}
