/**
 * Capability-request outbox (plan §4b / D11). When an operator commissions a
 * capability gap at the blueprint gate, we write a structured brief to
 * curriculum/capability-requests/<gapId>/ — the handoff to the code side. A
 * dev skill (sibling of process-scenarios) picks these up, implements the
 * capability additively (new app / auto-rule / checkpoint kind + registry +
 * AUTHORING.md + tests, per labs/AUTHORING.md §13), and the shipping PR makes
 * the registry satisfy it — at which point the blocked lessons can be authored.
 *
 * The generator never blocks on the code side, and the code side never blocks a
 * run's supported lessons: the outbox decouples them.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityGap } from "../../../packages/course-architect/src/gaps.ts";

export interface CapabilityRequestInput {
  gap: CapabilityGap;
  runId: string;
  technology: string;
  /** The proposed contract, sketched by the generator (free text for the POC). */
  rationale: string;
}

export interface CapabilityRequestRecord {
  gapId: string;
  runId: string;
  technology: string;
  blockedLessons: string[];
  status: "requested"; // dev skill advances this in its PR; "shipped" is detected via the registry
  requestedAt: string;
  rationale: string;
}

/** A safe directory name for a capability id. */
function safeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "capability";
}

/**
 * Write (or refresh) the request brief for a commissioned gap. Idempotent: a
 * re-commission of the same gap overwrites its brief rather than duplicating.
 * Returns the request record.
 */
export function writeCapabilityRequest(outboxDir: string, input: CapabilityRequestInput, at: string): CapabilityRequestRecord {
  const dir = join(outboxDir, safeId(input.gap.capabilityId));
  mkdirSync(dir, { recursive: true });
  const record: CapabilityRequestRecord = {
    gapId: input.gap.capabilityId,
    runId: input.runId,
    technology: input.technology,
    blockedLessons: input.gap.lessons,
    status: "requested",
    requestedAt: at,
    rationale: input.rationale,
  };
  writeFileSync(join(dir, "request.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(dir, "request.md"), renderRequestMd(record));
  return record;
}

function renderRequestMd(r: CapabilityRequestRecord): string {
  return [
    `# Capability request: \`${r.gapId}\``,
    ``,
    `- **Requested by** course-generation run \`${r.runId}\` (${r.technology})`,
    `- **Requested at** ${r.requestedAt}`,
    `- **Blocks lessons** ${r.blockedLessons.map((l) => `\`${l}\``).join(", ") || "(none recorded)"}`,
    ``,
    `## Why it's needed`,
    ``,
    r.rationale,
    ``,
    `## Acceptance (additive — see labs/AUTHORING.md §13)`,
    ``,
    `- Implement the capability (a new workspace app + its events, a new task \`auto\``,
    `  value in \`taskAutoDone()\`, or a new checkpoint kind) WITHOUT changing existing`,
    `  behavior.`,
    `- Register its id in the capability registry (\`apps/api/src/capabilities.ts\`) and`,
    `  document it in \`labs/AUTHORING.md\` in the SAME change.`,
    `- Add a deterministic test; the registry↔implementation agreement test must pass.`,
    ``,
    `Once shipped, this gap is satisfied automatically (the registry now includes`,
    `\`${r.gapId}\`) and the blocked lessons can be authored on the next run.`,
    ``,
  ].join("\n");
}

/**
 * Remove every request this run commissioned (cascade when a run is deleted).
 * Returns the gap ids that were removed. A request the dev side already picked up
 * is still removed — deleting the run retracts its outstanding asks.
 */
export function deleteCapabilityRequestsForRun(outboxDir: string, runId: string): string[] {
  if (!existsSync(outboxDir)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(outboxDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(outboxDir, entry.name);
    const file = join(dir, "request.json");
    if (!existsSync(file)) continue;
    try {
      const rec = JSON.parse(readFileSync(file, "utf8")) as CapabilityRequestRecord;
      if (rec.runId === runId) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(rec.gapId);
      }
    } catch {
      /* skip malformed */
    }
  }
  return removed;
}

/** List open capability requests in the outbox (for an admin view / the dev skill). */
export function listCapabilityRequests(outboxDir: string): CapabilityRequestRecord[] {
  if (!existsSync(outboxDir)) return [];
  const out: CapabilityRequestRecord[] = [];
  for (const entry of readdirSync(outboxDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(outboxDir, entry.name, "request.json");
    if (existsSync(file)) {
      try {
        out.push(JSON.parse(readFileSync(file, "utf8")) as CapabilityRequestRecord);
      } catch {
        /* skip malformed */
      }
    }
  }
  return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
