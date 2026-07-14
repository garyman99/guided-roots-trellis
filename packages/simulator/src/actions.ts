/**
 * Strict simulator action schema (plan Phase 5).
 *
 * The model gets a small, explicit action vocabulary — never shell or
 * arbitrary browser access. A decision carries a BOUNDED action group so
 * mechanical click/type runs don't cost a deliberation each, but long
 * autonomous scripts are rejected at validation time.
 */

export type TargetRef = { kind: "name"; value: string } | { kind: "index"; value: number };

export type SimulatorAction =
  | { type: "click"; target: TargetRef }
  | { type: "dblclick"; target: TargetRef }
  | { type: "type"; text: string }
  | { type: "press"; key: string }
  | { type: "replace-text"; text: string }
  | { type: "scroll"; dy: number }
  | { type: "wait"; ms: number };

export type DecisionStatus = "continue" | "done" | "gave-up" | "stuck";

export interface SimulatorDecision {
  status: DecisionStatus;
  /** One BEAT line: what you see / what you're doing / why, in persona voice. */
  beat: string;
  special?: "GOAL" | "STUCK-ASK" | "MISTAKE" | "RECOVERY";
  /** Updated learner belief — the bounded state that replaces full history. */
  belief?: string;
  actions: SimulatorAction[];
}

export const MAX_ACTIONS_PER_DECISION = 5;
const MAX_TEXT = 2000;
const MAX_WAIT_MS = 5000;
const STATUSES: DecisionStatus[] = ["continue", "done", "gave-up", "stuck"];
const SPECIALS = ["GOAL", "STUCK-ASK", "MISTAKE", "RECOVERY"];

const validTarget = (t: unknown): t is TargetRef => {
  const ref = t as TargetRef;
  if (typeof ref !== "object" || ref === null) return false;
  if (ref.kind === "name") return typeof ref.value === "string" && ref.value.trim() !== "";
  if (ref.kind === "index") return Number.isInteger(ref.value) && (ref.value as number) >= 0;
  return false;
};

/**
 * Tolerant normalization of harmless model drift, applied before
 * validation: `special: null` means absent; `{"type":"key"}` means press.
 * Anything beyond these documented aliases still fails validation.
 */
export function normalizeDecision(candidate: unknown): unknown {
  const d = candidate as Record<string, unknown>;
  if (typeof d !== "object" || d === null) return candidate;
  if (d.special === null || d.special === "") delete d.special;
  if (Array.isArray(d.actions)) {
    for (const a of d.actions as Array<Record<string, unknown>>) {
      if (a && a.type === "key" && typeof a.key === "string") a.type = "press";
    }
  }
  return candidate;
}

export function validateDecision(candidate: unknown): string[] {
  const errors: string[] = [];
  const d = candidate as SimulatorDecision;
  if (typeof d !== "object" || d === null) return ["decision is not an object"];
  if (!STATUSES.includes(d.status)) errors.push(`status must be one of ${STATUSES.join("|")}`);
  if (typeof d.beat !== "string" || d.beat.trim().length < 10) {
    errors.push("beat must narrate what you see / are doing / why (>= 10 chars)");
  }
  if (d.special !== undefined && !SPECIALS.includes(d.special)) {
    errors.push(`special must be one of ${SPECIALS.join("|")} when present`);
  }
  if (!Array.isArray(d.actions)) {
    errors.push("actions must be an array (empty is allowed only to wait and re-observe)");
    return errors;
  }
  if (d.actions.length > MAX_ACTIONS_PER_DECISION) {
    errors.push(`at most ${MAX_ACTIONS_PER_DECISION} actions per decision — no long autonomous scripts`);
  }
  if (d.status !== "continue" && d.actions.length > 0) {
    errors.push(`status "${d.status}" ends the run — actions must be empty`);
  }
  d.actions.forEach((a, i) => {
    const where = `actions[${i}]`;
    switch (a?.type) {
      case "click":
      case "dblclick":
        if (!validTarget(a.target)) errors.push(`${where}: target must be {kind:"name",value} or {kind:"index",value>=0}`);
        break;
      case "type":
      case "replace-text":
        if (typeof a.text !== "string" || a.text.length === 0 || a.text.length > MAX_TEXT) {
          errors.push(`${where}: text must be a 1..${MAX_TEXT} char string`);
        }
        break;
      case "press":
        if (typeof a.key !== "string" || a.key.trim() === "") errors.push(`${where}: key required (e.g. "Enter")`);
        break;
      case "scroll":
        if (typeof a.dy !== "number" || !Number.isFinite(a.dy)) errors.push(`${where}: dy must be a number`);
        break;
      case "wait":
        if (!Number.isInteger(a.ms) || a.ms <= 0 || a.ms > MAX_WAIT_MS) {
          errors.push(`${where}: ms must be an integer 1..${MAX_WAIT_MS}`);
        }
        break;
      default:
        errors.push(`${where}: unknown action type "${(a as { type?: string })?.type}"`);
    }
  });
  return errors;
}
