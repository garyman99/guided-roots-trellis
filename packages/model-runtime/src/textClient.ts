/** Shared shapes for the single-shot text-generation clients (ADR-0006 D39). */
import type { NormalizedModelUsage } from "./usage.ts";
import type { TransportLogEntry } from "./transport.ts";

export interface TextGenerationRequest {
  baseUrl: string;
  /** Optional for local OpenAI-compatible endpoints; required by Anthropic. */
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** OpenAI-compatible only; Anthropic 4.6+ models reject sampling params. */
  temperature?: number;
  timeoutMs?: number;
  requestId?: string;
  log?: (entry: TransportLogEntry) => void;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface TextGenerationResult {
  text: string;
  /** The model the server says served the request (dated snapshots etc.). */
  model: string;
  usage: NormalizedModelUsage;
  /** Verbatim provider usage object — stored next to normalized, never merged. */
  rawUsage?: Record<string, unknown>;
  stopReason?: string;
  requestId: string;
}
