export * from "./types.ts";
export * from "./context.ts";
export * from "./assembler.ts";
export * from "./policy.ts";
export * from "./narrative.ts";
export { MockInstructorProvider } from "./mock.ts";
export { OpenAICompatibleProvider } from "./openaiCompatible.ts";
export { AnthropicInstructorProvider } from "./anthropic.ts";
export { FakeInstructorProvider, type FakeHint } from "./fake.ts";

import type { InstructorProvider } from "./types.ts";
import { MockInstructorProvider } from "./mock.ts";
import { OpenAICompatibleProvider } from "./openaiCompatible.ts";
import { AnthropicInstructorProvider } from "./anthropic.ts";
import { FakeInstructorProvider } from "./fake.ts";
import { resolveRoleConfig, ModelConfigError } from "../../model-runtime/src/config.ts";

/**
 * Guide-role provider selection (plan Phase 3): role-scoped GUIDE_* env with
 * legacy INSTRUCTOR_PROVIDER fallback, validated centrally — unknown
 * providers and missing models/keys throw actionable ModelConfigErrors
 * instead of silently falling back to mock.
 */
export function providerFromEnv(env = process.env): InstructorProvider {
  const cfg = resolveRoleConfig("guide", env);
  switch (cfg.provider) {
    case "anthropic":
      return AnthropicInstructorProvider.fromConfig(cfg);
    case "openai-compatible":
      return OpenAICompatibleProvider.fromConfig(cfg);
    case "fake":
      return new FakeInstructorProvider(); // default deterministic script (tests/offline)
    default:
      return new MockInstructorProvider();
  }
}

export const PROMPT_VERSION = "v3";

/**
 * Runtime guide-provider switching (a dev/operator affordance on top of the
 * env-selected default). The learner UI offers exactly two choices: the
 * offline scripted guide, and "the live model" — whatever GUIDE_* configures.
 * Secrets never leave the server: the client passes an id ("mock" | "model"),
 * the server resolves it against env-held config.
 */
export type GuideProviderId = "mock" | "model";

export interface GuideProviderInfo {
  id: GuideProviderId;
  label: string;
  /** Can the server actually build this right now? (model needs valid GUIDE_* config) */
  available: boolean;
  /** When unavailable, exactly what to set to enable it. */
  detail?: string;
}

/**
 * What the switcher can offer, given the current env. "mock" is always there;
 * "model" is available only when the GUIDE_ vars (or the legacy INSTRUCTOR_ /
 * OPENAI_ ones) resolve to a real LLM provider — otherwise it's listed but
 * disabled with a message naming the variables to set. Never throws.
 */
export function guideProviderCatalog(env = process.env): GuideProviderInfo[] {
  const list: GuideProviderInfo[] = [
    { id: "mock", label: "Scripted guide (offline)", available: true },
  ];
  try {
    const cfg = resolveRoleConfig("guide", env);
    if (cfg.provider === "anthropic" || cfg.provider === "openai-compatible") {
      list.push({ id: "model", label: `Live model · ${cfg.provider} · ${cfg.model}`, available: true });
    } else {
      list.push({
        id: "model",
        label: "Live model (not configured)",
        available: false,
        detail:
          "Set GUIDE_PROVIDER=anthropic|openai-compatible, GUIDE_MODEL, and a key " +
          "(GUIDE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) in .env, then restart the API.",
      });
    }
  } catch (err) {
    list.push({
      id: "model",
      label: "Live model (misconfigured)",
      available: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return list;
}

/** Build the provider for a switcher id. "model" throws (ModelConfigError) if not configured. */
export function buildGuideProvider(id: GuideProviderId, env = process.env): InstructorProvider {
  if (id === "mock") return new MockInstructorProvider();
  const cfg = resolveRoleConfig("guide", env); // throws with the exact missing var
  switch (cfg.provider) {
    case "anthropic":
      return AnthropicInstructorProvider.fromConfig(cfg);
    case "openai-compatible":
      return OpenAICompatibleProvider.fromConfig(cfg);
    default:
      throw new ModelConfigError(
        "No live model is configured — set GUIDE_PROVIDER to anthropic or openai-compatible (with GUIDE_MODEL and a key).",
      );
  }
}
