/**
 * OpenAI-compatible chat-completions adapter for the Guide.
 *
 * Works with any endpoint speaking the /v1/chat/completions dialect
 * (OpenAI, Together, vLLM, Ollama compat, LM Studio, …) — including LOCAL
 * endpoints, where the API key may be omitted (the config layer enforces
 * keys for non-local base URLs). HTTP concerns live in the shared
 * model-runtime transport (ADR-0006 D39).
 *
 * ⚠ UNVERIFIED AGAINST A LIVE ENDPOINT in this environment (no network /
 * no local model). The wire shape is stub-tested; the credential-gated
 * integration test in test/providers.test.ts runs when a real endpoint is
 * configured.
 *
 * SECURITY: the API key lives only in the API server's env. It is never
 * passed into lab environments and never sent to the browser.
 */
import { openaiGenerateText } from "../../model-runtime/src/openaiClient.ts";
import { resolveRoleConfig, type RoleModelConfig } from "../../model-runtime/src/config.ts";
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  /** Optional for local endpoints (localhost/127.0.0.1). */
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleProvider implements InstructorProvider {
  readonly name = "openai-compatible";
  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
  }

  static fromConfig(cfg: RoleModelConfig): OpenAICompatibleProvider {
    if (cfg.provider !== "openai-compatible" || !cfg.model || !cfg.baseUrl) {
      throw new Error(`OpenAICompatibleProvider needs a resolved openai-compatible config (got provider=${cfg.provider})`);
    }
    return new OpenAICompatibleProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
  }

  /** @deprecated use providerFromEnv / fromConfig — kept for direct callers. */
  static fromEnv(env = process.env): OpenAICompatibleProvider {
    return OpenAICompatibleProvider.fromConfig(
      resolveRoleConfig("guide", { ...env, GUIDE_PROVIDER: "openai-compatible" }),
    );
  }

  async generateHint(req: HintRequest, context: BuiltContext): Promise<HintResponse> {
    const result = await openaiGenerateText({
      baseUrl: this.opts.baseUrl,
      apiKey: this.opts.apiKey,
      model: this.opts.model,
      system: context.system,
      user: context.user,
      temperature: 0.3,
      maxTokens: this.opts.maxTokens ?? 300,
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
      // Servers may echo a resolved model id (e.g. a dated snapshot); prefer it.
      model: result.model,
      modelRequested: this.opts.model,
      usage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
      },
    };
  }
}
