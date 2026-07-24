/**
 * AutoGateArbiter — the operator inside the pipeline (autonomous-course-pipeline
 * plan §3.1). In `gateMode: "auto"`, a run's four gates are decided by the
 * `gate-reviewer` role instead of a human: `poke()` scans for auto runs parked
 * at a gate, invokes the reviewer with a bounded artifact bundle, and calls the
 * SAME `decideGate` the human gate-decision endpoint uses — so the executor's
 * revision path is completely unaware whether a human or the arbiter decided.
 *
 * Two invariants keep this safe to run on a timer next to a live operator:
 *   • One review in flight globally. poke() re-arms itself instead of
 *     overlapping — the reviewer call is slow, the scheduler is already
 *     single-active-run, and two scans deciding the same gate would race the
 *     verdict-artifact write and `decideGate` itself.
 *   • A gate can vanish between scan and decide (a human beats the arbiter to
 *     it, or the run already advanced) — `decideGate` throws RunStateError,
 *     which is swallowed per-run. poke() never throws.
 *
 * The hard change-budget (autogateMaxChanges) is the P4 fix from the plan: a
 * reviewer whose job is finding problems never says "done", so after N
 * change-rounds the arbiter forces approval-with-reservations instead of
 * asking the model again. A gate never loops forever and never dead-ends.
 */
import type {
  CourseGenRole,
  CourseRun,
  CourseRunRequest,
  CourseRunScheduler,
  CourseRunStore,
  GateId,
  GateVerdict,
  RoleInvoker,
  RolePrompt,
} from "../../../packages/course-architect/src/index.ts";
import {
  GATES,
  GATE_REVIEWER_SYSTEM,
  RunArtifacts,
  RunStateError,
  autogateMaxChanges,
  gateVerdictInstruction,
  invokeValidatedJson,
  personaPromptView,
  validateGateVerdict,
} from "../../../packages/course-architect/src/index.ts";

/** Injected collaborators — kept narrow so tests can fake every side effect. */
export interface AutoGateArbiterDeps {
  store: CourseRunStore;
  courseRuns: CourseRunScheduler;
  invokerFor: (run: CourseRun) => RoleInvoker;
  artifactsFor: (runId: string) => RunArtifacts;
  /** Blueprint-gate approval: apply gap dispositions (same shape the human
   *  gate-decision endpoint's body.gaps takes: { capabilityId, disposition }[]).
   *  No longer called by the arbiter itself (blueprint is approved on design
   *  merit only, per gap-reconciliation-pause plan §6) — left wired for
   *  server.ts, which still owns gap dispositions at the reconcile gate. */
  applyGapDispositions: (runId: string, gaps: unknown) => void;
  /** Publish-gate approval on an `autoPublish` run: go live immediately. */
  publishCourse: (runId: string) => void;
  /** Best-effort lifecycle notifications (the webhook emitter). Optional —
   *  omit in tests that don't care about the notification side channel. */
  emit?: (event: string, runId: string, payload?: Record<string, unknown>) => void;
}

/** Each gate reviews a different, bounded slice of the run's artifacts. */
const GATE_ARTIFACTS: Record<GateId, string[]> = {
  frame: ["course-request.md"],
  blueprint: ["lesson-inventory.json", "plan-review.md", "capability-gaps.json"],
  package: ["reviews/summary.json", "critiques/summary.json"],
  rehearse: ["rehearsal/summary.json", "lessons/state.json"],
  publish: ["manifest.json"],
  // Never reviewed by the arbiter (decideOne returns early) — entry only to
  // satisfy the Record<GateId, ...> keying now that GateId includes it.
  reconcile: [],
};

/** Per-artifact character cap — the reviewer needs enough to judge, not the
 *  whole run; a full lesson corpus would blow the context window on courses
 *  with many lessons. */
const ARTIFACT_CHAR_CAP = 12_000;

function capArtifact(text: string): string {
  return text.length > ARTIFACT_CHAR_CAP ? `${text.slice(0, ARTIFACT_CHAR_CAP)}\n…[truncated at ${ARTIFACT_CHAR_CAP} chars]` : text;
}

/** The request as prompt context: persona lifted out as a bounded view — the
 *  raw embedded snapshot carries ids/timestamps the reviewer has no use for.
 *  Mirrors executor.ts's requestContext (not exported; small enough to keep
 *  local rather than widen that package's surface for one caller). */
function requestView(req: CourseRunRequest): Record<string, unknown> {
  const { persona, ...rest } = req;
  return { ...rest, ...(persona ? { persona: personaPromptView(persona.profile) } : {}) };
}

export class AutoGateArbiter {
  private readonly deps: AutoGateArbiterDeps;
  /** True while a scan is executing; a poke() that arrives mid-scan is
   *  coalesced into one more run right after, rather than overlapping. */
  private running = false;
  private queued = false;
  /** Webhook dedupe: `${runId}:${status}` already reported as parked. */
  private readonly seenParked = new Set<string>();
  /** Webhook dedupe: runId already reported as approved/failed. */
  private readonly seenTerminal = new Set<string>();

  constructor(deps: AutoGateArbiterDeps) {
    this.deps = deps;
  }

  /** Scan every auto-mode run for a gate that needs a decision. Never throws —
   *  a single bad run must not stop the arbiter from serving every other one. */
  async poke(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      await this.scanOnce();
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.poke();
      }
    }
  }

  private async scanOnce(): Promise<void> {
    const autoRuns = this.deps.store.listCourseRuns().filter((r) => r.request.gateMode === "auto");
    for (const run of autoRuns) this.reportLifecycle(run);

    const pending = autoRuns.filter((r) => r.status.startsWith("awaiting-"));
    for (const run of pending) {
      try {
        await this.decideOne(run);
      } catch (err) {
        // Defense in depth: decideOne already catches what it can; this is the
        // last resort so one run's surprise never stops the scan.
        console.error(`[autogate] run ${run.runId} errored:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Best-effort webhook notifications, deduped so a run only reports each
   *  parked-status / terminal-state transition once across many poke()s. */
  private reportLifecycle(run: CourseRun): void {
    const { runId, status } = run;
    if (status.startsWith("awaiting-")) {
      const key = `${runId}:${status}`;
      if (!this.seenParked.has(key)) {
        this.seenParked.add(key);
        this.deps.emit?.("run.parked", runId, { status });
      }
    } else if (status === "approved" || status === "failed") {
      if (!this.seenTerminal.has(runId)) {
        this.seenTerminal.add(runId);
        this.deps.emit?.(status === "approved" ? "run.approved" : "run.failed", runId, {});
      }
    }
  }

  private async decideOne(run: CourseRun): Promise<void> {
    const gateId = run.status.slice("awaiting-".length) as GateId;
    if (!(GATES as readonly string[]).includes(gateId)) return; // not a real gate status — ignore
    // Reconcile is a true human gate (plan §6): autopilot halts here and never
    // auto-decides it — the run stays parked awaiting the operator's build work.
    if (gateId === "reconcile") return;

    const arts = this.deps.artifactsFor(run.runId);
    const priorChanges = this.deps.store.courseRunGates(run.runId).filter((g) => g.gateId === gateId && g.decision === "changes").length;
    const round = priorChanges + 1;
    const maxChanges = autogateMaxChanges();

    let verdict: GateVerdict & { forced?: boolean };
    if (priorChanges >= maxChanges) {
      // Budget exhausted (plan §3.1 P4 fix): stop asking, ship with reservations.
      verdict = {
        decision: "approved",
        notes: [],
        reservations: [`change budget exhausted (${priorChanges} rounds) — approved with reservations`],
        forced: true,
      };
    } else {
      try {
        verdict = await this.reviewGate(run, gateId, arts);
      } catch (err) {
        // The model never produced a valid verdict — leave the gate pending so
        // a human can still decide it; record the failure for visibility.
        this.writeVerdict(arts, gateId, { error: err instanceof Error ? err.message : String(err), at: new Date().toISOString(), round });
        return;
      }
    }

    this.writeVerdict(arts, gateId, { ...verdict, at: new Date().toISOString(), round });

    await this.deps.courseRuns.settle(); // never decide while the phase is mid-flight
    try {
      this.deps.courseRuns.decideGate(run.runId, gateId, verdict.decision, verdict.notes.length ? verdict.notes : null, "gate-reviewer");
    } catch (err) {
      // The gate disappeared between scan and decide (a human beat us to it, or
      // the run moved on already) — nothing left to do here.
      if (err instanceof RunStateError) return;
      throw err;
    }
    this.deps.emit?.("gate.auto-decided", run.runId, { gateId, decision: verdict.decision, forced: verdict.forced ?? false });

    if (gateId === "publish" && verdict.decision === "approved" && run.request.autoPublish) {
      try {
        this.deps.publishCourse(run.runId);
      } catch (err) {
        console.error(`[autogate] auto-publish failed for run ${run.runId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  private async reviewGate(run: CourseRun, gateId: GateId, arts: RunArtifacts): Promise<GateVerdict> {
    const bundle = this.buildBundle(run, gateId, arts);
    const prompt: RolePrompt = {
      system: GATE_REVIEWER_SYSTEM,
      task: `gate:${gateId}`,
      context: { gateId, request: requestView(run.request), artifacts: bundle.artifacts },
      user: `${bundle.text}\n\n${gateVerdictInstruction(gateId)}`,
    };
    const role: CourseGenRole = "gate-reviewer";
    return invokeValidatedJson(this.deps.invokerFor(run), role, prompt, validateGateVerdict, { maxAttempts: 3 });
  }

  private buildBundle(run: CourseRun, gateId: GateId, arts: RunArtifacts): { text: string; artifacts: Record<string, string> } {
    const artifacts: Record<string, string> = {};
    for (const path of GATE_ARTIFACTS[gateId]) {
      const raw = arts.read(path);
      if (raw !== null) artifacts[path] = capArtifact(raw);
    }
    const text = [
      `Gate: ${gateId}`,
      `Run: ${run.runId} (${run.request.technology})`,
      ``,
      `## Run request`,
      JSON.stringify(requestView(run.request), null, 2),
      ``,
      ...Object.entries(artifacts).flatMap(([path, content]) => [`## ${path}`, content, ``]),
    ].join("\n");
    return { text, artifacts };
  }

  private writeVerdict(arts: RunArtifacts, gateId: GateId, doc: Record<string, unknown>): void {
    // gateId rides inside the doc too — the UI's GateVerdicts card renders
    // parsed documents without re-deriving the id from the artifact path.
    arts.write(`gates/${gateId}.verdict.json`, JSON.stringify({ gateId, ...doc }, null, 2));
  }

}

export function createAutoGateArbiter(deps: AutoGateArbiterDeps): AutoGateArbiter {
  return new AutoGateArbiter(deps);
}
