/**
 * Deterministic fake Guide provider for tests (plan Phase 3).
 *
 * Distinct from the mock: the MOCK is a real offline product path with its
 * own coaching ladders; the FAKE returns exactly what a test scripts —
 * fixed messages and exact usage numbers — and records every request it
 * saw, so tests can assert on telemetry and context without an LLM.
 */
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

export interface FakeHint {
  message: string;
  model?: string;
  usage?: HintResponse["usage"];
}

const DEFAULT_HINT: FakeHint = {
  message: "Fake hint: look at the failing step you saw last.",
  model: "fake-model",
  usage: { promptTokens: 100, completionTokens: 10 },
};

export class FakeInstructorProvider implements InstructorProvider {
  readonly name = "fake";
  readonly calls: Array<{ req: HintRequest; context: BuiltContext }> = [];
  private readonly script: FakeHint[];
  /** When the script runs dry: repeat the default (true) or throw (false). */
  private readonly repeatDefault: boolean;

  constructor(script: FakeHint[] = [], opts: { repeatDefault?: boolean } = {}) {
    this.script = [...script];
    this.repeatDefault = opts.repeatDefault ?? script.length === 0;
  }

  async generateHint(req: HintRequest, context: BuiltContext): Promise<HintResponse> {
    this.calls.push({ req, context });
    const next = this.script.shift() ?? (this.repeatDefault ? DEFAULT_HINT : undefined);
    if (!next) {
      throw new Error(`FakeInstructorProvider script exhausted after ${this.calls.length - 1} scripted hint(s)`);
    }
    const level = Math.max(0, Math.min(req.hintLevel, 5));
    return {
      message: next.message,
      level,
      strategy: STRATEGY_BY_LEVEL[level],
      promptVersion: context.promptVersion,
      provider: this.name,
      model: next.model ?? "fake-model",
      usage: next.usage,
    };
  }
}
