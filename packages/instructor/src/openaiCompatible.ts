/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Works with any endpoint speaking the /v1/chat/completions dialect
 * (OpenAI, Together, vLLM, Ollama's compat mode, …). Configured via env:
 *   OPENAI_BASE_URL  e.g. https://api.openai.com/v1
 *   OPENAI_API_KEY
 *   OPENAI_MODEL     e.g. gpt-4o-mini
 *
 * ⚠ UNVERIFIED IN BUILD SANDBOX (no network). The request/response shape
 * follows the public API contract; the mock provider exercises the rest of
 * the pipeline.
 *
 * SECURITY: the API key lives only in the API server's env. It is never
 * passed into lab environments (drivers construct lab env from an
 * allowlist) and never sent to the browser.
 */
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements InstructorProvider {
  readonly name = "openai-compatible";
  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts;
  }

  static fromEnv(env = process.env): OpenAICompatibleProvider {
    const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const apiKey = env.OPENAI_API_KEY ?? "";
    const model = env.OPENAI_MODEL ?? "gpt-4o-mini";
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for INSTRUCTOR_PROVIDER=openai");
    return new OpenAICompatibleProvider({ baseUrl, apiKey, model });
  }

  async generateHint(req: HintRequest, context: BuiltContext): Promise<HintResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: 0.3,
          max_tokens: 300,
          messages: [
            { role: "system", content: context.system },
            { role: "user", content: context.user },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`instructor provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = body.choices?.[0]?.message?.content?.trim();
      if (!message) throw new Error("instructor provider returned an empty completion");
      const level = Math.max(0, Math.min(req.hintLevel, 5));
      return {
        message,
        level,
        strategy: STRATEGY_BY_LEVEL[level],
        promptVersion: context.promptVersion,
        provider: this.name,
        // Servers may echo a resolved model id (e.g. a dated snapshot); prefer it.
        model: body.model ?? this.opts.model,
        usage:
          typeof body.usage?.prompt_tokens === "number" || typeof body.usage?.completion_tokens === "number"
            ? { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 }
            : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
