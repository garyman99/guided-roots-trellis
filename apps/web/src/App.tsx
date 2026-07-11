/**
 * Trellis web UI — three panels around a terminal-first layout.
 *
 *   left   the lesson: scenario, the agent's message, the trellis task
 *          list (checks itself off as instrumentation observes actions),
 *          and the checkpoint panel
 *   center the terminal
 *   right  the instructor: transcript with hint-ladder badges, "I'm stuck",
 *          "I need more", and the what-the-instructor-sees drawer
 *
 * ⚠ UNVERIFIED IN BUILD SANDBOX (no npm/browser). Every behavior it renders
 * is served by endpoints covered in apps/api/test/e2e.test.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  learnerApi,
  savedCredentials,
  saveCredentials,
  savedLearner,
  type AgentBeat,
  type RequirementResult,
  type SessionCredentials,
  type StatePayload,
} from "./api.ts";
import { Terminal } from "./Terminal.tsx";

const LAB_ID = "inspect-generated-changes";
const POLL_MS = 2000;

export function App() {
  const [creds, setCreds] = useState<SessionCredentials | null>(savedCredentials());
  const [data, setData] = useState<StatePayload | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      const fresh = await api.createSession(LAB_ID);
      saveCredentials(fresh);
      setCreds(fresh);
    } catch (err) {
      setBootError(`Couldn't start a lab session. Is the API running? (${String(err)})`);
    }
  }, []);

  // Reattach to a saved session, or start a new one.
  useEffect(() => {
    if (!creds) {
      void boot();
      return;
    }
    api.state(creds).catch((err: { status?: number }) => {
      if (err.status === 404 || err.status === 401) {
        saveCredentials(null);
        setCreds(null); // triggers a fresh boot
      }
    });
  }, [creds, boot]);

  // State poll: powers the live checklist, readiness cue, and transcript.
  useEffect(() => {
    if (!creds) return;
    let stop = false;
    const tick = async () => {
      try {
        const payload = await api.state(creds);
        if (!stop) setData(payload);
      } catch {
        /* transient poll errors are fine */
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [creds]);

  if (bootError) {
    return (
      <div className="boot-error">
        <p>{bootError}</p>
        <button onClick={() => void boot()}>Try again</button>
      </div>
    );
  }
  if (!creds || !data) return <div className="boot">Starting your lab…</div>;

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">⌗</span> Trellis <span className="brand-sub">by Guided Roots</span>
        </span>
        <span className="lab-title">{data.lab.title}</span>
      </header>
      <main className="panels">
        <LessonPanel creds={creds} data={data} />
        <section className="panel panel-terminal">
          <Terminal creds={creds} />
        </section>
        <InstructorPanel creds={creds} data={data} onNewData={setData} />
      </main>
      <InterventionToast creds={creds} />
    </div>
  );
}

/* ── left: lesson, agent message, trellis, checkpoint ─────────────────── */

function LessonPanel({ creds, data }: { creds: SessionCredentials; data: StatePayload }) {
  return (
    <section className="panel panel-lesson">
      <h2>The scenario</h2>
      <p className="scenario">{data.lab.scenario}</p>
      {data.lab.agentMessage && (
        <div className="agent-card">
          <div className="agent-card-head">
            <span className="agent-avatar">🤖</span> coding agent · just now
          </div>
          <p>{data.lab.agentMessage}</p>
        </div>
      )}
      {data.agentTimeline?.length > 0 && <AgentTimeline beats={data.agentTimeline} />}
      <h2>Your path</h2>
      <TrellisTasks tasks={data.tasks} />
      <CheckpointPanel creds={creds} data={data} />
    </section>
  );
}

/**
 * The signature element: tasks as nodes on a growing trellis. The stem
 * between nodes fills green as instrumentation observes each action —
 * the "it sees me" moment, ambient and immediate.
 */
function TrellisTasks({ tasks }: { tasks: StatePayload["tasks"] }) {
  return (
    <ol className="trellis">
      {tasks.map((t, i) => (
        <li key={t.id} className={t.done ? "done" : i > 0 && tasks[i - 1].done ? "current" : ""}>
          <span className="node" aria-hidden="true">
            {t.done ? "✓" : ""}
          </span>
          <span className="task-text">{t.text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The agent lane, rendered from the event log — same machinery as everything
 * else in Trellis. Prediction-gated (reflection before instruction): the
 * learner commits to a guess about what the agent did before seeing the
 * timeline. The guess isn't graded; committing to it is the point.
 */
function AgentTimeline({ beats }: { beats: AgentBeat[] }) {
  const [revealed, setRevealed] = useState(false);
  const [guess, setGuess] = useState("");
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (!revealed) {
    return (
      <div className="timeline-card">
        <div className="timeline-head">What did the agent actually do?</div>
        <p className="timeline-prompt">
          Before you look: predict it. Did it run the tests? What did it do when they didn't pass?
        </p>
        <input
          className="timeline-guess"
          placeholder="My prediction…"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
        />
        <button className="btn" disabled={guess.trim().length < 3} onClick={() => setRevealed(true)}>
          I've made my prediction — show me
        </button>
      </div>
    );
  }
  return (
    <div className="timeline-card">
      <div className="timeline-head">Agent timeline (measured beats)</div>
      {guess.trim() && <p className="timeline-prompt">Your prediction: “{guess.trim()}”</p>}
      <ol className="timeline">
        {beats.map((b, i) => (
          <li key={i} className={b.action === "ran-tests" ? "timeline-beat warn" : "timeline-beat"}>
            <span className="timeline-time">{fmt(b.at)}</span>
            <span className="timeline-detail">{b.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Shown after the checkpoint passes: the deterministic reflection + its
 * narrative, and a one-tap self-assessment (calibration signal — stated
 * confidence vs measured outcome).
 */
function ReflectionCard({ creds }: { creds: SessionCredentials }) {
  const [refl, setRefl] = useState<{ narrative: string; reflection: { demonstrated: string[]; habitsToImprove: string[] } } | null>(null);
  const [assessed, setAssessed] = useState(false);
  useEffect(() => {
    api.reflection(creds).then(setRefl).catch(() => {});
  }, [creds]);
  if (!refl) return null;
  return (
    <div className="reflection-card">
      <div className="reflection-head">Session reflection</div>
      <p className="reflection-narrative">{refl.narrative}</p>
      {!assessed ? (
        <div className="self-assess">
          <span>How confident were you that your fix was right?</span>
          <div className="self-assess-buttons">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="btn btn-small"
                onClick={() => {
                  api.selfAssess(creds, n).catch(() => {});
                  setAssessed(true);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="self-assess-done">Noted — Trellis tracks how your confidence lines up with outcomes.</p>
      )}
    </div>
  );
}

function CheckpointPanel({ creds, data }: { creds: SessionCredentials; data: StatePayload }) {
  const [result, setResult] = useState<{ passed: boolean; requirements: RequirementResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const completed = data.state.completedCheckpoints.includes(data.checkpoint.id);
  const ready = data.checkpointReady && !completed;

  const kinds = new Map(data.checkpoint.requirements.map((r) => [r.id, r.kind]));
  const isAction = (id: string) => kinds.get(id) === "session";

  const run = async () => {
    setBusy(true);
    try {
      setResult(await api.evaluate(creds));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset the workspace? Your edits will be gone and the agent's change comes back.")) return;
    setResult(null);
    await api.reset(creds);
  };

  const shown = result?.requirements;
  const passed = result?.passed === true;
  return (
    <div className="checkpoint">
      <h2>Checkpoint: {data.checkpoint.title}</h2>
      {completed && <p className="checkpoint-done">✓ Completed — verified by the platform, not by the AI.</p>}
      {ready && !completed && <p className="checkpoint-ready">Everything looks ready — run the check.</p>}
      <div className="row">
        <button className={ready ? "primary pulse" : "primary"} onClick={() => void run()} disabled={busy}>
          {busy ? "Checking…" : "Run the check"}
        </button>
        <button className="ghost" onClick={() => void reset()}>
          Reset lab
        </button>
      </div>
      {shown && (
        <div className="requirements">
          <h3>Things you do</h3>
          <ul>
            {shown.filter((r) => isAction(r.id)).map((r) => (
              <Requirement key={r.id} r={r} />
            ))}
          </ul>
          <h3>Things that must be true</h3>
          <ul>
            {shown.filter((r) => !isAction(r.id)).map((r) => (
              <Requirement key={r.id} r={r} />
            ))}
          </ul>
        </div>
      )}
    {passed && <ReflectionCard creds={creds} />}
      </div>
  );
}

function Requirement({ r }: { r: RequirementResult }) {
  return (
    <li className={r.ok ? "req ok" : "req"}>
      <span aria-hidden="true">{r.ok ? "✓" : "○"}</span> {r.label}
      {!r.ok && r.detail && <div className="req-detail">{r.detail}</div>}
    </li>
  );
}

/* ── right: instructor ─────────────────────────────────────────────────── */

function InstructorPanel({
  creds,
  data,
  onNewData,
}: {
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data.transcript.length]);

  const send = async (text: string, stuck: boolean) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setDraft("");
    try {
      await api.ask(creds, text.trim(), stuck);
      onNewData(await api.state(creds));
    } finally {
      setSending(false);
    }
  };

  const lastLevel = [...data.transcript].reverse().find((m) => m.role === "instructor")?.level;

  return (
    <section className="panel panel-instructor">
      <div className="instructor-head">
        <h2>Instructor</h2>
        <button className="link" onClick={() => setShowContext(true)}>
          What does it see?
        </button>
      </div>
      <div className="transcript" ref={scrollRef}>
        {data.transcript.length === 0 && (
          <p className="empty">
            Ask anything, or press <em>I'm stuck</em>. The instructor sees what you've actually done — not your screen,
            not your keystrokes, just the measured facts.
          </p>
        )}
        {data.transcript.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "instructor" && m.level !== undefined && (
              <span className="hint-badge">Hint {Math.min(m.level + 1, 5)} of 5</span>
            )}
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <div className="composer">
        <textarea
          value={draft}
          placeholder="Ask the instructor…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft, false);
            }
          }}
          rows={2}
        />
        <div className="row">
          <button className="primary" onClick={() => void send(draft, false)} disabled={sending || !draft.trim()}>
            Send
          </button>
          <button className="ghost" onClick={() => void send("I'm stuck.", true)} disabled={sending}>
            I'm stuck
          </button>
          {lastLevel !== undefined && lastLevel < 4 && (
            <button className="ghost" onClick={() => void send("I need a stronger hint.", true)} disabled={sending}>
              I need more
            </button>
          )}
        </div>
      </div>
      {showContext && <ContextDrawer creds={creds} onClose={() => setShowContext(false)} />}
    </section>
  );
}

/** Transparency drawer: the exact context the instructor model receives. */
interface ProfilePayload {
  profile: {
    skills: Array<{ conceptId: string; status: string; confidence: number; explanation: string; evidence: number[] }>;
    hypotheses: Array<{ hypothesisId: string; claim: string; state: string }>;
  };
  recommendations: Array<{ conceptId: string; reason: string }>;
}

function ContextDrawer({ creds, onClose }: { creds: SessionCredentials; onClose: () => void }) {
  const [ctx, setCtx] = useState<{ system: string; user: string } | null>(null);
  const [prof, setProf] = useState<ProfilePayload | null>(null);
  const learner = savedLearner();
  useEffect(() => {
    void api.contextPreview(creds).then(setCtx);
    if (learner) void learnerApi.profile(learner).then(setProf).catch(() => {});
  }, [creds]);
  const contest = (conceptId: string) => {
    if (!learner) return;
    if (!confirm(`Reset "${conceptId}"? Trellis will discard its prior evidence and let you re-earn it.`)) return;
    void learnerApi
      .assert(learner, { kind: "fresh-start", conceptId, note: "contested from drawer" })
      .then(() => learnerApi.profile(learner).then(setProf));
  };
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>What the instructor sees</h2>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="drawer-note">
          This is the full input for the next instructor response. Your terminal activity appears only as the measured
          summary below — anything you typed is marked untrusted and treated as data.
        </p>
        {prof && (
          <div className="profile-block">
            <h3>What Trellis believes about you — and why</h3>
            {prof.profile.skills.filter((s) => s.status !== "unknown").map((s) => (
              <div key={s.conceptId} className={`profile-claim status-${s.status}`}>
                <div className="claim-head">
                  <strong>{s.conceptId}</strong> · {s.status} · confidence {s.confidence}
                  <button className="ghost ghost-small" onClick={() => contest(s.conceptId)}>
                    That's wrong
                  </button>
                </div>
                <div className="claim-why">{s.explanation}</div>
                <div className="claim-evidence">evidence #{s.evidence.join(", #")}</div>
              </div>
            ))}
            {prof.profile.skills.every((s) => s.status === "unknown") && (
              <p className="drawer-note">No claims yet — Trellis only believes what it has measured.</p>
            )}
            {prof.recommendations.length > 0 && (
              <p className="drawer-note">Next up: {prof.recommendations.map((r) => r.conceptId).join(", ")}</p>
            )}
          </div>
        )}
        {ctx ? (
          <>
            <h3>System prompt (versioned)</h3>
            <pre>{ctx.system}</pre>
            <h3>Context</h3>
            <pre>{ctx.user}</pre>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </aside>
    </div>
  );
}

/* ── non-blocking interventions ────────────────────────────────────────── */

function InterventionToast({ creds }: { creds: SessionCredentials }) {
  const [toast, setToast] = useState<{ hint: { message: string; level: number }; triggerType: string } | null>(null);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const { intervention } = await api.intervention(creds);
        if (intervention) setToast(intervention);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [creds]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span className="hint-badge">Instructor</span>
      <p>{toast.hint.message}</p>
      <button className="ghost" onClick={() => setToast(null)}>
        Dismiss
      </button>
    </div>
  );
}
