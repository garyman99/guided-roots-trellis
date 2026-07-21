/**
 * Observation sanitization boundary (plan Phase 5; design doc "Simulator
 * security and fidelity boundary").
 *
 * The simulated learner sees EXACTLY what a real learner sees: visible text
 * and accessible targets. This module is the single door — every observation
 * passes through `sanitizeSnapshot`, which WHITELISTS fields (anything new a
 * driver starts returning is dropped, never leaked) and strips coordinates:
 * the model addresses targets by index/accessible name; only the executor
 * maps back to pixels.
 */
import { sha256Text } from "../../model-runtime/src/hash.ts";

/** What the recorder's /snapshot returns (coordinates stay executor-side). */
export interface RawSnapshotTarget {
  tag: string;
  role: string | null;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawSnapshot {
  url: string;
  title: string;
  text: string;
  targets: RawSnapshotTarget[];
}

export interface ObservedTarget {
  index: number;
  tag: string;
  role: string | null;
  name: string;
}

export interface LearnerObservation {
  url: string;
  title: string;
  text: string;
  targets: ObservedTarget[];
}

const TEXT_CAP = 6000;
const NAME_CAP = 60;

export function sanitizeSnapshot(raw: RawSnapshot): LearnerObservation {
  return {
    url: String(raw.url ?? ""),
    title: String(raw.title ?? ""),
    text: String(raw.text ?? "").slice(0, TEXT_CAP),
    targets: (raw.targets ?? []).map((t, index) => ({
      index,
      tag: String(t.tag ?? ""),
      role: t.role == null ? null : String(t.role),
      name: String(t.name ?? "").slice(0, NAME_CAP),
    })),
  };
}

/** Identity of what the learner can see — drives repeated-observation (stall) detection. */
export function observationHash(obs: LearnerObservation): string {
  return sha256Text(JSON.stringify([obs.url, obs.title, obs.text, obs.targets.map((t) => t.name)]));
}

/**
 * Cheap material-change signature: the set of actionable targets. Text
 * changes during typing are expected mid-sequence; a changed TARGET set
 * (window opened/closed, buttons appeared) means stale intent — stop the
 * action sequence and re-observe (design doc requirement).
 *
 * Editable fields (textarea/input/select) are keyed by tag:role, NOT by
 * name — because the driver derives a field's `name` from its own live
 * `value` (sim-driver snapshot), so the learner typing into the chat box
 * would otherwise change the signature and cancel the `click Send` queued in
 * the SAME decision (observed live: every "ask the guide" split into a
 * type-turn + a send-turn, doubling LLM calls and often re-appending the
 * question). Signature identity must survive the learner's own keystrokes;
 * new/closed targets still change the SET and are still caught.
 */
const EDITABLE_TAGS = new Set(["textarea", "input", "select"]);
const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);
const isEditable = (t: { tag: string; role: string | null }) =>
  EDITABLE_TAGS.has(t.tag) || (t.role != null && EDITABLE_ROLES.has(t.role));
export function targetsSignature(raw: RawSnapshot): string {
  return (raw.targets ?? [])
    .map((t) => (isEditable(t) ? `${t.tag}:${t.role ?? ""}` : `${t.tag}:${t.name}`))
    .sort()
    .join("|");
}

/**
 * Render for the model. Unchanged screens skip the (large) visible text but
 * ALWAYS include the target list — the model addresses clicks by index, so
 * suppressing targets blinds it (observed live: the learner complained it
 * could not see the current screen targets).
 */
export function renderObservation(obs: LearnerObservation, opts: { unchanged?: boolean } = {}): string {
  const targets = obs.targets.map((t) => `  [${t.index}] ${t.tag}${t.role ? `(${t.role})` : ""} "${t.name}"`);
  const targetBlock = [`CLICKABLE TARGETS (address by [index] or exact listed name):`, ...targets];
  if (opts.unchanged) {
    return [`SCREEN: visible text unchanged since your last observation.`, ...targetBlock].join("\n");
  }
  return [
    `SCREEN URL: ${obs.url}`,
    `SCREEN TITLE: ${obs.title}`,
    `VISIBLE TEXT:`,
    obs.text,
    ``,
    ...targetBlock,
  ].join("\n");
}
