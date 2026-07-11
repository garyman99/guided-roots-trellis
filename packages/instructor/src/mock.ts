/**
 * MockInstructorProvider — deterministic, offline, free.
 *
 * Turns the same structured context the real model would see into a
 * templated hint chosen by (trigger/question kind × hint level × state).
 * Deterministic by design so the full loop is testable without a model;
 * selected with INSTRUCTOR_PROVIDER=mock (the default).
 */
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

function firstIncompleteTask(req: HintRequest): string {
  const { state, lab } = req;
  if (!state.viewedGitDiff) return "reviewing the agent's uncommitted change";
  if (state.testsRun === 0) return "running the test suite";
  if ((state.latestTestResult?.failed ?? 0) > 0) return "getting the failing test to pass";
  return lab.tasks.at(-1)?.text ?? "finishing the checkpoint";
}

export class MockInstructorProvider implements InstructorProvider {
  readonly name = "mock";

  async generateHint(req: HintRequest, _context: BuiltContext): Promise<HintResponse> {
    const { state, reason, hintLevel } = req;
    const focus = firstIncompleteTask(req);
    const evidence: string[] = [];
    if (state.latestTestResult) {
      evidence.push(`your last test run had ${state.latestTestResult.failed} failing of ${state.latestTestResult.passed + state.latestTestResult.failed}`);
    }
    if (reason.kind === "intervention" && reason.trigger.type === "repeated_failure") {
      evidence.push(`the same command has now failed ${String((reason.trigger.evidence as { count?: number }).count ?? "several")} times`);
    }
    const observed = evidence.length ? ` I can see ${evidence.join(", and ")}.` : "";

    const byLevel: string[] = [
      // 0 elicit — reflection before instruction: one prediction/inspection question, zero direction.
      `Before anything else — what do you *expect* to find if you look at what changed? Make a prediction, then check it.${observed}`,
      // 1 orient
      `You're making progress.${observed} Right now the next step is ${focus}.`,
      // 2 point-to-tool
      `${observed} There's a Git command that shows exactly what an uncommitted change did to your working tree — that's the fastest way forward with ${focus}.`,
      // 3 point-to-location
      `${observed} Look closely at src/pricing.ts in the diff — read every hunk, including the ones that touch code you didn't ask to change. The failing test's name tells you which behavior to compare against.`,
      // 4 explain-concept
      `Here's the concept: an agent's change can include unrequested edits. In this diff, existing behavior that a test pins down was quietly altered. Find that hunk and restore the original behavior — and keep the new helper the agent added.`,
      // 5 walk-through
      `Step by step: 1) run \`git diff src/pricing.ts\` and read every hunk; 2) restore the original behavior the failing test describes; 3) run \`npm test\` and confirm everything passes; 4) evaluate the checkpoint. Keep bulkDiscountCents — it was the requested feature.`,
    ];

    const level = Math.max(0, Math.min(hintLevel, 5));
    return {
      message: byLevel[level],
      level,
      strategy: STRATEGY_BY_LEVEL[level],
      promptVersion: req.promptVersion,
      provider: this.name,
    };
  }
}
