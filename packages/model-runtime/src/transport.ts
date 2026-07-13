/**
 * Shared HTTP transport for provider adapters (ADR-0006 D39).
 *
 * Every adapter goes through here so cancellation/timeouts, bounded retries,
 * status/error normalization, request IDs, and safe logging exist ONCE.
 * Safe logging means: entries carry ids/urls/status/timing — never request
 * or response bodies, never headers (keys live in headers). Streaming
 * support will be added here (a postStream sibling), not in adapters.
 */
import { randomUUID } from "node:crypto";

export type TransportErrorCategory =
  | "timeout" // per-attempt deadline hit (not retried — callers own latency budgets)
  | "network" // connection refused/reset/DNS (retried)
  | "auth" // 401/403 (not retried)
  | "bad_request" // 400/422 (not retried — the request itself is wrong)
  | "not_found" // 404 (not retried — wrong base URL or model route)
  | "rate_limited" // 429 (retried)
  | "server_error" // 5xx (retried)
  | "bad_response" // 2xx that wasn't parseable JSON
  | "http_error"; // any other non-2xx

export class TransportError extends Error {
  readonly category: TransportErrorCategory;
  readonly status?: number;
  readonly requestId: string;
  readonly attempts: number;
  /** First 200 chars of the error body — enough to act on, small enough to log. */
  readonly bodySnippet?: string;

  constructor(
    message: string,
    opts: {
      category: TransportErrorCategory;
      requestId: string;
      attempts: number;
      status?: number;
      bodySnippet?: string;
    },
  ) {
    super(message);
    this.name = "TransportError";
    this.category = opts.category;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.attempts = opts.attempts;
    this.bodySnippet = opts.bodySnippet;
  }
}

export interface TransportLogEntry {
  requestId: string;
  method: "POST";
  url: string;
  attempt: number;
  status?: number;
  category?: TransportErrorCategory;
  durationMs: number;
}

export interface PostJsonOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  /** Per-attempt deadline. Default 30s. */
  timeoutMs?: number;
  /** Extra attempts after the first, for retriable failures only. Default 2. */
  maxRetries?: number;
  /** Base backoff (doubles per retry). Default 250ms; tests pass 1. */
  retryDelayMs?: number;
  requestId?: string;
  log?: (entry: TransportLogEntry) => void;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface PostJsonResult<T = unknown> {
  status: number;
  json: T;
  requestId: string;
  attempts: number;
}

function categorize(status: number): TransportErrorCategory {
  if (status === 400 || status === 422) return "bad_request";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "http_error";
}

const RETRIABLE: ReadonlySet<TransportErrorCategory> = new Set(["network", "rate_limited", "server_error"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function postJson<T = unknown>(opts: PostJsonOptions): Promise<PostJsonResult<T>> {
  const requestId = opts.requestId ?? randomUUID();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 2;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  const doFetch = opts.fetchImpl ?? fetch;
  const emit = (entry: TransportLogEntry) => {
    try {
      opts.log?.(entry);
    } catch {
      /* a broken logger must never break a request */
    }
  };

  let lastError: TransportError | null = null;
  for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await doFetch(opts.url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-trellis-request-id": requestId,
            ...opts.headers,
          },
          body: JSON.stringify(opts.body),
        });
      } catch (err) {
        const aborted = (err as Error).name === "AbortError";
        const category: TransportErrorCategory = aborted ? "timeout" : "network";
        emit({ requestId, method: "POST", url: opts.url, attempt, category, durationMs: Date.now() - started });
        lastError = new TransportError(
          aborted ? `request timed out after ${timeoutMs}ms` : `network error: ${(err as Error).message}`,
          { category, requestId, attempts: attempt },
        );
        if (!RETRIABLE.has(category) || attempt > maxRetries) throw lastError;
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      if (!res.ok) {
        const category = categorize(res.status);
        const bodySnippet = (await res.text().catch(() => "")).slice(0, 200);
        emit({ requestId, method: "POST", url: opts.url, attempt, status: res.status, category, durationMs: Date.now() - started });
        lastError = new TransportError(`HTTP ${res.status} (${category})`, {
          category,
          status: res.status,
          requestId,
          attempts: attempt,
          bodySnippet,
        });
        if (!RETRIABLE.has(category) || attempt > maxRetries) throw lastError;
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      const text = await res.text();
      let json: T;
      try {
        json = JSON.parse(text) as T;
      } catch {
        emit({ requestId, method: "POST", url: opts.url, attempt, status: res.status, category: "bad_response", durationMs: Date.now() - started });
        throw new TransportError("2xx response was not valid JSON", {
          category: "bad_response",
          status: res.status,
          requestId,
          attempts: attempt,
          bodySnippet: text.slice(0, 200),
        });
      }
      emit({ requestId, method: "POST", url: opts.url, attempt, status: res.status, durationMs: Date.now() - started });
      return { status: res.status, json, requestId, attempts: attempt };
    } finally {
      clearTimeout(timer);
    }
  }
  // Loop always returns or throws; this satisfies control-flow analysis.
  throw lastError ?? new TransportError("unreachable", { category: "network", requestId, attempts: 0 });
}
