/**
 * Bounded observe-decide-act loop (plan Phase 5).
 *
 * Every budget exhaustion is an EXPLICIT structured outcome with a reason,
 * never an ambiguous crash. Context stays bounded: the model gets a stable
 * system prefix (contract + persona — cacheable), then belief + recent
 * beats + the current observation (a marker when unchanged) instead of the
 * full history.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../../model-runtime/src/hash.ts";
import { addUsage, type NormalizedModelUsage } from "../../model-runtime/src/usage.ts";
import { estimateCostUSD, type PricingTable } from "../../model-runtime/src/pricing.ts";
import type { TextGenerationRequest, TextGenerationResult } from "../../model-runtime/src/textClient.ts";
import {
  observationHash,
  renderObservation,
  sanitizeSnapshot,
  targetsSignature,
  type LearnerObservation,
} from "./observation.ts";
import { normalizeDecision, validateDecision, type SimulatorDecision } from "./actions.ts";
import { executeAction, type SimScreenDriver } from "./driverClient.ts";

export const SIMULATOR_PROMPT_ID = "simulator.native";
export const SIMULATOR_PROMPT_VERSION = "v1";
export const SIMULATOR_PROMPT_PATH = fileURLToPath(new URL("../prompts/simulator.v1.md", import.meta.url));

export type GenerateText = (req: TextGenerationRequest) => Promise<TextGenerationResult>;

export interface SimulatorClient {
  provider: string;
  model: string;
  generate: GenerateText;
}

export interface SimulationBudgets {
  maxDecisions: number;
  maxInvalidActions: number;
  maxRepeatedObservations: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostUSD?: number;
  maxWallClockMs: number;
}

export const DEFAULT_BUDGETS: SimulationBudgets = {
  maxDecisions: 40,
  maxInvalidActions: 5,
  maxRepeatedObservations: 4,
  maxInputTokens: 500_000,
  maxOutputTokens: 50_000,
  maxEstimatedCostUSD: 1.5,
  maxWallClockMs: 30 * 60_000,
};

export type SimulationStatus =
  | "completed"
  | "gave_up"
  | "stuck"
  | "budget_exceeded"
  | "invalid_scenario"
  | "environment_failure"
  | "simulator_failure";

export interface DecisionTelemetry {
  decision: number;
  usage: NormalizedModelUsage;
  model: string;
  valid: boolean;
  startedAt: string;
  completedAt: string;
}

export interface SimulationResult {
  status: SimulationStatus;
  /** Why the loop ended — explicit, always populated (design doc). */
  reason: string;
  decisions: number;
  invalidActions: number;
  clarifyingQuestions: number;
  beats: string[];
  belief?: string;
  usage: NormalizedModelUsage;
  estimatedCostUSD?: number;
  /** Markdown trace in the established simulator-trace format. */
  trace: string;
}

export interface SimulationOptions {
  driver: SimScreenDriver;
  client: SimulatorClient;
  /** Learner-visible persona/scenario context (specView.ts projection). */
  personaContext: string;
  budgets?: Partial<SimulationBudgets>;
  pricing?: PricingTable | null;
  timeoutMs?: number;
  /**
   * Per-decision output budget. Models with always/adaptive thinking spend
   * output tokens thinking BEFORE the JSON — too small a cap yields an
   * empty response (observed live on Sonnet 5 at 700). Default 2500.
   */
  maxTokensPerDecision?: number;
  onDecision?: (t: DecisionTelemetry) => void;
  log?: (line: string) => void;
}

export function loadSimulatorPrompt(): { text: string; sha256: string } {
  const text = readFileSync(SIMULATOR_PROMPT_PATH, "utf8");
  return { text, sha256: sha256Text(text) };
}

function extractDecisionJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in output");
  return JSON.parse(trimmed.slice(start, end + 1));
}

const RECENT_BEATS = 8;

export async function runSimulationLoop(opts: SimulationOptions): Promise<SimulationResult> {
  const budgets: SimulationBudgets = { ...DEFAULT_BUDGETS, ...opts.budgets };
  const prompt = loadSimulatorPrompt();
  // Stable prefix for provider caching: contract, then persona — both frozen for the run.
  const system = `${prompt.text}\n\n${opts.personaContext}`;
  const startedAt = Date.now();
  const log = opts.log ?? (() => {});

  const beats: string[] = [];
  let belief: string | undefined;
  let usage: NormalizedModelUsage = {};
  let decisions = 0;
  let invalidActions = 0;
  let repeatedObservations = 0;
  let previousHash: string | null = null;
  let feedback: string | null = null;

  const cost = () =>
    opts.pricing ? estimateCostUSD(usage, opts.client.model, opts.pricing) : undefined;

  const finish = (status: SimulationStatus, reason: string): SimulationResult => {
    const clarifying = beats.filter((b) => b.includes("[STUCK-ASK]")).length;
    const outcome = status === "completed" ? "done" : "blocked";
    const trace = [
      `# Simulator trace — repo-native loop (${SIMULATOR_PROMPT_ID}@${SIMULATOR_PROMPT_VERSION}, ${opts.client.provider}/${opts.client.model})`,
      ``,
      ...beats,
      ``,
      `OUTCOME: ${outcome} — ${reason}`,
      `FINAL-STATUS: ${status}`,
      `CLARIFYING-QUESTIONS-ASKED: ${clarifying}`,
      `DECISIONS: ${decisions} · INVALID-ACTIONS: ${invalidActions}` +
        (belief ? `\nFINAL-BELIEF: ${belief}` : ""),
      ``,
    ].join("\n");
    return {
      status,
      reason,
      decisions,
      invalidActions,
      clarifyingQuestions: clarifying,
      beats,
      belief,
      usage,
      estimatedCostUSD: cost(),
      trace,
    };
  };

  while (true) {
    // ── budgets first: every exhaustion is explicit ────────────────────────
    if (decisions >= budgets.maxDecisions) return finish("budget_exceeded", `maxDecisions (${budgets.maxDecisions}) reached`);
    if (invalidActions > budgets.maxInvalidActions) return finish("budget_exceeded", `maxInvalidActions (${budgets.maxInvalidActions}) exceeded`);
    if ((usage.inputTokens ?? 0) > budgets.maxInputTokens) return finish("budget_exceeded", `maxInputTokens (${budgets.maxInputTokens}) exceeded`);
    if ((usage.outputTokens ?? 0) > budgets.maxOutputTokens) return finish("budget_exceeded", `maxOutputTokens (${budgets.maxOutputTokens}) exceeded`);
    const c = cost();
    if (budgets.maxEstimatedCostUSD !== undefined && c !== undefined && c > budgets.maxEstimatedCostUSD) {
      return finish("budget_exceeded", `maxEstimatedCostUSD (${budgets.maxEstimatedCostUSD}) exceeded`);
    }
    if (Date.now() - startedAt > budgets.maxWallClockMs) return finish("budget_exceeded", `maxWallClockMs (${budgets.maxWallClockMs}) exceeded`);

    // ── observe ────────────────────────────────────────────────────────────
    let observation: LearnerObservation;
    try {
      observation = sanitizeSnapshot(await opts.driver.snapshot());
    } catch (err) {
      return finish("environment_failure", `driver snapshot failed: ${(err as Error).message}`);
    }
    const hash = observationHash(observation);
    const unchanged = hash === previousHash;
    if (unchanged) {
      repeatedObservations += 1;
      if (repeatedObservations > budgets.maxRepeatedObservations) {
        return finish("stuck", `screen unchanged across ${repeatedObservations} consecutive observations`);
      }
    } else {
      repeatedObservations = 0;
    }
    previousHash = hash;

    // ── decide ─────────────────────────────────────────────────────────────
    const user = [
      belief ? `YOUR CURRENT BELIEF: ${belief}` : "YOUR CURRENT BELIEF: (none yet — this is your first look)",
      beats.length ? `YOUR RECENT BEATS:\n${beats.slice(-RECENT_BEATS).join("\n")}` : "YOUR RECENT BEATS: (none)",
      feedback ? `FEEDBACK ON YOUR LAST TURN: ${feedback}` : null,
      renderObservation(observation, { unchanged }),
      `Reply with your next decision as ONE JSON object.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    feedback = null;

    decisions += 1;
    const decisionStartedAt = new Date().toISOString();
    let result: TextGenerationResult;
    try {
      result = await opts.client.generate({
        baseUrl: "", // bound in the client closure
        model: opts.client.model,
        system,
        user,
        maxTokens: opts.maxTokensPerDecision ?? 2500,
        timeoutMs: opts.timeoutMs ?? 90_000,
      });
    } catch (err) {
      // Config-shaped failures are terminal (retrying cannot help); anything
      // transient (empty output, 5xx, timeout) is a bounded retry: it counts
      // against the invalid-action budget so a dead model still ends the run
      // explicitly instead of looping forever.
      const category = (err as { category?: string }).category;
      if (category === "auth" || category === "bad_request" || category === "not_found") {
        return finish("simulator_failure", `model call failed on decision ${decisions}: ${(err as Error).message}`);
      }
      invalidActions += 1;
      feedback = `your last turn produced no usable reply (${(err as Error).message}) — reply with ONE JSON decision`;
      log(`decision ${decisions}: MODEL ERROR (${(err as Error).message})`);
      opts.onDecision?.({ decision: decisions, usage: {}, model: opts.client.model, valid: false, startedAt: decisionStartedAt, completedAt: new Date().toISOString() });
      continue;
    }
    usage = addUsage(usage, result.usage);

    let decision: SimulatorDecision;
    let valid = true;
    try {
      const candidate = normalizeDecision(extractDecisionJson(result.text));
      const errors = validateDecision(candidate);
      if (errors.length > 0) throw new Error(errors.join("; "));
      decision = candidate as SimulatorDecision;
    } catch (err) {
      valid = false;
      invalidActions += 1;
      feedback = `your last reply was invalid (${(err as Error).message}) — reply with ONE valid JSON decision`;
      log(`decision ${decisions}: INVALID (${(err as Error).message})`);
      opts.onDecision?.({ decision: decisions, usage: result.usage, model: result.model, valid, startedAt: decisionStartedAt, completedAt: new Date().toISOString() });
      continue;
    }
    opts.onDecision?.({ decision: decisions, usage: result.usage, model: result.model, valid, startedAt: decisionStartedAt, completedAt: new Date().toISOString() });

    const specialTag = decision.special ? ` [${decision.special}]` : "";
    beats.push(`BEAT ${beats.length + 1}${specialTag} | ${decision.beat}`);
    if (decision.belief) belief = decision.belief;
    log(`decision ${decisions}: ${decision.status}${specialTag} — ${decision.beat.slice(0, 100)}`);

    if (decision.status === "done") return finish("completed", "learner finished after the product confirmed completion");
    if (decision.status === "gave-up") return finish("gave_up", "learner gave up in character");
    if (decision.status === "stuck") return finish("stuck", "learner reported being blocked after asking for help");

    // ── act (bounded group; stop when the target set changes materially) ──
    let preSignature: string;
    try {
      preSignature = targetsSignature(await opts.driver.snapshot());
    } catch (err) {
      return finish("environment_failure", `driver snapshot failed: ${(err as Error).message}`);
    }
    for (let i = 0; i < decision.actions.length; i++) {
      let raw;
      try {
        raw = await opts.driver.snapshot();
      } catch (err) {
        return finish("environment_failure", `driver snapshot failed: ${(err as Error).message}`);
      }
      if (i > 0 && targetsSignature(raw) !== preSignature) {
        feedback = `the screen changed materially after action ${i} of ${decision.actions.length} — remaining actions were cancelled; observe and decide again`;
        break;
      }
      let outcome: { ok: true } | { ok: false; error: string };
      try {
        outcome = await executeAction(opts.driver, raw, decision.actions[i]);
      } catch (err) {
        return finish("environment_failure", `driver action failed: ${(err as Error).message}`);
      }
      if (!outcome.ok) {
        invalidActions += 1;
        feedback = `action ${i + 1} (${decision.actions[i].type}) failed: ${outcome.error}`;
        log(`decision ${decisions}: action ${i + 1} invalid — ${outcome.error}`);
        break;
      }
    }
  }
}
