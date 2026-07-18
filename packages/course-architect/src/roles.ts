/**
 * Role invocation for course generation. Each strategy-doc role is a model
 * call; this module is the seam between the phase logic and a provider.
 *
 * Providers ride the same substrate as the Guide (model-runtime's fetch
 * clients), resolved from COURSE_GEN_* env — one shared config for every role
 * by default, overridable per role with COURSE_GEN_<ROLE>_* (plan §2). A
 * deterministic MockRoleInvoker returns canned, schema-valid artifacts so the
 * whole pipeline — phases, validation, gates, materialization — runs under
 * node:test with zero network, exactly like MockInstructorProvider does for the
 * Guide.
 */
import {
  anthropicGenerateText,
  openaiGenerateText,
  type NormalizedModelUsage,
} from "../../../packages/model-runtime/src/index.ts";

export type CourseGenRole =
  | "architect"
  | "domain-analyst"
  | "learner-advocate"
  | "lesson-author"
  | "technical-reviewer"
  | "pedagogy-reviewer"
  | "cohesion-editor"
  | "experience-analyst";

export const COURSE_GEN_ROLES: CourseGenRole[] = [
  "architect",
  "domain-analyst",
  "learner-advocate",
  "lesson-author",
  "technical-reviewer",
  "pedagogy-reviewer",
  "cohesion-editor",
  "experience-analyst",
];

/**
 * Default Claude model per role — the cheapest tier that fits the job.
 * Generative roles (whole documents, high leverage) ride Opus; judgment roles
 * (review against explicit criteria) ride Sonnet. Applies only when the run
 * picked the anthropic provider without an explicit model; see
 * resolveRoleModel for the full precedence chain.
 */
export const ROLE_MODEL_TIERS: Record<CourseGenRole, string> = {
  architect: "claude-opus-4-8",
  "lesson-author": "claude-opus-4-8",
  "domain-analyst": "claude-sonnet-5",
  "learner-advocate": "claude-sonnet-5",
  "technical-reviewer": "claude-sonnet-5",
  "pedagogy-reviewer": "claude-sonnet-5",
  "cohesion-editor": "claude-sonnet-5",
  "experience-analyst": "claude-sonnet-5",
};

/** The per-run provider choice, as far as model resolution needs it. */
export interface RoleModelChoice {
  provider: CourseGenProvider;
  /** Explicit run-wide model — the operator's override for every role. */
  model?: string;
  /** Per-role overrides from the run's advanced picker. */
  roleModels?: Partial<Record<CourseGenRole, string>>;
}

/**
 * Which model a role should use. Precedence: the run's per-role pick, then the
 * run's explicit run-wide model, then COURSE_GEN_<ROLE>_MODEL env, then the
 * anthropic tier default, then the shared COURSE_GEN_MODEL env. Undefined means
 * the caller has no model for this role (an error for live providers).
 */
export function resolveRoleModel(
  role: CourseGenRole,
  choice: RoleModelChoice,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const roleKey = role.toUpperCase().replace(/-/g, "_");
  return (
    choice.roleModels?.[role] ??
    choice.model ??
    env[`COURSE_GEN_${roleKey}_MODEL`] ??
    (choice.provider === "anthropic" ? ROLE_MODEL_TIERS[role] : undefined) ??
    env.COURSE_GEN_MODEL
  );
}

export interface RolePrompt {
  system: string;
  user: string;
  /** Stable id for the unit of work (e.g. "blueprint", "lesson:gitfnd-101"). */
  task: string;
  /**
   * Structured input for the task. The live path folds this into `user`; the
   * mock reads it directly so canned responders can be coherent without parsing.
   */
  context?: Record<string, unknown>;
}

export interface RoleResult {
  text: string;
  model: string;
  usage: NormalizedModelUsage;
}

/** Streaming delta: the model's thinking or its answer text, as it arrives. */
export type RoleDelta = (d: { kind: "thinking" | "text"; chunk: string }) => void;

export interface RoleInvoker {
  /** When `onDelta` is provided AND the provider supports it, the call streams
   *  (thinking + text) while it runs; the resolved text is unchanged. */
  invoke(role: CourseGenRole, prompt: RolePrompt, onDelta?: RoleDelta): Promise<RoleResult>;
}

/* ── mock invoker ── */

/** A responder decides the canned text for a (role, prompt). */
export type MockResponder = (role: CourseGenRole, prompt: RolePrompt) => string;

const ZERO_USAGE: NormalizedModelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Deterministic invoker. Given a responder, echoes its output with stub usage.
 * Tests pass a responder that returns exactly the JSON they want to assert on.
 */
export class MockRoleInvoker implements RoleInvoker {
  private readonly responder: MockResponder;
  constructor(responder: MockResponder) {
    this.responder = responder;
  }
  async invoke(role: CourseGenRole, prompt: RolePrompt, onDelta?: RoleDelta): Promise<RoleResult> {
    const text = this.responder(role, prompt);
    // Simulate a little streaming so the live view is exercised offline too.
    if (onDelta) onDelta({ kind: "text", chunk: text });
    const outputTokens = Math.ceil(text.length / 4);
    const inputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 4);
    return { text, model: "mock-course-gen", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
  }
}

/* ── live invoker (fetch-based, model-runtime clients) ── */

export type CourseGenProvider = "mock" | "anthropic" | "openai-compatible";

export interface CourseGenRoleConfig {
  provider: CourseGenProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Resolve a role's config from env: COURSE_GEN_<ROLE>_* wins, else the shared
 * COURSE_GEN_* block, else mock. Kept local (not model-runtime's resolveRoleConfig)
 * because that only knows guide/simulator/evaluator.
 */
export function resolveCourseGenConfig(role: CourseGenRole, env: Record<string, string | undefined> = process.env): CourseGenRoleConfig {
  const roleKey = role.toUpperCase().replace(/-/g, "_");
  const pick = (suffix: string): string | undefined => env[`COURSE_GEN_${roleKey}_${suffix}`] ?? env[`COURSE_GEN_${suffix}`];
  const raw = (pick("PROVIDER") ?? "mock").toLowerCase();
  const provider: CourseGenProvider = raw === "openai" ? "openai-compatible" : (raw as CourseGenProvider);
  if (provider === "mock") return { provider: "mock" };
  const model = pick("MODEL");
  const baseUrl = pick("BASE_URL");
  const apiKey = pick("API_KEY") ?? env.ANTHROPIC_API_KEY ?? env.OPENAI_API_KEY;
  return { provider, model, baseUrl, apiKey };
}

export interface LiveRoleOptions {
  provider: "anthropic" | "openai-compatible";
  /** Run-wide fallback model; a role without a roleModels entry uses this. */
  model?: string;
  /** Resolved per-role models (tier defaults folded in by the caller). */
  roleModels?: Partial<Record<CourseGenRole, string>>;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  /** Per-request HTTP timeout (ms). Generation calls are slow — default 5 min,
   *  NOT the transport's 30s. */
  timeoutMs?: number;
  /** Test seam — inject a fetch to exercise the live path without a network. */
  fetchImpl?: typeof fetch;
}

/**
 * Live invoker over model-runtime's fetch clients. Built with ONE explicit
 * provider config per run, but the MODEL is resolved per call — each role rides
 * its roleModels entry (tier defaults folded in by the caller) with `model` as
 * the run-wide fallback. The API key is passed in from the server's
 * environment — never from the client.
 */
export class LiveRoleInvoker implements RoleInvoker {
  private readonly opts: LiveRoleOptions;
  constructor(opts: LiveRoleOptions) {
    if (!opts.model && !Object.values(opts.roleModels ?? {}).some(Boolean)) {
      throw new Error(`course-gen ${opts.provider} provider requires a model`);
    }
    this.opts = opts;
  }
  private modelFor(role: CourseGenRole): string {
    const model = this.opts.roleModels?.[role] ?? this.opts.model;
    if (!model) throw new Error(`course-gen ${this.opts.provider} provider has no model for role "${role}"`);
    return model;
  }
  async invoke(role: CourseGenRole, prompt: RolePrompt, onDelta?: RoleDelta): Promise<RoleResult> {
    const o = { ...this.opts, model: this.modelFor(role) };
    if (onDelta) return streamChat(o, role, prompt, onDelta);
    const req = {
      baseUrl: o.baseUrl ?? (o.provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
      apiKey: o.apiKey,
      model: o.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: o.maxTokens ?? 4096,
      timeoutMs: o.timeoutMs ?? 300_000,
      requestId: `cg-${role}-${prompt.task}`,
      fetchImpl: o.fetchImpl,
    };
    const result = o.provider === "anthropic" ? await anthropicGenerateText(req) : await openaiGenerateText(req);
    return { text: result.text, model: result.model, usage: result.usage };
  }
}

/* ── streaming (SSE) for real-time thinking + text ── */

/** Yield the `data:` payloads of an SSE stream (ignores event: lines, [DONE]). */
async function* sseData(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") yield data;
        }
      }
    }
  }
}

/** Options with the per-role model already resolved (invoke() guarantees it). */
type ResolvedLiveOptions = LiveRoleOptions & { model: string };

async function streamChat(o: ResolvedLiveOptions, role: CourseGenRole, prompt: RolePrompt, onDelta: RoleDelta): Promise<RoleResult> {
  const anthropic = o.provider === "anthropic";
  // Extended thinking is ON by default for Claude (opt out with
  // COURSE_GEN_THINKING=0) — otherwise the model's reasoning streams as plain
  // TEXT and lands in the output panel instead of a thinking panel.
  const wantThinking = anthropic && process.env.COURSE_GEN_THINKING !== "0";
  try {
    return await streamOnce(o, prompt, onDelta, wantThinking);
  } catch (err) {
    // Some models/endpoints reject the thinking parameter — degrade gracefully
    // to a normal streamed call rather than interrupting the run.
    const msg = err instanceof Error ? err.message : String(err);
    if (wantThinking && /thinking|budget/i.test(msg)) return streamOnce(o, prompt, onDelta, false);
    throw err;
  }
}

async function streamOnce(o: ResolvedLiveOptions, prompt: RolePrompt, onDelta: RoleDelta, useThinking: boolean): Promise<RoleResult> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 300_000);
  (timer as { unref?: () => void }).unref?.();
  const anthropic = o.provider === "anthropic";
  const baseUrl = (o.baseUrl ?? (anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const budget = Number(process.env.COURSE_GEN_THINKING_BUDGET ?? 4096);
  const maxTokens = useThinking ? Math.max(o.maxTokens ?? 8192, budget + 1024) : (o.maxTokens ?? 8192);

  const url = anthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (anthropic) {
    if (o.apiKey) headers["x-api-key"] = o.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (o.apiKey) {
    headers.authorization = `Bearer ${o.apiKey}`;
  }
  const body = anthropic
    ? { model: o.model, max_tokens: maxTokens, stream: true, ...(useThinking ? { thinking: { type: "enabled", budget_tokens: budget } } : {}), system: prompt.system, messages: [{ role: "user", content: prompt.user }] }
    : { model: o.model, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] };

  let text = "";
  let model = o.model;
  const usage: NormalizedModelUsage = {};
  try {
    const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) throw new Error(`${o.provider} stream ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for await (const data of sseData(res.body)) {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (anthropic) {
        const type = j.type;
        if (type === "message_start") model = ((j.message as { model?: string })?.model) ?? model;
        else if (type === "content_block_delta") {
          const delta = j.delta as { type?: string; text?: string; thinking?: string };
          if (delta?.type === "text_delta" && delta.text) { text += delta.text; onDelta({ kind: "text", chunk: delta.text }); }
          else if (delta?.type === "thinking_delta" && delta.thinking) onDelta({ kind: "thinking", chunk: delta.thinking });
        } else if (type === "message_delta") {
          const u = j.usage as { output_tokens?: number } | undefined;
          if (u?.output_tokens) usage.outputTokens = u.output_tokens;
        }
      } else {
        const choice = (j.choices as Array<{ delta?: { content?: string; reasoning_content?: string } }> | undefined)?.[0];
        const chunk = choice?.delta?.content;
        // Some OpenAI-compatible reasoning models stream their reasoning here.
        const reason = choice?.delta?.reasoning_content;
        if (reason) onDelta({ kind: "thinking", chunk: reason });
        if (chunk) { text += chunk; onDelta({ kind: "text", chunk }); }
        const u = j.usage as { completion_tokens?: number } | undefined;
        if (u?.completion_tokens) usage.outputTokens = u.completion_tokens;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (!text.trim()) throw new Error(`${o.provider} stream returned no text`);
  if (usage.outputTokens === undefined) usage.outputTokens = Math.ceil(text.length / 4);
  return { text, model, usage };
}

export { ZERO_USAGE };
