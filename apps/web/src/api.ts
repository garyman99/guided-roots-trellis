/** Thin typed client for the Trellis API. */

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

export interface StatePayload {
  agentTimeline: AgentBeat[];
  variantId: string | null;
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
    chat: { botName?: string; welcome?: string[] } | null;
    tasks: TaskStatus[];
  };
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

/** Persistent identity: created once, reused across sessions and months. */
export function savedLearner(): LearnerCredentials | null {
  try {
    const raw = localStorage.getItem(LEARNER_KEY);
    return raw ? (JSON.parse(raw) as LearnerCredentials) : null;
  } catch {
    return null;
  }
}

export function saveLearner(creds: LearnerCredentials | null): void {
  if (creds) localStorage.setItem(LEARNER_KEY, JSON.stringify(creds));
  else localStorage.removeItem(LEARNER_KEY);
}

export function savedCredentials(): SessionCredentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionCredentials) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: SessionCredentials | null): void {
  if (creds) localStorage.setItem(KEY, JSON.stringify(creds));
  else localStorage.removeItem(KEY);
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
    const learner = await learnerApi.ensureLearner();
    return req("POST", "/api/sessions", null, {
      labId,
      consentAnalytics: false,
      learnerId: learner.learnerId,
      learnerToken: learner.learnerToken,
    }) as Promise<SessionCredentials & { labId: string }>;
  },
  state: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/state`, c) as Promise<StatePayload>,
  ask: (c: SessionCredentials, text: string, stuck: boolean, screen?: ScreenReport) =>
    req("POST", `/api/sessions/${c.sessionId}/ask`, c, { text, stuck, screen }),
  intervention: (c: SessionCredentials) => req("GET", `/api/sessions/${c.sessionId}/intervention`, c),
  evaluate: (c: SessionCredentials) =>
    req("POST", `/api/sessions/${c.sessionId}/checkpoint/evaluate`, c) as Promise<{
      passed: boolean;
      requirements: RequirementResult[];
    }>,
  reset: (c: SessionCredentials) => req("POST", `/api/sessions/${c.sessionId}/reset`, c),
  contextPreview: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/context-preview`, c) as Promise<{ system: string; user: string }>,
  destroy: (c: SessionCredentials) => req("DELETE", `/api/sessions/${c.sessionId}`, c),
  // Workspace fs — powers the desktop experience's Code Studio editor.
  fsList: (c: SessionCredentials) =>
    req("GET", `/api/sessions/${c.sessionId}/fs`, c) as Promise<{ entries: Array<{ path: string; dir: boolean }> }>,
  fsRead: (c: SessionCredentials, path: string) =>
    req("GET", `/api/sessions/${c.sessionId}/file?path=${encodeURIComponent(path)}`, c) as Promise<{
      path: string;
      content: string;
      truncated: boolean;
    }>,
  fsWrite: (c: SessionCredentials, path: string, content: string) =>
    req("PUT", `/api/sessions/${c.sessionId}/file`, c, { path, content }) as Promise<{ saved: boolean }>,
};

async function learnerReq(method: string, path: string, learner: LearnerCredentials, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${learner.learnerToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

export const learnerApi = {
  /** Create-or-reuse the persistent learner, then open a session bound to it. */
  async ensureLearner(): Promise<LearnerCredentials> {
    const existing = savedLearner();
    if (existing) return existing;
    const res = await fetch("/api/learners", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    const creds = { learnerId: body.learnerId, learnerToken: body.learnerToken };
    saveLearner(creds);
    return creds;
  },
  profile: (l: LearnerCredentials) => learnerReq("GET", `/api/learners/${l.learnerId}/profile`, l),
  reflections: (l: LearnerCredentials) => learnerReq("GET", `/api/learners/${l.learnerId}/reflections`, l),
  assert: (l: LearnerCredentials, body: unknown) => learnerReq("POST", `/api/learners/${l.learnerId}/assertions`, l, body),
  erase: (l: LearnerCredentials) => learnerReq("DELETE", `/api/learners/${l.learnerId}`, l),
};

export function terminalUrl(c: SessionCredentials): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/terminal?session=${c.sessionId}&token=${encodeURIComponent(c.token)}`;
}
