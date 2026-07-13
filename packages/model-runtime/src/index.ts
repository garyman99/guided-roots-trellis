/**
 * @trellis model-runtime — shared provider-neutral substrate (ADR-0006).
 *
 * Phase 2 scope: normalized usage, invocation records, immutable run
 * manifests with hash-anchored evidence references, versioned pricing, and
 * the prompt registry. Phase 3 adds the shared HTTP transport and the
 * fetch-based Anthropic / OpenAI-compatible clients on top of this.
 */
export { sha256File, sha256Text } from "./hash.ts";
export {
  isLocalBaseUrl,
  ModelConfigError,
  resolveRoleConfig,
  type ProviderKind,
  type RoleModelConfig,
} from "./config.ts";
export {
  postJson,
  TransportError,
  type PostJsonOptions,
  type PostJsonResult,
  type TransportErrorCategory,
  type TransportLogEntry,
} from "./transport.ts";
export type { TextGenerationRequest, TextGenerationResult } from "./textClient.ts";
export { anthropicGenerateText, normalizeAnthropicUsage } from "./anthropicClient.ts";
export { normalizeOpenAIUsage, openaiGenerateText } from "./openaiClient.ts";
export { addUsage, totalTokens, type NormalizedModelUsage } from "./usage.ts";
export {
  newInvocationId,
  newRunId,
  type InvocationStatus,
  type ModelInvocationRecord,
  type ModelRole,
} from "./invocation.ts";
export {
  RunArtifactWriter,
  type EvidenceRef,
  type RedactionStatus,
  type RetentionStatus,
  type RoleModelSelection,
  type RunManifest,
} from "./manifest.ts";
export {
  DEFAULT_PRICING_PATH,
  estimateCostUSD,
  loadPricingTable,
  type ModelPricing,
  type PricingTable,
} from "./pricing.ts";
export {
  KNOWN_PROMPTS,
  promptVersionMap,
  resolvePromptArtifact,
  type PromptArtifact,
  type PromptRegistration,
} from "./prompts.ts";
