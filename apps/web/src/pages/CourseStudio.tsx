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
  type CourseRunDetail,
  type CourseRunSummary,
  type GateId,
  type GateNote,
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    courseRunApi.list().then(setRuns).catch((e) => setError(String((e as Error).message)));
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

  const submit = () => {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
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
      {error && <p className="admin-error">{error}</p>}
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary" onClick={submit} disabled={busy || !form.technology.trim()}>
          {busy ? "Starting…" : "Start run"}
        </button>
        <button className="gr-btn gr-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </article>
  );
}

/* ================= runs table ================= */

function RunsTable({ runs, onOpen }: { runs: CourseRunSummary[]; onOpen: (id: string) => void }) {
  const pending = runs.filter((r) => r.pendingGate || r.status === "interrupted");
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
          <p className="gr-mono-note">{run.runId} · {run.technology} · <StatusChip status={run.status} /></p>
        </div>
      </div>

      {run.status === "interrupted" && (
        <div className="gr-card">
          <p className="admin-error">Interrupted: {run.lastError ?? "unknown error"}</p>
          <button className="gr-btn gr-btn-primary gr-btn-small" onClick={() => courseRunApi.resume(runId).then(setRun)}>Resume</button>
        </div>
      )}

      <PhaseRail run={run} />
      <RunEconomics events={run.events} />

      {gate && <GateBar run={run} gate={gate} onDecided={setRun} />}
      {run.status === "approved" && <GoLive run={run} onCoursesChanged={onCoursesChanged} />}

      <LessonBoard run={run} />
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
  const by = "operator";

  const decide = (decision: "approved" | "changes" | "rejected") => {
    if (decision === "changes") {
      const clean = notes.filter((n) => n.comment.trim());
      if (clean.length === 0) { setError("Add at least one change note."); return; }
      submit(decision, clean);
    } else {
      submit(decision, null);
    }
  };
  const submit = (decision: "approved" | "changes" | "rejected", n: GateNote[] | null) => {
    setBusy(true); setError(null);
    courseRunApi.decide(run.runId, gate, decision, n, by)
      .then((r) => { setBusy(false); setMode("idle"); onDecided(r); })
      .catch((e) => { setBusy(false); setError(String((e as Error).message)); });
  };

  return (
    <div className="gr-card cg-gatebar">
      <h3>Gate: {gate}</h3>
      <p className="gr-mono-note">This run is awaiting your decision on the {gate} gate.</p>
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

/* ---------- lesson board ---------- */

interface InventoryEntry { lessonId: string; level: string; sequence: number; title: string; primaryCapability: string }

function LessonBoard({ run }: { run: CourseRunDetail }) {
  const [inv, setInv] = useState<InventoryEntry[] | null>(null);
  useEffect(() => {
    if (run.artifacts.includes("lesson-inventory.json")) {
      courseRunApi.artifact(run.runId, "lesson-inventory.json").then((a) => setInv(JSON.parse(a.content))).catch(() => setInv([]));
    }
  }, [run]);
  if (!inv || inv.length === 0) return null;

  const authored = new Set(run.events.filter((e) => e.type === "lesson.authored").map((e) => (e.payload as { lessonId: string }).lessonId));
  const blocked = new Set(run.events.filter((e) => e.type === "lesson.blocked").map((e) => (e.payload as { lessonId: string }).lessonId));
  const stateOf = (id: string) => (authored.has(id) ? "authored" : blocked.has(id) ? "blocked" : "pending");

  return (
    <div className="gr-card">
      <h3>Lessons</h3>
      <table className="admin-table">
        <thead><tr><th>#</th><th>Level</th><th>Lesson</th><th>Capability</th><th>State</th></tr></thead>
        <tbody>
          {[...inv].sort((a, b) => a.sequence - b.sequence).map((l) => (
            <tr key={l.lessonId}>
              <td>{l.sequence}</td>
              <td><span className="admin-chip">{l.level}</span></td>
              <td>{l.title} <code className="gr-mono-note">{l.lessonId}</code></td>
              <td>{l.primaryCapability}</td>
              <td><span className={`admin-chip ${stateOf(l.lessonId) === "authored" ? "status-mastered" : stateOf(l.lessonId) === "blocked" ? "status-abandoned" : ""}`}>{stateOf(l.lessonId)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
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
