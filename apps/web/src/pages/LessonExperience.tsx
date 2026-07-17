/**
 * LessonExperiencePanel — the recorded-experience dashboard for one lesson
 * FAMILY (all versions). Deterministic metrics straight from the session event
 * logs: completion/abandonment, hint pressure, command failures, stalls, the
 * checkpoint requirements that block learners, and their own words. Rendered
 * from the Admin Courses tab (every course, hand-authored included) and from
 * the Course studio Go-live table. The AI experience analyst (Phase B) will
 * live on this panel too.
 */
import { useEffect, useRef, useState } from "react";
import {
  courseRunApi,
  lessonApi,
  type ExperienceReportView,
  type LessonExperienceData,
  type LessonVersionExperience,
  type ProviderConfig,
  type ProvidersPayload,
} from "../api.ts";

const REVISABLE = new Set(["content", "lab-design"]);

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const mins = (ms: number | null): string => (ms === null ? "—" : `${Math.max(1, Math.round(ms / 60000))} min`);

export function LessonExperiencePanel({ labId }: { labId: string }) {
  const [data, setData] = useState<LessonExperienceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    lessonApi.experience(labId).then(setData).catch((e) => setError(String((e as Error).message)));
  }, [labId]);

  if (error) return <p className="admin-error">{error}</p>;
  if (!data) return <p className="admin-loading">Reading recorded sessions…</p>;
  if (data.totalSessions === 0) {
    return <p className="admin-empty">No recorded sessions for this lesson yet — experience data appears after learners try it.</p>;
  }

  const focus: LessonVersionExperience =
    data.versions.find((v) => v.version === data.requestedVersion) ?? data.versions[0];

  return (
    <div className="cg-experience">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Version</th><th>Sessions</th><th>Completed</th><th>Abandoned</th><th>Median time</th>
            <th>Hints/session</th><th>Cmd failures</th><th>Stalls/session</th><th>Hints→progress</th>
          </tr>
        </thead>
        <tbody>
          {data.versions.map((v) => (
            <tr key={v.version}>
              <td>
                <code className="gr-mono-note">{v.labId}</code>
                {v.version === data.requestedVersion && data.versions.length > 1 && (
                  <span className="admin-chip" style={{ marginLeft: 6 }}>viewing</span>
                )}
              </td>
              <td>{v.sessions}</td>
              <td>{pct(v.completionRate)}</td>
              <td>{pct(v.abandonmentRate)}</td>
              <td>{mins(v.medianDurationMs)}</td>
              <td>{v.hintsPerSession.toFixed(1)}</td>
              <td>{pct(v.commandFailureRate)}</td>
              <td>{v.stallsPerSession.toFixed(1)}</td>
              <td>{v.hintFollowedByProgressRate === null ? "—" : pct(v.hintFollowedByProgressRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cg-experience-detail">
        {focus.topBlockingRequirements.length > 0 && (
          <p>
            <strong>Blocking checks:</strong>{" "}
            {focus.topBlockingRequirements.map((b) => `${b.id} ×${b.count}`).join(" · ")}
          </p>
        )}
        {focus.topInterventionTriggers.length > 0 && (
          <p>
            <strong>Intervention triggers:</strong>{" "}
            {focus.topInterventionTriggers.map((t) => `${t.trigger} ×${t.count}`).join(" · ")}
          </p>
        )}
        {focus.topTaskFailReasons.length > 0 && (
          <p>
            <strong>Task-check failures:</strong> {focus.topTaskFailReasons.join(" · ")}
          </p>
        )}
        {focus.quotes.length > 0 && (
          <>
            <p><strong>In learners' own words:</strong></p>
            <ul className="cg-quotes">
              {focus.quotes.map((q, i) => (
                <li key={i}>
                  “{q.text}”
                  {q.stuck && <span className="admin-chip status-abandoned" style={{ marginLeft: 6 }}>stuck</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <AnalystSection labId={labId} />
    </div>
  );
}

/* ---------- the AI experience analyst: run it, watch it think, read reports ---------- */

function AnalystSection({ labId }: { labId: string }) {
  const [reports, setReports] = useState<ExperienceReportView[] | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const [provider, setProvider] = useState<ProviderConfig["provider"]>("mock");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState<{ thinking: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadReports = () => lessonApi.reports(labId).then(setReports).catch(() => setReports([]));
  useEffect(() => {
    loadReports();
    courseRunApi.providers().then((p) => {
      setProviders(p);
      const models = p.providers.find((x) => x.id === "anthropic")?.models;
      if (models?.length) setModel(models[0].id);
    }).catch(() => {});
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labId]);

  const startPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      lessonApi.live(labId).then(({ live, state }) => {
        if (live) setLiveText({ thinking: live.thinking, text: live.text });
        if (!state.running) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          setRunning(false);
          setLiveText(null);
          if (state.error) setError(state.error);
          else loadReports();
        }
      }).catch(() => {});
    }, 1200);
  };

  const analyze = () => {
    setError(null);
    setNotice(null);
    const cfg: ProviderConfig | undefined =
      provider === "mock" ? { provider: "mock" }
      : provider === "anthropic" ? { provider, model }
      : { provider, model, baseUrl };
    setRunning(true);
    lessonApi.analyze(labId, cfg)
      .then(() => startPolling())
      .catch((e) => { setRunning(false); setError(String((e as Error).message)); });
  };

  const handoff = (file: string) => {
    setNotice(null);
    setError(null);
    lessonApi.handoff(labId, file)
      .then(() => setNotice("Handed off to the dev outbox (curriculum/lesson-improvements/)."))
      .catch((e) => setError(String((e as Error).message)));
  };

  const anthropic = providers?.providers.find((p) => p.id === "anthropic");

  return (
    <div className="cg-analyst">
      <div className="admin-editor-actions">
        <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderConfig["provider"])} disabled={running}>
          <option value="mock">Mock (offline)</option>
          <option value="anthropic" disabled={!anthropic?.available}>Claude{anthropic?.available ? "" : " (no key)"}</option>
          <option value="openai-compatible">OpenAI-compatible</option>
        </select>
        {provider === "anthropic" && (
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
            {(anthropic?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        {provider === "openai-compatible" && (
          <>
            <input placeholder="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={running} />
            <input placeholder="base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={running} />
          </>
        )}
        <button className="gr-btn gr-btn-primary gr-btn-small" onClick={analyze} disabled={running}>
          {running ? "Analyzing…" : "Analyze with AI"}
        </button>
      </div>
      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="gr-mono-note">{notice}</p>}
      {running && liveText && (
        <pre className="cg-lesson-preview" style={{ maxHeight: 160 }}>
          {liveText.thinking && `[thinking]\n${liveText.thinking.slice(-1200)}\n\n`}
          {liveText.text.slice(-800)}
        </pre>
      )}

      {reports && reports.length > 0 && (
        <div className="cg-experience-detail">
          <p><strong>Reports</strong></p>
          {reports.map((r) => {
            const revisable = r.findings.filter((f) => REVISABLE.has(f.area));
            const other = r.findings.filter((f) => !REVISABLE.has(f.area));
            const open = openReport === r.file;
            return (
              <div key={r.file} className="gr-card" style={{ padding: "10px 14px" }}>
                <div className="admin-editor-actions" style={{ cursor: "pointer" }} onClick={() => setOpenReport(open ? null : r.file)}>
                  <span className={`admin-chip ${r.verdict === "revise" ? "status-abandoned" : "status-mastered"}`}>{r.verdict}</span>
                  <strong>{r.file}</strong>
                  <span className="gr-mono-note">
                    {r.sessionsAnalyzed} session(s) · {r.meta?.provider}{r.meta?.model ? ` · ${r.meta.model}` : ""} · {r.meta?.at ? new Date(r.meta.at).toLocaleString() : ""}
                  </span>
                  {r.usedByRunId && <span className="admin-chip">revised in {r.usedByRunId}</span>}
                </div>
                {open && (
                  <div className="cg-experience-detail" style={{ marginTop: 8 }}>
                    <p>{r.summary}</p>
                    {revisable.length > 0 && (
                      <>
                        <p><strong>Fixable by revising this lesson</strong></p>
                        <ul className="cg-quotes" style={{ fontStyle: "normal" }}>
                          {revisable.map((f, i) => (
                            <li key={i}><span className="admin-chip">{f.severity}</span> <span className="admin-chip">{f.area}</span> {f.description} <span className="gr-mono-note">({f.evidence})</span></li>
                          ))}
                        </ul>
                      </>
                    )}
                    {r.recommendations.length > 0 && (
                      <>
                        <p><strong>Recommended changes</strong></p>
                        <ul className="cg-quotes" style={{ fontStyle: "normal" }}>
                          {r.recommendations.map((rec, i) => <li key={i}>{rec.change} <span className="gr-mono-note">— {rec.rationale}</span></li>)}
                        </ul>
                      </>
                    )}
                    {other.length > 0 && (
                      <>
                        <p><strong>Not fixable by revising this lesson</strong> (guide/platform)</p>
                        <ul className="cg-quotes" style={{ fontStyle: "normal" }}>
                          {other.map((f, i) => (
                            <li key={i}><span className="admin-chip status-abandoned">{f.area}</span> {f.description} <span className="gr-mono-note">({f.evidence})</span></li>
                          ))}
                        </ul>
                        <div>
                          <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => handoff(r.file)}>
                            Send to dev outbox
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
