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
import { resolveRoleConfig } from "../../model-runtime/src/config.ts";

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

export const PROMPT_VERSION = "v2";
