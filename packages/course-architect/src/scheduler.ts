/**
 * CourseRunScheduler — drives runs through the phase/gate state machine.
 *
 * Responsibilities (plan Phase B):
 *   • Single active run (D7): at most one run executes a phase at a time; others
 *     wait in `queued`. Runs parked at a gate do not occupy the slot.
 *   • Gates (D4): after each phase the run parks awaiting a human decision;
 *     approve advances, changes re-runs the phase with the notes, reject archives.
 *   • Interrupt/resume (D8): a run caught mid-phase on construction (server boot)
 *     is marked `interrupted`; the operator resumes it and it re-enters the queue.
 *   • Bounded execution: a per-phase invocation cap and wall-clock cap stand in
 *     for budgets (D5) — correctness rails against loops, not cost accounting.
 *
 * Execution itself is an injected PhaseExecutor, so Phase B tests use a fake and
 * Phase C plugs in the real role pipeline. All mutations go through the store.
 */
import { randomBytes } from "node:crypto";
import {
  type CourseRun,
  type CourseRunRequest,
  type CourseRunStore,
  type GateDecision,
  type GateId,
  type GateNote,
  type Phase,
  type PhaseExecutor,
  GATE_OF_PHASE,
  NEXT_PHASE_AFTER_GATE,
  PHASE_OF_GATE,
  RunStateError,
  awaitingGate,
  isActive,
} from "./types.ts";

/** How many times one lesson may be bounced before it needs a human
 *  (rehearsal-phase §5). Overridable per run via `request.rehearsalBounces`. */
export const DEFAULT_REHEARSAL_BOUNCES = 2;

export interface SchedulerOptions {
  /** Injected clock — defaults to Date.now via new Date(); tests pass a stub. */
  now?: () => string;
  /** Deterministic id suffix for tests. */
  idSuffix?: () => string;
  /**
   * Wall-clock cap per phase execution (ms). Exceeding it interrupts the run.
   * A single number caps every phase; a record caps them individually, falling
   * back to `default`. Phases are not comparable: `rehearsing` drives a real
   * browser per lesson (tens of minutes each), so one cap that suits the model
   * phases would guarantee it is killed mid-course.
   */
  phaseTimeoutMs?: number | ({ default: number } & Partial<Record<Phase, number>>);
}

export class CourseRunScheduler {
  private readonly store: CourseRunStore;
  private readonly executor: PhaseExecutor;
  private readonly now: () => string;
  private readonly idSuffix: () => string;
  private readonly phaseTimeouts: { default: number } & Partial<Record<Phase, number>>;

  /** In-flight execution, tracked so tests can await settle() and pump() serializes. */
  private running: Promise<void> | null = null;

  constructor(store: CourseRunStore, executor: PhaseExecutor, opts: SchedulerOptions = {}) {
    this.store = store;
    this.executor = executor;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.idSuffix = opts.idSuffix ?? (() => randomBytes(3).toString("hex"));
    this.phaseTimeouts =
      typeof opts.phaseTimeoutMs === "number"
        ? { default: opts.phaseTimeoutMs }
        : (opts.phaseTimeoutMs ?? { default: 10 * 60 * 1000 });
    this.recoverInterrupted();
    this.pump();
  }

  /** Any run left mid-phase (a prior process died) becomes `interrupted` (D8). */
  private recoverInterrupted(): void {
    for (const run of this.store.listCourseRuns()) {
      if (isActive(run.status)) {
        const phase = run.status as Phase;
        this.patch(run, { status: "interrupted", pendingPhase: phase, lastError: "interrupted by restart" });
        this.emit(run.runId, "run.interrupted", { phase });
      }
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Create a run from a request. Starts framing when a slot is free, else queues. */
  create(request: CourseRunRequest): CourseRun {
    if (!request.technology || !request.technology.trim()) throw new RunStateError("technology is required");
    const at = this.now();
    const run: CourseRun = {
      runId: this.newRunId(request),
      status: "queued",
      request,
      pendingPhase: "framing",
      pendingChangeNotes: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    };
    this.store.createCourseRun(run);
    this.emit(run.runId, "run.queued", { pendingPhase: "framing" });
    this.pump();
    return this.store.getCourseRun(run.runId)!;
  }

  /** Record a gate decision and advance the run. Throws if the gate isn't pending. */
  decideGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    notes: GateNote[] | null,
    by: string | null,
    lessonIds?: string[] | null,
  ): CourseRun {
    const run = this.require(runId);
    if (run.status !== awaitingGate(gateId)) {
      throw new RunStateError(`gate "${gateId}" is not awaiting a decision for run ${runId} (status: ${run.status})`);
    }
    this.store.decideCourseRunGate(runId, gateId, decision, by, notes ?? null, this.now());
    this.emit(runId, "gate.decided", { gateId, decision, by: by ?? undefined, noteCount: notes?.length ?? 0 });

    if (decision === "rejected") {
      this.patch(run, { status: "archived", pendingPhase: null, pendingChangeNotes: null, pendingLessonScope: null, pendingChain: null });
    } else if (decision === "changes") {
      // A lesson-scoped `changes` at a POST-MATERIALIZE gate is a rehearsal
      // bounce (rehearsal-phase §5): the named lessons go back through
      // authoring, then get rebuilt and re-rehearsed, while the rest of the
      // course stays exactly where it is. Everything else keeps the old
      // behaviour — re-run the phase that produced this gate with the notes.
      const bounceLessons =
        gateId === "publish" || gateId === "rehearse"
          ? [...new Set((notes ?? []).map((n) => n.lessonId).filter((id): id is string => !!id))]
          : [];
      if (bounceLessons.length) {
        this.bounce(run, gateId, bounceLessons, notes ?? null);
      } else {
        const pendingPhase = PHASE_OF_GATE[gateId];
        this.patch(run, { status: "queued", pendingPhase, pendingChangeNotes: notes ?? null, pendingLessonScope: null, pendingChain: null });
        this.emit(runId, "run.queued", { pendingPhase, reason: "changes-requested" });
      }
    } else {
      const next = NEXT_PHASE_AFTER_GATE[gateId];
      if (next === null) {
        // publish approved — the course now exists as a draft (materialization
        // wrote it in Phase C). The run is done; Go-live is a separate action.
        this.patch(run, { status: "approved", pendingPhase: null, pendingChangeNotes: null });
        this.emit(runId, "run.approved", {});
      } else {
        // An approval of `package` or `rehearse` may carry a scope — "materialize
        // only these lessons" / "rehearse only these lessons" (rehearsal-phase
        // §1, §3). Any other gate ignores the parameter.
        const scope = (gateId === "package" || gateId === "rehearse") && lessonIds && lessonIds.length ? lessonIds : null;
        this.patch(run, { status: "queued", pendingPhase: next, pendingChangeNotes: null, pendingLessonScope: scope, pendingChain: null });
        this.emit(runId, "run.queued", { pendingPhase: next });
      }
    }
    this.pump();
    return this.store.getCourseRun(runId)!;
  }

  /**
   * A REHEARSAL BOUNCE (rehearsal-phase §5): send the named lessons back
   * through authoring → materializing → rehearsing as one chained unit, so the
   * operator's single "fix this lesson" decision doesn't ask them to re-approve
   * the package and rehearse gates it passes through on the way.
   *
   * Bounded per lesson. This is the only cycle in the pipeline that spends both
   * model tokens AND real browser time, so a lesson the loop cannot fix would
   * otherwise burn an unattended run's entire budget by itself. A lesson at its
   * cap is dropped from the bounce and reported; when every named lesson is
   * capped, nothing is queued and the gate is re-opened for a human to decide
   * differently (accept it as-is, waive it, or reject the run).
   */
  private bounce(run: CourseRun, gateId: GateId, lessons: string[], notes: GateNote[] | null): void {
    const cap = Math.max(1, run.request.rehearsalBounces ?? DEFAULT_REHEARSAL_BOUNCES);
    const priorBounces = new Map<string, number>();
    for (const ev of this.store.courseRunEvents(run.runId)) {
      if (ev.type !== "lesson.bounced") continue;
      const id = (ev.payload as { lessonId?: string } | undefined)?.lessonId;
      if (id) priorBounces.set(id, (priorBounces.get(id) ?? 0) + 1);
    }

    const eligible: string[] = [];
    for (const lessonId of lessons) {
      const used = priorBounces.get(lessonId) ?? 0;
      if (used >= cap) {
        this.emit(run.runId, "lesson.bounce-capped", { lessonId, bounces: used, cap });
        continue;
      }
      eligible.push(lessonId);
      this.emit(run.runId, "lesson.bounced", { lessonId, bounce: used + 1, cap, fromGate: gateId });
    }

    if (!eligible.length) {
      // Every named lesson is spent. Re-open the gate rather than queueing a
      // re-author we already know will not converge — the decision is a
      // human's now, and leaving no pending row would strand the run.
      this.requestGate(run.runId, gateId);
      this.emit(run.runId, "rehearsal.bounce-cap-reached", { lessons, cap });
      return;
    }

    this.patch(run, {
      status: "queued",
      pendingPhase: "authoring",
      pendingChangeNotes: notes,
      pendingLessonScope: eligible,
      pendingChain: ["materializing", "rehearsing"],
    });
    this.emit(run.runId, "run.queued", { pendingPhase: "authoring", reason: "rehearsal-bounce", lessons: eligible });
  }

  /**
   * Re-run an EARLIER phase from the gate the run is currently parked at — a
   * deliberate BACKWARD transition the normal "changes" path can't express
   * (that only re-runs `PHASE_OF_GATE[gate]`). Used by redesign at the reconcile
   * gate: reopen `designing` wholesale under a free-text instruction so the
   * blueprint no longer needs a capability we've decided not to build
   * (gap-reconciliation-pause §3). Records a `changes` decision on the parked
   * gate so no stale pending row is left, then queues `phase` with the notes.
   */
  rerunPhaseFromGate(runId: string, gateId: GateId, phase: Phase, notes: GateNote[] | null, by: string | null): CourseRun {
    const run = this.require(runId);
    if (run.status !== awaitingGate(gateId)) {
      throw new RunStateError(`gate "${gateId}" is not awaiting a decision for run ${runId} (status: ${run.status})`);
    }
    this.store.decideCourseRunGate(runId, gateId, "changes", by, notes ?? null, this.now());
    this.emit(runId, "gate.decided", { gateId, decision: "changes", by: by ?? undefined, noteCount: notes?.length ?? 0 });
    this.patch(run, { status: "queued", pendingPhase: phase, pendingChangeNotes: notes ?? null });
    this.emit(runId, "run.queued", { pendingPhase: phase, reason: "phase-rerun" });
    this.pump();
    return this.store.getCourseRun(runId)!;
  }

  /** Resume an interrupted run (D8) — it re-enters the queue at its dead phase. */
  resume(runId: string): CourseRun {
    const run = this.require(runId);
    if (run.status !== "interrupted") throw new RunStateError(`run ${runId} is not interrupted (status: ${run.status})`);
    if (!run.pendingPhase) throw new RunStateError(`interrupted run ${runId} has no phase to resume`);
    this.patch(run, { status: "queued", lastError: null });
    this.emit(runId, "run.resumed", { pendingPhase: run.pendingPhase });
    this.pump();
    return this.store.getCourseRun(runId)!;
  }

  /** Abandon a run. Allowed unless it's mid-phase (let it park or interrupt first). */
  archive(runId: string): CourseRun {
    const run = this.require(runId);
    if (isActive(run.status)) throw new RunStateError(`run ${runId} is executing (${run.status}); cannot archive mid-phase`);
    this.patch(run, { status: "archived", pendingPhase: null, pendingChangeNotes: null });
    this.emit(runId, "run.archived", {});
    this.pump();
    return this.store.getCourseRun(runId)!;
  }

  /** Test/shutdown helper: resolve when no phase execution is in flight. */
  async settle(): Promise<void> {
    while (this.running) await this.running;
  }

  // ── scheduling core ─────────────────────────────────────────────────────────

  /** If the slot is free, pick the oldest queued run and execute its pending phase. */
  private pump(): void {
    if (this.running) return; // slot occupied
    const next = this.store
      .listCourseRuns()
      .filter((r) => r.status === "queued" && r.pendingPhase)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return;
    this.running = this.runPhase(next).finally(() => {
      this.running = null;
      this.pump(); // a slot freed — promote the next queued run
    });
  }

  private async runPhase(run: CourseRun): Promise<void> {
    const phase = run.pendingPhase!;
    const changeNotes = run.pendingChangeNotes ?? null;
    this.patch(run, { status: phase, pendingChangeNotes: null });
    this.emit(run.runId, "phase.started", { phase, reRun: changeNotes !== null });

    try {
      await this.withTimeout(
        this.executor({
          run: this.store.getCourseRun(run.runId)!,
          phase,
          changeNotes,
          emit: (type, payload) => this.emit(run.runId, type, payload),
          events: () => this.store.courseRunEvents(run.runId),
        }),
        phase,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Preserve pendingPhase so the operator can resume exactly here (D8).
      this.patch(run, { status: "interrupted", pendingPhase: phase, lastError: message });
      this.emit(run.runId, "error", { phase, message });
      this.emit(run.runId, "run.interrupted", { phase });
      return;
    }

    this.emit(run.runId, "phase.completed", { phase });

    // Mid-chain (a rehearsal bounce): run the next phase instead of parking at
    // this one's gate. The lesson scope rides along — every phase in the chain
    // is scoped to the same lessons.
    const current = this.store.getCourseRun(run.runId)!;
    const [nextInChain, ...rest] = current.pendingChain ?? [];
    if (nextInChain) {
      this.patch(current, { status: "queued", pendingPhase: nextInChain, pendingChain: rest.length ? rest : null });
      this.emit(run.runId, "run.queued", { pendingPhase: nextInChain, reason: "bounce-chain" });
      return;
    }

    // Chain done (or never started): the scope has been consumed by the phases
    // that needed it, so clear it before the run parks — a stale scope would
    // silently narrow the NEXT phase the operator asks for.
    if (current.pendingLessonScope) this.patch(current, { pendingLessonScope: null });
    this.requestGate(run.runId, GATE_OF_PHASE[phase]);
  }

  private requestGate(runId: string, gateId: GateId): void {
    this.store.requestCourseRunGate(runId, gateId, this.now());
    const run = this.store.getCourseRun(runId)!;
    this.patch(run, { status: awaitingGate(gateId), pendingPhase: null });
    this.emit(runId, "gate.requested", { gateId });
  }

  private async withTimeout(work: Promise<void>, phase: Phase): Promise<void> {
    const cap = this.phaseTimeouts[phase] ?? this.phaseTimeouts.default;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`phase "${phase}" exceeded ${cap}ms`)), cap);
      // Don't let the cap timer alone keep the process alive (a hung executor
      // from a crashed prior run shouldn't pin the event loop for 10 minutes).
      timer.unref?.();
    });
    try {
      await Promise.race([work, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private require(runId: string): CourseRun {
    const run = this.store.getCourseRun(runId);
    if (!run) throw new RunStateError(`run not found: ${runId}`);
    return run;
  }

  private patch(run: CourseRun, fields: Partial<CourseRun>): void {
    const updated = { ...run, ...fields, updatedAt: this.now() };
    this.store.updateCourseRun(updated);
    Object.assign(run, updated); // keep the caller's reference current
  }

  private emit(runId: string, type: string, payload?: Record<string, unknown>): void {
    this.store.appendCourseRunEvent({ runId, at: this.now(), type, payload });
  }

  private newRunId(request: CourseRunRequest): string {
    const slug = request.technology
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "course";
    return `cg-${slug}-${this.idSuffix()}`;
  }
}
