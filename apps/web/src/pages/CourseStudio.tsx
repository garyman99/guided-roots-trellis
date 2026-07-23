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
  suggestCoursePersona,
  type SimLessonResult,
  type SimTestJobView,
  type Course,
  type CapabilityGapReport,
  type CapabilityRequest,
  type CourseIdeaSuggestion,
  type CourseRunDetail,
  type CourseRunSummary,
  type LiveActivity,
  type GapDecision,
  type GapDisposition,
  type GateId,
  type GateNote,
  type GateVerdict,
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
// No progress recorded for over 20 minutes while a phase is running — the
// host may be down or the phase wedged (docs/plans/autonomous-course-pipeline.md §3.3).
const STALL_MS = 20 * 60 * 1000;
const isStalled = (status: RunStatus, updatedAt: string) =>
  isActive(status) && Date.now() - Date.parse(updatedAt) > STALL_MS;
function StalledChip() {
  return (
    <span className="admin-chip status-abandoned" title="No progress recorded for over 20 minutes — the host may be down or the phase wedged.">
      stalled?
    </span>
  );
}
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
      <CourseIdeaCard personas={personas} onStarted={onStarted} />

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
  // Model/baseUrl for the interview provider (openai-compatible needs both;
  // Claude falls back to the interviewer's tier default when model is empty).
  const [ivModel, setIvModel] = useState("");
  const [ivBaseUrl, setIvBaseUrl] = useState("");

  const interviewProviderConfig = (): ProviderConfig => {
    if (provider === "mock") return { provider: "mock" };
    return {
      provider,
      ...(ivModel.trim() ? { model: ivModel.trim() } : {}),
      ...(provider === "openai-compatible" && ivBaseUrl.trim() ? { baseUrl: ivBaseUrl.trim() } : {}),
    };
  };

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
        if (def) {
          setProvider(def.id);
          if (def.id === "openai-compatible") {
            if (p.defaultModel) setIvModel(p.defaultModel);
            if (p.defaultBaseUrl) setIvBaseUrl(p.defaultBaseUrl);
          }
        }
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
    personaApi.interview(personaId, text, interviewProviderConfig())
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
              <>
                <select
                  value={provider}
                  onChange={(e) => {
                    const id = e.target.value as ProviderConfig["provider"];
                    setProvider(id);
                    const p = providers.providers.find((x) => x.id === id);
                    setIvModel(id === "anthropic" ? "" : (p?.models?.[0]?.id ?? ""));
                  }}
                  aria-label="Interview model provider"
                >
                  {providers.providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>{p.label}</option>
                  ))}
                </select>
                {provider === "openai-compatible" && (
                  <>
                    <input value={ivModel} onChange={(e) => setIvModel(e.target.value)} placeholder="model id" aria-label="Interview model id" />
                    <input value={ivBaseUrl} onChange={(e) => setIvBaseUrl(e.target.value)} placeholder="base URL, e.g. http://localhost:1234/v1" aria-label="Interview base URL" style={{ minWidth: 260 }} />
                  </>
                )}
              </>
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

/* ================= course idea intake (plan §3.2, the front door) ================= */

function CourseIdeaCard({ personas, onStarted }: {
  personas: PersonaProfile[];
  onStarted: (run: CourseRunDetail) => void;
}) {
  const [idea, setIdea] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [suggestion, setSuggestion] = useState<CourseIdeaSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A minimal provider picker — the run itself gets the full advanced picker
  // via StartRunForm; this front door just needs to reach a model.
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [provider, setProvider] = useState<ProviderConfig["provider"]>("mock");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    if (!providers) {
      courseRunApi.providers().then((p) => {
        setProviders(p);
        const def = p.providers.find((x) => x.id === p.defaultProvider && x.available) ?? p.providers.find((x) => x.available);
        if (def) {
          setProvider(def.id);
          // Prefill the OpenAI-compatible endpoint + model from the env defaults,
          // so a wired-up deployment doesn't retype the proxy URL every run.
          if (def.id === "openai-compatible") {
            if (p.defaultModel) setModel(p.defaultModel);
            if (p.defaultBaseUrl) setBaseUrl(p.defaultBaseUrl);
          }
        }
      }).catch(() => setProviders({ defaultProvider: "mock", defaultModel: null, providers: [{ id: "mock", label: "Mock", available: true }] }));
    }
  }, [providers]);

  const providerConfig = (): ProviderConfig => {
    if (provider === "mock") return { provider: "mock" };
    return {
      provider,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(provider === "openai-compatible" && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
    };
  };

  const existingPersona = suggestion?.match === "existing" ? personas.find((p) => p.personaId === suggestion.personaId) ?? null : null;

  const suggest = () => {
    if (!idea.trim() || suggesting) return;
    setSuggesting(true);
    setError(null);
    setSuggestion(null);
    suggestCoursePersona(idea.trim(), providerConfig())
      .then((s) => { setSuggesting(false); setSuggestion(s); })
      .catch((e) => { setSuggesting(false); setError(String((e as Error).message)); });
  };

  const dismiss = () => { setSuggestion(null); setError(null); };

  const useAndStart = async () => {
    if (!suggestion) return;
    setStarting(true);
    setError(null);
    try {
      let personaId = suggestion.personaId;
      if (suggestion.match === "new" && suggestion.profile) {
        const created = await personaApi.create(suggestion.profile.name);
        await personaApi.update(created.personaId, { profile: suggestion.profile, status: "ready" });
        personaId = created.personaId;
      }
      if (!personaId) throw new Error("no persona to start the run with");
      const run = await courseRunApi.create({
        technology: suggestion.technology,
        personaId,
        gateMode: "auto",
        autoPublish: true,
        // The run rides the same provider the suggestion used — otherwise a
        // live idea would silently generate on the server default.
        providerConfig: providerConfig(),
      });
      setStarting(false);
      setIdea("");
      setSuggestion(null);
      onStarted(run);
    } catch (e) {
      setStarting(false);
      setError(String((e as Error).message));
    }
  };

  return (
    <article className="gr-card admin-course-editor">
      <h3>Course idea</h3>
      <p className="gr-mono-note">
        Type a course idea and who it's for — one field. A persona-suggester agent proposes an existing
        library persona or drafts a complete new one; confirm it and an autopilot run starts unattended:
        idea in, published course out.
      </p>
      <div className="gr-field">
        <label htmlFor="ci-idea">Course idea + who it's for</label>
        <textarea
          id="ci-idea"
          rows={3}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder='e.g. "Docker for backend devs who have never containerized anything"'
          disabled={suggesting}
        />
      </div>
      {providers && providers.providers.length > 1 && (
        <div className="admin-editor-actions">
          <select
            value={provider}
            onChange={(e) => {
              const id = e.target.value as ProviderConfig["provider"];
              setProvider(id);
              const p = providers.providers.find((x) => x.id === id);
              setModel(id === "anthropic" ? "" : (p?.models?.[0]?.id ?? ""));
            }}
            aria-label="Suggestion model provider"
          >
            {providers.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>{p.label}</option>
            ))}
          </select>
          {provider === "openai-compatible" && (
            <>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" aria-label="Suggestion model id" />
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="base URL, e.g. http://localhost:1234/v1" aria-label="Suggestion base URL" style={{ minWidth: 260 }} />
            </>
          )}
        </div>
      )}
      {error && <p className="admin-error">{error}</p>}
      <div className="admin-editor-actions">
        <button className="gr-btn gr-btn-primary" onClick={suggest} disabled={suggesting || !idea.trim()}>
          {suggesting ? "Thinking…" : "Suggest persona"}
        </button>
      </div>

      {suggestion && (
        <div className="gr-card" style={{ marginTop: 12 }}>
          <p><strong>Technology:</strong> {suggestion.technology}</p>
          <p>{suggestion.rationale}</p>
          {suggestion.match === "existing" ? (
            <div>
              <span className="admin-chip status-mastered">existing persona</span>{" "}
              {existingPersona ? (
                <>
                  <strong>{existingPersona.name}</strong>
                  <p className="gr-mono-note">{existingPersona.narrative}</p>
                </>
              ) : (
                <p className="gr-mono-note">{suggestion.personaId}</p>
              )}
            </div>
          ) : suggestion.profile ? (
            <div>
              <span className="admin-chip">new persona</span>{" "}
              <strong>{suggestion.profile.name}</strong>
              <ul>
                <li><strong>Knows:</strong> {suggestion.profile.anticipatedKnowledgeLevel}</li>
                <li><strong>Can do:</strong> {suggestion.profile.anticipatedCapabilityLevel}</li>
              </ul>
              <p className="gr-mono-note">{suggestion.profile.narrative}</p>
            </div>
          ) : null}
          <div className="admin-editor-actions">
            <button className="gr-btn gr-btn-primary" onClick={useAndStart} disabled={starting}>
              {starting ? "Starting…" : "Use & start autopilot"}
            </button>
            <button className="gr-btn gr-btn-ghost" onClick={dismiss} disabled={starting}>Dismiss</button>
          </div>
        </div>
      )}
    </article>
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
  // The desktop the course targets — the virtual desktop mimics Windows only
  // today; the mac option unlocks when the macOS-styled desktop ships.
  const [targetPlatform, setTargetPlatform] = useState("windows");
  // Baked Environment image (optional): a course whose lessons need a real
  // browser / offline package cache picks the toolchain here, so the author is
  // told the bench can host it (else browser lessons block). Empty = the default
  // browserless bench. Listed from what this build actually ships.
  const [environments, setEnvironments] = useState<Array<{ id: string; label: string; description: string }>>([]);
  const [environmentImage, setEnvironmentImage] = useState("");
  useEffect(() => {
    if (open && environments.length === 0) courseRunApi.environments().then((r) => setEnvironments(r.environments)).catch(() => {});
  }, [open, environments]);
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
  // openai-compatible only: refine the judgment/mechanical tiers; generative rides `model`.
  const [judgmentModel, setJudgmentModel] = useState("");
  const [mechanicalModel, setMechanicalModel] = useState("");
  // Advanced per-role overrides; empty string = "use the tier default".
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  // Autopilot: gate-reviewer decides gates unattended (docs/plans/autonomous-course-pipeline.md §3.2).
  const [gateMode, setGateMode] = useState<"manual" | "auto">("manual");
  const [autoPublish, setAutoPublish] = useState(false);
  // Budget guardrails (plan §3.2) — optional; blank leaves the run unbounded.
  const [maxModelCalls, setMaxModelCalls] = useState("");
  const [maxEstimatedCostUSD, setMaxEstimatedCostUSD] = useState("");
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
          // Prefill the OpenAI-compatible endpoint + model from the env defaults.
          if (def.id === "openai-compatible") {
            if (p.defaultModel) setModel(p.defaultModel);
            if (p.defaultBaseUrl) setBaseUrl(p.defaultBaseUrl);
          }
        }
      }).catch(() => setProviders({ defaultProvider: "mock", defaultModel: null, providers: [{ id: "mock", label: "Mock", available: true }] }));
    }
  }, [open, providers]);
  const chosen = providers?.providers.find((p) => p.id === provider);

  const submit = () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    body.targetPlatform = targetPlatform;
    if (environmentImage) body.environmentImage = environmentImage;
    if (personaId) body.personaId = personaId;
    if (gateMode === "auto") {
      body.gateMode = "auto";
      if (autoPublish) body.autoPublish = true;
    }
    const calls = Number(maxModelCalls);
    if (maxModelCalls.trim() && Number.isFinite(calls) && calls > 0) body.maxModelCalls = calls;
    const cost = Number(maxEstimatedCostUSD);
    if (maxEstimatedCostUSD.trim() && Number.isFinite(cost) && cost > 0) body.maxEstimatedCostUSD = cost;
    const pickedRoleModels = Object.fromEntries(Object.entries(roleModels).filter(([, v]) => v.trim()));
    body.providerConfig =
      provider === "mock"
        ? { provider: "mock" }
        : {
            provider,
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(provider === "openai-compatible" && judgmentModel.trim() ? { judgmentModel: judgmentModel.trim() } : {}),
            ...(provider === "openai-compatible" && mechanicalModel.trim() ? { mechanicalModel: mechanicalModel.trim() } : {}),
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
        <div className="gr-field">
          <label htmlFor="cg-platform">Target platform</label>
          <select id="cg-platform" value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value)}>
            <option value="windows">Windows (virtual desktop)</option>
            <option value="mac" disabled>macOS — coming soon</option>
          </select>
        </div>
        {environments.length > 0 && (
          <div className="gr-field">
            <label htmlFor="cg-env">Bench environment</label>
            <select id="cg-env" value={environmentImage} onChange={(e) => setEnvironmentImage(e.target.value)}>
              <option value="">Default (terminal only — no browser/network)</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            {environmentImage && <p className="gr-mono-note">{environments.find((e) => e.id === environmentImage)?.description}</p>}
          </div>
        )}
      </div>
      <h4 className="admin-subhead">Model provider</h4>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="cg-provider">Provider</label>
          <select id="cg-provider" value={provider} onChange={(e) => {
            const id = e.target.value as ProviderConfig["provider"];
            setProvider(id);
            setRoleModels({});
            setJudgmentModel("");
            setMechanicalModel("");
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
        {provider === "openai-compatible" && (
          <div className="gr-field">
            <label htmlFor="cg-judgment-model">Judgment model (optional)</label>
            <input
              id="cg-judgment-model"
              value={judgmentModel}
              onChange={(e) => setJudgmentModel(e.target.value)}
              placeholder="defaults to the model above"
            />
          </div>
        )}
        {provider === "openai-compatible" && (
          <div className="gr-field">
            <label htmlFor="cg-mechanical-model">Mechanical model (optional)</label>
            <input
              id="cg-mechanical-model"
              value={mechanicalModel}
              onChange={(e) => setMechanicalModel(e.target.value)}
              placeholder="defaults to the judgment model"
            />
          </div>
        )}
      </div>
      {provider === "mock" && <p className="gr-mono-note">Mock is deterministic and offline — great for trying the flow. Pick Claude or an OpenAI-compatible endpoint for the real thing (the API key is read from the server environment).</p>}
      {chosen?.note && provider !== "mock" && <p className="gr-mono-note">{chosen.note}</p>}
      {provider === "openai-compatible" && (
        <p className="gr-mono-note">
          The model above rides the generative tier (architect, lesson-author). Set a judgment model to give
          reviewer/analyst roles a cheaper alias; a mechanical model refines it further (falls back to judgment, then the model above).
        </p>
      )}
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

      <h4 className="admin-subhead">Autopilot</h4>
      <div className="admin-editor-grid">
        <div className="gr-field">
          <label htmlFor="cg-gatemode">Gates</label>
          <select id="cg-gatemode" value={gateMode} onChange={(e) => setGateMode(e.target.value as "manual" | "auto")}>
            <option value="manual">Manual — I decide each gate</option>
            <option value="auto">Autopilot — the gate-reviewer agent decides</option>
          </select>
        </div>
        {gateMode === "auto" && (
          <div className="gr-field">
            <label htmlFor="cg-autopublish">
              <input id="cg-autopublish" type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />{" "}
              Publish automatically when the run completes
            </label>
          </div>
        )}
        <div className="gr-field">
          <label htmlFor="cg-max-calls">Max model calls (optional)</label>
          <input
            id="cg-max-calls"
            type="number"
            min={1}
            value={maxModelCalls}
            onChange={(e) => setMaxModelCalls(e.target.value)}
            placeholder="unbounded"
          />
        </div>
        <div className="gr-field">
          <label htmlFor="cg-max-cost">Max est. cost (USD, optional)</label>
          <input
            id="cg-max-cost"
            type="number"
            min={0}
            step="0.01"
            value={maxEstimatedCostUSD}
            onChange={(e) => setMaxEstimatedCostUSD(e.target.value)}
            placeholder="unbounded"
          />
        </div>
      </div>
      {gateMode === "auto" && (
        <p className="gr-mono-note">
          Gates are decided by an agent against an acceptance rubric with a bounded change budget.
          Every decision and its reservations are recorded for after-the-fact review.
        </p>
      )}

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
              <td>
                <StatusChip status={r.status} />{" "}
                {r.gateMode === "auto" && <span className="admin-chip kind-llm">autopilot</span>}{" "}
                {isStalled(r.status, r.updatedAt) && <StalledChip />}
              </td>
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
  // Full throttle: rubber-stamp every gate as it arrives (per-run, persisted so a
  // page refresh keeps it on). Manual-gate runs only — autopilot already decides.
  const [fullThrottle, setFullThrottle] = useState(() => {
    try { return localStorage.getItem(`cg.fullThrottle.${runId}`) === "1"; } catch { return false; }
  });
  const toggleThrottle = (on: boolean) => {
    setFullThrottle(on);
    try { localStorage.setItem(`cg.fullThrottle.${runId}`, on ? "1" : "0"); } catch { /* private mode */ }
  };

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
  // The request is editable only while the run is PARKED (interrupted or at a
  // gate) — the API 409s otherwise. Pre-field runs have no targetPlatform;
  // absent = windows everywhere.
  const parked = !isActive(run.status) && run.status !== "queued";
  const platform = run.request?.targetPlatform ?? "windows";
  const setPlatform = (value: "windows" | "mac") =>
    courseRunApi.updateRequest(runId, { targetPlatform: value }).then(setRun).catch((e) => window.alert(`Couldn't update the platform: ${String((e as Error).message)}`));

  return (
    <div className="admin-stack">
      <div className="admin-replay-head">
        <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={onBack}>← All runs</button>
        <div>
          <h3>{run.title ?? run.technology}</h3>
          <p className="gr-mono-note">
            {run.runId} · {run.technology} · {run.provider ?? "mock"}{run.model ? ` (${run.model})` : run.provider === "anthropic" ? " (per-role tiers)" : ""} · <StatusChip status={run.status} />
            {run.gateMode === "auto" && <> <span className="admin-chip kind-llm">autopilot</span></>}
            {isStalled(run.status, run.updatedAt) && <> <StalledChip /></>}
            {(run.request?.persona as { profile?: { name?: string } } | undefined)?.profile?.name
              ? <> · persona: {(run.request!.persona as { profile: { name: string } }).profile.name}</>
              : null}
            {" · platform: "}
            {parked ? (
              <select
                value={platform}
                title="Desktop the course targets. Editable while the run is parked; the next (re-)run of a phase authors for this platform."
                onChange={(e) => setPlatform(e.target.value as "windows" | "mac")}
              >
                <option value="windows">windows</option>
                <option value="mac">mac (desktop variant not built yet)</option>
              </select>
            ) : (
              platform
            )}
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

      {run.gateMode !== "auto" && !["approved", "archived", "failed", "rejected"].includes(run.status) && (
        <label className="cg-throttle" title="Auto-approve every gate the moment it arrives — no clicking through each one. Blueprint capability-gaps are deferred so it keeps moving.">
          <input type="checkbox" checked={fullThrottle} onChange={(e) => toggleThrottle(e.target.checked)} />
          <span>⚡ Full throttle — auto-approve every gate{fullThrottle ? " (on)" : ""}</span>
        </label>
      )}

      <PhaseRail run={run} />
      <GateVerdicts run={run} />
      <LivePanel run={run} />
      <AgentChat run={run} />
      <RunEconomics events={run.events} />

      {gate && <GateBar run={run} gate={gate} onDecided={setRun} fullThrottle={fullThrottle} />}
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

/* ---------- autopilot gate verdicts ---------- */

const GATE_NUMBER: Record<GateId, string> = { frame: "G1", blueprint: "G2", package: "G3", publish: "G4" };

function GateVerdicts({ run }: { run: CourseRunDetail }) {
  const verdictPaths = useMemo(
    () => run.artifacts.filter((p) => /^gates\/.+\.verdict\.json$/.test(p)),
    [run.artifacts],
  );
  const [verdicts, setVerdicts] = useState<GateVerdict[] | null>(null);

  useEffect(() => {
    if (verdictPaths.length === 0) { setVerdicts(null); return; }
    let stop = false;
    Promise.all(verdictPaths.map((p) => courseRunApi.artifact(run.runId, p).then((a) => JSON.parse(a.content) as GateVerdict)))
      .then((vs) => { if (!stop) setVerdicts(vs); })
      .catch(() => { if (!stop) setVerdicts(null); });
    return () => { stop = true; };
  }, [run.runId, verdictPaths]);

  if (!verdicts?.length) return null;
  return (
    <div className="gr-card">
      <h3>Autopilot gate decisions</h3>
      <ul className="admin-claims">
        {verdicts.map((v) => (
          <li key={v.gateId}>
            <details>
              <summary>
                <span className={`admin-chip ${v.decision === "approved" ? "status-mastered" : "status-open"}`}>{v.decision}</span>{" "}
                {GATE_NUMBER[v.gateId] ?? v.gateId} · {v.gateId} — {v.decision} by gate-reviewer · round {v.round}
                {v.reservations.length > 0 && (
                  <span className="admin-chip status-open" style={{ marginLeft: 6 }}>{v.reservations.length} reservation{v.reservations.length === 1 ? "" : "s"}</span>
                )}
                {v.forced && <span className="admin-chip status-abandoned" style={{ marginLeft: 6 }}>budget exhausted</span>}
              </summary>
              {v.notes.length > 0 && (
                <>
                  <p className="gr-mono-note">Notes</p>
                  <ul>
                    {v.notes.map((n, i) => (
                      <li key={i}>{n.comment}{n.path ? <code> ({n.path})</code> : null}{n.lessonId ? <code> ({n.lessonId})</code> : null}</li>
                    ))}
                  </ul>
                </>
              )}
              {v.reservations.length > 0 && (
                <>
                  <p className="gr-mono-note">Reservations</p>
                  <ul>
                    {v.reservations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </>
              )}
            </details>
          </li>
        ))}
      </ul>
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

function GateBar({ run, gate, onDecided, fullThrottle }: { run: CourseRunDetail; gate: GateId; onDecided: (r: CourseRunDetail) => void; fullThrottle?: boolean }) {
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
      // Keep `busy` true on success: the run leaves this gate and the bar
      // unmounts, so the button must never re-enable (it re-enabling before the
      // status visibly moved is what let a fast operator double-submit).
      .then((r) => { setMode("idle"); onDecided(r); })
      .catch((e) => {
        // A failure may just mean the run already left this gate (a stale/racing
        // decision now 409s fast instead of hanging). Sync to the true state so
        // the bar unmounts if it moved on; otherwise re-enable so a retry works.
        courseRunApi.get(run.runId).then(onDecided).catch(() => {});
        setBusy(false);
        setError(String((e as Error).message));
      });
  };

  // Full throttle: auto-approve this gate as soon as it appears. For the
  // blueprint gate we first defer any undecided capability gaps so the approve
  // isn't rejected — full throttle means "keep going, don't ask me".
  const autoFired = useRef(false);
  const needGaps = gate === "blueprint" && run.artifacts.includes("capability-gaps.json");
  useEffect(() => {
    if (!fullThrottle || busy || mode !== "idle" || autoFired.current) return;
    if (needGaps && gaps === null) return; // wait for the gap report to load
    if (undecidedGaps.length > 0) {
      setDispositions((d) => {
        const next = { ...d };
        for (const g of undecidedGaps) next[g.capabilityId] = "defer";
        return next;
      });
      return; // undecidedGaps → 0 next render; the effect then approves
    }
    autoFired.current = true;
    submit("approved", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullThrottle, busy, mode, needGaps, gaps, undecidedGaps.length]);

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
          <button className="gr-btn gr-btn-primary" onClick={() => decide("approved")} disabled={busy}>{busy ? "Approving…" : "Approve"}</button>
          <button className="gr-btn gr-btn-ghost" onClick={() => setMode("changes")} disabled={busy}>Request changes</button>
          <button className="gr-btn gr-btn-ghost admin-danger" onClick={() => { if (window.confirm("Reject and archive this run?")) decide("rejected"); }} disabled={busy}>Reject</button>
          {busy && <span className="gr-mono-note">submitting — the next phase is starting…</span>}
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
  const [reviseLab, setReviseLab] = useState<string | null>(null); // open revise panel
  const [revisePrompt, setRevisePrompt] = useState("");
  const [reviseNotice, setReviseNotice] = useState<string | null>(null);
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
    // When every lesson is still hidden, going live alone would show learners
    // an empty course (the API refuses) — take the lessons live with it.
    const call = publish ? courseRunApi.publishCourse(courseId, { withLessons: liveCount === 0 }) : courseRunApi.unpublishCourse(courseId);
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

  // Commission a revision from a free-text prompt — works whatever the course's
  // status (draft or live). The prompt goes to the author; the full review loop
  // iterates and self-revises, then mints a new hidden lesson version to review.
  const openRevise = (labId: string) => {
    setReviseNotice(null); setError(null);
    setRevisePrompt("");
    setReviseLab(reviseLab === labId ? null : labId);
  };
  const sendRevise = (labId: string) => {
    const prompt = revisePrompt.trim();
    if (!prompt) return;
    setBusy(labId); setError(null); setReviseNotice(null);
    courseRunApi.create({ revision: { labId, notes: prompt }, gateMode: "auto" })
      .then((r) => {
        setBusy(null); setReviseLab(null); setRevisePrompt("");
        setReviseNotice(`Revision started (${r.runId}) — the author is revising “${labId}”; it self-revises through review, then appears as a new hidden version to publish.`);
      })
      .catch((e) => { setBusy(null); setError(String((e as Error).message)); });
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
            {liveCount === 0 && lessons.length > 0 ? `Go live (reveals all ${lessons.length} lessons)` : "Go live"}
          </button>
        )}
        {live && <span className="admin-chip status-mastered">live</span>}
        {lessons.length === 0 && <span className="gr-mono-note">no lessons materialized — nothing to publish</span>}
      </div>
      {error && <p className="admin-error">{error}</p>}
      {reviseNotice && <p className="gr-mono-note" style={{ color: "var(--gr-ok, #2e7d32)" }}>{reviseNotice}</p>}

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
                      </button>{" "}
                      <button
                        className={`gr-btn gr-btn-small ${reviseLab === l.labId ? "gr-btn-primary" : "gr-btn-ghost"}`}
                        onClick={() => openRevise(l.labId)}
                        title="Send a revision prompt to the author; the review loop self-revises into a new version"
                      >
                        {reviseLab === l.labId ? "Cancel" : "Revise"}
                      </button>
                    </td>
                  </tr>
                  {reviseLab === l.labId && (
                    <tr>
                      <td colSpan={5}>
                        <div className="gr-field">
                          <label htmlFor={`rev-${l.labId}`}>
                            Revision prompt for <code>{l.labId}</code> — goes straight to the author; the full review loop iterates and self-revises, then mints a new hidden version.
                          </label>
                          <textarea
                            id={`rev-${l.labId}`}
                            rows={3}
                            value={revisePrompt}
                            onChange={(e) => setRevisePrompt(e.target.value)}
                            placeholder="e.g. Rewrite the venv step for Windows paths (.venv/Scripts) and add a troubleshooting row for the execution-policy error."
                          />
                        </div>
                        <div className="admin-editor-actions">
                          <button
                            className="gr-btn gr-btn-primary gr-btn-small"
                            onClick={() => sendRevise(l.labId)}
                            disabled={busy === l.labId || !revisePrompt.trim()}
                          >
                            {busy === l.labId ? "Starting…" : "Send to author"}
                          </button>
                          <span className="gr-mono-note">Runs autonomously through review; the new version ships hidden for you to publish.</span>
                        </div>
                      </td>
                    </tr>
                  )}
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

/** Live "where is the persona now" preview: the recorder driver drops a JPEG
 *  every ~0.8s while a sim runs; this refreshes it about once a second. It's a
 *  low-rate slideshow, not smooth video — enough to watch progress. The webm
 *  remains the reviewable record after the run. */
function SimLiveView({ runId }: { runId: string }) {
  const [labId, setLabId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => simTestApi.live(runId).then((s) => { if (alive) { setReady(s.live); setLabId(s.labId); } }).catch(() => {});
    poll();
    const t = setInterval(() => { poll(); setTick((n) => n + 1); }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [runId]);
  return (
    <div className="cg-sim-live">
      <div className="cg-sim-live-head">
        <span className="cg-live-dot" /> LIVE
        {labId && <code className="gr-mono-note">{labId}</code>}
      </div>
      {ready ? (
        <img className="cg-sim-live-img" src={`${simTestApi.liveFrameUrl(runId)}${simTestApi.liveFrameUrl(runId).includes("?") ? "&" : "?"}t=${tick}`} alt="Live simulated-learner screen" />
      ) : (
        <p className="gr-mono-note">waiting for the browser to come up…</p>
      )}
    </div>
  );
}

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
      {running && <SimLiveView runId={run.runId} />}
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
  // reviews/summary.json is the authoring ledger (written after every lesson,
  // reused on resume) — when a lesson has an entry there it is ground truth;
  // events are the fallback for lessons the ledger hasn't reached yet.
  const stateOf = (id: string) =>
    reviews[id]
      ? (reviews[id].passed ? "authored" : "needs-revision")
      : authored.has(id) ? "authored" : needsRevision.has(id) ? "needs-revision" : blocked.has(id) ? "blocked" : "pending";
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

/* ---------- agent chat (operator's high-level view) ---------- */

/** Who's talking: producers on the left, judges on the right, gates centered. */
const CHAT_ROLES: Record<string, { label: string; side: "left" | "right"; cls: string }> = {
  architect: { label: "Architect", side: "left", cls: "producer" },
  "domain-analyst": { label: "Domain analyst", side: "left", cls: "producer" },
  "lesson-author": { label: "Lesson author", side: "left", cls: "producer" },
  "technical-reviewer": { label: "Technical reviewer", side: "right", cls: "reviewer" },
  "pedagogy-reviewer": { label: "Pedagogy reviewer", side: "right", cls: "reviewer" },
  "cohesion-editor": { label: "Cohesion editor", side: "right", cls: "reviewer" },
  "learner-advocate": { label: "Learner advocate", side: "right", cls: "advocate" },
};

interface ChatMsg { at: string; who: string; side: "left" | "right" | "center"; cls: string; task?: string; text: string }

/** agent.message events (each role's 1–2 sentence self-report) interleaved
 *  with gate decisions, rendered as a conversation. Older runs predate the
 *  summary field and simply have no messages — the panel hides itself. */
function AgentChat({ run }: { run: CourseRunDetail }) {
  const logRef = useRef<HTMLDivElement | null>(null);
  // While a phase runs, poll the live activity so the chat shows WHO is working
  // right now ("… is thinking") instead of looking frozen between summaries.
  const active = isActive(run.status) || run.status === "queued";
  const [live, setLive] = useState<LiveActivity | null>(null);
  useEffect(() => {
    if (!active) { setLive(null); return; }
    let stop = false;
    const tick = () => courseRunApi.live(run.runId).then((l) => { if (!stop) setLive(l); }).catch(() => {});
    tick();
    const t = setInterval(tick, 900);
    return () => { stop = true; clearInterval(t); };
  }, [run.runId, active]);
  const workingWho = live?.role ? (CHAT_ROLES[live.role]?.label ?? live.role) : null;
  const workingModel = run.model ?? (run.provider === "anthropic" ? "Claude" : run.provider ?? "the model");

  const msgs: ChatMsg[] = [];
  for (const e of run.events) {
    if (e.type === "agent.message") {
      const p = e.payload as { role?: string; task?: string; summary?: string } | undefined;
      if (!p?.summary) continue;
      const meta = CHAT_ROLES[p.role ?? ""] ?? { label: p.role ?? "agent", side: "left" as const, cls: "producer" };
      msgs.push({ at: e.at, who: meta.label, side: meta.side, cls: meta.cls, task: p.task, text: p.summary });
    } else if (e.type === "gate.decided") {
      const p = e.payload as { gateId?: string; decision?: string; by?: string; noteCount?: number } | undefined;
      if (!p?.gateId) continue;
      const notes = p.noteCount ? ` — ${p.noteCount} note${p.noteCount === 1 ? "" : "s"}` : "";
      msgs.push({ at: e.at, who: p.by ?? "operator", side: "center", cls: "gate", text: `${p.gateId} gate: ${p.decision}${notes}` });
    } else if (e.type === "lesson.started") {
      // A per-lesson progress divider so the operator sees WHICH lesson is being
      // authored (n of N) as its slow author/review calls run.
      const p = e.payload as { lessonId?: string; title?: string; sequence?: number; total?: number } | undefined;
      if (!p?.lessonId) continue;
      const pos = p.sequence && p.total ? `${p.sequence} of ${p.total}` : p.sequence ? `${p.sequence}` : "";
      msgs.push({ at: e.at, who: "▸ authoring", side: "center", cls: "phase", task: p.lessonId, text: `Lesson ${pos}${p.title ? ` — ${p.title}` : ""}` });
    }
  }
  // Keep the newest exchange in view as messages stream in.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs.length, active]);
  // Show the panel whenever there's history OR a phase is actively running (so
  // the "thinking" line appears even before the first summary lands).
  if (msgs.length === 0 && !active) return null;

  return (
    <div className="gr-card">
      <h3>Agent chat <span className="gr-mono-note">{msgs.length} messages · each agent's own summary, not its full output</span></h3>
      <div className="cg-chat-log" ref={logRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`cg-chat-row ${m.side}`}>
            <div className={`cg-chat-bubble ${m.cls}`}>
              <span className="cg-chat-who">
                {m.who}
                {m.task && <code className="cg-chat-task">{m.task}</code>}
                <span className="cg-chat-time">{new Date(m.at).toLocaleTimeString()}</span>
              </span>
              <p>{m.text}</p>
            </div>
          </div>
        ))}
        {active && (
          <div className="cg-chat-row left">
            <div className="cg-chat-bubble producer cg-chat-thinking">
              <span className="cg-chat-who">
                {workingWho ?? "Working"}
                {live?.task && <code className="cg-chat-task">{live.task}</code>}
              </span>
              <p><em>{workingModel} is thinking</em> <span className="cg-live-dot" aria-hidden="true" /></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
