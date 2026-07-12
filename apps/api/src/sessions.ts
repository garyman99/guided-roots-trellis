/**
 * SessionManager — one live object per learner session, wiring together:
 * driver (lab env) → instrumentation (events) → store (append-only) →
 * reducer (state) → interventions (rules) → instructor (words).
 *
 * The Session also owns the TERMINAL HUB: exactly one pty per session,
 * fan-out to any number of WebSocket subscribers, a scrollback buffer so a
 * refreshed tab replays recent history, and automatic shell respawn so a
 * reset (or a stray `exit`) feels like a scene change, not a crash.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { newLearnerId, newSessionId, newSessionToken } from "../../../packages/shared/src/ids.ts";
import { sanitizeUntrusted } from "../../../packages/shared/src/sanitize.ts";
import { now, type SessionEvent } from "../../../packages/session-events/src/events.ts";
import { reduce, type LearningSessionState } from "../../../packages/session-events/src/reducer.ts";
import {
  defaultInterventionConfig,
  evaluateInterventions,
  type InterventionTrigger,
} from "../../../packages/session-events/src/interventions.ts";
import type { LabDriver, LabHandle, TerminalAttachment } from "../../../packages/lab-runtime/src/driver.ts";
import { LocalProcessDriver } from "../../../packages/lab-runtime/src/localDriver.ts";
import { DockerDriver } from "../../../packages/lab-runtime/src/dockerDriver.ts";
import { SessionInstrumentation } from "../../../packages/lab-runtime/src/instrumentation.ts";
import {
  evaluateCheckpoint,
  verifyScriptPathFor,
  type CheckpointResult,
  type CheckpointSpec,
} from "../../../packages/lab-runtime/src/evaluator.ts";
import {
  buildInstructorContext,
  choosePolicy,
  assembleProfileFacets,
  renderReflectionNarrative,
  providerFromEnv,
  PROMPT_VERSION,
  type AssembledProfile,
  type HintRequest,
  type HintResponse,
  type InstructorProvider,
} from "../../../packages/instructor/src/index.ts";
import { loadBlueprint, resolveVariant, chooseTier, type LabVariant } from "../../../packages/lab-runtime/src/variants.ts";
import { loadCurriculum, type Curriculum } from "../../../packages/learner-model/src/curriculum.ts";
import { extractDigest, digestToEvidence } from "../../../packages/learner-model/src/evidence.ts";
import { reduceProfile, type LearnerProfile } from "../../../packages/learner-model/src/profileReducer.ts";
import { corroborateHypotheses } from "../../../packages/learner-model/src/hypotheses.ts";
import { buildReflection } from "../../../packages/learner-model/src/reflection.ts";
import type { EventStore, StoredReflection } from "./store.ts";
import { WorkspaceRuntime, type WorkspaceSpec } from "./workspace.ts";

export interface LabTask {
  id: string;
  text: string;
  /** How instrumentation recognizes this task as done (see taskStatuses). */
  auto?:
    | "any-command"
    | "diff-viewed"
    | "tests-run"
    | "file-edited"
    | "tests-green"
    // workspace labs (simulated applications):
    | "artifact-opened"
    | "ai-consulted"
    | "context-clean"
    | "draft-edited"
    | "reply-submitted";
}

export interface LabManifest {
  id: string;
  title: string;
  objective: string;
  scenario: string;
  /** The simulated agent's confident self-description of its change. */
  agentMessage?: string;
  /**
   * Conversational voice for chat-first surfaces: informal, direct-address
   * messages the guide bot says on arrival — never "you are a…" role-play
   * framing. Optional; chat UIs fall back to title/objective phrasing.
   *
   * goalPrompt: goal-first onboarding — the ONE opening message asking what
   * the learner wants to accomplish; scenario context arrives after they
   * answer. faq: authored answers to predictable clarifying questions.
   */
  chat?: {
    botName?: string;
    welcome?: string[];
    goalPrompt?: string;
    faq?: Array<{ match: string; answer: string }>;
  };
  tasks: LabTask[];
  checkpoint: CheckpointSpec;
  instructorNotes?: string;
  /** The agent lane: authored beats of what the simulated agent "did",
   * emitted as agent.action events at session start (offsets are negative —
   * the agent worked before the learner arrived). */
  agentTimeline?: Array<{ atOffsetMs: number; action: string; detail: string }>;
  /**
   * Workspace labs: simulated applications instead of a terminal + repo.
   * When present, the session has NO lab environment (no container, no pty,
   * no fs) — the learner works entirely in seeded, instrumented apps.
   */
  workspace?: WorkspaceSpec;
  /**
   * Registered curriculum concept IDs this lab teaches/exercises. Blueprint
   * labs derive these from blueprint.json; non-blueprint labs (workspace)
   * declare them here so profile evidence and context assembly work.
   */
  concepts?: string[];
}

export interface InstructorMessage {
  id: number;
  role: "learner" | "instructor";
  text: string;
  level?: number;
  at: string;
}

/** Pure + tested: which tasks does the measured state show as done? */
export function taskStatuses(tasks: LabTask[], state: LearningSessionState): Array<LabTask & { done: boolean }> {
  const ws = state.workspace;
  const done = (auto?: LabTask["auto"]): boolean => {
    switch (auto) {
      case "any-command":
        return state.recentCommands.length > 0;
      case "diff-viewed":
        return state.viewedGitDiff;
      case "tests-run":
        return state.testsRun > 0;
      case "file-edited":
        return state.filesChanged.length > 0;
      case "tests-green":
        return state.testsRun > 0 && state.latestTestResult?.failed === 0 && !state.changedSinceLastTestRun;
      case "artifact-opened":
        return ws.openedArtifacts.length > 0;
      case "ai-consulted":
        return ws.aiDraftsGenerated > 0;
      case "context-clean":
        return ws.aiContextShares > 0 && ws.restrictedInLatestShare.length === 0 && ws.requiredFactsInLatestShare.length > 0;
      case "draft-edited":
        return ws.draftRevisions > 0 || (!!ws.submitted && ws.submitted.similarityToGenerated === null);
      case "reply-submitted":
        return !!ws.submitted;
      default:
        return false;
    }
  };
  return tasks.map((t) => ({ ...t, done: done(t.auto) }));
}

const SCROLLBACK_CAP = 64 * 1024;
const RESPAWN_MIN_INTERVAL_MS = 2_000;
const INTERVENTION_COOLDOWN_MS = 90_000;

export class Session {
  readonly id = newSessionId();
  readonly token = newSessionToken();
  readonly learnerId: string;
  readonly createdAt = now();
  readonly variant: LabVariant | null;
  readonly lessonConcepts: string[];
  private readonly learners: LearnerService;

  readonly manifest: LabManifest;
  readonly labDir: string;
  readonly driverKind: "local" | "docker";
  private readonly store: EventStore;
  private readonly instructor: InstructorProvider;

  /** The lab environment. NULL for workspace labs (simulated apps only). */
  handle: LabHandle | null = null;
  instrumentation: SessionInstrumentation | null = null;
  /** Simulated applications. NULL for terminal labs. */
  workspace: WorkspaceRuntime | null = null;
  transcript: InstructorMessage[] = [];
  pendingIntervention: (InterventionTrigger & { hint: HintResponse }) | null = null;

  // ── terminal hub state ──
  private attachment: TerminalAttachment | null = null;
  private subscribers = new Set<(chunk: Buffer) => void>();
  private scrollbackBuf = "";
  private lastSize: { cols: number; rows: number } | null = null;
  private lastSpawnAt = 0;
  private resetting = false;
  private destroyed = false;

  /** Interventions currently "used up": type → firedAt ms. Re-armed on resolution. */
  private firedInterventions = new Map<string, number>();
  /** Per-type cooldown clock so a re-armed trigger can't nag immediately. */
  private lastFiredByType = new Map<string, number>();
  private msgSeq = 0;

  constructor(
    manifest: LabManifest,
    labDir: string,
    driverKind: "local" | "docker",
    store: EventStore,
    instructor: InstructorProvider,
    learnerId: string,
    learners: LearnerService,
    variant: LabVariant | null,
    lessonConcepts: string[],
  ) {
    this.manifest = manifest;
    this.labDir = labDir;
    this.driverKind = driverKind;
    this.store = store;
    this.instructor = instructor;
    this.learnerId = learnerId;
    this.learners = learners;
    this.variant = variant;
    this.lessonConcepts = lessonConcepts;
  }

  emit(event: SessionEvent): void {
    this.store.appendEvent(this.id, event);
  }

  state(): LearningSessionState {
    return reduce(this.store.eventsFor(this.id));
  }

  events(): SessionEvent[] {
    return this.store.eventsFor(this.id);
  }

  appendSelfAssessment(confidence: number, actualPassed: boolean): void {
    this.learners.appendSelfAssessment(this.learnerId, confidence, actualPassed);
  }

  verifyToken(candidate: string | undefined | null): boolean {
    if (!candidate) return false;
    const a = Buffer.from(this.token);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ── terminal hub ────────────────────────────────────────────────────────

  get scrollback(): string {
    return this.scrollbackBuf;
  }

  private broadcast(chunk: Buffer): void {
    this.scrollbackBuf += chunk.toString("utf8");
    if (this.scrollbackBuf.length > SCROLLBACK_CAP) {
      this.scrollbackBuf = this.scrollbackBuf.slice(-SCROLLBACK_CAP);
    }
    this.instrumentation?.onTerminalOutput(chunk);
    for (const cb of this.subscribers) cb(chunk);
  }

  private banner(text: string): void {
    this.broadcast(Buffer.from(`\r\n\x1b[33m— ${text} —\x1b[0m\r\n`));
  }

  ensureTerminal(): void {
    if (this.attachment || this.destroyed || !this.handle) return;
    this.lastSpawnAt = Date.now();
    const term = this.handle.attachTerminal();
    this.attachment = term;
    term.onData((chunk) => this.broadcast(chunk));
    term.onExit(() => {
      this.attachment = null;
      if (this.destroyed || this.resetting) return; // reset flow reattaches itself
      // Learner typed `exit` (or the shell died): respawn, rate-limited.
      const wait = Math.max(0, RESPAWN_MIN_INTERVAL_MS - (Date.now() - this.lastSpawnAt));
      setTimeout(() => {
        if (this.destroyed || this.resetting) return;
        this.banner("the shell exited — starting a fresh one (your files are untouched)");
        this.ensureTerminal();
        this.applySize();
      }, wait);
    });
  }

  subscribe(cb: (chunk: Buffer) => void): () => void {
    this.ensureTerminal();
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  writeTerminal(data: string): void {
    this.ensureTerminal();
    this.attachment?.write(data);
  }

  /**
   * Resize the pty. Sent as a space-prefixed stty line: HISTCONTROL=ignorespace
   * keeps it out of history, so command capture never records it as a learner
   * action. (The echo briefly appears in the terminal — a documented trade-off
   * of the zero-dependency pty; the UI debounces resizes to settle events.)
   */
  resizeTerminal(cols: number, rows: number): void {
    const c = Math.max(20, Math.min(500, Math.floor(cols)));
    const r = Math.max(5, Math.min(200, Math.floor(rows)));
    if (this.lastSize?.cols === c && this.lastSize?.rows === r) return;
    this.lastSize = { cols: c, rows: r };
    this.applySize();
  }

  private applySize(): void {
    if (!this.lastSize || !this.attachment) return;
    this.attachment.write(` stty cols ${this.lastSize.cols} rows ${this.lastSize.rows}\n`);
  }

  // ── workspace filesystem (for GUI editors) ──────────────────────────────
  //
  // The desktop experience's Code Studio reads and saves workspace files.
  // Everything goes through the LabHandle (docker exec / lab process) — the
  // SAME trust boundary as the terminal; the API host never touches lab
  // files directly. Programs are node -e one-liners (node exists in every
  // lab env) with base64 env args, so no shell quoting can be smuggled.

  private async fsExec(program: string, env: Record<string, string>): Promise<string> {
    if (!this.handle) throw new Error("session has no lab environment");
    const res = await this.handle.exec(["node", "-e", program], { env, timeoutMs: 15_000 });
    if (res.exitCode !== 0) throw new Error(res.stderr.slice(0, 300) || `fs op exited ${res.exitCode}`);
    return res.stdout;
  }

  /** Relative workspace paths only; reject traversal before anything runs. */
  private static validFsPath(path: string): boolean {
    return (
      path.length > 0 &&
      path.length < 512 &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.includes("..") &&
      !/^[a-zA-Z]:/.test(path)
    );
  }

  async listWorkspaceFiles(): Promise<Array<{ path: string; dir: boolean }>> {
    const program =
      'const fs=require("fs"),p=require("path");const skip=new Set([".git","node_modules","test-results","playwright-report"]);' +
      "const out=[];function walk(d,rel){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(skip.has(e.name))continue;" +
      'const r=rel?rel+"/"+e.name:e.name;if(e.isDirectory()){out.push({path:r,dir:true});if(out.length<500)walk(p.join(d,e.name),r)}' +
      'else out.push({path:r,dir:false});if(out.length>=500)return}}walk(process.cwd(),"");' +
      "console.log(JSON.stringify(out));";
    return JSON.parse(await this.fsExec(program, {})) as Array<{ path: string; dir: boolean }>;
  }

  async readWorkspaceFile(path: string): Promise<{ path: string; content: string; truncated: boolean }> {
    if (!Session.validFsPath(path)) throw new Error("invalid path");
    const program =
      'const fs=require("fs"),p=require("path");const rel=Buffer.from(process.env.TRELLIS_FS_PATH,"base64").toString();' +
      "const abs=p.resolve(process.cwd(),rel);if(!abs.startsWith(process.cwd()+p.sep))throw new Error(\"outside workspace\");" +
      "const raw=fs.readFileSync(abs,\"utf8\");const cap=200*1024;" +
      "console.log(JSON.stringify({content:raw.slice(0,cap),truncated:raw.length>cap}));";
    const parsed = JSON.parse(await this.fsExec(program, { TRELLIS_FS_PATH: Buffer.from(path).toString("base64") }));
    return { path, content: parsed.content, truncated: parsed.truncated };
  }

  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (!Session.validFsPath(path)) throw new Error("invalid path");
    if (content.length > 500 * 1024) throw new Error("file too large");
    const program =
      'const fs=require("fs"),p=require("path");const rel=Buffer.from(process.env.TRELLIS_FS_PATH,"base64").toString();' +
      'const body=Buffer.from(process.env.TRELLIS_FS_BODY,"base64").toString();' +
      "const abs=p.resolve(process.cwd(),rel);if(!abs.startsWith(process.cwd()+p.sep))throw new Error(\"outside workspace\");" +
      "fs.mkdirSync(p.dirname(abs),{recursive:true});fs.writeFileSync(abs,body);console.log(\"ok\");";
    await this.fsExec(program, {
      TRELLIS_FS_PATH: Buffer.from(path).toString("base64"),
      TRELLIS_FS_BODY: Buffer.from(content).toString("base64"),
    });
    // MEASURED, not inferred: the platform itself performed this write, so the
    // event is truthful — GUI saves reach the reducer exactly like terminal
    // edits do (those are caught by the git snapshot after the next command).
    this.emit({ type: "file.changed", path, timestamp: now() });
  }

  // ── instructor ──────────────────────────────────────────────────────────

  hintRequest(reason: HintRequest["reason"], state = this.state(), screen?: HintRequest["screen"]): HintRequest {
    return {
      state,
      lab: {
        id: this.manifest.id,
        title: this.manifest.title,
        objective: this.manifest.objective,
        // With measured done-ness: providers may point at the actual next step.
        tasks: taskStatuses(this.manifest.tasks, state),
        instructorNotes: this.manifest.instructorNotes,
        surface: this.manifest.workspace ? "workspace" : "terminal",
        // Diff-first coaching only fits labs built around an agent's change.
        agentReview: Boolean(this.manifest.agentMessage),
        faq: this.manifest.chat?.faq,
      },
      reason,
      screen,
      hintLevel: choosePolicy(state, reason).level,
      promptVersion: PROMPT_VERSION,
    };
  }

  /**
   * Normalize a client-supplied screen report: UNTRUSTED input, so sanitize
   * every string, cap list sizes, and coerce shapes. Returns undefined when
   * nothing usable was reported.
   */
  private static normalizeScreen(raw: unknown): HintRequest["screen"] {
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    const str = (v: unknown, cap: number) =>
      typeof v === "string" && v.trim() ? sanitizeUntrusted(v, cap) : null;
    const windows = Array.isArray(r.openWindows)
      ? r.openWindows.flatMap((w) => (typeof w === "string" && w.trim() ? [sanitizeUntrusted(w, 60)] : [])).slice(0, 8)
      : [];
    const screen = {
      activeApp: str(r.activeApp, 60),
      openWindows: windows,
      editorFile: str(r.editorFile, 200),
      editorDirty: r.editorDirty === true,
    };
    if (!screen.activeApp && windows.length === 0 && !screen.editorFile) return undefined;
    return screen;
  }

  /** Deterministic profile-facet selection for this lesson (may be empty). */
  assembledProfile(): AssembledProfile | null {
    try {
      const profile = this.learners.profileFor(this.learnerId);
      return assembleProfileFacets(profile, this.lessonConcepts, this.learners.curriculum);
    } catch {
      return null; // cold start / storage hiccup degrades to session-only context
    }
  }

  async ask(text: string, stuck: boolean, rawScreen?: unknown, opts?: { goal?: boolean }): Promise<InstructorMessage> {
    if (opts?.goal) {
      this.emit({ type: "learner.goal.stated", text: text.slice(0, 1000), timestamp: now() });
    } else {
      this.emit({ type: "learner.question", text: text.slice(0, 2000), stuck, timestamp: now() });
    }
    // Record what the client SAYS was on screen when they asked — provenance
    // for "what did the instructor see", never an input to profile truth.
    const screen = Session.normalizeScreen(rawScreen);
    if (screen) {
      this.emit({
        type: "ui.state.reported",
        activeApp: screen.activeApp,
        openWindows: screen.openWindows,
        editorFile: screen.editorFile,
        editorDirty: screen.editorDirty,
        timestamp: now(),
      });
    }
    this.transcript.push({ id: ++this.msgSeq, role: "learner", text, at: now() });
    const req = this.hintRequest(
      opts?.goal ? { kind: "goal", text } : { kind: "question", text, stuck },
      this.state(),
      screen,
    );
    const assembled = this.assembledProfile();
    const hint = await this.instructor.generateHint(req, buildInstructorContext(req, assembled ?? undefined));
    this.emit({ type: "instructor.hint", level: hint.level, strategy: hint.strategy, contextManifest: assembled?.manifest ?? null, timestamp: now() });
    const msg: InstructorMessage = { id: ++this.msgSeq, role: "instructor", text: hint.message, level: hint.level, at: now() };
    this.transcript.push(msg);
    return msg;
  }

  /** Deterministic rules; runs on the instrumentation cadence. */
  async maybeIntervene(): Promise<void> {
    if (this.pendingIntervention || this.destroyed) return;
    const state = this.state();
    const triggers = evaluateInterventions(state, defaultInterventionConfig);
    const active = new Set(triggers.map((t) => t.type));

    // RE-ARM: a fired trigger whose condition has resolved may fire again
    // later (tests_not_run → learner runs tests → edits again). The per-type
    // cooldown below stops quick-succession nagging.
    for (const type of [...this.firedInterventions.keys()]) {
      if (!active.has(type)) this.firedInterventions.delete(type);
    }

    const nowMs = Date.now();
    const fresh = triggers.find((t) => {
      if (this.firedInterventions.has(t.type)) return false; // still unresolved
      const lastFired = this.lastFiredByType.get(t.type);
      return lastFired === undefined || nowMs - lastFired >= INTERVENTION_COOLDOWN_MS;
    });
    if (!fresh) return;

    this.firedInterventions.set(fresh.type, nowMs);
    this.lastFiredByType.set(fresh.type, nowMs);
    this.emit({
      type: "intervention.proposed",
      triggerType: fresh.type,
      suggestedHintLevel: fresh.suggestedHintLevel,
      timestamp: now(),
    });
    const req = this.hintRequest({ kind: "intervention", trigger: fresh }, state);
    const assembled = this.assembledProfile();
    const hint = await this.instructor.generateHint(req, buildInstructorContext(req, assembled ?? undefined));
    this.emit({ type: "instructor.hint", level: hint.level, strategy: hint.strategy, contextManifest: assembled?.manifest ?? null, timestamp: now() });
    // Non-blocking: parked until the UI polls it; never interrupts typing.
    this.pendingIntervention = { ...fresh, hint };
  }

  takePendingIntervention() {
    const p = this.pendingIntervention;
    if (p) {
      this.transcript.push({ id: ++this.msgSeq, role: "instructor", text: p.hint.message, level: p.hint.level, at: now() });
    }
    this.pendingIntervention = null;
    return p;
  }

  // ── checkpoint / lifecycle ──────────────────────────────────────────────

  async evaluateCheckpoint(): Promise<CheckpointResult> {
    const result = await evaluateCheckpoint(
      this.manifest.checkpoint,
      this.state(),
      this.handle,
      verifyScriptPathFor(this.driverKind, this.labDir),
      this.manifest.workspace
        ? { meaningfulEditMaxSimilarity: this.manifest.workspace.policy.meaningfulEditMaxSimilarity }
        : undefined,
    );
    this.emit({
      type: "checkpoint.evaluated",
      checkpointId: result.checkpointId,
      passed: result.passed,
      incomplete: result.incomplete,
      timestamp: now(),
    });
    if (result.passed && !this.state().completedCheckpoints.includes(result.checkpointId)) {
      this.emit({ type: "checkpoint.completed", checkpointId: result.checkpointId, timestamp: now() });
      // Lab completion is the ONE moment session truth enters the learner's
      // long-term record: digest → evidence → corroboration → reflection.
      // Pipeline failure must never break the learner's checkpoint result.
      try {
        this.learners.onLabCompleted(this);
      } catch (err) {
        console.error(`[learner-model] completion pipeline failed for ${this.id}:`, err);
      }
    }
    return result;
  }

  latestReflection(): StoredReflection | null {
    return this.learners.reflectionFor(this.id);
  }

  async reset(): Promise<void> {
    if (!this.handle) {
      // Workspace lab: reset restores the seeded scene — the event is the
      // boundary (the reducer clears workspace facts); the runtime clears
      // the content. Learner questions/hints survive, exactly like terminal labs.
      this.workspace?.reset();
      this.firedInterventions.clear();
      this.pendingIntervention = null;
      this.emit({ type: "session.reset", timestamp: now() });
      return;
    }
    this.resetting = true;
    try {
      this.attachment = null; // handle.reset() kills the pty
      await this.handle.reset();
      await this.instrumentation?.onLabReset();
      this.firedInterventions.clear();
      this.pendingIntervention = null;
      this.emit({ type: "session.reset", timestamp: now() });
      // Scene change: fresh scrollback, clear banner, live shell again.
      this.scrollbackBuf = "";
      this.banner("workspace reset — the agent's change is back, your edits are gone");
    } finally {
      this.resetting = false;
    }
    this.ensureTerminal();
    this.applySize();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.instrumentation?.stop();
    this.subscribers.clear();
    await this.handle?.destroy();
  }

  contextPreview(): { system: string; user: string } {
    const req = this.hintRequest({ kind: "question", text: "(preview — what would the instructor see right now?)", stuck: false });
    const ctx = buildInstructorContext(req);
    return { system: ctx.system, user: ctx.user };
  }
}

/**
 * LearnerService (kernel edge): everything that turns session truth into
 * long-term learner knowledge. All deterministic; the only prose it stores
 * (the reflection narrative) is rendered from the deterministic struct and
 * is regenerable.
 */
export class LearnerService {
  private readonly store: EventStore;
  readonly curriculum: Curriculum;

  constructor(store: EventStore, curriculum: Curriculum) {
    this.store = store;
    this.curriculum = curriculum;
  }

  profileFor(learnerId: string): LearnerProfile {
    return reduceProfile(learnerId, this.store.evidenceFor(learnerId), this.curriculum);
  }

  reflectionFor(sessionId: string): StoredReflection | null {
    // Reflections keyed by session; scan is fine at POC scale.
    for (const learnerId of this.store.listLearners()) {
      const hit = this.store.reflectionsFor(learnerId).find((r) => r.sessionId === sessionId);
      if (hit) return hit;
    }
    return this.anonReflections.get(sessionId) ?? null;
  }
  /** Reflections for learners created outside the store (anonymous e2e paths). */
  private anonReflections = new Map<string, StoredReflection>();

  appendSelfAssessment(learnerId: string, confidence: number, actualPassed: boolean): void {
    this.store.appendEvidence(learnerId, {
      type: "learner.assertion",
      kind: "self-assessment",
      confidence,
      actualPassed,
      timestamp: now(),
    });
  }

  recentTiersFor(learnerId: string, labId: string): number[] {
    const tiers: number[] = [];
    for (const ev of this.store.evidenceFor(learnerId)) {
      if (ev.type !== "session.digest" || ev.digest.labId !== labId) continue;
      const m = /^tier(\d+):/.exec(ev.digest.variantId ?? "");
      if (m) tiers.push(Number(m[1]));
    }
    return tiers;
  }

  onLabCompleted(session: Session): void {
    const digest = extractDigest(this.store.eventsFor(session.id), {
      sessionId: session.id,
      labId: session.manifest.id,
      learnerId: session.learnerId,
    });

    const before = this.profileFor(session.learnerId);

    for (const ev of digestToEvidence(digest, this.curriculum.concepts)) {
      this.store.appendEvidence(session.learnerId, ev);
    }
    // Deterministic corroboration pass over the whole record, including the
    // fresh digest: quarantined hypotheses may be confirmed or expired now.
    for (const ev of corroborateHypotheses(this.store.evidenceFor(session.learnerId))) {
      this.store.appendEvidence(session.learnerId, ev);
    }

    const after = this.profileFor(session.learnerId);
    const reflection = buildReflection(digest, before, after);
    const stored: StoredReflection = {
      sessionId: session.id,
      learnerId: session.learnerId,
      labId: session.manifest.id,
      reflection,
      narrative: renderReflectionNarrative(reflection),
      createdAt: now(),
    };
    if (this.store.learnerMeta(session.learnerId)) this.store.saveReflection(stored);
    else this.anonReflections.set(session.id, stored);
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private driver: LabDriver;
  private instructor = providerFromEnv();
  private readonly store: EventStore;
  private readonly labsRoot: string;
  readonly driverKind: "local" | "docker";
  readonly learners: LearnerService;

  constructor(store: EventStore, labsRoot: string, driverKind?: "local" | "docker") {
    this.store = store;
    this.labsRoot = labsRoot;
    this.driverKind = driverKind ?? ((process.env.LAB_DRIVER as "local" | "docker") ?? "local");
    // Container resource limits are env-tunable: browser labs (Playwright)
    // need more than the conservative defaults. Unset env keeps the defaults.
    this.driver = this.driverKind === "docker"
      ? new DockerDriver({
          cpus: process.env.LAB_DOCKER_CPUS,
          memory: process.env.LAB_DOCKER_MEMORY,
          pidsLimit: process.env.LAB_DOCKER_PIDS ? Number(process.env.LAB_DOCKER_PIDS) : undefined,
        })
      : new LocalProcessDriver();
    this.learners = new LearnerService(store, loadCurriculum(join(labsRoot, "..", "curriculum", "concepts.json")));
  }

  loadManifest(labId: string): LabManifest {
    if (!/^[a-z0-9-]+$/.test(labId)) throw new Error("invalid lab id");
    const raw = readFileSync(join(this.labsRoot, labId, "lab.json"), "utf8");
    return JSON.parse(raw) as LabManifest;
  }

  async createSession(labId: string, consentAnalytics: boolean, learnerId?: string): Promise<Session> {
    const manifest = this.loadManifest(labId);
    const labDir = join(this.labsRoot, labId);
    const learner = learnerId ?? newLearnerId();

    // ── Adaptive labs: deterministic variant selection with hysteresis ──
    const blueprint = loadBlueprint(labDir);
    let variant: LabVariant | null = null;
    let lessonConcepts: string[] = manifest.concepts ?? [];
    if (blueprint) {
      lessonConcepts = [...new Set([...blueprint.teaches, ...blueprint.exercises])];
      const profile = this.learners.profileFor(learner);
      const status = new Map(profile.skills.map((s) => [s.conceptId, s.status]));
      const exercisedMastered =
        blueprint.exercises.length > 0 && blueprint.exercises.every((c) => status.get(c) === "mastered");
      const tier = chooseTier(exercisedMastered, this.learners.recentTiersFor(learner, labId));
      variant = resolveVariant(blueprint, tier);
    }

    const session = new Session(
      manifest, labDir, this.driverKind, this.store, this.instructor,
      learner, this.learners, variant, lessonConcepts,
    );
    if (!manifest.workspace) {
      session.handle = await this.driver.create({ labDir, labId, variant: variant ? { defect: variant.defect } : undefined }, session.id);
    }
    this.store.createSession({
      sessionId: session.id,
      learnerId: session.learnerId,
      labId,
      createdAt: session.createdAt,
      consentAnalytics,
    });
    session.emit({ type: "session.started", lessonId: labId, learnerId: session.learnerId, variantId: variant?.variantId ?? null, timestamp: now() });

    // ── The agent lane: replay the authored timeline into the event log ──
    // (offsets are negative: the agent worked before the learner arrived).
    const t0 = Date.parse(session.createdAt);
    for (const beat of manifest.agentTimeline ?? []) {
      session.emit({
        type: "agent.action",
        action: beat.action,
        detail: beat.detail,
        timestamp: new Date(t0 + beat.atOffsetMs).toISOString(),
      });
    }

    if (manifest.workspace) {
      // Workspace lab: simulated apps, no shell to instrument. Interventions
      // are evaluated after each workspace action and on the nudge poll.
      session.workspace = new WorkspaceRuntime(manifest.workspace, (e) => session.emit(e));
    } else {
      const instr = new SessionInstrumentation(session.handle!, (e) => session.emit(e));
      session.instrumentation = instr;
      await instr.start();
      // The rule engine piggybacks on the instrumentation cadence.
      const origDrain = instr.drain.bind(instr);
      instr.drain = async () => {
        await origDrain();
        await session.maybeIntervene().catch(() => {});
      };
    }

    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async destroy(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    await s.destroy();
    this.store.deleteSession(sessionId);
    this.sessions.delete(sessionId);
  }

  async destroyAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.destroy(id);
  }

  /** Erasure support: tear down any live sessions belonging to a learner. */
  async destroyByLearner(learnerId: string): Promise<void> {
    for (const [id, s] of [...this.sessions.entries()]) {
      if (s.learnerId === learnerId) await this.destroy(id);
    }
  }
}
