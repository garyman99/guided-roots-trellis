export * from "./types.ts";
export * from "./context.ts";
export * from "./assembler.ts";
export * from "./policy.ts";
export * from "./narrative.ts";
export { MockInstructorProvider } from "./mock.ts";
export { OpenAICompatibleProvider } from "./openaiCompatible.ts";

import type { InstructorProvider } from "./types.ts";
import { MockInstructorProvider } from "./mock.ts";
import { OpenAICompatibleProvider } from "./openaiCompatible.ts";

export function providerFromEnv(env = process.env): InstructorProvider {
  switch ((env.INSTRUCTOR_PROVIDER ?? "mock").toLowerCase()) {
    case "openai":
    case "openai-compatible":
      return OpenAICompatibleProvider.fromEnv(env);
    default:
      return new MockInstructorProvider();
  }
}

export const PROMPT_VERSION = "v2";
