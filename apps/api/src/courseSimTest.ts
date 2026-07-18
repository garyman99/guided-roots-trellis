/**
 * Pre-publish simulated user test — orchestration (quality-rework Phase 4).
 *
 * After a run's publish gate is approved, the admin can send the course's
 * target-user persona through EVERY materialized lesson: a zero-app-context
 * agent plays each lesson in a real browser (tools/sim-test.mjs, spawned as a
 * child process so Playwright never enters the zero-dep API and a crashed
 * browser can't take it down). Results are ADVISORY — they inform the per-
 * lesson Go-live decision, they never block it.
 *
 * One GLOBAL slot: a single recorder browser + model stream at a time, so
 * jobs from any run queue serially. In-memory state only for live progress;
 * the durable record is curriculum/runs/<runId>/sim-tests/<labId>/result.json
 * (written by the server's onResult), so a restart just re-reads disk.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

export interface SimTestJob {
  runId: string;
  labId: string;
  title: string;
  blurb?: string;
  /** conceptsIntroduced by EARLIER lessons — the persona's cumulative memory. */
  concepts: string[];
  /** Path to the run's persona.json (the embedded snapshot). */
  personaPath: string;
  webUrl: string;
  apiUrl: string;
}

export interface SimLessonResult {
  runId?: string;
  labId: string;
  status: string; // completed | gave_up | stuck | budget_exceeded | environment_failure | simulator_failure
  reason?: string;
  decisions?: number;
  invalidActions?: number;
  clarifyingQuestions?: number;
  checkpointPassed?: boolean | null;
  sessionId?: string | null;
  estimatedCostUSD?: number;
  model?: string;
  bundleDir?: string;
  at?: string;
  frictionScore?: number | null;
}

export type SimTestRunner = (job: SimTestJob) => Promise<SimLessonResult>;

export interface SimTestRecord {
  labId: string;
  state: "queued" | "running" | "done";
  result?: SimLessonResult;
}

/** Production runner: spawn tools/sim-test.mjs and parse its result line. */
export function spawnSimTestRunner(repoRoot: string): SimTestRunner {
  return (job) =>
    new Promise((resolve) => {
      const args = [
        join(repoRoot, "tools", "sim-test.mjs"),
        "--lab", job.labId,
        "--persona", job.personaPath,
        "--title", job.title,
        "--web", job.webUrl,
        "--api", job.apiUrl,
      ];
      if (job.blurb) args.push("--blurb", job.blurb);
      if (job.concepts.length) args.push("--concepts", job.concepts.join(","));
      if (process.env.SIM_TEST_MAX_DECISIONS) args.push("--max-decisions", process.env.SIM_TEST_MAX_DECISIONS);
      if (process.env.SIM_TEST_MAX_COST_USD) args.push("--max-cost", process.env.SIM_TEST_MAX_COST_USD);

      const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (err += c));
      // A lesson sim is bounded by the loop's own budgets; this wall clock is
      // the backstop against a wedged browser (45 min, env-tunable).
      const killer = setTimeout(() => child.kill(), Number(process.env.SIM_TEST_TIMEOUT_MS ?? 45 * 60 * 1000));
      child.on("error", (e) => {
        clearTimeout(killer);
        resolve({ labId: job.labId, status: "environment_failure", reason: `couldn't spawn sim-test: ${e.message}` });
      });
      child.on("close", () => {
        clearTimeout(killer);
        const lines = out.trim().split("\n").filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const doc = JSON.parse(lines[i]) as SimLessonResult;
            if (doc.status) return resolve({ ...doc, labId: job.labId });
          } catch { /* not the result line */ }
        }
        resolve({ labId: job.labId, status: "simulator_failure", reason: `no result line from sim-test (stderr: ${err.slice(-300)})` });
      });
    });
}

export interface SimTestManagerDeps {
  runner: SimTestRunner;
  /** Persist a finished lesson's result (disk write + session tagging). */
  onResult: (runId: string, result: SimLessonResult) => void;
}

export class SimTestManager {
  private records = new Map<string, SimTestRecord[]>(); // runId → this process's jobs
  private pending: Array<{ job: SimTestJob; record: SimTestRecord }> = [];
  private pumping = false;
  private readonly deps: SimTestManagerDeps;

  constructor(deps: SimTestManagerDeps) {
    this.deps = deps;
  }

  /** True while any job for this run is queued or running in this process. */
  busy(runId: string): boolean {
    return (this.records.get(runId) ?? []).some((r) => r.state !== "done");
  }

  status(runId: string): SimTestRecord[] {
    return this.records.get(runId) ?? [];
  }

  enqueue(jobs: SimTestJob[]): SimTestRecord[] {
    const added: SimTestRecord[] = [];
    for (const job of jobs) {
      const record: SimTestRecord = { labId: job.labId, state: "queued" };
      const list = this.records.get(job.runId) ?? [];
      // Re-running a lesson replaces its previous in-memory record.
      this.records.set(job.runId, [...list.filter((r) => r.labId !== job.labId), record]);
      this.pending.push({ job, record });
      added.push(record);
    }
    void this.pump();
    return added;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let next = this.pending.shift(); next; next = this.pending.shift()) {
        next.record.state = "running";
        let result: SimLessonResult;
        try {
          result = await this.deps.runner(next.job);
        } catch (err) {
          result = { labId: next.job.labId, status: "simulator_failure", reason: err instanceof Error ? err.message : String(err) };
        }
        result.at = new Date().toISOString();
        next.record.state = "done";
        next.record.result = result;
        try {
          this.deps.onResult(next.job.runId, result);
        } catch { /* persistence best-effort; the in-memory record still shows it */ }
        // The queue continues past failures — advisory coverage over the whole course.
      }
    } finally {
      this.pumping = false;
    }
  }
}
