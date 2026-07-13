/**
 * Evaluator runner (plan Phase 4): single-shot model call over a fixed
 * bundle → schema-valid EvaluationReport. No agent loop. Invalid output
 * gets ONE bounded retry with the validator's errors fed back; a second
 * failure throws — an evaluation that cannot meet the contract is a failed
 * evaluation, never a silently-patched one.
 *
 * Provider-neutral: the model is reached through a generateText seam
 * satisfied by the Phase 3 clients (anthropic / openai-compatible) or a
 * test fake. The deterministic completion verdict is injected by THIS
 * runner from the bundle — never accepted from the model.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { anthropicGenerateText } from "../../model-runtime/src/anthropicClient.ts";
import { openaiGenerateText } from "../../model-runtime/src/openaiClient.ts";
import { resolveRoleConfig, ModelConfigError, type RoleModelConfig } from "../../model-runtime/src/config.ts";
import { sha256Text } from "../../model-runtime/src/hash.ts";
import type { TextGenerationRequest, TextGenerationResult } from "../../model-runtime/src/textClient.ts";
import type { NormalizedModelUsage } from "../../model-runtime/src/usage.ts";
import { addUsage } from "../../model-runtime/src/usage.ts";
import { bundleToPromptText, type EvaluationBundle } from "./bundle.ts";
import { validateReport, type EvaluationReport } from "./report.ts";

export const EVALUATOR_PROMPT_ID = "evaluator.report";
export const EVALUATOR_PROMPT_VERSION = "v1";
export const EVALUATOR_PROMPT_PATH = fileURLToPath(new URL("../prompts/evaluator.v1.md", import.meta.url));

export type GenerateText = (req: TextGenerationRequest) => Promise<TextGenerationResult>;

export interface EvaluationOutcome {
  report: EvaluationReport;
  model: string;
  provider: string;
  promptVersion: string;
  promptSha256: string;
  usage: NormalizedModelUsage;
  attempts: number;
}

export function loadEvaluatorPrompt(): { text: string; sha256: string } {
  const text = readFileSync(EVALUATOR_PROMPT_PATH, "utf8");
  return { text, sha256: sha256Text(text) };
}

/** Models sometimes fence JSON despite instructions; strip one fence layer. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export interface EvaluatorClient {
  provider: string;
  model: string;
  generate: GenerateText;
}

/** Build the evaluator's model client from EVALUATOR_* env (Phase 3 config). */
export function evaluatorClientFromEnv(env: Record<string, string | undefined> = process.env): EvaluatorClient {
  const cfg: RoleModelConfig = resolveRoleConfig("evaluator", env);
  if (cfg.provider === "anthropic") {
    return {
      provider: cfg.provider,
      model: cfg.model as string,
      generate: (req) => anthropicGenerateText({ ...req, baseUrl: cfg.baseUrl as string, apiKey: cfg.apiKey, model: cfg.model as string }),
    };
  }
  if (cfg.provider === "openai-compatible") {
    return {
      provider: cfg.provider,
      model: cfg.model as string,
      generate: (req) => openaiGenerateText({ ...req, baseUrl: cfg.baseUrl as string, apiKey: cfg.apiKey, model: cfg.model as string, temperature: 0 }),
    };
  }
  throw new ModelConfigError(
    `EVALUATOR_PROVIDER=${cfg.provider} cannot run a real evaluation — set anthropic or openai-compatible (tests inject a fake client directly)`,
  );
}

export async function runEvaluation(
  bundle: EvaluationBundle,
  client: EvaluatorClient,
  opts: { maxTokens?: number; timeoutMs?: number; onRetry?: (errors: string[]) => void } = {},
): Promise<EvaluationOutcome> {
  const prompt = loadEvaluatorPrompt();
  let usage: NormalizedModelUsage = {};
  let lastErrors: string[] = [];
  let userText = bundleToPromptText(bundle);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await client.generate({
      baseUrl: "", // overridden by the client closure
      model: client.model,
      system: prompt.text,
      user: userText,
      maxTokens: opts.maxTokens ?? 4000,
      timeoutMs: opts.timeoutMs ?? 120_000,
    });
    usage = addUsage(usage, result.usage);

    let candidate: unknown;
    try {
      candidate = extractJson(result.text);
    } catch (err) {
      lastErrors = [`output was not parseable JSON: ${(err as Error).message}`];
      opts.onRetry?.(lastErrors);
      userText = retryText(bundle, lastErrors, result.text);
      continue;
    }
    lastErrors = validateReport(candidate, bundle.rubric, bundle.completionGatePassed);
    if (lastErrors.length === 0) {
      const report = candidate as EvaluationReport;
      // Deterministic truth is injected here, never model-stated.
      report.completionGatePassed = bundle.completionGatePassed;
      return {
        report,
        model: result.model,
        provider: client.provider,
        promptVersion: EVALUATOR_PROMPT_VERSION,
        promptSha256: prompt.sha256,
        usage,
        attempts: attempt,
      };
    }
    opts.onRetry?.(lastErrors);
    userText = retryText(bundle, lastErrors, result.text);
  }
  throw new Error(`evaluation failed schema validation after 2 attempts:\n- ${lastErrors.join("\n- ")}`);
}

function retryText(bundle: EvaluationBundle, errors: string[], previous: string): string {
  return (
    bundleToPromptText(bundle) +
    `\n\nYOUR PREVIOUS OUTPUT FAILED VALIDATION. Errors:\n- ${errors.join("\n- ")}\n\n` +
    `Previous output (fix it, return ONLY the corrected JSON object):\n${previous.slice(0, 6000)}`
  );
}
