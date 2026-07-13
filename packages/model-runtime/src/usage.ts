/**
 * Provider-neutral token accounting (ADR-0006 D40).
 *
 * Fields are optional because providers report different subsets; a missing
 * field means "the provider did not report this" — never substitute zero,
 * or aggregates would silently understate usage as fact.
 */
export interface NormalizedModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

const FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

/** Field-wise sum; a field is present in the result iff either side reported it. */
export function addUsage(a: NormalizedModelUsage, b: NormalizedModelUsage): NormalizedModelUsage {
  const out: NormalizedModelUsage = {};
  for (const f of FIELDS) {
    const av = a[f];
    const bv = b[f];
    if (av === undefined && bv === undefined) continue;
    out[f] = (av ?? 0) + (bv ?? 0);
  }
  return out;
}

/** Explicit provider total when reported, else the sum of reported parts. */
export function totalTokens(u: NormalizedModelUsage): number {
  if (u.totalTokens !== undefined) return u.totalTokens;
  return (
    (u.inputTokens ?? 0) +
    (u.outputTokens ?? 0) +
    (u.cacheReadTokens ?? 0) +
    (u.cacheWriteTokens ?? 0) +
    (u.reasoningTokens ?? 0)
  );
}
