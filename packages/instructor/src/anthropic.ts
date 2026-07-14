/**
 * Anthropic adapter for the Guide (plan Phase 3; ADR-0006 D39).
 *
 * Thin role adapter: all HTTP concerns (timeouts, bounded retries, error
 * normalization, request IDs, safe logging) live in the shared
 * model-runtime transport; all POLICY lives outside providers — this class
 * only phrases the hint level it is handed. Trellis domain types never
 * expose Anthropic message shapes.
 *
 * VERIFIED against the live API (2026-07-13): credential-gated integration
 * test green, plus a live end-to-end smoke — real server, real session,
 * real hint (claude-haiku-4-5, 1.5s, usage + cost recorded; the dated
 * snapshot id the server echoed exercised the requested-model pricing
 * fallback). The integration test in test/providers.test.ts re-runs
 * whenever ANTHROPIC_API_KEY + ANTHROPIC_TEST_MODEL are present.
 *
 * SECURITY: the API key lives only in the API server's env — never passed
 * into lab environments, never sent to the browser, never logged.
 */
import { anthropicGenerateText } from "../../model-runtime/src/anthropicClient.ts";
import type { RoleModelConfig } from "../../model-runtime/src/config.ts";
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

export interface AnthropicInstructorOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export class AnthropicInstructorProvider implements InstructorProvider {
  readonly name = "anthropic";
  private readonly opts: AnthropicInstructorOptions;

  constructor(opts: AnthropicInstructorOptions) {
    this.opts = opts;
  }

  static fromConfig(cfg: RoleModelConfig): AnthropicInstructorProvider {
    if (cfg.provider !== "anthropic" || !cfg.model || !cfg.apiKey || !cfg.baseUrl) {
      throw new Error(`AnthropicInstructorProvider needs a resolved anthropic config (got provider=${cfg.provider})`);
    }
    return new AnthropicInstructorProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
  }

  async generateHint(req: HintRequest, context: BuiltContext): Promise<HintResponse> {
    const result = await anthropicGenerateText({
      baseUrl: this.opts.baseUrl,
      apiKey: this.opts.apiKey,
      model: this.opts.model,
      system: context.system,
      user: context.user,
      // 300 truncated replies that explain AND show a code piece — the model
      // could hit the cap before emitting a usable text block, and the client
      // then threw "no text content", failing the whole ask (a learner's
      // message would go unanswered). Only tokens actually generated are
      // billed, so a generous ceiling is a pure win; the prompt keeps replies brief.
      maxTokens: this.opts.maxTokens ?? 2048,
      timeoutMs: this.opts.timeoutMs ?? 30_000,
      fetchImpl: this.opts.fetchImpl,
    });
    const level = Math.max(0, Math.min(req.hintLevel, 5));
    return {
      message: result.text,
      level,
      strategy: STRATEGY_BY_LEVEL[level],
      promptVersion: context.promptVersion,
      provider: this.name,
      model: result.model,
      modelRequested: this.opts.model,
      usage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
        ...(result.usage.cacheReadTokens !== undefined ? { cacheReadTokens: result.usage.cacheReadTokens } : {}),
        ...(result.usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: result.usage.cacheWriteTokens } : {}),
      },
    };
  }
}
