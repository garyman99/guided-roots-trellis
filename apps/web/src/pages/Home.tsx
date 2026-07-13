/**
 * Post-login launcher. Front and center: launch the virtual desktop. Then
 * curated courses (ordered paths of scenarios, with derived progress), then
 * the full scenario library with marketplace filters (role / technology /
 * experience level). Navigation to /lab is a full page load on purpose — the
 * lab experience reads its query params at module load.
 *
 * Progress is read-only truth from the API (completion digests); the page
 * never computes or stores its own idea of "done".
 */
import { useEffect, useMemo, useState } from "react";
import { getUser, isAdmin, logout } from "../auth.ts";
import { fetchCourses, savedLearner, learnerApi, type Course, type LearnerProgress } from "../api.ts";
import {
  allLevels,
  allRoles,
  allTechnologies,
  scenarioByLabId,
  scenarios,
  type Scenario,
} from "../scenarios.ts";
import { useReveal } from "./reveal.ts";
import "../brand/guided-roots.css";
import "./pages.css";

export function Home() {
  useReveal();
  const user = getUser();
  const firstName = (user?.name ?? "there").split(" ")[0];

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progress, setProgress] = useState<LearnerProgress | null>(null);
  useEffect(() => {
    fetchCourses().then(setCourses).catch(() => setCourses([]));
    const learner = savedLearner();
    if (learner) learnerApi.progress(learner).then(setProgress).catch(() => {});
  }, []);
  const completed = useMemo(() => new Set(progress?.completedLabIds ?? []), [progress]);

  return (
    <div className="gr-scope">
      <nav className="gr-nav">
        <div className="gr-nav-inner">
          <a className="gr-wordmark" href="/home">
            <img src="/brand/logo-mark.svg" alt="" />
            <span>
              <span className="name">Trellis</span>
              <span className="by">by Guided Roots</span>
            </span>
          </a>
          <div className="gr-nav-actions user-chip">
            <span className="who">{user?.name?.toUpperCase()}</span>
            {isAdmin() && (
              <a className="gr-btn gr-btn-ghost gr-btn-small" href="/admin">
                Admin
              </a>
            )}
            <button className="gr-btn gr-btn-ghost gr-btn-small" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <header className="gr-section tight">
        <div className="gr-container">
          <div className="gr-section-head" style={{ marginBottom: "clamp(28px, 4vw, 48px)" }}>
            <p className="gr-eyebrow">Your workspace</p>
            <h2>
              Welcome back, <em>{firstName}</em>.
            </h2>
          </div>

          <div className="launch-card gr-reveal in">
            <img className="launch-rings" src="/brand/rings-watermark.svg" alt="" />
            <div className="copy">
              <p className="gr-mono-note">VIRTUAL DESKTOP · FRESH SESSION</p>
              <h2>Step up to the desk</h2>
              <p>
                A windowed machine with an editor, a terminal, and a guide at the next desk. Everything
                you do in it is measured; nothing outside it is touched.
              </p>
              <a className="gr-btn gr-btn-primary gr-btn-big" href="/lab">
                Launch the virtual desktop
              </a>
            </div>
            <figure className="shot-frame">
              <div className="bar" aria-hidden="true">
                <i /><i /><i />
                <span className="url">trellis · virtual desktop</span>
              </div>
              <img src="/landing/desktop.png" alt="Preview of the Trellis virtual desktop" />
            </figure>
          </div>
        </div>
      </header>

      {courses !== null && courses.length > 0 && (
        <section className="gr-section tight" style={{ paddingTop: 0 }}>
          <div className="gr-container">
            <div className="gr-section-head" style={{ marginBottom: "clamp(24px, 3vw, 40px)" }}>
              <p className="gr-eyebrow">Courses</p>
              <h2 style={{ fontSize: "clamp(1.7rem, 2.6vw, 2.3rem)" }}>
                Follow a <em>guided path</em>
              </h2>
              <p className="gr-lede">
                Each course is an ordered run of scenarios. Finish a lesson in the desktop and the next
                one unlocks its place in the path — your progress is measured, never self-reported.
              </p>
            </div>
            <div className="course-list">
              {courses.map((c, i) => (
                <CourseCard key={c.courseId} course={c} completed={completed} delay={i % 2} />
              ))}
            </div>
          </div>
        </section>
      )}

      <ScenarioLibrary completed={completed} />

      <footer className="gr-footer">
        <div className="gr-container">
          <hr className="gr-ground" />
          <div className="gr-footer-inner">
            <span className="gr-mono-note">TRELLIS · GUIDED ROOTS LLC</span>
            <span className="gr-mono-note">SHAPED BY HAND, GROWN IN PLACE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ================= courses ================= */

function CourseCard({ course, completed, delay }: { course: Course; completed: Set<string>; delay: number }) {
  const total = course.lessons.length;
  const done = course.lessons.filter((l) => completed.has(l.labId)).length;
  const next = course.lessons.find((l) => !completed.has(l.labId)) ?? null;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <article className={`gr-card course-card gr-reveal`} data-delay={String(delay)}>
      <div className="course-head">
        <div>
          <span className="gr-mono-note">
            {course.audience.toUpperCase()} · {course.level.toUpperCase()} · {total} LESSON{total === 1 ? "" : "S"}
          </span>
          <h3>{course.title}</h3>
        </div>
        {done === total && total > 0 ? (
          <span className="course-complete-chip">Complete ✓</span>
        ) : (
          next && (
            <a className="gr-btn gr-btn-primary gr-btn-small" href={`/lab?lab=${encodeURIComponent(next.labId)}`}>
              {done === 0 ? "Start course" : "Continue"}
            </a>
          )
        )}
      </div>
      <p className="course-desc">{course.description}</p>

      <div className="course-progress" role="img" aria-label={`${done} of ${total} lessons complete`}>
        <div className="bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="gr-mono-note">
          {done}/{total} · {pct}%
        </span>
      </div>

      <ol className="course-lessons">
        {course.lessons.map((l, i) => {
          const s = scenarioByLabId.get(l.labId);
          const isDone = completed.has(l.labId);
          const isNext = next?.labId === l.labId;
          return (
            <li key={`${l.labId}-${i}`} className={isDone ? "done" : isNext ? "next" : ""}>
              <span className="mark" aria-hidden="true">
                {isDone ? "✓" : i + 1}
              </span>
              <a href={`/lab?lab=${encodeURIComponent(l.labId)}`}>
                <span className="lesson-title">{l.title ?? s?.title ?? l.labId}</span>
                {l.note && <span className="lesson-note">{l.note}</span>}
              </a>
              {isNext && <span className="up-next gr-mono-note">UP NEXT</span>}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

/* ================= scenario library (marketplace) ================= */

const LEVEL_LABEL: Record<string, string> = {
  beginner: "New to this",
  intermediate: "Comfortable",
  advanced: "Confident",
};

function ScenarioLibrary({ completed }: { completed: Set<string> }) {
  const [role, setRole] = useState<string | null>(null);
  const [tech, setTech] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      scenarios.filter(
        (s) =>
          (role === null || s.role === role) &&
          (tech === null || s.technologies.includes(tech)) &&
          (level === null || s.level === level),
      ),
    [role, tech, level],
  );
  const anyFilter = role !== null || tech !== null || level !== null;

  return (
    <section className="gr-section tight" style={{ paddingTop: 0 }}>
      <div className="gr-container">
        <div className="gr-section-head" style={{ marginBottom: "clamp(20px, 3vw, 32px)" }}>
          <p className="gr-eyebrow">Scenario library</p>
          <h2 style={{ fontSize: "clamp(1.7rem, 2.6vw, 2.3rem)" }}>
            Or start from a <em>scenario</em>
          </h2>
          <p className="gr-lede">
            Each one opens the desktop with a situation already growing in it — a failing test, an
            agent's unreviewed diff, an inbox that needs judgment.
          </p>
        </div>

        <div className="scenario-filters">
          <FilterGroup label="Role" options={allRoles} value={role} onChange={setRole} />
          <FilterGroup
            label="Technology"
            options={allTechnologies}
            value={tech}
            onChange={setTech}
          />
          <FilterGroup
            label="Experience"
            options={allLevels}
            display={(v) => LEVEL_LABEL[v] ?? v}
            value={level}
            onChange={setLevel}
          />
          <div className="filter-meta">
            <span className="gr-mono-note">
              {filtered.length} OF {scenarios.length} SCENARIOS
            </span>
            {anyFilter && (
              <button
                className="filter-clear"
                onClick={() => {
                  setRole(null);
                  setTech(null);
                  setLevel(null);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="library-empty">
            Nothing on the shelf matches that combination yet — clear a filter or two.
          </p>
        ) : (
          <div className="gr-grid gr-grid-3">
            {filtered.map((s, i) => (
              <ScenarioCard key={s.labId} scenario={s} done={completed.has(s.labId)} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
  display = (v: string) => v,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  display?: (v: string) => string;
}) {
  return (
    <div className="filter-group" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="gr-mono-note">{label.toUpperCase()}</span>
      <div className="filter-chips">
        <button className={`filter-chip${value === null ? " active" : ""}`} onClick={() => onChange(null)}>
          All
        </button>
        {options.map((o) => (
          <button
            key={o}
            className={`filter-chip${value === o ? " active" : ""}`}
            onClick={() => onChange(value === o ? null : o)}
          >
            {display(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario: s, done, index }: { scenario: Scenario; done: boolean; index: number }) {
  return (
    <a
      className={`gr-card scenario-card gr-reveal${index === 0 ? " featured" : ""}`}
      data-delay={String(index % 3)}
      href={`/lab?lab=${encodeURIComponent(s.labId)}`}
    >
      <span className="scenario-topline">
        <span className="gr-mono-note">{s.tag}</span>
        {done && <span className="scenario-done" title="Completed — measured at checkpoint">✓ DONE</span>}
      </span>
      <h3>{s.title}</h3>
      <p>{s.blurb}</p>
      <span className="scenario-facets">
        <span className="facet">{s.role}</span>
        {s.technologies.map((t) => (
          <span key={t} className="facet">
            {t}
          </span>
        ))}
        <span className="facet level">{LEVEL_LABEL[s.level] ?? s.level}</span>
      </span>
      <span className="go">Launch scenario</span>
    </a>
  );
}
