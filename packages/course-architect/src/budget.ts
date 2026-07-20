/**
 * Run budget enforcement (plan §3.2): a run may cap its own cumulative
 * model-call count and/or estimated spend. Enforcement rides the existing
 * throw→interrupted path — invokeValidated (executor.ts) calls enforceBudget
 * right after emitting `model.invoked`; a BudgetExceededError interrupts the
 * run exactly like any other phase failure, preserving pendingPhase so the
 * operator can raise the cap and resume (D8) instead of losing the run.
 *
 * Cost estimation is a rough guardrail, not accounting: output tokens times a
 * small per-model $/MTok table for the anthropic tier defaults
 * (ANTHROPIC_TIER_MODELS). Any other model id (openai-compatible, local,
 * mock) estimates $0 — for those, only maxModelCalls binds.
 */
import type { CourseRunEvent, CourseRunRequest } from "./types.ts";

/** Raised when a run's budget is exhausted; the scheduler catches this like
 *  any other executor error and interrupts the run (D8) with this message. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Rough $/million OUTPUT tokens — current public prices for the anthropic
 *  tier defaults, order of magnitude only (a guardrail, not a bill). */
const OUTPUT_PRICE_PER_MTOK: Record<string, number> = {
  "claude-opus-4-8": 75,
  "claude-sonnet-5": 15,
  "claude-haiku-4-5-20251001": 4,
};

/** Unknown/unpriced models (openai-compatible, local, mock) estimate $0. */
export function estimateCostUSD(model: string, outputTokens: number): number {
  const perMTok = OUTPUT_PRICE_PER_MTOK[model];
  if (!perMTok || outputTokens <= 0) return 0;
  return (outputTokens / 1_000_000) * perMTok;
}

export interface BudgetUsage {
  modelCalls: number;
  estimatedCostUSD: number;
}

/** Tally every model.invoked event recorded for the run so far (across every
 *  phase — a run's budget is cumulative for its whole lifetime, not per-phase). */
export function tallyBudgetUsage(events: CourseRunEvent[]): BudgetUsage {
  let modelCalls = 0;
  let estimatedCostUSD = 0;
  for (const e of events) {
    if (e.type !== "model.invoked") continue;
    modelCalls++;
    const model = e.payload?.model;
    const outputTokens = e.payload?.outputTokens;
    if (typeof model === "string" && typeof outputTokens === "number") {
      estimatedCostUSD += estimateCostUSD(model, outputTokens);
    }
  }
  return { modelCalls, estimatedCostUSD };
}

/**
 * Throw BudgetExceededError if the run's cumulative usage (as of the events
 * passed in — call this right after emitting the latest model.invoked) is
 * over either cap. A no-op when the request set neither field.
 */
export function enforceBudget(request: CourseRunRequest, events: CourseRunEvent[]): void {
  if (request.maxModelCalls === undefined && request.maxEstimatedCostUSD === undefined) return;
  const usage = tallyBudgetUsage(events);
  if (request.maxModelCalls !== undefined && usage.modelCalls > request.maxModelCalls) {
    throw new BudgetExceededError(`budget exhausted: ${usage.modelCalls} model calls (max ${request.maxModelCalls})`);
  }
  if (request.maxEstimatedCostUSD !== undefined && usage.estimatedCostUSD > request.maxEstimatedCostUSD) {
    throw new BudgetExceededError(
      `budget exhausted: est. $${usage.estimatedCostUSD.toFixed(4)} spent (max $${request.maxEstimatedCostUSD})`,
    );
  }
}
