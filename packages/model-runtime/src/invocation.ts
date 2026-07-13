/** Model invocation records: one per model call, appended to a run's JSONL stream. */
import { randomUUID } from "node:crypto";
import type { NormalizedModelUsage } from "./usage.ts";

export type ModelRole = "guide" | "simulator" | "evaluator";

export type InvocationStatus = "ok" | "error" | "timeout" | "refused";

export interface ModelInvocationRecord {
  invocationId: string;
  runId: string;
  role: ModelRole;
  provider: string;
  model: string;
  promptId?: string;
  promptVersion: string;
  promptHash?: string;
  startedAt: string;
  completedAt?: string;
  usage: NormalizedModelUsage;
  /** Raw provider-reported usage, kept verbatim next to the normalized view. */
  rawUsage?: Record<string, unknown>;
  /** Absent when the model has no pricing entry — never a guessed number. */
  estimatedCostUSD?: number;
  pricingVersion?: number;
  status: InvocationStatus;
  errorCategory?: string;
}

/** Sortable, collision-safe: <prefix>-<utc compact timestamp>-<uuid slice>. */
export function newRunId(prefix = "run"): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${prefix}-${ts}-${randomUUID().slice(0, 8)}`;
}

export function newInvocationId(): string {
  return `inv-${randomUUID()}`;
}
