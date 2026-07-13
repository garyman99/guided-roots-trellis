/**
 * OpenAI-compatible /chat/completions client — fetch-based, zero-dep
 * (ADR-0006 D39). Works with OpenAI, vLLM, Ollama compat, LM Studio, …;
 * a missing apiKey is allowed (local endpoints ignore auth — the config
 * layer enforces keys for non-local base URLs).
 */
import { postJson } from "./transport.ts";
import type { NormalizedModelUsage } from "./usage.ts";
import type { TextGenerationRequest, TextGenerationResult } from "./textClient.ts";

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function normalizeOpenAIUsage(raw: ChatCompletionsResponse["usage"]): NormalizedModelUsage {
  const usage: NormalizedModelUsage = {};
  if (typeof raw?.prompt_tokens === "number") usage.inputTokens = raw.prompt_tokens;
  if (typeof raw?.completion_tokens === "number") usage.outputTokens = raw.completion_tokens;
  if (typeof raw?.total_tokens === "number") usage.totalTokens = raw.total_tokens;
  return usage;
}

export async function openaiGenerateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
  const { json, requestId } = await postJson<ChatCompletionsResponse>({
    url: `${req.baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {},
    body: {
      model: req.model,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      max_tokens: req.maxTokens ?? 300,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    },
    timeoutMs: req.timeoutMs,
    requestId: req.requestId,
    log: req.log,
    fetchImpl: req.fetchImpl,
  });

  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) {
    throw new Error(`openai-compatible endpoint returned an empty completion (request ${requestId})`);
  }
  return {
    text,
    model: json.model ?? req.model,
    usage: normalizeOpenAIUsage(json.usage),
    rawUsage: json.usage as Record<string, unknown> | undefined,
    stopReason: choice?.finish_reason,
    requestId,
  };
}
