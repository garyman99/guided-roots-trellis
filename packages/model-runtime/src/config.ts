/**
 * Role-scoped provider configuration (plan Phase 3; ADR-0006).
 *
 * The Guide, simulator, and evaluator each select a provider/model
 * independently via env — GUIDE_*, SIMULATOR_*, EVALUATOR_* — with legacy
 * fallbacks so existing INSTRUCTOR_PROVIDER / OPENAI_* setups keep working.
 * No model names are hardcoded in domain logic: LLM providers REQUIRE an
 * explicit model, and validation errors name the exact variable to set.
 */
import type { ModelRole } from "./invocation.ts";

export type ProviderKind = "mock" | "fake" | "anthropic" | "openai-compatible";

export interface RoleModelConfig {
  role: ModelRole;
  provider: ProviderKind;
  model?: string;
  baseUrl?: string;
  /** Resolved secret — carry to the adapter, never into logs or manifests. */
  apiKey?: string;
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

type Env = Record<string, string | undefined>;

const PREFIX: Record<ModelRole, string> = {
  guide: "GUIDE_",
  simulator: "SIMULATOR_",
  evaluator: "EVALUATOR_",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Local OpenAI-compatible endpoints (LM Studio, Ollama, vLLM) usually ignore keys. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(baseUrl).hostname) || LOCAL_HOSTS.has(`[${new URL(baseUrl).hostname}]`);
  } catch {
    return false;
  }
}

export function resolveRoleConfig(role: ModelRole, env: Env = process.env): RoleModelConfig {
  const p = PREFIX[role];
  // Legacy fallback: the Guide predates role-scoped config as "the instructor".
  const rawProvider = env[`${p}PROVIDER`] ?? (role === "guide" ? env.INSTRUCTOR_PROVIDER : undefined) ?? "mock";
  const provider = rawProvider.toLowerCase() === "openai" ? "openai-compatible" : (rawProvider.toLowerCase() as ProviderKind);

  if (provider === "mock" || provider === "fake") return { role, provider };

  if (provider === "anthropic") {
    const model = env[`${p}MODEL`];
    if (!model) {
      throw new ModelConfigError(`${p}PROVIDER=anthropic requires ${p}MODEL (no model names are hardcoded)`);
    }
    const apiKey = env[`${p}API_KEY`] ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ModelConfigError(`${p}PROVIDER=anthropic requires ${p}API_KEY or ANTHROPIC_API_KEY`);
    }
    return {
      role,
      provider,
      model,
      baseUrl: env[`${p}BASE_URL`] ?? env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      apiKey,
    };
  }

  if (provider === "openai-compatible") {
    const baseUrl = env[`${p}BASE_URL`] ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = env[`${p}MODEL`] ?? env.OPENAI_MODEL;
    if (!model) {
      throw new ModelConfigError(
        `${p}PROVIDER=openai-compatible requires ${p}MODEL or OPENAI_MODEL (no model names are hardcoded)`,
      );
    }
    const apiKey = env[`${p}API_KEY`] ?? env.OPENAI_API_KEY;
    if (!apiKey && !isLocalBaseUrl(baseUrl)) {
      throw new ModelConfigError(
        `${p}PROVIDER=openai-compatible with non-local base URL ${baseUrl} requires ${p}API_KEY or OPENAI_API_KEY ` +
          `(local endpoints like http://localhost:1234/v1 may omit the key)`,
      );
    }
    return { role, provider, model, baseUrl, apiKey };
  }

  throw new ModelConfigError(
    `${p}PROVIDER="${rawProvider}" is not a known provider (valid: mock | fake | anthropic | openai-compatible)`,
  );
}
