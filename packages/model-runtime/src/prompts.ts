/**
 * Prompt registry (ADR-0006 D40): every model-facing prompt has a stable ID,
 * an explicit version, and a content hash, so run manifests can pin exactly
 * which prompt text produced a result.
 *
 * The simulator contracts still physically live under `.claude/skills/`
 * (the live scheduled routine reads them there); they are registered in
 * place now and move into their packages when Phases 4–5 build the
 * repo-native simulator/evaluator.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./hash.ts";

export interface PromptRegistration {
  /** Stable ID, "<role>.<name>" — never reused for different content lines. */
  id: string;
  version: string;
  /** Repo-root-relative path to the artifact. */
  file: string;
  description?: string;
}

export interface PromptArtifact extends PromptRegistration {
  sha256: string;
  bytes: number;
}

export const KNOWN_PROMPTS: PromptRegistration[] = [
  {
    id: "guide.instructor",
    version: "v2",
    file: "packages/instructor/prompts/instructor.v2.md",
    description: "In-product Guide system prompt (hard rules, evidence-only coaching)",
  },
  {
    id: "evaluator.report",
    version: "v1",
    file: "packages/evaluator/prompts/evaluator.v1.md",
    description: "Repo-native evaluator system prompt (evidence-cited JSON report)",
  },
  {
    id: "simulator.native",
    version: "v1",
    file: "packages/simulator/prompts/simulator.v1.md",
    description: "Repo-native simulated-learner contract (JSON decisions, bounded action groups)",
  },
  {
    id: "simulator.contract",
    version: "v1",
    file: ".claude/skills/process-scenarios/simulator-contract.md",
    description: "MCP-pane simulated-learner contract (persona fidelity, BEAT trace)",
  },
  {
    id: "simulator.recorded-contract",
    version: "v1",
    file: ".claude/skills/process-scenarios/recorded-simulator-contract.md",
    description: "Playwright-recorded simulated-learner contract (sim.mjs actions)",
  },
];

export function resolvePromptArtifact(reg: PromptRegistration, repoRoot: string): PromptArtifact {
  const path = join(repoRoot, reg.file);
  const bytes = statSync(path).size;
  return { ...reg, sha256: sha256File(path), bytes };
}

/** promptId → "version@hash12" — the shape run manifests record. */
export function promptVersionMap(
  repoRoot: string,
  prompts: PromptRegistration[] = KNOWN_PROMPTS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const reg of prompts) {
    const art = resolvePromptArtifact(reg, repoRoot);
    out[art.id] = `${art.version}@${art.sha256.slice(0, 12)}`;
  }
  return out;
}
