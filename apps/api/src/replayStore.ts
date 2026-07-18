/**
 * rrweb replay storage (quality-rework Phase 3) — the screen-faithful twin of
 * the deterministic event log. The web app records rrweb DOM events for EVERY
 * session (real learners and AI sims alike — kill-switch TRELLIS_RRWEB=off)
 * and batch-uploads them; this module appends them as NDJSON on disk:
 *
 *   data/replays/<sessionId>/events.ndjson   one rrweb event per line
 *
 * Files, not DB blobs: replays are big, append-only, and read whole. A
 * per-session byte cap (TRELLIS_RRWEB_MAX_BYTES, default 25 MB) bounds a
 * runaway session; past it, events are dropped and a single marker line
 * records the truncation.
 */
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

export function rrwebEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TRELLIS_RRWEB ?? "on").toLowerCase() !== "off";
}

export function rrwebMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.TRELLIS_RRWEB_MAX_BYTES ?? 25 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? n : 25 * 1024 * 1024;
}

export function replayEventsPath(dir: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  return join(dir, sessionId, "events.ndjson");
}

export interface AppendResult {
  stored: number;
  dropped: number;
  capped: boolean;
}

/** Append a batch of rrweb events; enforce the per-session byte cap. */
export function appendReplayEvents(dir: string, sessionId: string, events: unknown[], maxBytes = rrwebMaxBytes()): AppendResult {
  const path = replayEventsPath(dir, sessionId);
  if (!path) return { stored: 0, dropped: events.length, capped: false };
  mkdirSync(join(dir, sessionId), { recursive: true });
  let size = 0;
  try {
    size = statSync(path).size;
  } catch { /* first write */ }
  if (size >= maxBytes) {
    return { stored: 0, dropped: events.length, capped: true };
  }
  const lines: string[] = [];
  let stored = 0;
  let capped = false;
  for (const e of events) {
    const line = JSON.stringify(e) + "\n";
    if (size + line.length > maxBytes) {
      // One marker line records the truncation, then the file is closed to
      // further writes (the size check above short-circuits future batches).
      lines.push(JSON.stringify({ type: "trellis-cap-reached", at: new Date().toISOString() }) + "\n");
      capped = true;
      break;
    }
    lines.push(line);
    size += line.length;
    stored++;
  }
  if (lines.length) appendFileSync(path, lines.join(""));
  return { stored, dropped: events.length - stored, capped };
}

/** The stored NDJSON path if a replay exists for this session, else null. */
export function replayFileFor(dir: string, sessionId: string): string | null {
  const path = replayEventsPath(dir, sessionId);
  return path && existsSync(path) ? path : null;
}

export function deleteReplay(dir: string, sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) return;
  rmSync(join(dir, sessionId), { recursive: true, force: true });
}
