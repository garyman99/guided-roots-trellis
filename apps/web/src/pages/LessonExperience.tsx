/**
 * LessonExperiencePanel — the recorded-experience dashboard for one lesson
 * FAMILY (all versions). Deterministic metrics straight from the session event
 * logs: completion/abandonment, hint pressure, command failures, stalls, the
 * checkpoint requirements that block learners, and their own words. Rendered
 * from the Admin Courses tab (every course, hand-authored included) and from
 * the Course studio Go-live table. The AI experience analyst (Phase B) will
 * live on this panel too.
 */
import { useEffect, useState } from "react";
import { lessonApi, type LessonExperienceData, type LessonVersionExperience } from "../api.ts";

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
    </div>
  );
}
