/**
 * Course studio — the operator surface for course-generation runs (Admin tab).
 *
 * Start a run, watch it move through the phase/gate state machine, read each
 * artifact, decide the four human gates, resume an interrupted run, and take an
 * approved run's draft course live. Talks to /api/admin/course-runs; with the
 * offline mock provider (default) a run completes without any model keys, so
 * this whole surface is exercisable in dev.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  courseRunApi,
  personaApi,
  simTestApi,
  type SimLessonResult,
  type SimTestJobView,
  type Course,
  type CapabilityGapReport,
  type CapabilityRequest,
  type CourseRunDetail,
  type CourseRunSummary,
  type LiveActivity,
  type GapDecision,
  type GapDisposition,
  type GateId,
  type GateNote,
  type PersonaInterviewMessage,
  type PersonaProfile,
  type ProviderConfig,
  type ProvidersPayload,
  type RunStatus,
} from "../api.ts";
import { LessonExperiencePanel } from "./LessonExperience.tsx";

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
  const [personas, setPersonas] = useState<PersonaProfile[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Personas | Runs sub-view. Defining WHO the course is for comes before
  // generating it — with no ready persona, the studio lands on Personas.
  const [view, setView] = useState<"personas" | "runs" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    courseRunApi.list().then(setRuns).catch((e) => setError(String((e as Error).message)));
    courseRunApi.capabilityRequests().then(setRequests).catch(() => setRequests([]));
    personaApi.list().then(setPersonas).catch(() => setPersonas([]));
  }, []);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (view === null && personas !== null) setView(personas.some((p) => p.status === "ready") ? "runs" : "personas");
  }, [view, personas]);

  if (openId) {
    return <RunDetail runId={openId} onBack={() => { setOpenId(null); refresh(); }} onCoursesChanged={onCoursesChanged} />;
  }

  const readyCount = (personas ?? []).filter((p) => p.status === "ready").length;
  return (
    <div className="admin-stack">
      <p className="admin-lede-note">
        Generate a course under human control: define WHO it's for (a persona), start a run, then approve
        each of the four gates. Nothing reaches learners until you review the draft and take it live. With
        no model configured the built-in mock produces a small course so you can walk the whole flow.
      </p>
      {error && <p className="admin-error">{error}</p>}

      <div className="admin-actions" role="tablist" aria-label="Course studio views">
        <button
          className={`gr-btn ${view === "personas" ? "gr-btn-primary" : "gr-btn-ghost"}`}
          onClick={() => setView("personas")}
        >
          Personas{personas ? ` (${readyCount} ready)` : ""}
        </button>
        <button className={`gr-btn ${view === "runs" ? "gr-btn-primary" : "gr-btn-ghost"}`} onClick={() => setView("runs")}>
          Runs{runs ? ` (${runs.length})` : ""}
        </button>
      </div>

      {view === "personas" ? (
        <PersonaLibrary personas={personas} onChanged={refresh} />
      ) : (
        <RunsView
          runs={runs}
          requests={requests}
          personas={personas ?? []}
          onGoPersonas={() => setView("personas")}
          onOpen={setOpenId}
          onStarted={(run) => { refresh(); setOpenId(run.runId); }}
          onChanged={() => { refresh(); onCoursesChanged(); }}
        />
      )}
    </div>
  );
}

function RunsView({ runs, requests, personas, onGoPersonas, onOpen, onStarted, onChanged }: {
  runs: CourseRunSummary[] | null;
  requests: CapabilityRequest[];
  personas: PersonaProfile[];
  onGoPersonas: () => void;
  onOpen: (id: string) => void;
  onStarted: (run: CourseRunDetail) => void;
  onChanged: () => void;
}) {
  return (
    <div className="admin-stack">
      <StartRunForm onStarted={onStarted} personas={personas} onGoPersonas={onGoPersonas} />

      {requests.length > 0 && <CommissionOutbox requests={requests} />}

      {runs === null ? (
        <p className="admin-loading">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="admin-empty">No runs yet — start one above.</p>
      ) : (
        <RunsTable runs={runs} onOpen={onOpen} onChanged={onChanged} />
      )}
    </div>
  );
}

/* ================= personas (quality-rework Phase 1) ================= */

function PersonaLibrary({ personas, onChanged }: { personas: PersonaProfile[] | null; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (openId) {
    return <PersonaWorkbench personaId={openId} onBack={() => { setOpenId(null); onChanged(); }} />;
  }

  const create = () => {
    setBusy(true);
    setError(null);
    personaApi.create(newName.trim())
      .then((p) => { setBusy(false); setNewName(""); onChanged(); setOpenId(p.personaId); })
      .catch((e) => { setBusy(false); setError(String((e as Error).message)); });
  };

  return (
    <div className="admin-stack">
      <article className="gr-card admin-course-editor">
        <h3>Define a target user</h3>
        <p className="gr-mono-note">
          Every course is generated FOR someone specific. Create a persona, then let the interviewer agent
          sharpen it with you — what this person knows, what they can do, and how they behave when stuck.
          The generation agents, the reviewers, and the pre-publish simulated learner all anchor on it.
        </p>
        <div className="admin-editor-grid">
          <div className="gr-field">
            <label htmlFor="persona-name">Who is this course for?</label>
            <input
              id="persona-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='e.g. "Priya — manual QA moving to automation"'
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) create(); }}
            />
          </div>
        </div>
        {error && <p className="admin-error">{error}</p>}
        <div className="admin-editor-actions">
          <button className="gr-btn gr-btn-primary" onClick={create} disabled={busy || !newName.trim()}>
            {busy ? "Creating…" : "Create persona"}
          </button>
        </div>
      </article>

      {personas === null ? (
        <p className="admin-loading">Loading personas…</p>
      ) : personas.length === 0 ? (
        <p className="admin-empty">No personas yet — create one above before starting a run.</p>
      ) : (
        <div className="admin-stack">
          {personas.map((p) => (
            <article key={p.personaId} className="gr-card admin-course-editor persona-card">
              <div className="admin-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                <span className={`admin-chip ${p.status === "ready" ? "status-mastered" : ""}`}>{p.status === "ready" ? "Ready" : "Draft"}</span>
              </div>
              <p className="gr-mono-note">{p.personaId} · v{p.version} · updated {fmtWhen(p.updatedAt)}</p>
              {p.narrative
                ? <p>{p.narrative}</p>
                : <p className="admin-empty">No narrative yet — continue the interview.</p>}
              {(p.anticipatedKnowledgeLevel || p.anticipatedCapabilityLevel) && (
                <ul>
                  {p.anticipatedKnowledgeLevel && <li><strong>Knows:</strong> {p.anticipatedKnowledgeLevel}</li>}
                  {p.anticipatedCapabilityLevel && <li><strong>Can do:</strong> {p.anticipatedCapabilityLevel}</li>}
                </ul>
              )}
              <div className="admin-editor-actions">
                <button className="gr-btn gr-btn-primary" onClick={() => setOpenId(p.personaId)}>Open workbench</button>
                <button
                  className="gr-btn gr-btn-ghost"
                  onClick={() => {
                    if (!confirm(`Delete persona "${p.name}"? Existing runs keep their snapshots.`)) return;
                    personaApi.remove(p.personaId).then(onChanged).catch(() => onChanged());
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const PERSONA_FIELDS: Array<{ key: keyof PersonaProfile; label: string; hint?: string; list?: boolean }> = [
  { key: "name", label: "Name" },
  { key: "anticipatedKnowledgeLevel", label: "Anticipated knowledge level", hint: "What they already KNOW (terms, concepts)" },
  { key: "anticipatedCapabilityLevel", label: "Anticipated capability level", hint: "What they can DO (follow steps? debug alone?)" },
  { key: "background", label: "Background" },
  { key: "goals", label: "Goals", list: true },
  { key: "frustrations", label: "Frustrations", list: true },
  { key: "vocabularyComfort", label: "Vocabulary comfort", hint: "Safe terms vs. terms needing definition" },
  { key: "toolFamiliarity", label: "Tool familiarity", list: true },
  { key: "behaviorUnderFriction", label: "Behavior under friction", hint: "What they do when stuck — drives the simulated learner" },
  { key: "narrative", label: "Narrative", hint: "One paragraph, used verbatim in prompts" },
];

function PersonaWorkbench({ personaId, onBack }: { personaId: string; onBack: () => void }) {
  const [persona, setPersona] = useState<PersonaProfile | null>(null);
  const [interview, setInterview] = useState<PersonaInterviewMessage[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [provider, setProvider] = useState<ProviderConfig["provider"]>("mock");

  const fromProfile = (p: PersonaProfile): Record<string, string> =>
    Object.fromEntries(PERSONA_FIELDS.map((f) => [f.key, f.list ? (p[f.key] as string[]).join("\n") : String(p[f.key] ?? "")]));
  const toPatch = (d: Record<string, string>): Record<string, unknown> =>
    Object.fromEntries(PERSONA_FIELDS.map((f) => [f.key, f.list ? d[f.key].split("\n").map((s) => s.trim()).filter(Boolean) : d[f.key]]));

  const load = useCallback(() => {
    personaApi.get(personaId).then(({ persona: p, interview: iv }) => {
      setPersona(p);
      setInterview(iv);
      setDraft(fromProfile(p));
      setDirty(false);
    }).catch((e) => setError(String((e as Error).message)));
  }, [personaId]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!providers) {
      courseRunApi.providers().then((p) => {
        setProviders(p);
        const def = p.providers.find((x) => x.id === p.defaultProvider && x.available) ?? p.providers.find((x) => x.available);
        if (def) setProvider(def.id);
      }).catch(() => setProviders({ defaultProvider: "mock", defaultModel: null, providers: [{ id: "mock", label: "Mock", available: true }] }));
    }
  }, [providers]);

  // While a turn is in flight, poll the streaming view (the analysisLive pattern).
  useEffect(() => {
    if (!sending) { setLive(null); return; }
    const t = setInterval(() => personaApi.interviewLive(personaId).then((r) => setLive(r.live)).catch(() => {}), 1200);
    return () => clearInterval(t);
  }, [sending, personaId]);

  const send = () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setInterview((iv) => [...iv, { role: "admin", text, at: new Date().toISOString() }]);
    setMessage("");
    personaApi.interview(personaId, text, provider === "mock" ? { provider: "mock" } : { provider })
      .then(({ persona: p, reply, complete }) => {
        setSending(false);
        setPersona(p);
        setDraft(fromProfile(p));
        setDirty(false);
        setInterview((iv) => [...iv, { role: "interviewer", text: reply, at: new Date().toISOString() }]);
        if (complete) setError(null);
      })
      .catch((e) => { setSending(false); setError(String((e as Error).message)); });
  };

  const save = (status?: "ready" | "draft") => {
    setError(null);
    personaApi.update(personaId, { profile: toPatch(draft) as Partial<PersonaProfile>, ...(status ? { status } : {}) })
      .then((p) => { setPersona(p); setDraft(fromProfile(p)); setDirty(false); })
      .catch((e) => setError(String((e as Error).message)));
  };

  if (!persona) return <p className="admin-loading">{error ?? "Loading persona…"}</p>;

  return (
    <div className="admin-stack">
      <div className="admin-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <button className="gr-btn gr-btn-ghost" onClick={onBack}>← Personas</button>
        <span className={`admin-chip ${persona.status === "ready" ? "status-mastered" : ""}`}>
          {persona.status === "ready" ? "Ready" : "Draft"} · v{persona.version}
        </span>
      </div>

      <div className="persona-workbench">
        <article className="gr-card admin-course-editor persona-chat">
          <h3>Interview</h3>
          <p className="gr-mono-note">
            Talk to the interviewer agent about who this course is for. It asks one question at a time and
            builds the profile live on the right.
          </p>
          <div className="persona-chat-log">
            {interview.length === 0 && <p className="admin-empty">Start by describing this person in a sentence or two.</p>}
            {interview.map((m, i) => (
              <p key={i} className={m.role === "admin" ? "persona-msg-admin" : "persona-msg-interviewer"}>
                <strong>{m.role === "admin" ? "You" : "Interviewer"}:</strong> {m.text}
              </p>
            ))}
            {sending && (
              <p className="persona-msg-interviewer gr-mono-note">
                {live?.text ? live.text : live?.thinking ? `(thinking) ${live.thinking.slice(-300)}` : "Interviewer is thinking…"}
              </p>
            )}
          </div>
          <div className="gr-field">
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the target user, answer the interviewer's question…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={sending}
            />
          </div>
          <div className="admin-editor-actions">
            <button className="gr-btn gr-btn-primary" onClick={send} disabled={sending || !message.trim()}>
              {sending ? "Interviewing…" : "Send"}
            </button>
            {providers && providers.providers.length > 1 && (
              <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderConfig["provider"])} aria-label="Interview model provider">
                {providers.providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>{p.label}</option>
                ))}
              </select>
            )}
          </div>
        </article>

        <article className="gr-card admin-course-editor persona-profile">
          <h3>Profile</h3>
          {PERSONA_FIELDS.map((f) => (
            <div className="gr-field" key={f.key}>
              <label htmlFor={`pf-${f.key}`}>{f.label}{f.hint ? <span className="gr-mono-note"> — {f.hint}</span> : null}</label>
              {f.list || f.key === "narrative" || f.key === "background" ? (
                <textarea
                  id={`pf-${f.key}`}
                  rows={f.list ? 3 : 3}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => { setDraft((d) => ({ ...d, [f.key]: e.target.value })); setDirty(true); }}
                  placeholder={f.list ? "One per line" : ""}
                />
              ) : (
                <input
                  id={`pf-${f.key}`}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => { setDraft((d) => ({ ...d, [f.key]: e.target.value })); setDirty(true); }}
                />
              )}
            </div>
          ))}
          {error && <p className="admin-error">{error}</p>}
          <div className="admin-editor-actions">
            <button className="gr-btn" onClick={() => save()} disabled={!dirty}>Save</button>
            {persona.status === "draft" ? (
              <button className="gr-btn gr-btn-primary" onClick={() => save("ready")}>Mark ready</button>
            ) : (
              <button className="gr-btn gr-btn-ghost" onClick={() => save("draft")}>Back to draft</button>
            )}
          </div>
          <p className="gr-mono-note">
            "Ready" requires the two anchors (knowledge + capability) and the narrative. You stay the
            authority — the interviewer's "complete" is advice, not a gate.
          </p>
        </article>
      </div>
    </div>
  );
}

/* ================= start form ================= */

function StartRunForm({ onStarted, personas, onGoPersonas }: {
  onStarted: (run: CourseRunDetail) => void;
  personas: PersonaProfile[];
  onGoPersonas: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ technology: "", title: "", outcome: "", inScope: "", outOfScope: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // The target user is a PERSONA, not a free-text field (Phase 1).
  const ready = personas.filter((p) => p.status === "ready");
  const [personaId, setPersonaId] = useState("");
  useEffect(() => {
    if (!personaId && ready.length > 0) setPersonaId(ready[0].personaId);
  }, [personaId, ready]);
  const chosenPersona = ready.find((p) => p.personaId === personaId) ?? null;

  // Model provider selection (mock / Claude / OpenAI-compatible).
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [provider, setProvider] = useState<ProviderConfig["provider"]>("mock");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  // Advanced per-role overrides; empty string = "use the tier default".
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open && !providers) {
      courseRunApi.providers().then((p) => {
        setProviders(p);
        // Default to the deployment default provider if it's usable. Claude
        // defaults to per-role tiers (empty model), not a single model.
        const def = p.providers.find((x) => x.id === p.defaultProvider && x.available) ?? p.providers.find((x) => x.available);
        if (def) {
          setProvider(def.id);
          if (def.id !== "anthropic" && def.models?.length) setModel(def.models[0].id);
        }
      }).catch(() => setProviders({ defaultProvider: "mock", defaultModel: null, providers: [{ id: "mock", label: "Mock", available: true }] }));
    }
  }, [open, providers]);
  const chosen = providers?.providers.find((p) => p.id === provider);

  const submit = () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    if (personaId) body.personaId = personaId;
    const pickedRoleModels = Object.fromEntries(Object.entries(roleModels).filter(([, v]) => v.trim()));
    body.providerConfig =
      provider === "mock"
        ? { provider: "mock" }
        : {
            provider,
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(Object.keys(pickedRoleModels).length ? { roleModels: pickedRoleModels } : {}),
            ...(provider === "openai-compatible" ? { baseUrl: baseUrl.trim() } : {}),
          };
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
          <label htmlFor="cg-persona">Target persona *</label>
          {ready.length === 0 ? (
            <p className="admin-error" style={{ margin: 0 }}>
              No ready personas. <button className="gr-btn gr-btn-ghost" onClick={onGoPersonas}>Define a persona first →</button>
            </p>
          ) : (
            <select id="cg-persona" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              {ready.map((p) => <option key={p.personaId} value={p.personaId}>{p.name} (v{p.version})</option>)}
            </select>
          )}
        </div>
      </div>
      {chosenPersona && <p className="gr-mono-note">{chosenPersona.narrative}</p>}
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
            setRoleModels({});
            const p = providers?.providers.find((x) => x.id === id);
            // Claude defaults to per-role tiers (empty = tier defaults).
            setModel(id === "anthropic" ? "" : (p?.models?.[0]?.id ?? ""));
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
                {provider === "anthropic" && <option value="">Per-role defaults (recommended)</option>}
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
      {provider === "anthropic" && providers?.roles?.length ? (
        <details className="admin-role-models">
          <summary>Advanced: per-role models</summary>
          <p className="gr-mono-note">
            Each pipeline role rides the cheapest Claude tier that fits its job — generative roles on Opus,
            reviewer roles on Sonnet. Override a role here; the run-wide model (above) overrides everything.
          </p>
          <div className="admin-editor-grid">
            {providers.roles.map((role) => {
              const tier = providers.roleTiers?.[role];
              const tierLabel = chosen?.models?.find((m) => m.id === tier)?.label ?? tier ?? "provider default";
              return (
                <div className="gr-field" key={role}>
                  <label htmlFor={`cg-role-${role}`}>{role}</label>
                  <select
                    id={`cg-role-${role}`}
                    value={roleModels[role] ?? ""}
                    onChange={(e) => setRoleModels((rm) => ({ ...rm, [role]: e.target.value }))}
                  >
                    <option value="">{model.trim() ? "Run-wide model" : `Default — ${tierLabel}`}</option>
                    {(chosen?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {error && <p className="admin-error">{error}</p>}
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary" onClick={submit} disabled={busy || !form.technology.trim() || !personaId || (provider === "openai-compatible" && !model.trim())}>
          {busy ? "Starting…" : "Start run"}
        </button>
        <button className="gr-btn gr-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </article>
  );
}

/* ================= runs table ================= */

function RunsTable({ runs, onOpen, onChanged }: { runs: CourseRunSummary[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const pending = runs
    .filter((r) => r.pendingGate || r.status === "interrupted")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); // most recent first
  const ordered = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const deleteRun = (e: { stopPropagation(): void }, r: CourseRunSummary) => {
    e.stopPropagation(); // don't open the run
    const msg =
      `Delete run ${r.runId}?\n\n` +
      `This permanently removes the run AND everything it produced — its draft course, ` +
      `lessons, catalog entries, generated labs, and any capabilities it commissioned. ` +
      `This cannot be undone.`;
    if (!window.confirm(msg)) return;
    courseRunApi.remove(r.runId)
      .then((s) => {
        onChanged();
        if (s.coursePublished) window.alert(`Deleted. Note: the course "${s.courseId}" was LIVE and has been taken down.`);
      })
      .catch((err) => window.alert(`Delete failed: ${(err as Error).message}`));
  };

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
          <tr><th>Run</th><th>Technology</th><th>Status</th><th>Gate</th><th>Updated</th><th></th></tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.runId} onClick={() => onOpen(r.runId)} title="Open this run">
              <td><strong>{r.title ?? "(untitled)"}</strong> <code className="gr-mono-note">{r.runId.slice(0, 20)}</code></td>
              <td>{r.technology}</td>
              <td><StatusChip status={r.status} /></td>
              <td>{r.pendingGate ? <span className="admin-chip status-mastered">{r.pendingGate}</span> : "—"}</td>
              <td>{fmtWhen(r.updatedAt)}</td>
              <td>
                <button
                  className="gr-btn gr-btn-small gr-btn-ghost admin-danger"
                  onClick={(e) => deleteRun(e, r)}
                  disabled={isActive(r.status)}
                  title={isActive(r.status) ? "Can't delete while a phase is running" : "Delete this run and everything it produced"}
                >
                  Delete
                </button>
              </td>
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
          <p className="gr-mono-note">
            {run.runId} · {run.technology} · {run.provider ?? "mock"}{run.model ? ` (${run.model})` : run.provider === "anthropic" ? " (per-role tiers)" : ""} · <StatusChip status={run.status} />
            {(run.request?.persona as { profile?: { name?: string } } | undefined)?.profile?.name
              ? <> · persona: {(run.request!.persona as { profile: { name: string } }).profile.name}</>
              : null}
          </p>
        </div>
      </div>

      {run.request?.revision && (
        <div className="gr-card">
          <p>
            <span className="admin-chip status-mastered">revision</span>{" "}
            Revising lesson <code>{run.request.revision.family}</code> — v{run.request.revision.fromVersion} →
            v{run.request.revision.fromVersion + 1} in course <code>{run.request.revision.courseId}</code>
            {run.request.revision.reportFile && <> · seeded by <code>{run.request.revision.reportFile}</code></>}.
            The new version ships hidden; flip it live per-lesson after the publish gate.
          </p>
        </div>
      )}

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
      <CritiquePanel run={run} />
      <QualityGates run={run} />
      <ArtifactViewer run={run} />
      <ActivityFeed events={run.events} />

      {!isActive(run.status) && (
        <div className="admin-editor-actions">
          {run.status !== "approved" && run.status !== "archived" && (
            <button
              className="gr-btn gr-btn-ghost gr-btn-small admin-danger"
              onClick={() => { if (window.confirm("Archive this run? It can't be resumed.")) courseRunApi.archive(runId).then(setRun); }}
            >
              Archive run
            </button>
          )}
          <button
            className="gr-btn gr-btn-ghost gr-btn-small admin-danger"
            onClick={() => {
              const msg =
                `Delete run ${runId}?\n\n` +
                `This permanently removes the run AND everything it produced — its draft course, ` +
                `lessons, catalog entries, generated labs, and any capabilities it commissioned. ` +
                `This cannot be undone.`;
              if (!window.confirm(msg)) return;
              courseRunApi.remove(runId)
                .then((s) => {
                  if (s.coursePublished) window.alert(`Deleted. Note: the course "${s.courseId}" was LIVE and has been taken down.`);
                  onCoursesChanged();
                  onBack();
                })
                .catch((err) => window.alert(`Delete failed: ${(err as Error).message}`));
            }}
          >
            Delete run
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
  const [manifest, setManifest] = useState<{ courseId?: string } | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "course" or a labId while toggling
  const [preview, setPreview] = useState<{ labId: string; md: string } | null>(null);
  const [expLab, setExpLab] = useState<string | null>(null); // recorded-experience panel
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (run.artifacts.includes("manifest.json")) {
      courseRunApi.artifact(run.runId, "manifest.json").then((a) => setManifest(JSON.parse(a.content))).catch(() => {});
    }
  }, [run]);

  const courseId = manifest?.courseId;
  const loadCourse = useCallback(() => {
    if (!courseId) return;
    courseRunApi.course(courseId).then(setCourse).catch(() => setCourse(null));
  }, [courseId]);
  useEffect(loadCourse, [loadCourse]);

  if (!courseId) {
    return <div className="gr-card"><h3>Approved</h3><p className="admin-empty">Materialization complete. (No course manifest found.)</p></div>;
  }

  const live = course?.status === "published";
  const lessons = course?.lessons ?? [];
  const liveCount = lessons.filter((l) => l.published !== false).length;

  const setCourseLive = (publish: boolean) => {
    setBusy("course"); setError(null);
    const call = publish ? courseRunApi.publishCourse(courseId) : courseRunApi.unpublishCourse(courseId);
    call.then(() => { onCoursesChanged(); loadCourse(); })
      .catch((e) => setError(String((e as Error).message)))
      .finally(() => setBusy(null));
  };
  const setLessonLive = (labId: string, publish: boolean) => {
    setBusy(labId); setError(null);
    courseRunApi.setLessonLive(courseId, labId, publish)
      .then((c) => { setCourse(c); onCoursesChanged(); })
      .catch((e) => setError(String((e as Error).message)))
      .finally(() => setBusy(null));
  };
  const togglePreview = (labId: string) => {
    if (preview?.labId === labId) { setPreview(null); return; }
    courseRunApi.artifact(run.runId, `lessons/${labId}/lesson.md`)
      .then((a) => setPreview({ labId, md: a.content }))
      .catch(() => setPreview({ labId, md: "(no lesson content found on disk)" }));
  };

  return (
    <div className="gr-card">
      <h3>Go live</h3>
      <p>
        Course <code>{courseId}</code> · {lessons.length} lessons ({liveCount} live).{" "}
        {live
          ? "The course is live. Reveal lessons to learners one at a time below."
          : "A draft — hidden from learners until you take the course live. You can preview and reveal individual lessons after."}
      </p>
      <div className="admin-editor-actions">
        {live ? (
          <button className="gr-btn gr-btn-ghost" onClick={() => setCourseLive(false)} disabled={busy === "course"}>Unpublish course</button>
        ) : (
          <button className="gr-btn gr-btn-primary" onClick={() => setCourseLive(true)} disabled={busy === "course" || lessons.length === 0}>
            Go live
          </button>
        )}
        {live && <span className="admin-chip status-mastered">live</span>}
        {lessons.length === 0 && <span className="gr-mono-note">no lessons materialized — nothing to publish</span>}
      </div>
      {error && <p className="admin-error">{error}</p>}

      <SimTestPanel run={run} />

      {lessons.length > 0 && (
        <table className="admin-table" style={{ marginTop: 14 }}>
          <thead>
            <tr><th>#</th><th>Level</th><th>Lesson</th><th>Learner visibility</th><th>Preview</th></tr>
          </thead>
          <tbody>
            {lessons.map((l, i) => {
              const lessonLive = l.published !== false;
              return (
                <Fragment key={l.labId}>
                  <tr>
                    <td>{i + 1}</td>
                    <td><span className="admin-chip">{l.level ?? "—"}</span></td>
                    <td>{l.title ?? l.labId} <code className="gr-mono-note">{l.labId}</code></td>
                    <td>
                      <button
                        className={`gr-btn gr-btn-small ${lessonLive ? "gr-btn-ghost" : "gr-btn-primary"}`}
                        onClick={() => setLessonLive(l.labId, !lessonLive)}
                        disabled={busy === l.labId}
                      >
                        {lessonLive ? "Hide" : "Go live"}
                      </button>
                      {lessonLive && <span className="admin-chip status-mastered" style={{ marginLeft: 8 }}>live</span>}
                    </td>
                    <td>
                      <button className="gr-btn gr-btn-small gr-btn-ghost" onClick={() => togglePreview(l.labId)}>
                        {preview?.labId === l.labId ? "Hide" : "Read"}
                      </button>{" "}
                      <a className="gr-btn gr-btn-small gr-btn-ghost" href={`/lab?lab=${encodeURIComponent(l.labId)}`} target="_blank" rel="noreferrer">
                        Try lab ↗
                      </a>{" "}
                      <button
                        className="gr-btn gr-btn-small gr-btn-ghost"
                        onClick={() => setExpLab(expLab === l.labId ? null : l.labId)}
                        title="Recorded learner experience for this lesson"
                      >
                        {expLab === l.labId ? "Hide stats" : "Experience"}
                      </button>
                    </td>
                  </tr>
                  {preview?.labId === l.labId && (
                    <tr>
                      <td colSpan={5}><pre className="cg-lesson-preview">{preview.md}</pre></td>
                    </tr>
                  )}
                  {expLab === l.labId && (
                    <tr>
                      <td colSpan={5}><LessonExperiencePanel labId={l.labId} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- pre-publish simulated user test (quality-rework Phase 4) ---------- */

function SimTestPanel({ run }: { run: CourseRunDetail }) {
  const [jobs, setJobs] = useState<SimTestJobView[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needPersona, setNeedPersona] = useState(false);
  const [readyPersonas, setReadyPersonas] = useState<PersonaProfile[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [busyRev, setBusyRev] = useState<string | null>(null);
  const [revStarted, setRevStarted] = useState<string | null>(null);

  const refresh = useCallback(() => {
    simTestApi.status(run.runId).then((s) => { setJobs(s.jobs); setRunning(s.running); }).catch(() => {});
  }, [run.runId]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [running, refresh]);

  const start = (pid?: string) => {
    setError(null);
    simTestApi.start(run.runId, pid ? { personaId: pid } : {})
      .then((s) => { setJobs(s.jobs); setRunning(true); setNeedPersona(false); })
      .catch((e) => {
        if ((e as { status?: number }).status === 422) {
          // Legacy run/course with no persona: prompt to attach one (backfilled).
          setNeedPersona(true);
          personaApi.list().then((ps) => {
            const ready = ps.filter((p) => p.status === "ready");
            setReadyPersonas(ready);
            if (ready[0]) setPersonaId(ready[0].personaId);
          }).catch(() => setReadyPersonas([]));
        } else {
          setError(String((e as Error).message));
        }
      });
  };

  const badge = (j: SimTestJobView) => {
    if (j.state !== "done") return <span className="admin-chip status-open">{j.state}</span>;
    const s = j.result?.status;
    const cls = s === "completed" ? "status-mastered" : s === "environment_failure" || s === "simulator_failure" ? "" : "status-open";
    return <span className={`admin-chip ${cls}`}>{s ?? "?"}</span>;
  };

  return (
    <div className="cg-simtest" style={{ marginTop: 14 }}>
      <h4 className="admin-subhead">Simulated learner (advisory)</h4>
      <p className="gr-mono-note">
        Before publishing, let the course's target persona actually play every lesson — screen only, mouse
        and keyboard, asking the in-app guide when stuck. Results inform your publish decision; they don't
        block it. Requires the web dev server and a live SIMULATOR_* provider.
      </p>
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary gr-btn-small" onClick={() => start()} disabled={running}>
          {running ? "Running…" : jobs?.length ? "Re-run simulated learner" : "Run simulated learner (all lessons)"}
        </button>
        {running && <span className="gr-mono-note">one lesson at a time — this takes a while; leave the page open or come back</span>}
      </div>
      {needPersona && (
        <div className="admin-editor-actions">
          <span className="gr-mono-note">This course predates personas — pick one to attach (saved onto the course):</span>
          {readyPersonas.length === 0 ? (
            <span className="admin-error">no ready personas — define one in the Personas view first</span>
          ) : (
            <>
              <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} aria-label="Persona to attach">
                {readyPersonas.map((p) => <option key={p.personaId} value={p.personaId}>{p.name}</option>)}
              </select>
              <button className="gr-btn gr-btn-small gr-btn-primary" onClick={() => start(personaId)} disabled={!personaId}>
                Attach &amp; run
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="admin-error">{error}</p>}
      {revStarted && <p className="gr-mono-note">Revision run started: <code>{revStarted}</code> — see the Runs list.</p>}

      {jobs && jobs.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr><th>Lesson</th><th>Outcome</th><th>Friction</th><th>Asked the guide</th><th>Evidence</th><th></th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const r = j.result;
              const failed = j.state === "done" && (r?.status !== "completed" || r?.checkpointPassed === false);
              return (
                <tr key={j.labId}>
                  <td><code>{j.labId}</code></td>
                  <td>
                    {badge(j)}
                    {r?.checkpointPassed === false && <span className="admin-chip status-abandoned" style={{ marginLeft: 6 }}>checkpoint fail</span>}
                    {r?.reason && <div className="gr-mono-note">{r.reason}</div>}
                  </td>
                  <td>{typeof r?.frictionScore === "number" ? r.frictionScore : "—"}</td>
                  <td>{r ? `${r.clarifyingQuestions ?? 0}×` : "—"}</td>
                  <td>
                    {r && (
                      <>
                        <button
                          className="gr-btn gr-btn-small gr-btn-ghost"
                          onClick={() =>
                            courseRunApi.artifact(run.runId, `sim-tests/${j.labId}/simulator-trace.md`)
                              .then((a) => window.open("", "_blank")?.document.write(`<pre>${a.content.replace(/</g, "&lt;")}</pre>`))
                              .catch(() => setError("no trace recorded"))
                          }
                        >
                          Trace
                        </button>{" "}
                        {r.bundleDir && (
                          <a className="gr-btn gr-btn-small gr-btn-ghost" href={simTestApi.videoUrl(run.runId, j.labId)} target="_blank" rel="noreferrer">
                            Video ↗
                          </a>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {failed && (
                      <button
                        className="gr-btn gr-btn-small"
                        disabled={busyRev === j.labId}
                        onClick={() => {
                          setBusyRev(j.labId);
                          setError(null);
                          simTestApi.startRevision(run.runId, j.labId)
                            .then((rev) => setRevStarted(rev.runId))
                            .catch((e) => setError(String((e as Error).message)))
                            .finally(() => setBusyRev(null));
                        }}
                        title="Seed a lesson-revision run from this sim result"
                      >
                        {busyRev === j.labId ? "Starting…" : "Start revision from this result"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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

/* ---------- critique rounds (quality-rework Phase 2) ---------- */

function CritiquePanel({ run }: { run: CourseRunDetail }) {
  const [entries, setEntries] = useState<Array<{ subject: string; rounds: number; satisfied: boolean }> | null>(null);
  useEffect(() => {
    if (run.artifacts.includes("critiques/summary.json")) {
      courseRunApi.artifact(run.runId, "critiques/summary.json").then((a) => setEntries(JSON.parse(a.content))).catch(() => setEntries(null));
    } else {
      setEntries(null);
    }
  }, [run]);
  if (!entries?.length) return null;
  const unsatisfied = entries.filter((e) => !e.satisfied);
  return (
    <div className="gr-card">
      <h3>
        Learner-advocate critique{" "}
        <span className="gr-mono-note">
          {entries.length} artifact(s){unsatisfied.length ? ` · ${unsatisfied.length} unsatisfied after the round cap` : " · all satisfied"}
        </span>
      </h3>
      <p className="admin-lede-note">
        Every artifact was judged for persona-fit (terms within the target user's knowledge + capability) and
        goal-fit (will it achieve its stated goal), refining until satisfied or the round cap. Round-by-round
        verdicts are in the artifacts under <code>critiques/</code>.
      </p>
      <ul className="admin-claims">
        {entries.map((e) => (
          <li key={e.subject}>
            <span className={`admin-chip ${e.satisfied ? "status-mastered" : "status-open"}`}>
              {e.satisfied ? (e.rounds === 1 ? "satisfied" : `satisfied · ${e.rounds} rounds`) : `unsatisfied · ${e.rounds} rounds`}
            </span>
            <code>{e.subject}</code>
          </li>
        ))}
      </ul>
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
