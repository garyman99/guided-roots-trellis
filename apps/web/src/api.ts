/** Thin typed client for the Trellis API. */
import { getUser } from "./auth.ts";

export interface SessionCredentials {
  sessionId: string;
  token: string;
}

export interface TaskStatus {
  id: string;
  text: string;
  done: boolean;
}

export interface RequirementResult {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  kind?: string;
}

export interface AgentBeat {
  at: string;
  action: string;
  detail: string;
}

export type GuideProviderId = "mock" | "model";

export interface GuideProviderInfo {
  id: GuideProviderId;
  label: string;
  available: boolean;
  detail?: string;
}

export interface GuideOptions {
  options: GuideProviderInfo[];
  defaultId: GuideProviderId;
}

export interface StatePayload {
  agentTimeline: AgentBeat[];
  variantId: string | null;
  /** Which guide provider is voicing this session (mock | live model). */
  guideProvider: GuideProviderId;
  /** Per-task correctness-gate results (reason present on a fail). */
  taskValidations: Record<string, { passed: boolean; reason: string; contentHash: string }>;
  state: {
    viewedGitDiff: boolean;
    testsRun: number;
    latestTestResult?: { passed: number; failed: number };
    completedCheckpoints: string[];
    changedSinceLastTestRun: boolean;
  };
  tasks: TaskStatus[];
  checkpointReady: boolean;
  transcript: Array<{ id: number; role: "learner" | "instructor"; text: string; level?: number; at: string }>;
  checkpoint: { id: string; title: string; requirements: Array<{ id: string; kind: string; label: string }> };
  lab: {
    id: string;
    title: string;
    scenario: string;
    agentMessage: string | null;
    chat: { botName?: string; welcome?: string[]; goalPrompt?: string } | null;
    tasks: TaskStatus[];
    /** Simulated apps for workspace labs; null for terminal labs. */
    workspaceApps: Array<{ id: string; title: string; icon: string }> | null;
  };
}

/** Workspace labs: everything the simulated apps render. */
export interface WorkspaceView {
  apps: Array<{ id: string; title: string; icon: string }>;
  email: {
    inbox: Array<{ id: string; from: string; subject: string; body: string; receivedAgoMinutes?: number; read: boolean }>;
    notes: Array<{ id: string; title: string; body: string }>;
    replyTo: string;
  };
  aiChat: {
    assistantName: string;
    tagline: string;
    thread: Array<{ id: number; role: "learner" | "assistant"; text: string; contextChars?: number; draftId?: string }>;
  };
  reply: { text: string; revision: number; hasAiBaseline: boolean; submitted: boolean };
}

export type WorkspaceAction =
  | { type: "open-app"; appId: string }
  | { type: "open-artifact"; appId: string; artifactId: string }
  | { type: "chat-send"; prompt: string; context: string }
  | { type: "insert-draft"; draftId: string }
  | { type: "update-draft"; text: string }
  | { type: "submit-reply" };

/** A curated course: an ordered path of scenarios (see /api/courses). */
export interface CourseLesson {
  labId: string;
  title?: string;
  note?: string;
}

export interface Course {
  courseId: string;
  title: string;
  description: string;
  audience: string;
  level: string;
  lessons: CourseLesson[];
  /** Learner visibility; absent = published. /api/courses returns published only. */
  status?: "draft" | "published";
  /** Provenance: the course-generation run that produced this course, if any. */
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Derived completion facts for the signed-in learner (see /api/learners/:id/progress). */
export interface LearnerProgress {
  completedLabIds: string[];
  sessions: Array<{ sessionId: string; labId: string; createdAt: string; completed: boolean }>;
}

/** One ESLint diagnostic, mapped straight onto Monaco marker fields (see /api/sessions/:id/lint). */
export interface LintMessage {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 1 | 2;
  message: string;
  ruleId: string | null;
}

/** Client self-report of what's on screen, sent alongside learner messages. */
export interface ScreenReport {
  activeApp: string | null;
  openWindows: string[];
  editorFile: string | null;
  editorDirty: boolean;
}

const KEY = "trellis.session";

export interface LearnerCredentials {
  learnerId: string;
  learnerToken: string;
}

const LEARNER_KEY = "trellis.learner";

/**
 * Learner identity is per signed-in person: each auth sub gets its own
 * storage slot, so Eva's learner profile never mixes with the developer's.
 * The unscoped legacy key serves two paths: the ungated tooling entry
 * ("/?lab=…", no auth user) keeps using it, and the original dev-bypass user
 * ("dev|local") adopts it so pre-existing history survives the change.
 */
function learnerKey(): string {
  const sub = getUser()?.sub;
  return sub ? `${LEARNER_KEY}:${sub}` : LEARNER_KEY;
}

/**
 * Read a user-scoped slot; "dev|local" adopts the pre-scoping legacy value
 * ONCE (move, not alias — clearing the scoped slot must stay cleared).
 */
function scopedRead(scoped: string, legacy: string): string | null {
  const existing = localStorage.getItem(scoped);
  if (existing !== null || scoped === legacy) return existing;
  if (getUser()?.sub !== "dev|local") return null;
  const inherited = localStorage.getItem(legacy);
  if (inherited !== null) {
    localStorage.setItem(scoped, inherited);
    localStorage.removeItem(legacy);
  }
  return inherited;
}

/** Persistent identity: created once, reused across sessions and months. */
export function savedLearner(): LearnerCredentials | null {
  try {
    const raw = scopedRead(learnerKey(), LEARNER_KEY);
    return raw ? (JSON.parse(raw) as LearnerCredentials) : null;
  } catch {
    return null;
  }
}

export function saveLearner(creds: LearnerCredentials | null): void {
  if (creds) {
    localStorage.setItem(learnerKey(), JSON.stringify(creds));
    return;
  }
  localStorage.removeItem(learnerKey());
  // A dev|local clear must also drop the pre-scoping legacy slot — otherwise
  // scopedRead re-adopts the same dead identity on the very next read (seen
  // live: a purged learner kept resurrecting through the legacy key).
  if (getUser()?.sub === "dev|local") localStorage.removeItem(LEARNER_KEY);
}

/** Saved sessions are user-scoped too — Eva must never resume the developer's session. */
function sessionKey(): string {
  const sub = getUser()?.sub;
  return sub ? `${KEY}:${sub}` : KEY;
}

export function savedCredentials(): SessionCredentials | null {
  try {
    const raw = scopedRead(sessionKey(), KEY);
    return raw ? (JSON.parse(raw) as SessionCredentials) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: SessionCredentials | null): void {
  if (creds) localStorage.setItem(sessionKey(), JSON.stringify(creds));
  else localStorage.removeItem(sessionKey());
}

/**
 * The learner's chosen guide provider, persisted so it survives reloads and
 * applies to the NEXT session created (a fresh boot / new lab). Null = "use
 * the server default" (mock unless GUIDE_* configures a live model).
 */
const GUIDE_PREF_KEY = "trellis.guide.provider";

export function savedGuidePref(): GuideProviderId | null {
  const v = localStorage.getItem(GUIDE_PREF_KEY);
  return v === "mock" || v === "model" ? v : null;
}

export function saveGuidePref(id: GuideProviderId | null): void {
  if (id) localStorage.setItem(GUIDE_PREF_KEY, id);
  else localStorage.removeItem(GUIDE_PREF_KEY);
}

async function req(method: string, path: string, creds: SessionCredentials | null, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(creds ? { authorization: `Bearer ${creds.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

export const api = {
  reflection: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/reflection`, c),
  selfAssess: (c: SessionCredentials, confidence: number) =>
    req("POST", `/api/sessions/${c.sessionId}/self-assessment`, c, { confidence }),
  createSession: async (labId: string) => {
    // Every session binds to the persistent learner: this is what makes the
    // second visit different from the first.
    const attempt = async () => {
      const learner = await learnerApi.ensureLearner();
      return req("POST", "/api/sessions", null, {
        labId,
        consentAnalytics: false,
        learnerId: learner.learnerId,
        learnerToken: learner.learnerToken,
        // Start the session on the learner's saved guide choice (falls back to
        // the server default when null or unavailable).
        guideProviderId: savedGuidePref() ?? undefined,
      }) as Promise<SessionCredentials & { labId: string; guideProvider: GuideProviderId }>;
    };
    try {
      return await attempt();
    } catch (err) {
      const status = (err as { status?: number }).status;
      // Self-heal a stale identity: 401 = the saved learner no longer exists
      // on the server (e.g. its data store was purged/replaced), 410 = this
      // learner erased themselves. Either way the saved credentials are dead
      // weight — drop them, enroll fresh, and retry once.
      if (status === 401 || status === 410) {
        saveLearner(null);
        return await attempt();
      }
      throw err;
    }
  },
  /**
   * The client's single boot call: resume-or-create bound to the persistent
   * learner. The server decides — 200 (resumed) vs 201 (created fresh) — the
   * client never chooses. Same stale-learner self-heal as createSession.
   */
  ensureSession: async (labId: string) => {
    const attempt = async () => {
      const learner = await learnerApi.ensureLearner();
      return learnerReq("POST", `/api/learners/${learner.learnerId}/lessons/${labId}/session`, learner, {
        consentAnalytics: false,
        // Apply the learner's saved guide choice (on both create and resume);
        // falls back to the server default when null or unavailable.
        guideProviderId: savedGuidePref() ?? undefined,
      }) as Promise<SessionCredentials & { labId: string; resumed: boolean; guideProvider: GuideProviderId }>;
    };
    try {
      return await attempt();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 410) {
        saveLearner(null);
        return await attempt();
      }
      throw err;
    }
  },
  state: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/state`, c) as Promise<StatePayload>,
  /** A resumed session's "welcome back — here's where you are" opening (from the active guide). */
  resumeOpening: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/resume-opening`, c) as Promise<{ message: { text: string } }>,
  /** Guide-model switcher options (mock | live model) + the server default. No auth. */
  guideProviders: () => req("GET", "/api/guide-providers", null) as Promise<GuideOptions>,
  /** Live-swap this session's guide provider. Rejects (400) if the choice isn't available. */
  setGuideProvider: (c: SessionCredentials, id: GuideProviderId) =>
    req("POST", `/api/sessions/${c.sessionId}/guide-provider`, c, { id }) as Promise<{ id: GuideProviderId; provider: string }>,
  /** The generated session-opening message (cached server-side; falls back to authored text). */
  greeting: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/greeting`, c) as Promise<{ message: { text: string; generated: boolean } }>,
  /** Measured task(s) done → the guide's generated check-off + next-step message. */
  progress: (c: SessionCredentials, completedTaskIds: string[]) =>
    req("POST", `/api/sessions/${c.sessionId}/progress`, c, { completedTaskIds }) as Promise<{
      message: { id: number; text: string };
    }>,
  workspace: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/workspace`, c) as Promise<WorkspaceView>,
  workspaceAction: (c: SessionCredentials, action: WorkspaceAction) =>
    req("POST", `/api/sessions/${c.sessionId}/workspace/action`, c, action) as Promise<WorkspaceView>,
  ask: (c: SessionCredentials, text: string, stuck: boolean, screen?: ScreenReport, goal?: boolean) =>
    req("POST", `/api/sessions/${c.sessionId}/ask`, c, { text, stuck, screen, goal }),
  intervention: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/intervention`, c),
  /** Answer a check-in: accepted returns the parked hint (now delivered); declined returns null. */
  interventionAnswer: (c: SessionCredentials, accepted: boolean) =>
    req("POST", `/api/sessions/${c.sessionId}/intervention/answer`, c, { accepted }) as Promise<{
      message: { id: number; text: string; level?: number } | null;
    }>,
  evaluate: (c: SessionCredentials) =>
    req("POST", `/api/sessions/${c.sessionId}/checkpoint/evaluate`, c) as Promise<{
      passed: boolean;
      requirements: RequirementResult[];
    }>,
  reset: (c: SessionCredentials) => req("POST", `/api/sessions/${c.sessionId}/reset`, c),
  /** "Start over": ends the current attempt (history kept), doesn't create a new one — pair with ensureSession. */
  abandonSession: (c: SessionCredentials) => req("POST", `/api/sessions/${c.sessionId}/abandon`, c) as Promise<{ ok: true }>,
  contextPreview: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/context-preview`, c) as Promise<{ system: string; user: string }>,
  destroy: (c: SessionCredentials) => req("DELETE", `/api/sessions/${c.sessionId}`, c),
  // Workspace fs — powers the desktop experience's Code Studio editor.
  fsList: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/fs`, c) as Promise<{ entries: Array<{ path: string; dir: boolean }> }>,
  fsRead: (c: SessionCredentials, path: string, opts?: { probe?: boolean }) =>
    req("GET", `/api/sessions/${c.sessionId}/file?path=${encodeURIComponent(path)}${opts?.probe ? "&probe=1" : ""}`, c) as Promise<{
      path: string;
      content: string;
      truncated: boolean;
    }>,
  fsWrite: (c: SessionCredentials, path: string, content: string) =>
    req("PUT", `/api/sessions/${c.sessionId}/file`, c, { path, content }) as Promise<{ saved: boolean }>,
  /** Type-aware ESLint for the Code Studio editor — debounced client-side, live squiggles server-side. */
  lint: (c: SessionCredentials, path: string, content: string) =>
    req("POST", `/api/sessions/${c.sessionId}/lint`, c, { path, content }) as Promise<{ messages: LintMessage[] }>,
};

async function learnerReq(method: string, path: string, learner: LearnerCredentials, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${learner.learnerToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}`), { status: res.status });
  return res.json();
}

export const learnerApi = {
  /** Create-or-reuse the persistent learner, then open a session bound to it. */
  async ensureLearner(): Promise<LearnerCredentials> {
    const existing = savedLearner();
    if (existing) return existing;
    // Carry the signed-in identity so the operator surface can show a human
    // name (e.g. "Eva") instead of a bare learner id.
    const user = getUser();
    const res = await fetch("/api/learners", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: user?.name, email: user?.email }),
    });
    const body = await res.json();
    const creds = { learnerId: body.learnerId, learnerToken: body.learnerToken };
    saveLearner(creds);
    return creds;
  },
  profile: (l: LearnerCredentials) => learnerReq("GET", `/api/learners/${l.learnerId}/profile`, l),
  progress: (l: LearnerCredentials) =>
    learnerReq("GET", `/api/learners/${l.learnerId}/progress`, l) as Promise<LearnerProgress>,
  reflections: (l: LearnerCredentials) => learnerReq("GET", `/api/learners/${l.learnerId}/reflections`, l),
  assert: (l: LearnerCredentials, body: unknown) => learnerReq("POST", `/api/learners/${l.learnerId}/assertions`, l, body),
  erase: (l: LearnerCredentials) => learnerReq("DELETE", `/api/learners/${l.learnerId}`, l),
};

/** Public course shelf — no credentials needed to browse. */
export async function fetchCourses(): Promise<Course[]> {
  const res = await fetch("/api/courses");
  if (!res.ok) throw new Error(`GET /api/courses → ${res.status}`);
  const body = (await res.json()) as { courses: Course[] };
  return body.courses;
}

export function terminalUrl(c: SessionCredentials): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/terminal?session=${c.sessionId}&token=${encodeURIComponent(c.token)}`;
}
