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
import { timingSafeEqual, createHash } from "node:crypto";
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
  guideProviderCatalog,
  buildGuideProvider,
  buildTaskValidator,
  PROMPT_VERSION,
  type TaskValidator,
  type AssembledProfile,
  type GuideProviderId,
  type GuideProviderInfo,
  type HintRequest,
  type HintResponse,
  type InstructorProvider,
} from "../../../packages/instructor/src/index.ts";
import {
  RunArtifactWriter,
  newInvocationId,
  loadPricingTable,
  estimateCostUSD,
  type PricingTable,
} from "../../../packages/model-runtime/src/index.ts";
import { loadBlueprint, resolveVariant, chooseTier, type LabVariant } from "../../../packages/lab-runtime/src/variants.ts";
import { loadCurriculum, type Curriculum } from "../../../packages/learner-model/src/curriculum.ts";
import { extractDigest, digestToEvidence } from "../../../packages/learner-model/src/evidence.ts";
import { reduceProfile, type LearnerProfile } from "../../../packages/learner-model/src/profileReducer.ts";
import { corroborateHypotheses } from "../../../packages/learner-model/src/hypotheses.ts";
import { buildReflection } from "../../../packages/learner-model/src/reflection.ts";
import type { EventStore, StoredReflection } from "./store.ts";
import { WorkspaceRuntime, type WorkspaceSpec } from "./workspace.ts";

// ── model telemetry (ADR-0006) ──────────────────────────────────────────────
// Normalized invocation records are ADDITIVE next to the token_usage store:
// append-only JSONL under the git-ignored artifacts dir. Telemetry failures
// must never break a hint, so both sinks are guarded independently.
const modelArtifacts = new RunArtifactWriter(process.env.TRELLIS_ARTIFACTS_DIR ?? "artifacts");
let pricingTable: PricingTable | null = null;
try {
  pricingTable = loadPricingTable();
} catch (err) {
  console.error("[model-runtime] pricing table unavailable — costs will be unestimated:", err);
}

export interface LabTask {
  id: string;
  /** Short display title — the checklist heading the guide renders. */
  title?: string;
  text: string;
  /** How instrumentation recognizes this task as done (see taskStatuses). */
  auto?:
    | "any-command"
    | "diff-viewed"
    | "tests-run"
    | "file-edited"
    // Learner opened a workspace file in the GUI editor. KNOWN LIMITATION:
    // reading the same file via `cat` in the terminal is not detected.
    | "file-viewed"
    | "tests-green"
    // workspace labs (simulated applications):
    | "artifact-opened"
    | "ai-consulted"
    | "context-clean"
    | "draft-edited"
    | "reply-submitted";
  /** For auto "file-viewed": the workspace path that counts (any file when omitted). */
  autoPath?: string;
  /**
   * Optional LLM correctness gate. When present, the task completes only after
   * its coarse `auto` trigger fires AND a model judges the learner's work
   * against `criterion` as correct — so a half-finished edit can't advance the
   * lesson. Offline mock has no model, so the gate auto-passes (unchanged).
   */
  validate?: {
    /** Workspace file paths whose contents the criterion is judged against. */
    reads: string[];
    /** Plain-language description of what "done correctly" means. */
    criterion: string;
  };
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

/** Whether a task's COARSE instrumentation trigger has fired (pre-validation). */
export function taskAutoDone(task: LabTask, state: LearningSessionState): boolean {
  const ws = state.workspace;
  const { auto, autoPath } = task;
  {
    switch (auto) {
      case "any-command":
        return state.recentCommands.length > 0;
      case "diff-viewed":
        return state.viewedGitDiff;
      case "tests-run":
        return state.testsRun > 0;
      case "file-edited":
        return state.filesChanged.length > 0;
      case "file-viewed":
        return autoPath ? state.viewedFiles.includes(autoPath) : state.viewedFiles.length > 0;
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
  }
}

/**
 * Which tasks show as done? The coarse instrumentation trigger must have fired
 * AND — for a task that declares a `validate` criterion — the LLM correctness
 * gate must have passed. Tasks without a criterion behave exactly as before.
 */
export function taskStatuses(tasks: LabTask[], state: LearningSessionState): Array<LabTask & { done: boolean }> {
  return tasks.map((t) => ({
    ...t,
    done: taskAutoDone(t, state) && (!t.validate || state.taskValidations[t.id]?.passed === true),
  }));
}

/** Stable fingerprint of the files a criterion reads — re-check only on change. */
function hashValidationInputs(files: Array<{ path: string; content: string }>): string {
  const h = createHash("sha1");
  for (const f of files) h.update(f.path).update("\0").update(f.content).update("\0");
  return h.digest("hex");
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
  /** The guide's words-provider. Swappable at runtime (see setGuide). */
  private instructor: InstructorProvider;
  /** Which switcher choice is live now ("mock" | "model") — surfaced to the UI. */
  guideProviderId: GuideProviderId = "mock";
  /** LLM correctness gate (shared, from GUIDE_* config). Null → tasks auto-pass. */
  private readonly validator: TaskValidator | null;
  /** Tasks whose validation is in flight — stops the poll cadence double-firing. */
  private readonly validating = new Set<string>();

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
    validator: TaskValidator | null,
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
    this.validator = validator;
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

  async readWorkspaceFile(path: string, opts?: { probe?: boolean }): Promise<{ path: string; content: string; truncated: boolean }> {
    if (!Session.validFsPath(path)) throw new Error("invalid path");
    const program =
      'const fs=require("fs"),p=require("path");const rel=Buffer.from(process.env.TRELLIS_FS_PATH,"base64").toString();' +
      "const abs=p.resolve(process.cwd(),rel);if(!abs.startsWith(process.cwd()+p.sep))throw new Error(\"outside workspace\");" +
      "const raw=fs.readFileSync(abs,\"utf8\");const cap=200*1024;" +
      "console.log(JSON.stringify({content:raw.slice(0,cap),truncated:raw.length>cap}));";
    const parsed = JSON.parse(await this.fsExec(program, { TRELLIS_FS_PATH: Buffer.from(path).toString("base64") }));
    // MEASURED: the platform served this file to the learner's editor — a
    // truthful "they opened it". UI probes (feature detection, previews the
    // learner didn't click) pass probe to keep inference out of the record.
    if (!opts?.probe) this.emit({ type: "file.viewed", path, timestamp: now() });
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
    // A save is the moment an authoring task's work is ready to judge — run the
    // correctness gate now (non-blocking; the write result returns immediately).
    void this.maybeValidate().catch(() => {});
  }

  // ── instructor ──────────────────────────────────────────────────────────

  /**
   * Swap the guide's provider mid-session. Lab state, transcript, and the
   * already-generated greeting are untouched — only the NEXT ask/progress/
   * nudge is voiced by the new provider. The id is display truth for the UI.
   */
  setGuide(id: GuideProviderId, provider: InstructorProvider): void {
    this.guideProviderId = id;
    this.instructor = provider;
  }

  /** The live provider's engine name (for telemetry/UI). */
  guideProviderName(): string {
    return this.instructor.name;
  }

  hintRequest(reason: HintRequest["reason"], state = this.state(), screen?: HintRequest["screen"]): HintRequest {
    return {
      state,
      lab: {
        id: this.manifest.id,
        title: this.manifest.title,
        objective: this.manifest.objective,
        scenario: this.manifest.scenario,
        botName: this.manifest.chat?.botName,
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

  /** Token accounting for the admin usage views; must never break a hint. */
  private recordHintUsage(hint: HintResponse): void {
    if (!hint.usage) return;
    const model = hint.model ?? this.instructor.name;
    const usage = {
      inputTokens: hint.usage.promptTokens,
      outputTokens: hint.usage.completionTokens,
      ...(hint.usage.cacheReadTokens !== undefined ? { cacheReadTokens: hint.usage.cacheReadTokens } : {}),
      ...(hint.usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: hint.usage.cacheWriteTokens } : {}),
    };
    // The served model id is truth for `model`, but servers may echo a dated
    // snapshot with no pricing entry — fall back to the id the adapter
    // requested (which is what the operator priced).
    const estimatedCostUSD = pricingTable
      ? (estimateCostUSD(usage, model, pricingTable) ??
        (hint.modelRequested ? estimateCostUSD(usage, hint.modelRequested, pricingTable) : undefined))
      : undefined;
    try {
      this.store.recordTokenUsage({
        learnerId: this.learnerId,
        sessionId: this.id,
        model,
        promptTokens: hint.usage.promptTokens,
        completionTokens: hint.usage.completionTokens,
        cacheReadTokens: hint.usage.cacheReadTokens,
        cacheWriteTokens: hint.usage.cacheWriteTokens,
        estimatedCostUSD,
        pricingVersion: pricingTable?.version,
        createdAt: now(),
      });
    } catch (err) {
      console.error(`[token-usage] failed to record for ${this.id}:`, err);
    }
    try {
      modelArtifacts.appendInvocation({
        invocationId: newInvocationId(),
        runId: `session-${this.id}`,
        role: "guide",
        provider: this.instructor.name,
        model,
        promptVersion: hint.promptVersion,
        // Recorded at completion; per-call timing lands with the Phase 3
        // transport — completedAt is omitted rather than fabricated.
        startedAt: now(),
        usage,
        estimatedCostUSD,
        pricingVersion: pricingTable?.version,
        status: "ok",
      });
    } catch (err) {
      console.error(`[model-runtime] failed to record invocation for ${this.id}:`, err);
    }
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

  // ── session-opening greeting ────────────────────────────────────────────
  // The first thing the learner reads. Generated ONCE per session by the
  // guide provider from the lesson (title/objective/scenario/tasks) plus the
  // assembled learner profile — so clicking a lesson link lands the learner
  // IN that lesson, personally addressed, instead of a generic chat opener.
  // Concurrent requests share one promise; a provider failure falls back to
  // the authored goalPrompt so onboarding never blocks on a model.
  private greetingPromise: Promise<{ text: string; generated: boolean }> | null = null;

  async greeting(): Promise<{ text: string; generated: boolean }> {
    this.greetingPromise ??= this.generateGreeting().catch((err) => {
      console.error(`[instructor] greeting generation failed for ${this.id}:`, err);
      this.greetingPromise = null; // a later request may retry
      return { text: this.authoredGreeting(), generated: false };
    });
    return this.greetingPromise;
  }

  private authoredGreeting(): string {
    return (
      this.manifest.chat?.goalPrompt ??
      `Hey! I'm ${this.manifest.chat?.botName ?? "Sage"} 🌿 — before we open anything: tell me in your own words, what are you here to get done today?`
    );
  }

  private async generateGreeting(): Promise<{ text: string; generated: boolean }> {
    const req = this.hintRequest({ kind: "greeting" });
    const assembled = this.assembledProfile();
    const hint = await this.instructor.generateHint(req, buildInstructorContext(req, assembled ?? undefined));
    this.recordHintUsage(hint);
    this.emit({ type: "instructor.greeting", text: hint.message.slice(0, 4000), contextManifest: assembled?.manifest ?? null, timestamp: now() });
    return { text: hint.message, generated: true };
  }

  /**
   * Measured progress beat: the client observed task(s) flip to done and asks
   * for the guide's next-step message — completed items checked off, the next
   * open task handed over (or a nudge when the measured state warrants one).
   * Falls back to the next task's authored text so the path never stalls on a
   * provider hiccup. Ids are validated against the manifest (untrusted input).
   */
  async progressMessage(completedTaskIds: unknown): Promise<InstructorMessage> {
    const known = new Set(this.manifest.tasks.map((t) => t.id));
    const ids = (Array.isArray(completedTaskIds) ? completedTaskIds : [])
      .filter((id): id is string => typeof id === "string" && known.has(id))
      .slice(0, 20);
    const state = this.state();
    const req = this.hintRequest({ kind: "progress", completedTaskIds: ids }, state);
    const assembled = this.assembledProfile();
    let text: string;
    try {
      const hint = await this.instructor.generateHint(req, buildInstructorContext(req, assembled ?? undefined));
      this.recordHintUsage(hint);
      text = hint.message;
    } catch (err) {
      console.error(`[instructor] progress generation failed for ${this.id}:`, err);
      const next = taskStatuses(this.manifest.tasks, state).find((t) => !t.done);
      text = next?.text ?? 'Everything on the list is measured done — run "Check my work" when you\'re ready.';
    }
    this.emit({ type: "instructor.progress", completedTaskIds: ids, text: text.slice(0, 4000), contextManifest: assembled?.manifest ?? null, timestamp: now() });
    const msg: InstructorMessage = { id: ++this.msgSeq, role: "instructor", text, at: now() };
    this.transcript.push(msg);
    return msg;
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
    this.recordHintUsage(hint);
    this.emit({ type: "instructor.hint", level: hint.level, strategy: hint.strategy, text: hint.message.slice(0, 4000), contextManifest: assembled?.manifest ?? null, timestamp: now() });
    const msg: InstructorMessage = { id: ++this.msgSeq, role: "instructor", text: hint.message, level: hint.level, at: now() };
    this.transcript.push(msg);
    return msg;
  }

  /**
   * The auto-gating correctness check. For every task that declares a
   * `validate` criterion and whose coarse trigger has fired but which hasn't
   * passed yet, judge the learner's actual files against the criterion and
   * record the result. A live guide runs the LLM check; the offline mock
   * auto-passes (labs behave as before). Content-hashed so a given piece of
   * work is judged once — a fail is re-checked only after the learner edits.
   * Runs on the same cadence as interventions, plus right after a GUI save.
   */
  async maybeValidate(): Promise<void> {
    if (this.destroyed || !this.handle) return; // file-based check needs a lab fs
    const state = this.state();
    for (const task of this.manifest.tasks) {
      const v = task.validate;
      if (!v) continue;
      if (state.taskValidations[task.id]?.passed) continue; // already correct
      if (!taskAutoDone(task, state)) continue; // coarse trigger hasn't fired yet
      if (this.validating.has(task.id)) continue; // one check in flight per task

      // No live model → auto-pass, so labs stay usable offline.
      if (this.guideProviderId !== "model" || !this.validator) {
        this.emit({ type: "task.validated", taskId: task.id, passed: true, reason: "", contentHash: "auto", timestamp: now() });
        continue;
      }

      let files: Array<{ path: string; content: string }>;
      try {
        files = [];
        for (const p of v.reads) {
          const r = await this.readWorkspaceFile(p, { probe: true }); // probe: not a learner "view"
          files.push({ path: p, content: r.content });
        }
      } catch {
        continue; // a read file isn't there yet — try again next tick
      }
      const contentHash = hashValidationInputs(files);
      if (state.taskValidations[task.id]?.contentHash === contentHash) continue; // this exact work already judged

      this.validating.add(task.id);
      try {
        const { passed, reason } = await this.validator.validate(v.criterion, files);
        this.emit({ type: "task.validated", taskId: task.id, passed, reason: reason.slice(0, 300), contentHash, timestamp: now() });
      } catch (err) {
        console.error(`[validate] task ${task.id} check failed for ${this.id}:`, err);
        // Never strand a learner on a validator hiccup — let them through.
        this.emit({ type: "task.validated", taskId: task.id, passed: true, reason: "", contentHash, timestamp: now() });
      } finally {
        this.validating.delete(task.id);
      }
    }
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
    this.recordHintUsage(hint);
    this.emit({ type: "instructor.hint", level: hint.level, strategy: hint.strategy, text: hint.message.slice(0, 4000), contextManifest: assembled?.manifest ?? null, timestamp: now() });
    // Non-blocking: parked until the UI polls it; never interrupts typing.
    this.pendingIntervention = { ...fresh, hint };
  }

  /** Offered-but-unanswered check-in: the hint text is parked here and only
   *  DELIVERED (transcript + event) if the learner accepts the nudge — one
   *  message at a time, never a nudge immediately followed by its hint. */
  private offeredIntervention: (InterventionTrigger & { hint: HintResponse }) | null = null;

  takePendingIntervention() {
    const p = this.pendingIntervention;
    if (p) this.offeredIntervention = p;
    this.pendingIntervention = null;
    return p;
  }

  /**
   * The learner answered the check-in. Accepted → the parked hint becomes a
   * real delivery (transcript + intervention.delivered) and is returned.
   * Declined (or nothing offered) → null; the proposal stays in the log.
   */
  answerIntervention(accepted: boolean): InstructorMessage | null {
    const offered = this.offeredIntervention;
    this.offeredIntervention = null;
    if (!offered || !accepted) return null;
    this.emit({
      type: "intervention.delivered",
      triggerType: offered.type,
      level: offered.hint.level,
      strategy: offered.hint.strategy,
      text: offered.hint.message.slice(0, 4000),
      timestamp: now(),
    });
    const msg: InstructorMessage = { id: ++this.msgSeq, role: "instructor", text: offered.hint.message, level: offered.hint.level, at: now() };
    this.transcript.push(msg);
    return msg;
  }

  // ── checkpoint / lifecycle ──────────────────────────────────────────────

  async evaluateCheckpoint(): Promise<CheckpointResult> {
    const result = await evaluateCheckpoint(
      this.manifest.checkpoint,
      this.state(),
      this.handle,
      verifyScriptPathFor(this.driverKind, this.labDir),
      this.manifest.workspace
        ? {
            meaningfulEditMaxSimilarity: this.manifest.workspace.policy.meaningfulEditMaxSimilarity,
            // Authored labels/teaching so failing gate details name what
            // tripped (selected by measured ids, never learner prose).
            forbiddenPhraseEntries: this.manifest.workspace.policy.forbiddenPhrases,
            restrictedSpanEntries: this.manifest.workspace.policy.restrictedSpans,
            // Server-side reply truth so a failing check can quote the
            // learner's own flagged words (check result only, never events).
            submittedReplyText: this.workspace?.view().reply.text,
          }
        : undefined,
    );
    // The evaluation itself just ran the suite inside the lab env; the
    // results file lands on the instrumentation's NEXT poll (~700ms). Drain
    // now so tests.completed precedes checkpoint.* in the log — otherwise the
    // digest extracted at completion records testsRun: 0 for a run whose
    // tests demonstrably passed (finding session-digest-contradicts-event-log).
    try {
      await this.instrumentation?.drain();
    } catch {
      /* the checkpoint result must never break on instrumentation hiccups */
    }
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
      agentReview: Boolean(session.manifest.agentMessage),
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
  // Guide provider selection is per-session and swappable at runtime. The
  // catalog (what env makes available) is resolved once; built providers are
  // cached and shared across sessions — one mock, one live model.
  private readonly guideCatalog = guideProviderCatalog();
  private readonly guideProviders = new Map<GuideProviderId, InstructorProvider>();
  // Task correctness gate, shared across sessions (from GUIDE_* config). Null
  // when no live model is configured; each session uses it only while on "model".
  private readonly taskValidator = buildTaskValidator();
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

  // ── guide provider selection ──────────────────────────────────────────────

  /** Build-once, share-across-sessions cache. Throws only for an unavailable id. */
  private guideProvider(id: GuideProviderId): InstructorProvider {
    let provider = this.guideProviders.get(id);
    if (!provider) {
      provider = buildGuideProvider(id);
      this.guideProviders.set(id, provider);
    }
    return provider;
  }

  /**
   * Default choice when the client names none: the live model if env made it
   * available (preserves the old "GUIDE_PROVIDER=anthropic just works"
   * behavior), otherwise the offline mock (plain `npm run dev`).
   */
  get defaultGuideId(): GuideProviderId {
    return this.guideCatalog.some((o) => o.id === "model" && o.available) ? "model" : "mock";
  }

  /** The switcher payload: what's offered, and what a new session defaults to. */
  guideOptions(): { options: GuideProviderInfo[]; defaultId: GuideProviderId } {
    return { options: this.guideCatalog, defaultId: this.defaultGuideId };
  }

  /** Coerce a requested id to a valid, AVAILABLE one — throws with the reason if not. */
  private requireGuideId(id: string): GuideProviderId {
    const opt = this.guideCatalog.find((o) => o.id === id);
    if (!opt) throw new Error(`unknown guide provider "${id}" (valid: mock | model)`);
    if (!opt.available) throw new Error(opt.detail ?? `guide provider "${id}" is not available`);
    return opt.id;
  }

  /** Live-swap a running session's guide. Returns the applied choice. */
  setSessionGuide(sessionId: string, id: string): { id: GuideProviderId; provider: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    const chosen = this.requireGuideId(id);
    session.setGuide(chosen, this.guideProvider(chosen));
    return { id: chosen, provider: session.guideProviderName() };
  }

  async createSession(
    labId: string,
    consentAnalytics: boolean,
    learnerId?: string,
    guideProviderId?: string,
  ): Promise<Session> {
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

    // Pick the guide provider: the client's choice if valid+available, else
    // the env default. Falling back (not erroring) keeps session creation
    // robust — a stale/unavailable choice never blocks starting a lab.
    let guideId = this.defaultGuideId;
    if (guideProviderId) {
      try {
        guideId = this.requireGuideId(guideProviderId);
      } catch {
        guideId = this.defaultGuideId;
      }
    }
    const session = new Session(
      manifest, labDir, this.driverKind, this.store, this.guideProvider(guideId),
      learner, this.learners, variant, lessonConcepts, this.taskValidator,
    );
    session.guideProviderId = guideId;
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
        await session.maybeValidate().catch(() => {});
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

  /**
   * Shutdown path: tear down live resources (ptys, containers) but KEEP the
   * stored session rows and event logs. Session history is learner truth the
   * admin surface replays later; only an explicit learner DELETE (destroy) or
   * erasure may remove it from the store.
   */
  async releaseAll(): Promise<void> {
    for (const [id, s] of [...this.sessions.entries()]) {
      await s.destroy();
      this.sessions.delete(id);
    }
  }

  /** Erasure support: tear down any live sessions belonging to a learner. */
  async destroyByLearner(learnerId: string): Promise<void> {
    for (const [id, s] of [...this.sessions.entries()]) {
      if (s.learnerId === learnerId) await this.destroy(id);
    }
  }
}
