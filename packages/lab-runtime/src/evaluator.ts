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
  kind: "session" | "verify" | "tests" | "repo" | "workspace";
  label: string;
}

/** Authored thresholds for workspace-kind requirements (from lab.json). */
export interface WorkspacePolicyThresholds {
  /** A submitted reply at or below this similarity counts as meaningfully edited. */
  meaningfulEditMaxSimilarity: number;
  /**
   * Authored policy entries, keyed by id, so a failing requirement can tell
   * the learner WHAT tripped in the lab author's own words (labels/teaching
   * are authored strings selected by measured ids — never learner prose).
   */
  forbiddenPhraseEntries?: Array<{ id: string; label: string; teaching?: string }>;
  restrictedSpanEntries?: Array<{ id: string; label: string; reason?: string }>;
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
  handle: LabHandle | null,
  paths: EvaluatorPaths,
  workspacePolicy?: WorkspacePolicyThresholds,
): Promise<CheckpointResult> {
  const results: RequirementResult[] = [];
  const needsEnv = spec.requirements.some((r) => r.kind === "verify" || r.kind === "tests" || r.kind === "repo");
  if (needsEnv && !handle) throw new Error("checkpoint requires a lab environment this session does not have");

  // Cache the expensive checks so multiple requirements can share them.
  let verifyChecks: Array<{ id: string; label: string; ok: boolean; detail?: string }> | null | undefined;
  let testsExit: number | undefined;

  for (const req of spec.requirements) {
    switch (req.kind) {
      case "workspace": {
        results.push(workspaceRequirement(req, state, workspacePolicy));
        break;
      }

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
          const res = await handle!.exec(["node", paths.verifyScript], { timeoutMs: 90_000 });
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
          const res = await handle!.exec(["node", "scripts/test.mjs"], { timeoutMs: 120_000 });
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
        const head = await handle!.exec(["git", "rev-parse", "HEAD"], { timeoutMs: 10_000 });
        const status = await handle!.exec(["git", "status", "--porcelain"], { timeoutMs: 10_000 });
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

/**
 * Workspace-kind requirements: pure functions of measured workspace state.
 * IDs are a small documented vocabulary (like session-kind); labs pick the
 * ones their scenario needs. Text policy results (restricted spans, forbidden
 * phrases, required facts) were classified at event time against the lab's
 * AUTHORED policy — nothing here inspects learner prose.
 */
function workspaceRequirement(
  req: CheckpointRequirementSpec,
  state: LearningSessionState,
  policy?: WorkspacePolicyThresholds,
): RequirementResult {
  const ws = state.workspace;
  const sub = ws.submitted;
  const r = (ok: boolean, detail?: string): RequirementResult => ({
    id: req.id,
    label: req.label,
    ok,
    detail: ok ? undefined : detail,
  });

  switch (req.id) {
    case "used-ai-helper":
      return r(ws.aiPrompts > 0 && ws.aiDraftsGenerated > 0, "The AI helper was not asked for a draft yet.");

    case "context-clean":
      // The LATEST share is what the helper is working from: sharing restricted
      // content and then re-sharing clean context counts as recovery.
      return r(
        ws.aiContextShares > 0 && ws.restrictedInLatestShare.length === 0 && ws.requiredFactsInLatestShare.length > 0,
        ws.aiContextShares === 0
          ? "No context was shared with the AI helper yet."
          : ws.restrictedInLatestShare.length > 0
            ? "The context most recently shared with the AI helper still contains restricted information."
            : "The shared context is missing the facts the helper needs.",
      );

    case "reviewed-and-edited": {
      if (!sub) return r(false, "Nothing has been submitted yet.");
      const maxSim = policy?.meaningfulEditMaxSimilarity ?? 0.9;
      // null similarity = drafted in the learner's own words (no AI draft inserted).
      const edited = sub.similarityToGenerated === null || sub.similarityToGenerated <= maxSim;
      return r(edited, "The submitted reply is still nearly identical to the AI helper's draft — make it your own.");
    }

    case "no-restricted-in-reply": {
      if (!sub) return r(false, "Nothing has been submitted yet.");
      const tripped = (policy?.restrictedSpanEntries ?? []).filter((e) => sub.restrictedSpans.includes(e.id));
      const why = tripped.map((e) => e.reason ? `${e.label} — ${e.reason}` : e.label).join("; ");
      return r(sub.restrictedSpans.length === 0, `The reply still contains restricted information${why ? `: ${why}` : "."}`);
    }

    case "no-forbidden-promise": {
      if (!sub) return r(false, "Nothing has been submitted yet.");
      const tripped = (policy?.forbiddenPhraseEntries ?? []).filter((e) => sub.forbiddenPhrases.includes(e.id));
      const why = tripped.map((e) => e.teaching ? `${e.label}. ${e.teaching}` : e.label).join("; ");
      return r(sub.forbiddenPhrases.length === 0, `The reply makes a promise that has not been approved${why ? `: ${why}` : "."}`);
    }

    case "facts-preserved":
      return r(!!sub && sub.requiredFactsMissing.length === 0, sub ? "A required fact is missing from the reply." : "Nothing has been submitted yet.");

    case "acknowledges-inconvenience":
      // Lexical check against the lab's authored acknowledgement lexicon —
      // deliberately approximate; scenarios pair it with qualitative review.
      return r(!!sub && sub.acknowledgesInconvenience, sub ? "The reply does not acknowledge the customer's inconvenience." : "Nothing has been submitted yet.");

    case "reply-submitted":
      return r(!!sub, "The simulated reply has not been submitted yet.");

    default:
      return r(false, `Unknown workspace requirement '${req.id}'.`);
  }
}

export function verifyScriptPathFor(driverKind: "local" | "docker", labDir: string): EvaluatorPaths {
  return driverKind === "docker"
    ? { verifyScript: "/opt/lab/verify/checkpoint.mjs" }
    : { verifyScript: join(labDir, "verify", "checkpoint.mjs") };
}
