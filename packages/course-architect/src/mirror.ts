/**
 * Disk mirroring for course-run STATE.
 *
 * Content (lessons, reviews, blueprint) already lives on disk under
 * curriculum/runs/<runId>/ (see RunArtifacts). The run RECORD — status, phase,
 * gate, request — historically lived ONLY in SQLite, so if that index was lost
 * or reset the expensive on-disk work became orphaned and invisible in the UI.
 *
 * This module makes disk authoritative: `run.json` sits next to the content and
 * is rewritten on every state change (DiskMirroredCourseRunStore), and on boot
 * `reconcileRunsFromDisk` re-inserts any run whose disk record has no DB row.
 * The result: shut the app down mid-run, start it back up, and the run reappears
 * at its last point of progress even if the database was wiped underneath it.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type CourseRun,
  type CourseRunEvent,
  type CourseRunGate,
  type CourseRunStore,
  type GateDecision,
  type GateId,
  type GateNote,
} from "./types.ts";

/** The mirrored run record's filename within a run dir. */
export const RUN_RECORD_FILE = "run.json";

/**
 * Write the run record to its run dir. Overwrites in place (no revisioning —
 * this is a live index, not a versioned artifact) and never throws into the
 * caller: mirroring is a durability aid, and a disk hiccup must not fail a run.
 */
export function writeRunRecord(runDir: string, run: CourseRun): void {
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, RUN_RECORD_FILE), JSON.stringify(run, null, 2));
  } catch {
    /* durability aid only */
  }
}

/** Remove the mirrored run record (best-effort) so a deleted run isn't resurrected. */
export function removeRunRecord(runDir: string): void {
  try {
    rmSync(join(runDir, RUN_RECORD_FILE), { force: true });
  } catch {
    /* durability aid only */
  }
}

/** Read the mirrored run record from a run dir, or null if absent/unreadable. */
export function readRunRecord(runDir: string): CourseRun | null {
  try {
    const p = join(runDir, RUN_RECORD_FILE);
    if (!existsSync(p)) return null;
    const rec = JSON.parse(readFileSync(p, "utf8")) as CourseRun;
    return rec && typeof rec.runId === "string" && typeof rec.status === "string" ? rec : null;
  } catch {
    return null;
  }
}

/**
 * A CourseRunStore decorator that mirrors every run-record write to disk. All of
 * the scheduler's state transitions flow through create/updateCourseRun, so
 * wrapping those two captures the full lifecycle. Every other method delegates
 * straight through to the inner (SQLite) store.
 */
export class DiskMirroredCourseRunStore implements CourseRunStore {
  private readonly inner: CourseRunStore;
  private readonly runDirFor: (runId: string) => string;

  constructor(inner: CourseRunStore, runDirFor: (runId: string) => string) {
    this.inner = inner;
    this.runDirFor = runDirFor;
  }

  createCourseRun(run: CourseRun): void {
    this.inner.createCourseRun(run);
    writeRunRecord(this.runDirFor(run.runId), run);
  }
  updateCourseRun(run: CourseRun): void {
    this.inner.updateCourseRun(run);
    writeRunRecord(this.runDirFor(run.runId), run);
  }
  getCourseRun(runId: string): CourseRun | null {
    return this.inner.getCourseRun(runId);
  }
  listCourseRuns(): CourseRun[] {
    return this.inner.listCourseRuns();
  }
  deleteCourseRun(runId: string): void {
    this.inner.deleteCourseRun(runId);
    removeRunRecord(this.runDirFor(runId));
  }
  appendCourseRunEvent(event: CourseRunEvent): CourseRunEvent {
    return this.inner.appendCourseRunEvent(event);
  }
  courseRunEvents(runId: string): CourseRunEvent[] {
    return this.inner.courseRunEvents(runId);
  }
  requestCourseRunGate(runId: string, gateId: GateId, requestedAt: string): void {
    this.inner.requestCourseRunGate(runId, gateId, requestedAt);
  }
  decideCourseRunGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    decidedBy: string | null,
    notes: GateNote[] | null,
    decidedAt: string,
  ): void {
    this.inner.decideCourseRunGate(runId, gateId, decision, decidedBy, notes, decidedAt);
  }
  courseRunGates(runId: string): CourseRunGate[] {
    return this.inner.courseRunGates(runId);
  }
}

export interface ReconcileResult {
  /** Run ids that were present on disk but missing from the DB, now re-inserted. */
  recovered: string[];
}

/**
 * Re-insert any run whose on-disk `run.json` has no matching DB row. Disk is the
 * source of truth: a run recorded on disk always belongs in the index. Runs the
 * DB already knows are left untouched (the DB may hold newer state for them, and
 * this only runs at boot when nothing is executing).
 */
export function reconcileRunsFromDisk(
  inner: CourseRunStore,
  runDirs: Array<{ runId: string; runDir: string }>,
): ReconcileResult {
  const known = new Set(inner.listCourseRuns().map((r) => r.runId));
  const recovered: string[] = [];
  for (const { runId, runDir } of runDirs) {
    if (known.has(runId)) continue;
    const record = readRunRecord(runDir);
    if (!record || record.runId !== runId) continue;
    inner.createCourseRun(record);
    recovered.push(runId);
  }
  return { recovered };
}
