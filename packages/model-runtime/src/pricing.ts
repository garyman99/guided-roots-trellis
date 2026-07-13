/**
 * Configuration-driven cost estimation (ADR-0006 D40).
 *
 * Prices live in the versioned `pricing.json` next to this package (root
 * `data/` is git-ignored) because provider pricing changes: a price change is
 * a version bump, and every estimate records which version produced it.
 * An unknown model yields `undefined`, never a guessed number.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NormalizedModelUsage } from "./usage.ts";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  notes?: string;
}

export interface PricingTable {
  version: number;
  pricedAt: string;
  currency: "USD";
  models: Record<string, ModelPricing>;
}

export const DEFAULT_PRICING_PATH = fileURLToPath(new URL("../pricing.json", import.meta.url));

export function loadPricingTable(path: string = DEFAULT_PRICING_PATH): PricingTable {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`pricing table not readable at ${path}: ${String((err as Error).message)}`);
  }
  const table = JSON.parse(raw) as PricingTable;
  if (typeof table.version !== "number" || typeof table.pricedAt !== "string" || table.currency !== "USD") {
    throw new Error(`pricing table ${path} missing version/pricedAt/currency`);
  }
  if (!table.models || typeof table.models !== "object") {
    throw new Error(`pricing table ${path} has no models map`);
  }
  for (const [id, p] of Object.entries(table.models)) {
    if (typeof p.inputPerMTok !== "number" || typeof p.outputPerMTok !== "number") {
      throw new Error(`pricing table ${path}: model "${id}" needs numeric inputPerMTok and outputPerMTok`);
    }
  }
  return table;
}

/** USD estimate from reported usage; `undefined` when the model has no entry. */
export function estimateCostUSD(
  usage: NormalizedModelUsage,
  model: string,
  table: PricingTable,
): number | undefined {
  const p = table.models[model];
  if (!p) return undefined;
  const perTok = (n: number | undefined, perM: number | undefined) =>
    n !== undefined && perM !== undefined ? (n * perM) / 1_000_000 : 0;
  return (
    perTok(usage.inputTokens, p.inputPerMTok) +
    perTok(usage.outputTokens, p.outputPerMTok) +
    perTok(usage.cacheReadTokens, p.cacheReadPerMTok) +
    perTok(usage.cacheWriteTokens, p.cacheWritePerMTok)
  );
}
