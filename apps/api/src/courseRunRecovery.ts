/**
 * Boot recovery: rebuild the course-run index from disk.
 *
 * Run STATE is mirrored to curriculum/runs/<runId>/run.json on every change
 * (DiskMirroredCourseRunStore). On startup we re-insert any run present on disk
 * but missing from the database, so a lost/reset SQLite index never orphans the
 * (expensive, model-generated) content sitting on disk.
 *
 * Two flavors:
 *   • Mirrored runs (run.json present) — re-inserted verbatim at their exact
 *     last status. This is the zero-loss path for every run created from now on.
 *   • Legacy runs (content on disk but no run.json — generated before mirroring
 *     existed) — a run.json is SYNTHESIZED from the artifacts, inferring how far
 *     the run got, so those pre-existing runs are recovered too.
 *
 * After re-inserting, a run parked at/after the Publish gate whose draft course
 * row is ALSO missing is sent back to the Package gate: one re-approve there
 * re-runs the (deterministic, no-model-tokens) materializer and rebuilds the
 * course, scenarios, and labs from the authored content on disk.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  RunArtifacts,
  readRunRecord,
  writeRunRecord,
  reconcileRunsFromDisk,
  awaitingGate,
  type CourseRun,
  type CourseRunRequest,
  type GateId,
  type RunStatus,
} from "../../../packages/course-architect/src/index.ts";
import type { EventStore } from "./store.ts";

export interface RecoveryReport {
  recovered: string[]; // runs re-inserted into the DB from disk
  synthesized: string[]; // legacy runs given a fresh run.json from their artifacts
  downgraded: string[]; // runs sent back to Package because their course was lost
}

const EMPTY: RecoveryReport = { recovered: [], synthesized: [], downgraded: [] };

export function recoverCourseRunsFromDisk(store: EventStore, runsDir: string): RecoveryReport {
  if (!existsSync(runsDir)) return EMPTY;
  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ runId: e.name, runDir: join(runsDir, e.name) }));
  if (dirs.length === 0) return EMPTY;

  const known = new Set(store.listCourseRuns().map((r) => r.runId));

  // 1. Give legacy run dirs (content but no run.json) a synthesized record.
  const synthesized: string[] = [];
  for (const { runId, runDir } of dirs) {
    if (known.has(runId) || readRunRecord(runDir)) continue;
    const record = synthesizeRunRecord(runId, runDir);
    if (!record) continue; // empty / unrecognizable dir
    writeRunRecord(runDir, record);
    synthesized.push(runId);
  }

  // 2. Re-insert every disk record the DB is missing.
  const { recovered } = reconcileRunsFromDisk(store, dirs);

  // 3. Repair recovered runs whose draft course was lost with the index.
  const downgraded: string[] = [];
  const now = new Date().toISOString();
  for (const runId of recovered) {
    const run = store.getCourseRun(runId);
    if (!run) continue;

    const parkedAtOrPastPublish = run.status === "awaiting-publish" || run.status === "approved";
    const courseExists = store.listCourses().some((c) => c.sourceRunId === runId);
    if (parkedAtOrPastPublish && !courseExists) {
      store.updateCourseRun({ ...run, status: awaitingGate("package"), pendingPhase: null, updatedAt: now });
      store.requestCourseRunGate(runId, "package", now);
      store.appendCourseRunEvent({
        runId,
        at: now,
        type: "run.recovered",
        payload: { from: run.status, to: "awaiting-package", reason: "course index lost; re-approve Package to rebuild" },
      });
      downgraded.push(runId);
      continue;
    }

    // Otherwise ensure the gate it's parked at is actually pending, so the
    // operator can act on it in the UI.
    const gate = gateOfStatus(run.status);
    if (gate && !store.courseRunGates(runId).some((g) => g.gateId === gate && !g.decidedAt)) {
      store.requestCourseRunGate(runId, gate, now);
    }
    store.appendCourseRunEvent({ runId, at: now, type: "run.recovered", payload: { status: run.status } });
  }

  // Re-mirror every recovered run's FINAL state so run.json matches the repaired
  // DB (the downgrade/gate steps above wrote through the raw store).
  for (const runId of recovered) {
    const run = store.getCourseRun(runId);
    if (run) writeRunRecord(join(runsDir, runId), run);
  }

  return { recovered, synthesized, downgraded };
}

/** Map an `awaiting-<gate>` status back to its gate id (null for non-gate states). */
function gateOfStatus(status: RunStatus): GateId | null {
  const prefix = "awaiting-";
  return status.startsWith(prefix) ? (status.slice(prefix.length) as GateId) : null;
}

/**
 * Reconstruct a run record for a legacy dir by reading how far its artifacts
 * got. Parked at the gate for the furthest completed phase, so recovery mirrors
 * where the operator actually left off.
 */
function synthesizeRunRecord(runId: string, runDir: string): CourseRun | null {
  const arts = new RunArtifacts(runDir);
  const has = (p: string): boolean => {
    try {
      return arts.exists(p);
    } catch {
      return false;
    }
  };
  const authored = has("reviews/summary.json") || lessonAuthored(runDir);

  let status: RunStatus;
  if (has("manifest.json")) status = "awaiting-publish"; // materialized (step 3 fixes a lost course)
  else if (authored) status = "awaiting-package";
  else if (has("lesson-inventory.json") || has("prerequisite-graph.json")) status = "awaiting-blueprint";
  else if (has("course-request.md")) status = "awaiting-frame";
  else return null;

  const at = new Date().toISOString();
  return {
    runId,
    status,
    request: requestFromArtifacts(runId, arts),
    pendingPhase: null,
    pendingChangeNotes: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  };
}

function lessonAuthored(runDir: string): boolean {
  const lessonsDir = join(runDir, "lessons");
  if (!existsSync(lessonsDir)) return false;
  return readdirSync(lessonsDir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && existsSync(join(lessonsDir, e.name, "lesson.md")),
  );
}

/** Recover the request fields the materializer needs from course-request.md. */
function requestFromArtifacts(runId: string, arts: RunArtifacts): CourseRunRequest {
  const md = safeRead(arts, "course-request.md") ?? "";
  const field = (label: string): string | undefined => {
    const m = md.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "i"));
    return m ? m[1].trim() : undefined;
  };
  const heading = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const platform = field("Target platform");
  return {
    technology: field("Technology") ?? technologyFromRunId(runId),
    title: heading,
    targetLearner: field("Target learner"),
    outcome: field("Ending capability"),
    learnerStartingExperience: field("Starting point"),
    targetPlatform: platform === "mac" ? "mac" : "windows",
  };
}

function safeRead(arts: RunArtifacts, p: string): string | null {
  try {
    return arts.read(p);
  } catch {
    return null;
  }
}

/** "cg-selenium-using-python-265b5a" → "selenium using python" (last-ditch fallback). */
function technologyFromRunId(runId: string): string {
  return runId
    .replace(/^cg-/, "")
    .replace(/-[0-9a-f]{4,}$/i, "")
    .replace(/-/g, " ")
    .trim() || "course";
}
