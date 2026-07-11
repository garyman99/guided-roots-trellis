/**
 * Event schema registry + upcasting (ADR-0002, Phase 0).
 *
 * Events now feed decade-scale learner profiles, not just one-hour sessions:
 * every stored event carries `v`, and reads pass through `upcastEvent` so old
 * shapes replay correctly forever. Reducers only ever see current shapes.
 */
import type { SessionEvent } from "./events.ts";

type RawEvent = { type: string; v?: number } & Record<string, unknown>;

/** Current schema version per event type (absent = 1). */
export const CURRENT_VERSIONS: Record<string, number> = {
  "session.started": 2, // v2 adds variantId (adaptive labs)
  "instructor.hint": 2, // v2 adds contextManifest (context assembly audit)
};

/** Upcast functions: UPCASTS[type][fromVersion] → event at fromVersion+1. */
const UPCASTS: Record<string, Record<number, (e: RawEvent) => RawEvent>> = {
  "session.started": {
    1: (e) => ({ ...e, variantId: null, v: 2 }),
  },
  "instructor.hint": {
    1: (e) => ({ ...e, contextManifest: null, v: 2 }),
  },
};

export function currentVersionOf(type: string): number {
  return CURRENT_VERSIONS[type] ?? 1;
}

export function upcastEvent(raw: RawEvent): SessionEvent {
  let e: RawEvent = { ...raw, v: raw.v ?? 1 };
  const target = currentVersionOf(e.type);
  while ((e.v ?? 1) < target) {
    const step = UPCASTS[e.type]?.[e.v ?? 1];
    if (!step) throw new Error(`no upcast for ${e.type} v${e.v} → v${(e.v ?? 1) + 1}`);
    e = step(e);
  }
  return e as unknown as SessionEvent;
}

/** Stamp the current version on a freshly emitted event. */
export function stampVersion<T extends { type: string }>(event: T): T & { v: number } {
  return { ...event, v: currentVersionOf(event.type) };
}
