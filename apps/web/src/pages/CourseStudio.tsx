/**
 * Course studio — the operator surface for course-generation runs (Admin tab).
 *
 * Start a run, watch it move through the phase/gate state machine, read each
 * artifact, decide the four human gates, resume an interrupted run, and take an
 * approved run's draft course live. Talks to /api/admin/course-runs; with the
 * offline mock provider (default) a run completes without any model keys, so
 * this whole surface is exercisable in dev.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  courseRunApi,
  type CapabilityGapReport,
  type CapabilityRequest,
  type CourseRunDetail,
  type CourseRunSummary,
  type LiveActivity,
  type GapDecision,
  type GapDisposition,
  type GateId,
  type GateNote,
  type ProviderConfig,
  type ProvidersPayload,
  type RunStatus,
} from "../api.ts";

/* ---------- status vocabulary ---------- */

// Linear order of run states, so a phase/gate rail node can tell whether the
// run is before it, on it, or past it.
const STATUS_ORDER: RunStatus[] = [
  "queued", "framing", "awaiting-frame", "designing", "awaiting-blueprint",
  "authoring", "awaiting-package", "materializing", "awaiting-publish", "approved",
];
const orderOf = (s: RunStatus): number => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
};
const ACTIVE_PHASES: RunStatus[] = ["framing", "designing", "authoring", "materializing"];
const isActive = (s: RunStatus) => ACTIVE_PHASES.includes(s);
const awaitingGateId = (s: RunStatus): GateId | null =>
  s.startsWith("awaiting-") ? (s.slice("awaiting-".length) as GateId) : null;

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", framing: "Framing", designing: "Designing", authoring: "Authoring",
  materializing: "Materializing", "awaiting-frame": "Awaiting frame gate",
  "awaiting-blueprint": "Awaiting blueprint gate", "awaiting-package": "Awaiting package gate",
  "awaiting-publish": "Awaiting publish gate", approved: "Approved", interrupted: "Interrupted",
  archived: "Archived", failed: "Failed",
};

const RAIL: Array<{ kind: "phase" | "gate" | "done"; status: RunStatus; gate?: GateId; label: string }> = [
  { kind: "phase", status: "framing", label: "Frame" },
  { kind: "gate", status: "awaiting-frame", gate: "frame", label: "G1 · Frame" },
  { kind: "phase", status: "designing", label: "Design" },
  { kind: "gate", status: "awaiting-blueprint", gate: "blueprint", label: "G2 · Blueprint" },
  { kind: "phase", status: "authoring", label: "Author" },
  { kind: "gate", status: "awaiting-package", gate: "package", label: "G3 · Package" },
  { kind: "phase", status: "materializing", label: "Materialize" },
  { kind: "gate", status: "awaiting-publish", gate: "publish", label: "G4 · Publish" },
  { kind: "done", status: "approved", label: "Approved" },
];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/* ================= top-level ================= */

export function CourseStudio({ onCoursesChanged }: { onCoursesChanged: () => void }) {
  const [runs, setRuns] = useState<CourseRunSummary[] | null>(null);
  const [requests, setRequests] = useState<CapabilityRequest[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    courseRunApi.list().then(setRuns).catch((e) => setError(String((e as Error).message)));
    courseRunApi.capabilityRequests().then(setRequests).catch(() => setRequests([]));
  }, []);
  useEffect(() => refresh(), [refresh]);

  if (openId) {
    return <RunDetail runId={openId} onBack={() => { setOpenId(null); refresh(); }} onCoursesChanged={onCoursesChanged} />;
  }

  return (
    <div className="admin-stack">
      <p className="admin-lede-note">
        Generate a course under human control: start a run, then approve each of the four gates. Nothing
        reaches learners until you review the draft and take it live. With no model configured the built-in
        mock produces a small course so you can walk the whole flow.
      </p>
      {error && <p className="admin-error">{error}</p>}

      <StartRunForm onStarted={(run) => { refresh(); setOpenId(run.runId); }} />

      {requests.length > 0 && <CommissionOutbox requests={requests} />}

      {runs === null ? (
        <p className="admin-loading">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="admin-empty">No runs yet — start one above.</p>
      ) : (
        <RunsTable runs={runs} onOpen={setOpenId} />
      )}
    </div>
  );
}

/* ================= start form ================= */

function StartRunForm({ onStarted }: { onStarted: (run: CourseRunDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ technology: "", title: "", targetLearner: "", outcome: "", inScope: "", outOfScope: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Model provider selection (mock / Claude / OpenAI-compatible).
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [provider, setProvider] = useState<ProviderConfig["provider"]>("mock");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    if (open && !providers) {
      courseRunApi.providers().then((p) => {
        setProviders(p);
        // Default to the deployment default provider if it's usable.
        const def = p.providers.find((x) => x.id === p.defaultProvider && x.available) ?? p.providers.find((x) => x.available);
        if (def) {
          setProvider(def.id);
          if (def.models?.length) setModel(def.models[0].id);
        }
      }).catch(() => setProviders({ defaultProvider: "mock", defaultModel: null, providers: [{ id: "mock", label: "Mock", available: true }] }));
    }
  }, [open, providers]);
  const chosen = providers?.providers.find((p) => p.id === provider);

  const submit = () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    body.providerConfig =
      provider === "mock"
        ? { provider: "mock" }
        : { provider, model: model.trim(), ...(provider === "openai-compatible" ? { baseUrl: baseUrl.trim() } : {}) };
    courseRunApi.create(body)
      .then((run) => { setBusy(false); setOpen(false); onStarted(run); })
      .catch((e) => { setBusy(false); setError(String((e as Error).message)); });
  };

  if (!open) {
    return (
      <div>
        <button className="gr-btn gr-btn-primary" onClick={() => setOpen(true)}>Start a run</button>
      </div>
    );
  }
  return (
    <article className="gr-card admin-course-editor">
      <h3>Start a generation run</h3>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="cg-tech">Technology *</label>
          <input id="cg-tech" value={form.technology} onChange={(e) => set("technology", e.target.value)} placeholder="Git, Postman, Docker…" />
        </div>
        <div className="gr-field">
          <label htmlFor="cg-title">Working title</label>
          <input id="cg-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Git Fundamentals" />
        </div>
        <div className="gr-field">
          <label htmlFor="cg-learner">Target learner</label>
          <input id="cg-learner" value={form.targetLearner} onChange={(e) => set("targetLearner", e.target.value)} placeholder="Backend engineers new to Git" />
        </div>
      </div>
      <div className="gr-field">
        <label htmlFor="cg-outcome">Intended outcome</label>
        <input id="cg-outcome" value={form.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="Can review a diff and repair a broken test" />
      </div>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="cg-in">In scope</label>
          <input id="cg-in" value={form.inScope} onChange={(e) => set("inScope", e.target.value)} />
        </div>
        <div className="gr-field">
          <label htmlFor="cg-out">Out of scope</label>
          <input id="cg-out" value={form.outOfScope} onChange={(e) => set("outOfScope", e.target.value)} />
        </div>
      </div>
      <h4 className="admin-subhead">Model provider</h4>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="cg-provider">Provider</label>
          <select id="cg-provider" value={provider} onChange={(e) => {
            const id = e.target.value as ProviderConfig["provider"];
            setProvider(id);
            const p = providers?.providers.find((x) => x.id === id);
            setModel(p?.models?.[0]?.id ?? "");
          }}>
            {(providers?.providers ?? [{ id: "mock", label: "Mock", available: true }]).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.label}{p.available ? "" : ` — set ${p.keyEnv} to enable`}
              </option>
            ))}
          </select>
        </div>
        {provider !== "mock" && (
          <div className="gr-field">
            <label htmlFor="cg-model">Model</label>
            {chosen?.models?.length ? (
              <select id="cg-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {chosen.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : (
              <input id="cg-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
            )}
          </div>
        )}
        {provider === "openai-compatible" && (
          <div className="gr-field">
            <label htmlFor="cg-baseurl">Base URL</label>
            <input id="cg-baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234/v1" />
          </div>
        )}
      </div>
      {provider === "mock" && <p className="gr-mono-note">Mock is deterministic and offline — great for trying the flow. Pick Claude or an OpenAI-compatible endpoint for the real thing (the API key is read from the server environment).</p>}
      {chosen?.note && provider !== "mock" && <p className="gr-mono-note">{chosen.note}</p>}

      {error && <p className="admin-error">{error}</p>}
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary" onClick={submit} disabled={busy || !form.technology.trim() || (provider !== "mock" && !model.trim())}>
          {busy ? "Starting…" : "Start run"}
        </button>
        <button className="gr-btn gr-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </article>
  );
}

/* ================= runs table ================= */

function RunsTable({ runs, onOpen }: { runs: CourseRunSummary[]; onOpen: (id: string) => void }) {
  const pending = runs
    .filter((r) => r.pendingGate || r.status === "interrupted")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); // most recent first
  const ordered = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      {pending.length > 0 && (
        <div className="gr-card">
          <h3>Needs your decision</h3>
          <ul className="admin-claims">
            {pending.map((r) => (
              <li key={r.runId} onClick={() => onOpen(r.runId)} style={{ cursor: "pointer" }}>
                <span className={`admin-chip ${r.status === "interrupted" ? "status-abandoned" : "status-mastered"}`}>
                  {r.status === "interrupted" ? "interrupted" : `gate: ${r.pendingGate}`}
                </span>
                <strong>{r.title ?? r.technology}</strong> <code className="gr-mono-note">{r.runId}</code>
                <time className="gr-mono-note" dateTime={r.updatedAt} title={r.updatedAt} style={{ marginLeft: "auto" }}>
                  {fmtWhen(r.updatedAt)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="admin-table admin-clickable">
        <thead>
          <tr><th>Run</th><th>Technology</th><th>Status</th><th>Gate</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.runId} onClick={() => onOpen(r.runId)} title="Open this run">
              <td><strong>{r.title ?? "(untitled)"}</strong> <code className="gr-mono-note">{r.runId.slice(0, 20)}</code></td>
              <td>{r.technology}</td>
              <td><StatusChip status={r.status} /></td>
              <td>{r.pendingGate ? <span className="admin-chip status-mastered">{r.pendingGate}</span> : "—"}</td>
              <td>{fmtWhen(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ---------- commission outbox ---------- */

function CommissionOutbox({ requests }: { requests: CapabilityRequest[] }) {
  return (
    <div className="gr-card">
      <h3>Commissioned capabilities <span className="gr-mono-note">{requests.length} open</span></h3>
      <p className="admin-lede-note">
        Gaps the generator asked the code side to build. A dev picks these up from
        <code> curriculum/capability-requests/</code>; once the capability ships, its blocked lessons can be authored.
      </p>
      <table className="admin-table">
        <thead><tr><th>Capability</th><th>From run</th><th>Blocks</th><th>Status</th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.gapId}>
              <td><code>{r.gapId}</code></td>
              <td>{r.technology} <code className="gr-mono-note">{r.runId.slice(0, 16)}</code></td>
              <td>{r.blockedLessons.join(", ")}</td>
              <td><span className="admin-chip">{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ status }: { status: RunStatus }) {
  const cls = status === "approved" ? "status-mastered" : status === "interrupted" || status === "archived" || status === "failed" ? "status-abandoned" : "";
  return <span className={`admin-chip ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/* ================= run detail ================= */

function RunDetail({ runId, onBack, onCoursesChanged }: { runId: string; onBack: () => void; onCoursesChanged: () => void }) {
  const [run, setRun] = useState<CourseRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    courseRunApi.get(runId).then(setRun).catch((e) => setError(String((e as Error).message)));
  }, [runId]);

  // Poll while a phase is executing (state changes on its own); stop when parked.
  useEffect(() => {
    load();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  useEffect(() => {
    if (run && (isActive(run.status) || run.status === "queued")) {
      timer.current = setTimeout(load, 1200);
      return () => { if (timer.current) clearTimeout(timer.current); };
    }
  }, [run, load]);

  if (error) return <p className="admin-error">Couldn't load the run: {error}</p>;
  if (!run) return <p className="admin-loading">Loading run…</p>;

  const gate = awaitingGateId(run.status);

  return (
    <div className="admin-stack">
      <div className="admin-replay-head">
        <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={onBack}>← All runs</button>
        <div>
          <h3>{run.title ?? run.technology}</h3>
          <p className="gr-mono-note">{run.runId} · {run.technology} · {run.provider ?? "mock"}{run.model ? ` (${run.model})` : ""} · <StatusChip status={run.status} /></p>
        </div>
      </div>

      {run.status === "interrupted" && (
        <div className="gr-card">
          <p className="admin-error">Interrupted: {run.lastError ?? "unknown error"}</p>
          <button className="gr-btn gr-btn-primary gr-btn-small" onClick={() => courseRunApi.resume(runId).then(setRun)}>Resume</button>
        </div>
      )}

      <PhaseRail run={run} />
      <LivePanel run={run} />
      <RunEconomics events={run.events} />

      {gate && <GateBar run={run} gate={gate} onDecided={setRun} />}
      {run.status === "approved" && <GoLive run={run} onCoursesChanged={onCoursesChanged} />}

      <LessonBoard run={run} />
      <QualityGates run={run} />
      <ArtifactViewer run={run} />
      <ActivityFeed events={run.events} />

      {run.status !== "approved" && !isActive(run.status) && run.status !== "archived" && (
        <div>
          <button
            className="gr-btn gr-btn-ghost gr-btn-small admin-danger"
            onClick={() => { if (window.confirm("Archive this run? It can't be resumed.")) courseRunApi.archive(runId).then(setRun); }}
          >
            Archive run
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- phase rail ---------- */

function PhaseRail({ run }: { run: CourseRunDetail }) {
  const pos = orderOf(run.status);
  const decisionOf = (gate: GateId) => run.gates.filter((g) => g.gateId === gate).at(-1)?.decision ?? null;
  return (
    <div className="gr-card">
      <h3>Progress</h3>
      <ol className="cg-rail">
        {RAIL.map((node) => {
          const nodePos = orderOf(node.status);
          let state = "pending";
          if (node.kind === "gate" && node.gate) {
            const d = decisionOf(node.gate);
            if (d === "approved") state = "passed";
            else if (d === "changes") state = "changes";
            else if (run.status === node.status) state = "active";
          } else if (run.status === node.status) {
            state = run.status === "interrupted" ? "interrupted" : "active";
          } else if (nodePos < pos) state = "passed";
          return (
            <li key={node.label} className={`cg-rail-node ${node.kind} ${state}`}>
              <span className="cg-rail-dot" aria-hidden="true" />
              <span className="cg-rail-label">{node.label}</span>
              {node.kind === "gate" && <span className="cg-rail-state gr-mono-note">{state}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- live model activity (streaming thinking + output) ---------- */

function LivePanel({ run }: { run: CourseRunDetail }) {
  const [live, setLive] = useState<LiveActivity | null>(null);
  const thinkRef = useRef<HTMLPreElement | null>(null);
  const outRef = useRef<HTMLPreElement | null>(null);
  const active = isActive(run.status) || run.status === "queued";

  useEffect(() => {
    if (!active) { setLive(null); return; }
    let stop = false;
    const tick = () => {
      courseRunApi.live(run.runId).then((l) => { if (!stop) setLive(l); }).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 700);
    return () => { stop = true; clearInterval(t); };
  }, [run.runId, active, run.status]);

  // Keep the thinking + output panels tailing the newest text as it streams.
  useEffect(() => { if (thinkRef.current) thinkRef.current.scrollTop = thinkRef.current.scrollHeight; }, [live?.thinking]);
  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [live?.text]);

  if (!active) return null;
  return (
    <div className="gr-card cg-live">
      <h3>
        Live <span className="cg-live-dot" aria-hidden="true" />
        {live ? <span className="gr-mono-note"> {live.role} · {live.task}</span> : <span className="gr-mono-note"> waiting for the model…</span>}
      </h3>
      {live?.thinking && (
        <>
          <p className="gr-mono-note">THINKING</p>
          <pre className="cg-live-think" ref={thinkRef}>{live.thinking}</pre>
        </>
      )}
      {live?.text && (
        <>
          <p className="gr-mono-note">OUTPUT</p>
          <pre className="cg-live-out" ref={outRef}>{live.text}</pre>
        </>
      )}
      {live && !live.thinking && !live.text && <p className="admin-empty">The model is working…</p>}
    </div>
  );
}

/* ---------- economics strip (from the event feed) ---------- */

function RunEconomics({ events }: { events: CourseRunDetail["events"] }) {
  const { calls, tokens } = useMemo(() => {
    let calls = 0, tokens = 0;
    for (const e of events) {
      if (e.type === "model.invoked") {
        calls++;
        tokens += Number((e.payload as { outputTokens?: number })?.outputTokens ?? 0);
      }
    }
    return { calls, tokens };
  }, [events]);
  return (
    <div className="admin-stats">
      <div className="admin-stat"><span className="v">{calls}</span><span className="l">Model calls</span></div>
      <div className="admin-stat"><span className="v">{tokens.toLocaleString()}</span><span className="l">Output tokens</span></div>
    </div>
  );
}

/* ---------- gate decision bar ---------- */

function GateBar({ run, gate, onDecided }: { run: CourseRunDetail; gate: GateId; onDecided: (r: CourseRunDetail) => void }) {
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [notes, setNotes] = useState<GateNote[]>([{ comment: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Blueprint gate: the capability-gap report + the operator's dispositions.
  const [gaps, setGaps] = useState<CapabilityGapReport | null>(null);
  const [dispositions, setDispositions] = useState<Record<string, GapDisposition>>({});
  const by = "operator";

  useEffect(() => {
    if (gate === "blueprint" && run.artifacts.includes("capability-gaps.json")) {
      courseRunApi.artifact(run.runId, "capability-gaps.json")
        .then((a) => setGaps(JSON.parse(a.content) as CapabilityGapReport))
        .catch(() => setGaps(null));
    }
  }, [gate, run]);

  const undecidedGaps = (gaps?.gaps ?? []).filter((g) => !dispositions[g.capabilityId] && !g.disposition);

  const decide = (decision: "approved" | "changes" | "rejected") => {
    if (decision === "changes") {
      const clean = notes.filter((n) => n.comment.trim());
      if (clean.length === 0) { setError("Add at least one change note."); return; }
      submit(decision, clean);
    } else {
      if (decision === "approved" && undecidedGaps.length > 0) {
        setError(`Disposition the ${undecidedGaps.length} capability gap(s) before approving.`);
        return;
      }
      submit(decision, null);
    }
  };
  const submit = (decision: "approved" | "changes" | "rejected", n: GateNote[] | null) => {
    setBusy(true); setError(null);
    const gapDecisions: GapDecision[] = Object.entries(dispositions).map(([capabilityId, disposition]) => ({ capabilityId, disposition }));
    courseRunApi.decide(run.runId, gate, decision, n, by, gate === "blueprint" ? gapDecisions : undefined)
      .then((r) => { setBusy(false); setMode("idle"); onDecided(r); })
      .catch((e) => { setBusy(false); setError(String((e as Error).message)); });
  };

  return (
    <div className="gr-card cg-gatebar">
      <h3>Gate: {gate}</h3>
      <p className="gr-mono-note">This run is awaiting your decision on the {gate} gate.</p>

      {gate === "blueprint" && gaps && gaps.gaps.length > 0 && (
        <div className="cg-gaps">
          <h4 className="admin-subhead">Capability gaps — the course needs {gaps.gaps.length} capabilit{gaps.gaps.length === 1 ? "y" : "ies"} this build lacks</h4>
          <p className="gr-mono-note">Disposition each before approving. Commission writes a request for the code side; defer drops the lesson; redesign = request changes so the architect reworks it.</p>
          <table className="admin-table">
            <thead><tr><th>Capability</th><th>Blocks lessons</th><th>Disposition</th></tr></thead>
            <tbody>
              {gaps.gaps.map((g) => (
                <tr key={g.capabilityId}>
                  <td><code>{g.capabilityId}</code></td>
                  <td>{g.lessons.join(", ")}</td>
                  <td>
                    <select
                      value={dispositions[g.capabilityId] ?? g.disposition ?? ""}
                      onChange={(e) => setDispositions((d) => ({ ...d, [g.capabilityId]: e.target.value as GapDisposition }))}
                    >
                      <option value="" disabled>choose…</option>
                      <option value="commission">Commission (build it)</option>
                      <option value="defer">Defer (drop lesson)</option>
                      <option value="redesign">Redesign (rework lesson)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === "changes" ? (
        <div>
          {notes.map((n, i) => (
            <div key={i} className="admin-editor-grid" style={{ marginBottom: 8 }}>
              <div className="gr-field">
                <label>Artifact / lesson (optional)</label>
                <input value={n.path ?? ""} onChange={(e) => setNotes((ns) => ns.map((x, j) => (j === i ? { ...x, path: e.target.value || undefined } : x)))} placeholder="lesson-inventory.json" />
              </div>
              <div className="gr-field" style={{ gridColumn: "span 2" }}>
                <label>What must change</label>
                <input value={n.comment} onChange={(e) => setNotes((ns) => ns.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} placeholder="Narrow the audience to backend engineers" />
              </div>
            </div>
          ))}
          <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => setNotes((ns) => [...ns, { comment: "" }])}>+ Add note</button>
          {error && <p className="admin-error">{error}</p>}
          <div className="admin-editor-actions">
            <button className="gr-btn gr-btn-primary" onClick={() => decide("changes")} disabled={busy}>Request changes</button>
            <button className="gr-btn gr-btn-ghost" onClick={() => setMode("idle")} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="admin-editor-actions">
          <button className="gr-btn gr-btn-primary" onClick={() => decide("approved")} disabled={busy}>Approve</button>
          <button className="gr-btn gr-btn-ghost" onClick={() => setMode("changes")} disabled={busy}>Request changes</button>
          <button className="gr-btn gr-btn-ghost admin-danger" onClick={() => { if (window.confirm("Reject and archive this run?")) decide("rejected"); }} disabled={busy}>Reject</button>
          {error && <p className="admin-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- go-live (approved run's draft course) ---------- */

function GoLive({ run, onCoursesChanged }: { run: CourseRunDetail; onCoursesChanged: () => void }) {
  const [manifest, setManifest] = useState<{ courseId?: string; lessons?: string[] } | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (run.artifacts.includes("manifest.json")) {
      courseRunApi.artifact(run.runId, "manifest.json").then((a) => setManifest(JSON.parse(a.content))).catch(() => {});
    }
  }, [run]);

  if (!manifest?.courseId) {
    return <div className="gr-card"><h3>Approved</h3><p className="admin-empty">Materialization complete. (No course manifest found.)</p></div>;
  }
  const go = (publish: boolean) => {
    setBusy(true);
    const call = publish ? courseRunApi.publishCourse(manifest.courseId!) : courseRunApi.unpublishCourse(manifest.courseId!);
    call.then(() => { setBusy(false); setLive(publish); onCoursesChanged(); }).catch(() => setBusy(false));
  };
  return (
    <div className="gr-card">
      <h3>Draft course ready</h3>
      <p>
        Course <code>{manifest.courseId}</code> · {manifest.lessons?.length ?? 0} lessons. It stays a draft —
        hidden from learners — until you take it live.
      </p>
      <div className="admin-editor-actions">
        {live ? (
          <button className="gr-btn gr-btn-ghost" onClick={() => go(false)} disabled={busy}>Unpublish</button>
        ) : (
          <button className="gr-btn gr-btn-primary" onClick={() => go(true)} disabled={busy}>Go live</button>
        )}
        {live && <span className="admin-chip status-mastered">live</span>}
      </div>
    </div>
  );
}

/* ---------- lesson board (with pedagogy scores) ---------- */

interface InventoryEntry { lessonId: string; level: string; sequence: number; title: string; primaryCapability: string }
interface ReviewOutcome {
  lessonId: string;
  passed: boolean;
  pedagogy: { scores: Record<string, number> };
  technical: { verdict: string };
  cohesion: { verdict: string };
  failingCategories: string[];
}
const PED_ORDER = ["priorKnowledge", "mentalModel", "activeLearning", "feedback", "mastery"];
const PED_SHORT: Record<string, string> = { priorKnowledge: "PK", mentalModel: "MM", activeLearning: "AL", feedback: "FB", mastery: "MA" };

function LessonBoard({ run }: { run: CourseRunDetail }) {
  const [inv, setInv] = useState<InventoryEntry[] | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewOutcome>>({});
  useEffect(() => {
    if (run.artifacts.includes("lesson-inventory.json")) {
      courseRunApi.artifact(run.runId, "lesson-inventory.json").then((a) => setInv(JSON.parse(a.content))).catch(() => setInv([]));
    }
    if (run.artifacts.includes("reviews/summary.json")) {
      courseRunApi.artifact(run.runId, "reviews/summary.json")
        .then((a) => setReviews(Object.fromEntries((JSON.parse(a.content) as ReviewOutcome[]).map((o) => [o.lessonId, o]))))
        .catch(() => setReviews({}));
    }
  }, [run]);
  if (!inv || inv.length === 0) return null;

  const authored = new Set(run.events.filter((e) => e.type === "lesson.authored").map((e) => (e.payload as { lessonId: string }).lessonId));
  const blocked = new Set(run.events.filter((e) => e.type === "lesson.blocked").map((e) => (e.payload as { lessonId: string }).lessonId));
  const needsRevision = new Set(run.events.filter((e) => e.type === "lesson.needs-revision").map((e) => (e.payload as { lessonId: string }).lessonId));
  const stateOf = (id: string) => (authored.has(id) ? "authored" : needsRevision.has(id) ? "needs-revision" : blocked.has(id) ? "blocked" : "pending");
  const stateClass = (s: string) => (s === "authored" ? "status-mastered" : s === "blocked" || s === "needs-revision" ? "status-abandoned" : "");
  const hasReviews = Object.keys(reviews).length > 0;

  return (
    <div className="gr-card">
      <h3>Lessons</h3>
      <table className="admin-table">
        <thead>
          <tr><th>#</th><th>Level</th><th>Lesson</th><th>State</th>{hasReviews && <th>Pedagogy (1–5)</th>}{hasReviews && <th>Tech / Cohesion</th>}</tr>
        </thead>
        <tbody>
          {[...inv].sort((a, b) => a.sequence - b.sequence).map((l) => {
            const state = stateOf(l.lessonId);
            const o = reviews[l.lessonId];
            return (
              <tr key={l.lessonId}>
                <td>{l.sequence}</td>
                <td><span className="admin-chip">{l.level}</span></td>
                <td>{l.title} <code className="gr-mono-note">{l.lessonId}</code></td>
                <td><span className={`admin-chip ${stateClass(state)}`}>{state}</span></td>
                {hasReviews && (
                  <td>
                    {o ? (
                      <span className="cg-heat">
                        {PED_ORDER.map((cat) => {
                          const s = o.pedagogy.scores[cat];
                          return <span key={cat} className={`cg-heat-cell${s < 4 ? " low" : ""}`} title={`${cat}: ${s}`}>{PED_SHORT[cat]}<b>{s}</b></span>;
                        })}
                      </span>
                    ) : "—"}
                  </td>
                )}
                {hasReviews && <td>{o ? <span className="gr-mono-note">{o.technical.verdict} / {o.cohesion.verdict}</span> : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- quality gates ---------- */

function QualityGates({ run }: { run: CourseRunDetail }) {
  const [gates, setGates] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (run.artifacts.includes("reviews/quality-gates.json")) {
      courseRunApi.artifact(run.runId, "reviews/quality-gates.json").then((a) => setGates(JSON.parse(a.content))).catch(() => setGates(null));
    }
  }, [run]);
  if (!gates) return null;
  return (
    <div className="gr-card">
      <h3>Quality gates</h3>
      <ul className="admin-claims">
        {Object.entries(gates).map(([k, v]) => (
          <li key={k}>
            {typeof v === "boolean" ? <span className={`admin-chip ${v ? "status-mastered" : "status-abandoned"}`}>{v ? "pass" : "fail"}</span> : <span className="admin-chip">{String(v)}</span>}
            <code>{k}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- artifact viewer ---------- */

function ArtifactViewer({ run }: { run: CourseRunDetail }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const open = (path: string) => {
    setSelected(path); setLoading(true);
    courseRunApi.artifact(run.runId, path).then((a) => { setContent(a.content); setLoading(false); }).catch((e) => { setContent(String((e as Error).message)); setLoading(false); });
  };
  if (run.artifacts.length === 0) return null;
  return (
    <div className="gr-card">
      <h3>Artifacts</h3>
      <div className="cg-artifacts">
        <ul className="cg-artifact-list">
          {run.artifacts.map((p) => (
            <li key={p}>
              <button className={`cg-artifact-link${selected === p ? " active" : ""}`} onClick={() => open(p)}>{p}</button>
            </li>
          ))}
        </ul>
        <div className="cg-artifact-body">
          {selected ? (
            loading ? <p className="admin-loading">Loading…</p> : <pre className="cg-artifact-pre">{content}</pre>
          ) : (
            <p className="admin-empty">Select an artifact to read it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- activity feed ---------- */

function ActivityFeed({ events }: { events: CourseRunDetail["events"] }) {
  if (events.length === 0) return null;
  const t0 = Date.parse(events[0].at);
  return (
    <details className="admin-prompt">
      <summary>Activity feed <span className="gr-mono-note">{events.length} events</span></summary>
      <div className="admin-replay-feed">
        {events.map((e, i) => (
          <div key={e.id ?? i} className="beat kind-action">
            <span className="beat-time gr-mono-note">+{Math.max(0, Math.round((Date.parse(e.at) - t0) / 1000))}s</span>
            <div className="beat-line">
              <span className="beat-title">{e.type}</span>
              {e.payload && <span className="beat-detail">{JSON.stringify(e.payload)}</span>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
