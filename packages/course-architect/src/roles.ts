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
  | "cohesion-editor";

export const COURSE_GEN_ROLES: CourseGenRole[] = [
  "architect",
  "domain-analyst",
  "learner-advocate",
  "lesson-author",
  "technical-reviewer",
  "pedagogy-reviewer",
  "cohesion-editor",
];

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

export interface RoleInvoker {
  invoke(role: CourseGenRole, prompt: RolePrompt): Promise<RoleResult>;
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
  async invoke(role: CourseGenRole, prompt: RolePrompt): Promise<RoleResult> {
    const text = this.responder(role, prompt);
    // Stub usage proportional to text so cost views have something non-trivial.
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
  model: string;
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
 * config used for every role (the run-wide provider/model the operator picked),
 * so provider selection is per-run, not per-boot. The API key is passed in from
 * the server's environment — never from the client.
 */
export class LiveRoleInvoker implements RoleInvoker {
  private readonly opts: LiveRoleOptions;
  constructor(opts: LiveRoleOptions) {
    if (!opts.model) throw new Error(`course-gen ${opts.provider} provider requires a model`);
    this.opts = opts;
  }
  async invoke(role: CourseGenRole, prompt: RolePrompt): Promise<RoleResult> {
    const o = this.opts;
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

export { ZERO_USAGE };
