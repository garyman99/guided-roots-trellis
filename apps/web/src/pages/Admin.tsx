/**
 * Admin — the operator surface (/admin, admin users only; see Root.tsx).
 * Five views over /api/admin/*:
 *   agents    configured agents/services and their prompts
 *   users     per-learner activity, token usage by model, derived profile
 *   usage     total token usage by model, graphed over time
 *   courses   curated paths: create / edit / delete, lessons from the catalog
 *   sessions  every session a learner has opened (finished or not) with a
 *             REPLAY of its measured event log — the deterministic recording
 *
 * When the API has TRELLIS_ADMIN_TOKEN set, requests carry the token pasted
 * into the unlock field (kept in localStorage) — the token is never bundled.
 *
 * Chart palette: brand-adjacent categorical steps validated for the dark
 * surface (dataviz six checks: lightness band, chroma, CVD ≥ 12, contrast).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getUser, logout } from "../auth.ts";
import type { Course, CourseLesson } from "../api.ts";
import { fetchScenarios, adminGet, adminGetText, adminSend, ADMIN_TOKEN_KEY } from "../api.ts";
import { CourseStudio } from "./CourseStudio.tsx";
import { LessonExperiencePanel } from "./LessonExperience.tsx";
import { scenarioMap, type Scenario } from "../scenarios.ts";
import "../brand/guided-roots.css";
import "./pages.css";

/* ---------- types mirroring /api/admin responses ---------- */

interface AgentPrompt {
  id: string;
  file: string;
  active: boolean;
  content: string;
}

interface AdminAgent {
  id: string;
  name: string;
  role: string;
  kind: string;
  provider?: string;
  model?: string;
  baseUrl?: string | null;
  promptVersion?: string;
  config?: Record<string, unknown>;
  prompts: AgentPrompt[];
}

interface ModelUsage {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  unpricedCalls: number;
}

interface UsageTotals {
  calls: number;
  totalTokens: number;
  estimatedCostUSD: number;
  unpricedCalls: number;
}

interface AdminUser {
  learnerId: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  totals: UsageTotals;
  consents: { selfAnalytics: boolean; cohortAggregate: boolean; research: boolean };
  activity: {
    sessionsOnRecord: number;
    labsCompleted: number;
    reflections: number;
    hintCalls: number;
    lastActiveAt: string;
    summary: {
      labs: number;
      completed: number;
      medianDurationMs: number | null;
      hintsPerLab: number;
      diffFirstRate: number;
      testUsageRate: number;
      recoveryRate: number;
    };
  };
  usageByModel: ModelUsage[];
  profile: {
    skills: Array<{ conceptId: string; status: string; confidence: number; explanation: string }>;
    habits: Array<{ habitId: string; value: number; baseline: number | null }>;
    preferences: Array<{ key: string; value: string }>;
    hypotheses: Array<{ claim: string; state: string }>;
    calibration: { samples: number; tendency: string } | null;
    labsCompleted: number;
  };
}

interface UsagePayload {
  byModel: ModelUsage[];
  series: Array<{ day: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }>;
  calls: number;
}

interface AdminSessionSummary {
  sessionId: string;
  learnerId: string;
  labId: string;
  createdAt: string;
  lastEventAt: string;
  durationMs: number;
  eventCount: number;
  counts: { commands: number; questions: number; hints: number; testRuns: number };
  completed: boolean;
  live: boolean;
  /** Lifecycle: "open" until the learner finishes or starts over. Optional — older sessions predate this field. */
  status?: "open" | "abandoned";
  /** Who drove it: a real learner or the pre-publish simulated learner (Phase 4). */
  kind?: "learner" | "sim";
}

/** Replay events are the raw session event log; rendered defensively. */
type ReplayEvent = { type: string; timestamp: string } & Record<string, unknown>;

interface ReplayPayload {
  meta: { sessionId: string; learnerId: string; labId: string; labTitle: string; createdAt: string; live: boolean };
  events: ReplayEvent[];
}

/* ---------- formatting ---------- */

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtRate(r: number): string {
  return `${Math.round(r * 100)}%`;
}

/** Small LLM costs need sub-cent precision; bigger ones read like money. */
function fmtUSD(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/** Fixed categorical order — color follows the model, never its rank. */
const SERIES_COLORS = ["#6ba55f", "#c9803a", "#5a86e0"];

function modelColor(model: string, order: string[]): string {
  const i = order.indexOf(model);
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

type Tab = "agents" | "users" | "usage" | "courses" | "studio" | "sessions";

export function Admin() {
  const user = getUser();
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<AdminAgent[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [sessions, setSessions] = useState<AdminSessionSummary[] | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);
  // labId → scenario, from the fetched catalog. Session tables and the course
  // editor resolve presentation titles through this.
  const scenarioByLabId = useMemo(() => scenarioMap(scenarios), [scenarios]);

  useEffect(() => {
    let stop = false;
    setError(null);
    Promise.all([
      adminGet<{ agents: AdminAgent[] }>("/api/admin/agents"),
      adminGet<{ users: AdminUser[] }>("/api/admin/users"),
      adminGet<UsagePayload>("/api/admin/usage"),
      // Operator view of courses: includes drafts and not-yet-live lessons
      // (the public /api/courses hides both).
      adminGet<{ courses: Course[] }>("/api/admin/courses"),
      adminGet<{ sessions: AdminSessionSummary[] }>("/api/admin/sessions"),
      fetchScenarios(),
    ])
      .then(([a, u, g, c, s, sc]) => {
        if (stop) return;
        setAgents(a.agents);
        setUsers(u.users);
        setUsage(g);
        setCourses(c.courses);
        setSessions(s.sessions);
        setScenarios(sc);
        setNeedsToken(false);
      })
      .catch((err: { status?: number }) => {
        if (stop) return;
        if (err.status === 401) setNeedsToken(true);
        else setError(`Couldn't load admin data. Is the API running? (${String(err)})`);
      });
    return () => {
      stop = true;
    };
  }, [reloadTick]);

  return (
    <div className="gr-scope admin-page">
      <nav className="gr-nav">
        <div className="gr-nav-inner">
          <a className="gr-wordmark" href="/home">
            <img src="/brand/logo-mark.svg" alt="" />
            <span>
              <span className="name">Trellis</span>
              <span className="by">Admin · Guided Roots</span>
            </span>
          </a>
          <div className="gr-nav-actions user-chip">
            <span className="who">{user?.name?.toUpperCase()}</span>
            <a className="gr-btn gr-btn-ghost gr-btn-small" href="/home">
              Home
            </a>
            <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <header className="gr-section tight" style={{ paddingBottom: 0 }}>
        <div className="gr-container">
          <div className="gr-section-head" style={{ marginBottom: "clamp(20px, 3vw, 36px)" }}>
            <p className="gr-eyebrow">Operator view</p>
            <h2 style={{ fontSize: "clamp(1.9rem, 3.2vw, 2.6rem)" }}>
              Under the <em>trellis</em>
            </h2>
          </div>
          <div className="admin-tabs" role="tablist">
            {(
              [
                ["agents", "Agents & services"],
                ["users", "Users"],
                ["usage", "Token usage"],
                ["courses", "Courses"],
                ["studio", "Course studio"],
                ["sessions", "Sessions"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={`admin-tab${tab === key ? " active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="gr-section tight" style={{ paddingTop: "clamp(24px, 3vw, 40px)" }}>
        <div className="gr-container">
          {needsToken && (
            <div className="gr-card admin-token-card">
              <h3>Admin token required</h3>
              <p>The API has TRELLIS_ADMIN_TOKEN set. Paste it to unlock this page (stored locally).</p>
              <form
                className="admin-token-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  localStorage.setItem(ADMIN_TOKEN_KEY, tokenDraft.trim());
                  setReloadTick((t) => t + 1);
                }}
              >
                <div className="gr-field" style={{ flex: 1 }}>
                  <label htmlFor="admin-token">Admin token</label>
                  <input
                    id="admin-token"
                    type="password"
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    placeholder="TRELLIS_ADMIN_TOKEN"
                  />
                </div>
                <button className="gr-btn gr-btn-primary" type="submit">
                  Unlock
                </button>
              </form>
            </div>
          )}
          {error && <p className="admin-error">{error}</p>}

          {!needsToken && !error && (
            <>
              {tab === "agents" && <AgentsView agents={agents} />}
              {tab === "users" && <UsersView users={users} sessions={sessions} scenarioByLabId={scenarioByLabId} />}
              {tab === "usage" && <UsageView usage={usage} />}
              {tab === "courses" && <CoursesView courses={courses} onChanged={reload} scenarios={scenarios} scenarioByLabId={scenarioByLabId} />}
              {tab === "studio" && <CourseStudio onCoursesChanged={reload} />}
              {tab === "sessions" && <SessionsView sessions={sessions} scenarioByLabId={scenarioByLabId} />}
            </>
          )}
        </div>
      </section>

      <footer className="gr-footer">
        <div className="gr-container">
          <hr className="gr-ground" />
          <div className="gr-footer-inner">
            <span className="gr-mono-note">TRELLIS · OPERATOR SURFACE</span>
            <span className="gr-mono-note">MEASURED, NOT GUESSED</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ================= agents ================= */

function AgentsView({ agents }: { agents: AdminAgent[] | null }) {
  if (!agents) return <p className="admin-loading">Loading agents…</p>;
  return (
    <div className="admin-stack">
      {agents.map((a) => (
        <article key={a.id} className="gr-card admin-agent">
          <div className="admin-agent-head">
            <h3>{a.name}</h3>
            <span className={`admin-chip kind-${a.kind}`}>{a.kind}</span>
          </div>
          <p>{a.role}</p>
          {(a.model || a.provider) && (
            <dl className="admin-kv">
              {a.provider && (
                <>
                  <dt>Provider</dt>
                  <dd>{a.provider}</dd>
                </>
              )}
              {a.model && (
                <>
                  <dt>Model</dt>
                  <dd>{a.model}</dd>
                </>
              )}
              {a.baseUrl && (
                <>
                  <dt>Endpoint</dt>
                  <dd>{a.baseUrl}</dd>
                </>
              )}
              {a.promptVersion && (
                <>
                  <dt>Active prompt</dt>
                  <dd>instructor.{a.promptVersion}</dd>
                </>
              )}
            </dl>
          )}
          {a.config && (
            <details className="admin-prompt">
              <summary>
                Rule configuration <span className="gr-mono-note">deterministic — no prompt</span>
              </summary>
              <pre>{JSON.stringify(a.config, null, 2)}</pre>
            </details>
          )}
          {a.prompts.map((p) => (
            <details key={p.id} className="admin-prompt" open={p.active}>
              <summary>
                {p.id}
                {p.active && <span className="admin-chip active-chip">active</span>}
                <span className="gr-mono-note">{p.file}</span>
              </summary>
              <pre>{p.content}</pre>
            </details>
          ))}
        </article>
      ))}
    </div>
  );
}

/* ================= users ================= */

/**
 * Users: a roster you can price from. The list ranks learners by estimated
 * cost; drilling in gives ONE view per user — totals, per-model cost, and
 * every session with its replay (the deterministic recording).
 */
function UsersView({
  users,
  sessions,
  scenarioByLabId,
}: {
  users: AdminUser[] | null;
  sessions: AdminSessionSummary[] | null;
  scenarioByLabId: Map<string, Scenario>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!users) return <p className="admin-loading">Loading users…</p>;
  if (users.length === 0)
    return (
      <p className="admin-loading">
        No learners yet — users appear here after someone launches the desktop for the first time.
      </p>
    );

  const open = openId ? users.find((u) => u.learnerId === openId) : null;
  if (open) {
    return (
      <UserDetail
        user={open}
        sessions={(sessions ?? []).filter((s) => s.learnerId === open.learnerId)}
        onBack={() => setOpenId(null)}
        scenarioByLabId={scenarioByLabId}
      />
    );
  }

  const ranked = [...users].sort((a, b) => b.totals.estimatedCostUSD - a.totals.estimatedCostUSD || b.totals.totalTokens - a.totals.totalTokens);
  return (
    <div className="admin-stack">
      <p className="admin-lede-note">
        Every user of the application, ranked by what their model usage is estimated to cost. Click a
        user for the single-view breakdown: totals, cost by model, and each session with its recording.
      </p>
      <table className="admin-table admin-clickable">
        <thead>
          <tr>
            <th>User</th>
            <th>Sessions</th>
            <th>Guide exchanges</th>
            <th>Tokens</th>
            <th>Est. cost</th>
            <th>Last active</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((u) => (
            <tr key={u.learnerId} onClick={() => setOpenId(u.learnerId)} title="Open this user's usage view">
              <td>
                <strong>{u.name ?? "(unnamed)"}</strong>{" "}
                <code className="gr-mono-note">{u.learnerId.slice(0, 14)}…</code>
              </td>
              <td>{u.activity.sessionsOnRecord}</td>
              <td>{u.activity.hintCalls}</td>
              <td>{fmtTokens(u.totals.totalTokens)}</td>
              <td>
                {fmtUSD(u.totals.estimatedCostUSD)}
                {u.totals.unpricedCalls > 0 && <span className="gr-mono-note"> +{u.totals.unpricedCalls} unpriced</span>}
              </td>
              <td>{fmtWhen(u.activity.lastActiveAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The single per-user view: identity, cost, usage, sessions + replays. */
function UserDetail({
  user: u,
  sessions,
  onBack,
  scenarioByLabId,
}: {
  user: AdminUser;
  sessions: AdminSessionSummary[];
  onBack: () => void;
  scenarioByLabId: Map<string, Scenario>;
}) {
  const [replayId, setReplayId] = useState<string | null>(null);
  if (replayId) return <ReplayView sessionId={replayId} onBack={() => setReplayId(null)} />;

  return (
    <div className="admin-stack">
      <div className="admin-replay-head">
        <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={onBack}>
          ← All users
        </button>
        <div>
          <h3>{u.name ?? "(unnamed user)"}</h3>
          <p className="gr-mono-note">
            {u.email ? `${u.email} · ` : ""}
            {u.learnerId} · joined {fmtWhen(u.createdAt)}
          </p>
        </div>
      </div>

      <div className="admin-stats big">
        <Stat label="Est. cost" value={fmtUSD(u.totals.estimatedCostUSD)} />
        <Stat label="Tokens" value={fmtTokens(u.totals.totalTokens)} />
        <Stat label="Model calls" value={String(u.totals.calls)} />
        <Stat label="Sessions" value={String(u.activity.sessionsOnRecord)} />
        <Stat label="Labs completed" value={String(u.activity.labsCompleted)} />
        <Stat label="Last active" value={fmtWhen(u.activity.lastActiveAt)} />
      </div>
      {u.totals.unpricedCalls > 0 && (
        <p className="admin-empty">
          ⚠ {u.totals.unpricedCalls} call(s) had no pricing entry when recorded — the estimate above
          understates this user's true cost.
        </p>
      )}

      <div className="gr-card">
        <h3>Cost & tokens by model</h3>
        {u.usageByModel.length === 0 ? (
          <p className="admin-empty">No model calls recorded yet.</p>
        ) : (
          <UsageTable rows={u.usageByModel} order={u.usageByModel.map((m) => m.model)} withCost />
        )}
      </div>

      <div className="gr-card">
        <h3>Sessions — watch any recording</h3>
        {sessions.length === 0 ? (
          <p className="admin-empty">No sessions on record for this user.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Scenario</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Activity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId}>
                  <td>{fmtWhen(s.createdAt)}</td>
                  <td>{scenarioByLabId.get(s.labId)?.title ?? s.labId}</td>
                  <td>
                    <span className={`admin-chip ${s.completed ? "status-mastered" : ""}`}>
                      {s.completed ? "finished" : s.live ? "live now" : "not finished"}
                    </span>
                    {s.status === "abandoned" && <span className="admin-chip status-abandoned">abandoned</span>}
                  </td>
                  <td>{fmtDuration(s.durationMs)}</td>
                  <td>
                    {s.counts.commands} cmds · {s.counts.questions} asks · {s.counts.hints} hints · {s.counts.testRuns} test runs
                  </td>
                  <td>
                    <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => setReplayId(s.sessionId)}>
                      ▶ Watch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="admin-prompt">
        <summary>
          Derived profile — what the guide is told about this learner{" "}
          <span className="gr-mono-note">
            diff-first {fmtRate(u.activity.summary.diffFirstRate)} · tests {fmtRate(u.activity.summary.testUsageRate)} ·{" "}
            {u.activity.reflections} reflections
          </span>
        </summary>
        {u.profile.skills.length === 0 && u.profile.habits.length === 0 && u.profile.preferences.length === 0 ? (
          <p className="admin-empty">Nothing derived yet — the profile grows as labs are completed.</p>
        ) : (
          <div className="admin-profile">
            {u.profile.skills.length > 0 && (
              <div>
                <p className="gr-mono-note">SKILLS</p>
                <ul className="admin-claims">
                  {u.profile.skills.map((s) => (
                    <li key={s.conceptId} title={s.explanation}>
                      <span className={`admin-chip status-${s.status}`}>{s.status}</span>
                      <code>{s.conceptId}</code>
                      <span className="conf">{Math.round(s.confidence * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {u.profile.habits.length > 0 && (
              <div>
                <p className="gr-mono-note">HABITS</p>
                <ul className="admin-claims">
                  {u.profile.habits.map((h) => (
                    <li key={h.habitId}>
                      <code>{h.habitId}</code>
                      <span className="conf">
                        {fmtRate(h.value)}
                        {h.baseline !== null && ` (was ${fmtRate(h.baseline)})`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {u.profile.preferences.length > 0 && (
              <div>
                <p className="gr-mono-note">PREFERENCES (learner-asserted)</p>
                <ul className="admin-claims">
                  {u.profile.preferences.map((p) => (
                    <li key={p.key}>
                      <code>{p.key}</code>
                      <span className="conf">{p.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {u.profile.calibration && (
              <div>
                <p className="gr-mono-note">CALIBRATION</p>
                <p className="admin-empty">
                  {u.profile.calibration.tendency} ({u.profile.calibration.samples} self-assessments)
                </p>
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-stat">
      <span className="v">{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

/* ================= usage ================= */

function UsageView({ usage }: { usage: UsagePayload | null }) {
  if (!usage) return <p className="admin-loading">Loading usage…</p>;
  const order = usage.byModel.map((m) => m.model); // fixed identity order
  const total = usage.byModel.reduce((s, m) => s + m.totalTokens, 0);
  const totalCost = usage.byModel.reduce((s, m) => s + m.estimatedCostUSD, 0);
  return (
    <div className="admin-stack">
      <div className="admin-stats big">
        <Stat label="Total tokens" value={fmtTokens(total)} />
        <Stat label="Est. cost" value={fmtUSD(totalCost)} />
        <Stat label="Model calls" value={String(usage.calls)} />
        <Stat label="Models" value={String(usage.byModel.length)} />
      </div>

      {usage.series.length === 0 ? (
        <p className="admin-loading">
          No token usage recorded yet — ask the guide something in a lab and this graph starts growing.
        </p>
      ) : (
        <div className="gr-card">
          <h3>Tokens per day, by model</h3>
          <UsageChart series={usage.series} order={order} />
        </div>
      )}

      {usage.byModel.length > 0 && (
        <div className="gr-card">
          <h3>Totals by model</h3>
          <UsageTable rows={usage.byModel} order={order} withCost />
        </div>
      )}
    </div>
  );
}

function UsageTable({ rows, order, withCost = false }: { rows: ModelUsage[]; order: string[]; withCost?: boolean }) {
  const anyCache = rows.some((m) => m.cacheReadTokens > 0 || m.cacheWriteTokens > 0);
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Calls</th>
          <th>Prompt</th>
          <th>Completion</th>
          {anyCache && <th>Cache r/w</th>}
          <th>Total</th>
          {withCost && <th>Est. cost</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.model}>
            <td>
              <span className="admin-swatch" style={{ background: modelColor(m.model, order) }} />
              <code>{m.model}</code>
            </td>
            <td>{m.calls}</td>
            <td>{fmtTokens(m.promptTokens)}</td>
            <td>{fmtTokens(m.completionTokens)}</td>
            {anyCache && (
              <td>
                {fmtTokens(m.cacheReadTokens)} / {fmtTokens(m.cacheWriteTokens)}
              </td>
            )}
            <td>{fmtTokens(m.totalTokens)}</td>
            {withCost && (
              <td>
                {fmtUSD(m.estimatedCostUSD)}
                {m.unpricedCalls > 0 && <span className="gr-mono-note"> +{m.unpricedCalls} unpriced</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- the chart: stacked daily bars, hover tooltip, zero deps ---------- */

interface ChartTip {
  x: number;
  y: number;
  day: string;
  model: string;
  tokens: number;
  dayTotal: number;
}

function UsageChart({
  series,
  order,
}: {
  series: UsagePayload["series"];
  order: string[];
}) {
  const [tip, setTip] = useState<ChartTip | null>(null);

  const { days, byDay, maxDay } = useMemo(() => {
    const days = [...new Set(series.map((s) => s.day))].sort();
    const byDay = new Map(days.map((d) => [d, new Map<string, number>()]));
    for (const s of series) byDay.get(s.day)!.set(s.model, (byDay.get(s.day)!.get(s.model) ?? 0) + s.totalTokens);
    const maxDay = Math.max(...days.map((d) => [...byDay.get(d)!.values()].reduce((a, b) => a + b, 0)));
    return { days, byDay, maxDay };
  }, [series]);

  const W = 720;
  const H = 280;
  const M = { top: 16, right: 12, bottom: 30, left: 46 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  // nice ceiling: 1/2/5 × 10^n
  const pow = 10 ** Math.floor(Math.log10(Math.max(maxDay, 1)));
  const yMax = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= maxDay) ?? maxDay;
  const y = (v: number) => M.top + ih - (v / yMax) * ih;

  const band = iw / days.length;
  const barW = Math.min(56, band * 0.6);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const GAP = 2; // surface gap between stacked segments

  return (
    <div className="admin-chart">
      {order.length > 1 && (
        <div className="admin-legend">
          {order.map((m) => (
            <span key={m}>
              <span className="admin-swatch" style={{ background: modelColor(m, order) }} />
              {m}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Token usage per day, stacked by model">
        {/* recessive grid + y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.left - 8} y={y(t) + 4} className="tick" textAnchor="end">
              {fmtTokens(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = M.left + band * i + band / 2;
          const perModel = byDay.get(d)!;
          const dayTotal = [...perModel.values()].reduce((a, b) => a + b, 0);
          let cursor = M.top + ih; // stack upward from the baseline
          const segs = order
            .filter((m) => (perModel.get(m) ?? 0) > 0)
            .map((m, idx, live) => {
              const hFull = (perModel.get(m)! / yMax) * ih;
              const top = cursor - hFull;
              const isTopmost = idx === live.length - 1;
              cursor = top;
              // non-top segments give up GAP px so a 2px surface gap separates fills
              return { m, top, h: Math.max(1, hFull - (isTopmost ? 0 : GAP)), isTopmost };
            });
          return (
            <g key={d}>
              {segs.map((s) => {
                const x0 = cx - barW / 2;
                const r = Math.min(4, barW / 2, s.h);
                const path = s.isTopmost
                  ? `M${x0},${s.top + s.h} L${x0},${s.top + r} Q${x0},${s.top} ${x0 + r},${s.top} L${x0 + barW - r},${s.top} Q${x0 + barW},${s.top} ${x0 + barW},${s.top + r} L${x0 + barW},${s.top + s.h} Z`
                  : `M${x0},${s.top} h${barW} v${s.h} h${-barW} Z`;
                return (
                  <path
                    key={s.m}
                    d={path}
                    fill={modelColor(s.m, order)}
                    onMouseEnter={() =>
                      setTip({
                        x: ((cx / W) * 100),
                        y: ((s.top / H) * 100),
                        day: d,
                        model: s.m,
                        tokens: byDay.get(d)!.get(s.m)!,
                        dayTotal,
                      })
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
              {/* selective direct label: the day's total above the bar */}
              <text x={cx} y={y(dayTotal) - 6} className="bar-label" textAnchor="middle">
                {fmtTokens(dayTotal)}
              </text>
              <text x={cx} y={H - 8} className="tick" textAnchor="middle">
                {d.slice(5)}
              </text>
            </g>
          );
        })}
        <line x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih} className="axis" />
      </svg>
      {tip && (
        <div className="admin-tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }}>
          <strong>{tip.model}</strong>
          <span>
            {tip.tokens.toLocaleString()} tokens · {tip.day}
          </span>
          <span className="dim">day total {tip.dayTotal.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

/* ================= courses (create / edit / delete) ================= */

const EMPTY_DRAFT: Omit<Course, "courseId" | "createdAt" | "updatedAt"> = {
  title: "",
  description: "",
  audience: "",
  level: "beginner",
  lessons: [],
};

function CoursesView({
  courses,
  onChanged,
  scenarios,
  scenarioByLabId,
}: {
  courses: Course[] | null;
  onChanged: () => void;
  scenarios: Scenario[];
  scenarioByLabId: Map<string, Scenario>;
}) {
  // editing: null = closed, "new" = creating, otherwise the courseId being edited
  const [editing, setEditing] = useState<string | null>(null);
  // one lesson's recorded-experience panel open at a time (by labId)
  const [expLab, setExpLab] = useState<string | null>(null);
  if (!courses) return <p className="admin-loading">Loading courses…</p>;

  return (
    <div className="admin-stack">
      {editing === null && (
        <div>
          <button className="gr-btn gr-btn-primary" onClick={() => setEditing("new")}>
            New course
          </button>
        </div>
      )}
      {editing !== null && (
        <CourseEditor
          initial={editing === "new" ? null : (courses.find((c) => c.courseId === editing) ?? null)}
          onDone={(changed) => {
            setEditing(null);
            if (changed) onChanged();
          }}
          scenarios={scenarios}
          scenarioByLabId={scenarioByLabId}
        />
      )}
      {courses.length === 0 && editing === null && (
        <p className="admin-empty">No courses yet — create one and it appears on every learner's home page.</p>
      )}
      {courses.map((c) => (
        <article key={c.courseId} className="gr-card admin-course">
          <div className="admin-agent-head">
            <h3>{c.title}</h3>
            {c.status === "draft" && <span className="admin-chip status-abandoned">draft</span>}
            <span className="admin-chip">{c.level}</span>
            {c.audience && <span className="admin-chip">{c.audience}</span>}
            <span className="gr-mono-note">{c.lessons.length} lessons · updated {fmtWhen(c.updatedAt)}</span>
            <span className="admin-course-actions">
              <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => setEditing(c.courseId)}>
                Edit
              </button>
              <button
                className="gr-btn gr-btn-ghost gr-btn-small admin-danger"
                onClick={() => {
                  if (!window.confirm(`Delete the course "${c.title}"? Learners keep their scenario progress.`)) return;
                  adminSend("DELETE", `/api/admin/courses/${encodeURIComponent(c.courseId)}`)
                    .then(onChanged)
                    .catch((err) => window.alert(`Couldn't delete: ${String((err as Error).message)}`));
                }}
              >
                Delete
              </button>
            </span>
          </div>
          <p>{c.description}</p>
          <ol className="admin-course-lessons">
            {c.lessons.map((l, i) => {
              const s = scenarioByLabId.get(l.labId);
              return (
                <li key={`${l.labId}-${i}`}>
                  <span className="gr-mono-note">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    {l.title ?? s?.title ?? l.labId} <code>{l.labId}</code>
                  </span>
                  <button
                    className="gr-btn gr-btn-ghost gr-btn-small"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setExpLab(expLab === l.labId ? null : l.labId)}
                    title="Recorded learner experience for this lesson"
                  >
                    {expLab === l.labId ? "Hide experience" : "Experience"}
                  </button>
                  {expLab === l.labId && (
                    <div style={{ flexBasis: "100%" }}>
                      <LessonExperiencePanel labId={l.labId} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </article>
      ))}
    </div>
  );
}

function CourseEditor({
  initial,
  onDone,
  scenarios,
  scenarioByLabId,
}: {
  initial: Course | null;
  onDone: (changed: boolean) => void;
  scenarios: Scenario[];
  scenarioByLabId: Map<string, Scenario>;
}) {
  const [draft, setDraft] = useState(() => (initial ? { ...initial, lessons: [...initial.lessons] } : { ...EMPTY_DRAFT, lessons: [] as CourseLesson[] }));
  const [addLabId, setAddLabId] = useState(scenarios[0]?.labId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const moveLesson = (i: number, delta: number) => {
    setDraft((d) => {
      const lessons = [...d.lessons];
      const j = i + delta;
      if (j < 0 || j >= lessons.length) return d;
      [lessons[i], lessons[j]] = [lessons[j], lessons[i]];
      return { ...d, lessons };
    });
  };

  const save = () => {
    setSaving(true);
    setError(null);
    const body = {
      title: draft.title,
      description: draft.description,
      audience: draft.audience,
      level: draft.level,
      lessons: draft.lessons,
    };
    const req = initial
      ? adminSend("PUT", `/api/admin/courses/${encodeURIComponent(initial.courseId)}`, body)
      : adminSend("POST", "/api/admin/courses", body);
    req
      .then(() => onDone(true))
      .catch((err) => {
        setSaving(false);
        setError(String((err as Error).message));
      });
  };

  return (
    <article className="gr-card admin-course-editor">
      <h3>{initial ? `Edit — ${initial.title}` : "New course"}</h3>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="course-title">Title</label>
          <input id="course-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Playwright Foundations" />
        </div>
        <div className="gr-field">
          <label htmlFor="course-audience">Audience</label>
          <input id="course-audience" value={draft.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="QA & Testing" />
        </div>
        <div className="gr-field">
          <label htmlFor="course-level">Level</label>
          <select id="course-level" value={draft.level} onChange={(e) => set({ level: e.target.value })}>
            <option value="intro">intro</option>
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
            <option value="expert">expert</option>
          </select>
        </div>
      </div>
      <div className="gr-field">
        <label htmlFor="course-desc">Description</label>
        <textarea
          id="course-desc"
          rows={3}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="What does a learner walk away with?"
        />
      </div>

      <h4 className="admin-subhead">Lessons — ordered; each one is a scenario from the catalog</h4>
      {draft.lessons.length === 0 && <p className="admin-empty">No lessons yet. Add scenarios below; order matters.</p>}
      <ol className="admin-editor-lessons">
        {draft.lessons.map((l, i) => {
          const s = scenarioByLabId.get(l.labId);
          return (
            <li key={`${l.labId}-${i}`}>
              <span className="gr-mono-note">{String(i + 1).padStart(2, "0")}</span>
              <div className="lesson-fields">
                <span className="lesson-lab">
                  {s?.title ?? l.labId} <code>{l.labId}</code>
                </span>
                <input
                  value={l.title ?? ""}
                  placeholder="Course-voice title (optional)"
                  onChange={(e) =>
                    setDraft((d) => {
                      const lessons = [...d.lessons];
                      lessons[i] = { ...lessons[i], title: e.target.value || undefined };
                      return { ...d, lessons };
                    })
                  }
                />
                <input
                  value={l.note ?? ""}
                  placeholder="One-line note under the title (optional)"
                  onChange={(e) =>
                    setDraft((d) => {
                      const lessons = [...d.lessons];
                      lessons[i] = { ...lessons[i], note: e.target.value || undefined };
                      return { ...d, lessons };
                    })
                  }
                />
              </div>
              <span className="lesson-actions">
                <button title="Move up" onClick={() => moveLesson(i, -1)} disabled={i === 0}>↑</button>
                <button title="Move down" onClick={() => moveLesson(i, 1)} disabled={i === draft.lessons.length - 1}>↓</button>
                <button
                  title="Remove"
                  className="admin-danger"
                  onClick={() => setDraft((d) => ({ ...d, lessons: d.lessons.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="admin-add-lesson">
        <select value={addLabId} onChange={(e) => setAddLabId(e.target.value)}>
          {scenarios.map((s) => (
            <option key={s.labId} value={s.labId}>
              {s.title} ({s.labId})
            </option>
          ))}
        </select>
        <button
          className="gr-btn gr-btn-ghost gr-btn-small"
          onClick={() => addLabId && setDraft((d) => ({ ...d, lessons: [...d.lessons, { labId: addLabId }] }))}
        >
          Add lesson
        </button>
      </div>

      {error && <p className="admin-error">{error}</p>}
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary" onClick={save} disabled={saving || !draft.title.trim()}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create course"}
        </button>
        <button className="gr-btn gr-btn-ghost" onClick={() => onDone(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </article>
  );
}

/* ================= sessions (history + replay) ================= */

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function SessionsView({
  sessions,
  scenarioByLabId,
}: {
  sessions: AdminSessionSummary[] | null;
  scenarioByLabId: Map<string, Scenario>;
}) {
  const [learner, setLearner] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "finished" | "in-progress">("all");
  const [kind, setKind] = useState<"all" | "learner" | "sim">("all");
  const [replayId, setReplayId] = useState<string | null>(null);

  if (!sessions) return <p className="admin-loading">Loading sessions…</p>;
  if (sessions.length === 0)
    return (
      <p className="admin-loading">
        No sessions on record yet — history starts accumulating as soon as someone opens the desktop.
      </p>
    );

  const learners = [...new Set(sessions.map((s) => s.learnerId))];
  const rows = sessions.filter(
    (s) =>
      (learner === "all" || s.learnerId === learner) &&
      (status === "all" || (status === "finished" ? s.completed : !s.completed)) &&
      (kind === "all" || (s.kind ?? "learner") === kind),
  );

  if (replayId) return <ReplayView sessionId={replayId} onBack={() => setReplayId(null)} />;

  return (
    <div className="admin-stack">
      <p className="admin-lede-note">
        Every scenario experience a learner has opened — finished or not. Each session's recording is a
        replay of its measured event log: commands, edits, test runs, and the full guide conversation,
        in the order they happened.
      </p>
      <div className="admin-session-filters">
        <label>
          <span className="gr-mono-note">LEARNER</span>
          <select value={learner} onChange={(e) => setLearner(e.target.value)}>
            <option value="all">All learners</option>
            {learners.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="gr-mono-note">STATUS</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All</option>
            <option value="finished">Finished</option>
            <option value="in-progress">Not finished</option>
          </select>
        </label>
        <label>
          <span className="gr-mono-note">DRIVER</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">All</option>
            <option value="learner">Real learners</option>
            <option value="sim">Simulated (sim-test)</option>
          </select>
        </label>
        <span className="gr-mono-note">
          {rows.length} OF {sessions.length} SESSIONS
        </span>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Learner</th>
            <th>Scenario</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Activity</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.sessionId}>
              <td>{fmtWhen(s.createdAt)}</td>
              <td>
                <code>{s.learnerId.slice(0, 14)}…</code>
              </td>
              <td>{scenarioByLabId.get(s.labId)?.title ?? s.labId}</td>
              <td>
                <span className={`admin-chip ${s.completed ? "status-mastered" : ""}`}>
                  {s.completed ? "finished" : s.live ? "live now" : "not finished"}
                </span>
                {s.status === "abandoned" && <span className="admin-chip status-abandoned">abandoned</span>}
                {s.kind === "sim" && <span className="admin-chip kind-llm" title="Driven by the pre-publish simulated learner">sim</span>}
              </td>
              <td>{fmtDuration(s.durationMs)}</td>
              <td>
                {s.counts.commands} cmds · {s.counts.questions} asks · {s.counts.hints} hints · {s.counts.testRuns} test runs
              </td>
              <td>
                <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => setReplayId(s.sessionId)}>
                  ▶ Replay
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- the replay player: the event log, played back in order ---------- */

interface Beat {
  at: string;
  offsetMs: number;
  icon: string;
  kind: "action" | "learner" | "instructor" | "milestone" | "agent";
  title: string;
  detail?: string;
}

function toBeats(events: ReplayEvent[]): Beat[] {
  if (events.length === 0) return [];
  const t0 = Date.parse(events[0].timestamp);
  const beats: Beat[] = [];
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  for (const e of events) {
    const b = (icon: string, kind: Beat["kind"], title: string, detail?: string) =>
      beats.push({ at: e.timestamp, offsetMs: Math.max(0, Date.parse(e.timestamp) - t0), icon, kind, title, detail });
    switch (e.type) {
      case "session.started":
        b("🏁", "milestone", "Session started", str(e.variantId) ? `variant ${str(e.variantId)}` : undefined);
        break;
      case "session.reset":
        b("↺", "milestone", "Workspace reset");
        break;
      case "session.resumed":
        b("▶", "milestone", "Resumed after a break");
        break;
      case "session.abandoned":
        b("⏹", "milestone", "Started over — attempt archived");
        break;
      case "agent.action":
        b("🤖", "agent", `Agent: ${str(e.action)}`, str(e.detail));
        break;
      case "terminal.command.completed": {
        const exit = Number(e.exitCode ?? 0);
        b(exit === 0 ? "＄" : "⚠", "action", `$ ${str(e.command)}`, str(e.outputSummary) || `exit ${exit}`);
        break;
      }
      case "file.changed":
        b("✎", "action", `Edited ${str(e.path)}`);
        break;
      case "git.diff.viewed":
        b("👁", "action", "Viewed the diff", str(e.command));
        break;
      case "tests.completed":
        b(Number(e.failed) > 0 ? "✗" : "✓", "action", `Tests: ${Number(e.passed)} passed, ${Number(e.failed)} failed`);
        break;
      case "checkpoint.evaluated":
        b(
          e.passed === true ? "🏆" : "▢",
          "milestone",
          e.passed === true ? "Checkpoint PASSED" : "Checkpoint attempt — not yet",
          Array.isArray(e.incomplete) && e.incomplete.length > 0 ? `still open: ${(e.incomplete as string[]).join(", ")}` : undefined,
        );
        break;
      case "checkpoint.completed":
        b("🎉", "milestone", "Lab completed");
        break;
      case "learner.goal.stated":
        b("🎯", "learner", str(e.text));
        break;
      case "learner.question":
        b("💬", "learner", str(e.text), e.stuck === true ? "flagged: stuck" : undefined);
        break;
      case "instructor.hint":
        b("🌿", "instructor", str(e.text) || "(words not recorded — session predates replay capture)", `hint level ${Number(e.level)} · ${str(e.strategy)}`);
        break;
      case "instructor.greeting":
        b("🌿", "instructor", str(e.text), "session opening");
        break;
      case "instructor.progress":
        b("🌿", "instructor", str(e.text), `progress: ${Array.isArray(e.completedTaskIds) ? (e.completedTaskIds as string[]).join(", ") : ""}`);
        break;
      case "intervention.delivered":
        b("🔔", "instructor", str(e.text) || "(unprompted check-in — words not recorded)", `trigger: ${str(e.triggerType)}`);
        break;
      case "workspace.app.opened":
        b("🗔", "action", `Opened ${str(e.appId)}`);
        break;
      case "workspace.artifact.opened":
        b("📄", "action", `Opened ${str(e.artifactId)} in ${str(e.appId)}`);
        break;
      case "aichat.context.shared": {
        const restricted = Array.isArray(e.restrictedSpans) ? (e.restrictedSpans as string[]) : [];
        b("📎", "action", `Shared context with the AI helper (${Number(e.chars)} chars)`, restricted.length > 0 ? `restricted: ${restricted.join(", ")}` : "clean share");
        break;
      }
      case "aichat.prompt.submitted":
        b("💭", "action", "Asked the AI helper for a draft");
        break;
      case "aichat.response.generated":
        b("🤖", "agent", "AI helper produced a draft", str(e.draftId));
        break;
      case "workspace.draft.inserted":
        b("📥", "action", "Inserted the AI draft into the reply");
        break;
      case "workspace.draft.updated":
        b("✎", "action", `Edited the reply (revision ${Number(e.revision)})`);
        break;
      case "workspace.artifact.submitted":
        b("📤", "milestone", `Submitted the reply (revision ${Number(e.revision)})`);
        break;
      default:
        break; // audit-only events (intervention.proposed, ui.state.reported, …) stay out of the replay lane
    }
  }
  return beats;
}

function ReplayView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Screen mode (Phase 3): the stored rrweb NDJSON, when this session has one.
  const [mode, setMode] = useState<"timeline" | "screen">("timeline");
  const [screenNdjson, setScreenNdjson] = useState<string | null>(null);
  useEffect(() => {
    adminGet<ReplayPayload>(`/api/admin/sessions/${encodeURIComponent(sessionId)}/replay`)
      .then(setPayload)
      .catch((err) => setError(String((err as Error).message)));
    adminGetText(`/api/admin/sessions/${encodeURIComponent(sessionId)}/rrweb`)
      .then(setScreenNdjson)
      .catch(() => setScreenNdjson(null)); // 404 = no screen replay recorded
  }, [sessionId]);

  if (error) return <p className="admin-error">Couldn't load the replay: {error}</p>;
  if (!payload) return <p className="admin-loading">Loading the session's event log…</p>;
  return (
    <div className="admin-stack">
      <div className="admin-actions">
        <button className={`gr-btn gr-btn-small ${mode === "timeline" ? "gr-btn-primary" : "gr-btn-ghost"}`} onClick={() => setMode("timeline")}>
          Timeline
        </button>
        <button
          className={`gr-btn gr-btn-small ${mode === "screen" ? "gr-btn-primary" : "gr-btn-ghost"}`}
          onClick={() => setMode("screen")}
          disabled={!screenNdjson}
          title={screenNdjson ? "Watch the session as the learner saw it" : "No screen replay recorded for this session"}
        >
          Screen{screenNdjson ? "" : " (none)"}
        </button>
      </div>
      {mode === "screen" && screenNdjson ? (
        <ScreenReplay ndjson={screenNdjson} meta={payload.meta} onBack={onBack} />
      ) : (
        <ReplayPlayer payload={payload} onBack={onBack} />
      )}
    </div>
  );
}

/** Minimal Replayer surface we drive (avoids depending on rrweb internals). */
interface RrwebReplayer {
  play(offsetMs?: number): void;
  pause(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  getMetaData(): { startTime: number; endTime: number; totalTime: number };
  destroy(): void;
  wrapper: HTMLElement;
  iframe: HTMLIFrameElement;
}

/**
 * Pixel-faithful playback of the stored rrweb events via @rrweb/replay's
 * Replayer with a small controls bar. (rrweb-player 2.1.0's published bundle
 * ships its UI shell without the Replayer itself, so we drive the replayer
 * directly.) Lazy-imported — the admin bundle only pays for it when opened.
 */
function ScreenReplay({ ndjson, meta, onBack }: { ndjson: string; meta: ReplayPayload["meta"]; onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<RrwebReplayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [nowMs, setNowMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const events = ndjson
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l) as { type?: unknown; timestamp?: unknown })
          .filter((e) => e.type !== "trellis-cap-reached" && typeof e.timestamp === "number");
        if (events.length < 2) {
          setError("This replay has too few events to play.");
          return;
        }
        const { Replayer } = await import("@rrweb/replay");
        await import("@rrweb/replay/dist/style.css");
        if (disposed || !hostRef.current) return;
        const replayer = new Replayer(events as unknown as ConstructorParameters<typeof Replayer>[0], {
          root: hostRef.current,
          speed: 1,
          showWarning: false,
          mouseTail: { strokeStyle: "#79b473" },
        }) as unknown as RrwebReplayer;
        playerRef.current = replayer;
        setTotalMs(replayer.getMetaData().totalTime);
        // Scale the recorded viewport down into the host card.
        const fit = (): void => {
          const w = hostRef.current?.clientWidth ?? 1024;
          const iw = replayer.iframe.offsetWidth || 1280;
          const scale = Math.min(1, (w - 16) / iw);
          replayer.wrapper.style.transform = `scale(${scale})`;
          replayer.wrapper.style.transformOrigin = "top left";
          if (hostRef.current) hostRef.current.style.height = `${Math.ceil((replayer.iframe.offsetHeight || 720) * scale) + 16}px`;
        };
        fit();
        window.addEventListener("resize", fit);
        // The clock rides the replayer's own event stream (getCurrentTime is
        // unreliable outside rrweb-player's controller).
        const start = replayer.getMetaData().startTime;
        replayer.on("event-cast", (e) => {
          const ts = (e as { timestamp?: number }).timestamp;
          if (typeof ts === "number") setNowMs(Math.max(0, ts - start));
        });
        replayer.on("finish", () => setPlaying(false));
        return () => window.removeEventListener("resize", fit);
      } catch (err) {
        setError(`Couldn't start the screen replay: ${String((err as Error).message)}`);
      }
    })();
    return () => {
      disposed = true;
      playerRef.current?.pause();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [ndjson]);

  const seek = (ms: number): void => {
    const p = playerRef.current;
    if (!p) return;
    setNowMs(ms);
    if (playing) p.play(ms);
    else {
      // pause-at-offset: play(offset) then pause renders the frame at that time.
      p.play(ms);
      p.pause();
    }
  };

  return (
    <div className="admin-stack">
      <div className="admin-replay-head">
        <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={onBack}>
          ← All sessions
        </button>
        <div>
          <h3>{meta.labTitle}</h3>
          <p className="gr-mono-note">{meta.learnerId} · started {fmtWhen(meta.createdAt)} · screen replay</p>
        </div>
      </div>
      {error && <p className="admin-error">{error}</p>}
      <div className="gr-card admin-replay">
        <div className="admin-replay-controls">
          <button
            className="gr-btn gr-btn-primary gr-btn-small"
            onClick={() => {
              const p = playerRef.current;
              if (!p) return;
              if (playing) {
                p.pause();
                setPlaying(false);
              } else {
                p.play(nowMs >= totalMs ? 0 : nowMs);
                setPlaying(true);
              }
            }}
          >
            {playing ? "⏸ Pause" : nowMs >= totalMs && totalMs > 0 ? "↺ Replay" : "▶ Play"}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(totalMs, 1)}
            value={Math.min(nowMs, totalMs)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Scrub through the screen replay"
          />
          <span className="gr-mono-note replay-clock">
            +{fmtDuration(nowMs)} / {fmtDuration(totalMs)}
          </span>
          <span className="admin-replay-speed">
            {[1, 4, 16].map((s) => (
              <button
                key={s}
                className={speed === s ? "active" : ""}
                onClick={() => {
                  setSpeed(s);
                  const p = playerRef.current as (RrwebReplayer & { setConfig?: (c: { speed: number }) => void }) | null;
                  p?.setConfig?.({ speed: s });
                }}
              >
                {s}×
              </button>
            ))}
          </span>
        </div>
        <div className="admin-screen-replay" ref={hostRef} />
      </div>
    </div>
  );
}

function ReplayPlayer({ payload, onBack }: { payload: ReplayPayload; onBack: () => void }) {
  const beats = useMemo(() => toBeats(payload.events), [payload]);
  const [idx, setIdx] = useState(0); // beats[0..idx] are visible
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const feedRef = useRef<HTMLDivElement | null>(null);

  // Playback: real gaps between beats, capped so silence never drags, divided
  // by the speed factor. Advancing past the last beat stops the player.
  useEffect(() => {
    if (!playing) return;
    if (idx >= beats.length - 1) {
      setPlaying(false);
      return;
    }
    const gap = beats[idx + 1].offsetMs - beats[idx].offsetMs;
    const wait = Math.min(Math.max(gap, 300), 6_000) / speed;
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, beats.length - 1)), wait);
    return () => clearTimeout(t);
  }, [playing, idx, beats, speed]);

  // Keep the newest visible beat in view while playing.
  useEffect(() => {
    feedRef.current?.querySelector(".beat.current")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [idx]);

  const total = beats.length;
  const current = beats[Math.min(idx, total - 1)];

  return (
    <div className="admin-stack">
      <div className="admin-replay-head">
        <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={onBack}>
          ← All sessions
        </button>
        <div>
          <h3>{payload.meta.labTitle}</h3>
          <p className="gr-mono-note">
            {payload.meta.learnerId} · started {fmtWhen(payload.meta.createdAt)} · {total} recorded beats
            {payload.meta.live ? " · LIVE SESSION" : ""}
          </p>
        </div>
      </div>

      {total === 0 ? (
        <p className="admin-empty">This session recorded no events.</p>
      ) : (
        <div className="gr-card admin-replay">
          <div className="admin-replay-controls">
            <button
              className="gr-btn gr-btn-primary gr-btn-small"
              onClick={() => {
                if (!playing && idx >= total - 1) setIdx(0); // replay from the top
                setPlaying((p) => !p);
              }}
            >
              {playing ? "⏸ Pause" : idx >= total - 1 ? "↺ Replay" : "▶ Play"}
            </button>
            <input
              type="range"
              min={0}
              max={total - 1}
              value={idx}
              onChange={(e) => {
                setPlaying(false);
                setIdx(Number(e.target.value));
              }}
              aria-label="Scrub through the session"
            />
            <span className="gr-mono-note replay-clock">
              +{fmtDuration(current?.offsetMs ?? 0)} · {idx + 1}/{total}
            </span>
            <span className="admin-replay-speed">
              {[1, 4, 16].map((s) => (
                <button key={s} className={speed === s ? "active" : ""} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </span>
          </div>

          <div className="admin-replay-feed" ref={feedRef}>
            {beats.slice(0, idx + 1).map((b, i) => (
              <div key={i} className={`beat kind-${b.kind}${i === idx ? " current" : ""}`}>
                <span className="beat-time gr-mono-note">+{fmtDuration(b.offsetMs)}</span>
                <span className="beat-icon" aria-hidden="true">
                  {b.icon}
                </span>
                {b.kind === "learner" || b.kind === "instructor" ? (
                  <div className={`beat-bubble ${b.kind}`}>
                    <span className="beat-who gr-mono-note">{b.kind === "learner" ? "LEARNER" : "GUIDE"}</span>
                    <p>{b.title}</p>
                    {b.detail && <span className="beat-detail">{b.detail}</span>}
                  </div>
                ) : (
                  <div className="beat-line">
                    <span className="beat-title">{b.title}</span>
                    {b.detail && <span className="beat-detail">{b.detail}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
