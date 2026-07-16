/**
 * Post-login launcher — course-first. The primary job of this page is to put
 * the learner back into a course: a resume band for work already in flight,
 * then the course catalog organized by a level ladder (Intro → Beginner →
 * Advanced → Expert) that also communicates the roadmap (empty rungs read as
 * "more coming"). The virtual desktop ("step up to the desk") is demoted to a
 * playground for advanced users who want to work without the rails, sitting
 * alongside the free-practice scenario library at the bottom.
 *
 * Navigation to /lab is a full page load on purpose — the lab experience reads
 * its query params at module load. Progress is read-only truth from the API
 * (completion digests); the page never computes or stores its own idea of
 * "done".
 */
import { useEffect, useMemo, useState } from "react";
import { getUser, isAdmin, logout } from "../auth.ts";
import { fetchCourses, fetchScenarios, savedLearner, learnerApi, type Course, type LearnerProgress } from "../api.ts";
import {
  ALL_LEVELS,
  rolesOf,
  technologiesOf,
  scenarioMap,
  type Scenario,
} from "../scenarios.ts";
import { useReveal } from "./reveal.ts";
import "../brand/guided-roots.css";
import "./pages.css";

/* ---- course level ladder (the spine of the catalog) ---- */
interface LevelMeta {
  key: string;
  label: string;
  hint: string;
}
const COURSE_LEVELS: LevelMeta[] = [
  { key: "intro", label: "Intro", hint: "No experience assumed" },
  { key: "beginner", label: "Beginner", hint: "You've met the basics" },
  { key: "intermediate", label: "Intermediate", hint: "You can work independently" },
  { key: "advanced", label: "Advanced", hint: "You design under ambiguity" },
  { key: "expert", label: "Expert", hint: "Sharpening mastery" },
];
const LEVEL_RANK: Record<string, number> = Object.fromEntries(
  COURSE_LEVELS.map((l, i) => [l.key, i]),
);
/** Normalize a course's free-form level onto a ladder rung; unknown → beginner. */
function normalizeLevel(level: string): string {
  const l = level.toLowerCase();
  return LEVEL_RANK[l] !== undefined ? l : "beginner";
}

interface CourseProgress {
  done: number;
  total: number;
  pct: number;
  next: Course["lessons"][number] | null;
  complete: boolean;
  started: boolean;
}
function courseProgress(course: Course, completed: Set<string>): CourseProgress {
  const total = course.lessons.length;
  const done = course.lessons.filter((l) => completed.has(l.labId)).length;
  const next = course.lessons.find((l) => !completed.has(l.labId)) ?? null;
  return {
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    next,
    complete: total > 0 && done === total,
    started: done > 0,
  };
}

export function Home() {
  useReveal();
  const user = getUser();
  const firstName = (user?.name ?? "there").split(" ")[0];

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progress, setProgress] = useState<LearnerProgress | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  useEffect(() => {
    fetchCourses().then(setCourses).catch(() => setCourses([]));
    fetchScenarios().then(setScenarios).catch(() => setScenarios([]));
    const learner = savedLearner();
    if (learner) learnerApi.progress(learner).then(setProgress).catch(() => {});
  }, []);
  // labId → scenario, rebuilt when the fetched catalog changes. Course lessons
  // and the resume band look up presentation titles through this.
  const scenarioByLabId = useMemo(() => scenarioMap(scenarios), [scenarios]);
  const completed = useMemo(() => new Set(progress?.completedLabIds ?? []), [progress]);

  // The course to resume: an in-progress course (0 < done < total), preferring the
  // one with the most recent session activity so "continue" lands where they last were.
  const resume = useMemo(() => {
    if (!courses) return null;
    const lastActivity = new Map<string, number>();
    for (const s of progress?.sessions ?? []) {
      const t = new Date(s.createdAt).getTime();
      const prev = lastActivity.get(s.labId) ?? 0;
      if (t > prev) lastActivity.set(s.labId, t);
    }
    const inProgress = courses
      .map((c) => ({ course: c, p: courseProgress(c, completed) }))
      .filter(({ p }) => p.started && !p.complete && p.next);
    if (inProgress.length === 0) return null;
    const recency = (c: Course) =>
      Math.max(0, ...c.lessons.map((l) => lastActivity.get(l.labId) ?? 0));
    inProgress.sort((a, b) => recency(b.course) - recency(a.course));
    return inProgress[0];
  }, [courses, completed, progress]);

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
          <div className="gr-section-head" style={{ marginBottom: "clamp(28px, 4vw, 44px)" }}>
            <p className="gr-eyebrow">Your courses</p>
            <h2>
              Welcome back, <em>{firstName}</em>.
            </h2>
          </div>

          {resume ? (
            <ResumeBand course={resume.course} p={resume.p} scenarioByLabId={scenarioByLabId} />
          ) : (
            <p className="gr-lede" style={{ marginTop: "-12px" }}>
              Pick a course below and learn it by doing it — every step measured inside a real
              machine, a guide at the next desk when you want one.
            </p>
          )}
        </div>
      </header>

      <CoursesSection
        courses={courses}
        completed={completed}
        resumeId={resume?.course.courseId ?? null}
        scenarioByLabId={scenarioByLabId}
      />

      <PlaygroundSection completed={completed} scenarios={scenarios} />

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

/* ================= resume band ================= */

function ResumeBand({ course, p, scenarioByLabId }: { course: Course; p: CourseProgress; scenarioByLabId: Map<string, Scenario> }) {
  const next = p.next!;
  const s = scenarioByLabId.get(next.labId);
  const lvl = normalizeLevel(course.level);
  return (
    <a
      className="resume-band gr-reveal in"
      href={`/lab?lab=${encodeURIComponent(next.labId)}`}
      data-level={lvl}
    >
      <img className="launch-rings" src="/brand/rings-watermark.svg" alt="" />
      <div className="resume-copy">
        <p className="gr-mono-note">PICK UP WHERE YOU LEFT OFF</p>
        <h3 className="resume-course">{course.title}</h3>
        <p className="resume-next">
          <span className="up-next gr-mono-note">UP NEXT</span>
          {next.title ?? s?.title ?? next.labId}
        </p>
        <div className="course-progress resume-progress" role="img" aria-label={`${p.done} of ${p.total} lessons complete`}>
          <div className="bar">
            <div className="fill" style={{ width: `${p.pct}%` }} />
          </div>
          <span className="gr-mono-note">
            {p.done}/{p.total} · {p.pct}%
          </span>
        </div>
      </div>
      <span className="gr-btn gr-btn-primary gr-btn-big resume-cta">Continue lesson</span>
    </a>
  );
}

/* ================= courses (the primary surface) ================= */

function CoursesSection({
  courses,
  completed,
  resumeId,
  scenarioByLabId,
}: {
  courses: Course[] | null;
  completed: Set<string>;
  resumeId: string | null;
  scenarioByLabId: Map<string, Scenario>;
}) {
  const [role, setRole] = useState<string | null>(null);

  const courseRoles = useMemo(
    () => Array.from(new Set((courses ?? []).map((c) => c.audience))).filter(Boolean),
    [courses],
  );
  // A course spans multiple levels, so we don't file (or filter) courses by a
  // single level — only by audience. Most recently updated first.
  const filtered = useMemo(
    () => [...(courses ?? [])].filter((c) => role === null || c.audience === role),
    [courses, role],
  );

  return (
    <section className="gr-section tight" style={{ paddingTop: 0 }}>
      <div className="gr-container">
        <div className="gr-section-head" style={{ marginBottom: "clamp(22px, 3vw, 36px)" }}>
          <p className="gr-eyebrow">Courses</p>
          <h2 style={{ fontSize: "clamp(1.9rem, 3vw, 2.6rem)" }}>
            Learn it by <em>doing</em> it
          </h2>
          <p className="gr-lede">
            Each course is a full path through real work — from your first steps to mastery. Every
            lesson is done in the desktop, your progress measured, never self-reported.
          </p>
        </div>

        {courseRoles.length > 1 && (
          <div className="course-role-filter">
            <FilterGroup label="For" options={courseRoles} value={role} onChange={setRole} />
          </div>
        )}

        {courses === null ? (
          <p className="library-empty">Loading your courses…</p>
        ) : filtered.length === 0 ? (
          <p className="library-empty">
            {courses.length === 0
              ? "Courses are being cultivated — check back soon. Meanwhile, the playground below is open."
              : "No course for that audience yet — clear the filter to see what's ready."}
          </p>
        ) : (
          <div className="course-stack">
            {filtered.map((c) => (
              <CourseCard
                key={c.courseId}
                course={c}
                completed={completed}
                highlight={c.courseId === resumeId}
                scenarioByLabId={scenarioByLabId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** The level of a course lesson: its own, else the scenario's facet, else beginner. */
function lessonLevel(lesson: Course["lessons"][number], scenarioByLabId: Map<string, Scenario>): string {
  return normalizeLevel(lesson.level ?? scenarioByLabId.get(lesson.labId)?.level ?? "beginner");
}

function CourseCard({
  course,
  completed,
  highlight,
  scenarioByLabId,
}: {
  course: Course;
  completed: Set<string>;
  highlight: boolean;
  scenarioByLabId: Map<string, Scenario>;
}) {
  const p = courseProgress(course, completed);

  // Group lessons by level, preserving course order, keeping each lesson's
  // overall position number for the progression.
  const groups = useMemo(() => {
    const byLevel = new Map<string, Array<{ lesson: Course["lessons"][number]; index: number }>>();
    course.lessons.forEach((lesson, index) => {
      const key = lessonLevel(lesson, scenarioByLabId);
      if (!byLevel.has(key)) byLevel.set(key, []);
      byLevel.get(key)!.push({ lesson, index });
    });
    // Ordered columns: only levels present, in ladder order.
    return COURSE_LEVELS.filter((l) => byLevel.has(l.key)).map((l) => ({ meta: l, items: byLevel.get(l.key)! }));
  }, [course.lessons, scenarioByLabId]);

  const spanLabel =
    groups.length === 0 ? "" : groups.length === 1 ? groups[0].meta.label : `${groups[0].meta.label} → ${groups[groups.length - 1].meta.label}`;

  return (
    <article className={`gr-card course-wide gr-reveal${highlight ? " highlight" : ""}`}>
      <div className="course-head">
        <div>
          <span className="course-badges">
            {spanLabel && <span className="level-badge span" data-level={groups[groups.length - 1]?.meta.key}>{spanLabel}</span>}
            <span className="gr-mono-note">
              {course.audience.toUpperCase()}
              {course.audience ? " · " : ""}
              {p.total} LESSON{p.total === 1 ? "" : "S"}
            </span>
          </span>
          <h3>{course.title}</h3>
          <p className="course-desc">{course.description}</p>
        </div>
        <div className="course-cta">
          {p.complete ? (
            <span className="course-complete-chip">Complete ✓</span>
          ) : (
            p.next && (
              <a className="gr-btn gr-btn-primary gr-btn-small" href={`/lab?lab=${encodeURIComponent(p.next.labId)}`}>
                {p.started ? "Continue" : "Start course"}
              </a>
            )
          )}
          <div className="course-progress" role="img" aria-label={`${p.done} of ${p.total} lessons complete`}>
            <div className="bar"><div className="fill" style={{ width: `${p.pct}%` }} /></div>
            <span className="gr-mono-note">{p.done}/{p.total} · {p.pct}%</span>
          </div>
        </div>
      </div>

      {/* Lessons grouped by level — a column per level, full visibility. */}
      <div className="course-levels">
        {groups.map(({ meta, items }) => (
          <div className="course-level-col" data-level={meta.key} key={meta.key}>
            <div className="course-level-head">
              <span className="lvl-label">{meta.label}</span>
              <span className="gr-mono-note">{items.length}</span>
            </div>
            <ol className="course-level-lessons">
              {items.map(({ lesson, index }) => {
                const s = scenarioByLabId.get(lesson.labId);
                const isDone = completed.has(lesson.labId);
                const isNext = p.next?.labId === lesson.labId;
                return (
                  <li key={`${lesson.labId}-${index}`} className={isDone ? "done" : isNext ? "next" : ""}>
                    <a href={`/lab?lab=${encodeURIComponent(lesson.labId)}`}>
                      <span className="mark" aria-hidden="true">{isDone ? "✓" : index + 1}</span>
                      <span className="lesson-title">{lesson.title ?? s?.title ?? lesson.labId}</span>
                      {isNext && <span className="up-next gr-mono-note">NEXT</span>}
                    </a>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </article>
  );
}

/* ================= playground (demoted: desk + free practice) ================= */

function PlaygroundSection({ completed, scenarios }: { completed: Set<string>; scenarios: Scenario[] }) {
  return (
    <section className="gr-section tight playground" style={{ paddingTop: 0 }}>
      <div className="gr-container">
        <hr className="gr-hairline" style={{ marginBottom: "clamp(40px, 5vw, 64px)" }} />
        <div className="gr-section-head" style={{ marginBottom: "clamp(22px, 3vw, 36px)" }}>
          <p className="gr-eyebrow">Playground</p>
          <h2 style={{ fontSize: "clamp(1.7rem, 2.6vw, 2.3rem)" }}>
            Or work <em className="copper">without the rails</em>
          </h2>
          <p className="gr-lede">
            Already comfortable? Skip the guided path. Open a bare machine and experiment, or drop
            straight into a single scenario — no course, no unlock order.
          </p>
        </div>

        <a className="desk-card" href="/lab">
          <img className="launch-rings" src="/brand/rings-watermark.svg" alt="" />
          <div className="desk-copy">
            <p className="gr-mono-note">VIRTUAL DESKTOP · FRESH SESSION</p>
            <h3>Step up to the desk</h3>
            <p>
              A windowed machine with an editor, a terminal, and a guide at the next desk. Everything
              you do in it is measured; nothing outside it is touched.
            </p>
          </div>
          <span className="gr-btn gr-btn-ghost desk-cta">Launch the desktop →</span>
        </a>

        <ScenarioLibrary completed={completed} scenarios={scenarios} />
      </div>
    </section>
  );
}

/* ================= scenario library (free practice) ================= */

const LEVEL_LABEL: Record<string, string> = {
  beginner: "New to this",
  intermediate: "Comfortable",
  advanced: "Confident",
};

function ScenarioLibrary({ completed, scenarios }: { completed: Set<string>; scenarios: Scenario[] }) {
  const [role, setRole] = useState<string | null>(null);
  const [tech, setTech] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  const roles = useMemo(() => rolesOf(scenarios), [scenarios]);
  const technologies = useMemo(() => technologiesOf(scenarios), [scenarios]);

  const filtered = useMemo(
    () =>
      scenarios.filter(
        (s) =>
          (role === null || s.role === role) &&
          (tech === null || s.technologies.includes(tech)) &&
          (level === null || s.level === level),
      ),
    [scenarios, role, tech, level],
  );
  const anyFilter = role !== null || tech !== null || level !== null;

  return (
    <div className="scenario-shelf">
      <div className="shelf-head">
        <span className="gr-mono-note">FREE PRACTICE · {scenarios.length} SCENARIOS</span>
        <p>Each one opens the desktop with a situation already growing in it — a failing test, an agent's unreviewed diff, an inbox that needs judgment.</p>
      </div>

      <div className="scenario-filters">
        <FilterGroup label="Role" options={roles} value={role} onChange={setRole} />
        <FilterGroup label="Technology" options={technologies} value={tech} onChange={setTech} />
        <FilterGroup
          label="Experience"
          options={ALL_LEVELS}
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
