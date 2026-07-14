/**
 * Anthropic Messages API client — fetch-based, zero-dep (ADR-0006 D39).
 *
 * Single-shot text generation via POST {baseUrl}/v1/messages. Deliberately
 * minimal: no sampling params (rejected on current models), no explicit
 * thinking config (adaptive by default where supported). Streaming arrives
 * with the transport's streaming support, not here.
 */
import { postJson, TransportError } from "./transport.ts";
import type { NormalizedModelUsage } from "./usage.ts";
import type { TextGenerationRequest, TextGenerationResult } from "./textClient.ts";

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function normalizeAnthropicUsage(raw: AnthropicMessagesResponse["usage"]): NormalizedModelUsage {
  const usage: NormalizedModelUsage = {};
  if (typeof raw?.input_tokens === "number") usage.inputTokens = raw.input_tokens;
  if (typeof raw?.output_tokens === "number") usage.outputTokens = raw.output_tokens;
  if (typeof raw?.cache_read_input_tokens === "number") usage.cacheReadTokens = raw.cache_read_input_tokens;
  if (typeof raw?.cache_creation_input_tokens === "number") usage.cacheWriteTokens = raw.cache_creation_input_tokens;
  return usage;
}

export async function anthropicGenerateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
  if (!req.apiKey) {
    throw new TransportError("anthropic client requires an apiKey", {
      category: "auth",
      requestId: req.requestId ?? "unassigned",
      attempts: 0,
    });
  }
  const { json, requestId } = await postJson<AnthropicMessagesResponse>({
    url: `${req.baseUrl.replace(/\/$/, "")}/v1/messages`,
    headers: {
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: req.model,
      max_tokens: req.maxTokens ?? 300,
      system: req.cacheSystem
        ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }]
        : req.system,
      messages: [{ role: "user", content: req.user }],
    },
    timeoutMs: req.timeoutMs,
    requestId: req.requestId,
    log: req.log,
    fetchImpl: req.fetchImpl,
  });

  if (json.stop_reason === "refusal") {
    throw new Error(`anthropic declined the request (stop_reason=refusal, request ${requestId})`);
  }
  const text = json.content
    ?.filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error(`anthropic returned no text content (stop_reason=${json.stop_reason ?? "?"}, request ${requestId})`);
  }
  return {
    text,
    model: json.model ?? req.model,
    usage: normalizeAnthropicUsage(json.usage),
    rawUsage: json.usage as Record<string, unknown> | undefined,
    stopReason: json.stop_reason,
    requestId,
  };
}
