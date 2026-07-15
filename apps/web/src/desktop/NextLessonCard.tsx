/**
 * NextLessonCard — the last card in the completion stack (celebration → pass
 * message → checklist → reflection → this). Appears once a checkpoint is
 * complete and drives the learner to whatever comes next: the following
 * lesson in the course, the course-complete state, or — for a standalone lab
 * with no course — back to the shelf.
 *
 * All client-side: courses + progress are fetched fresh on mount (no new
 * endpoint). A lesson switch is a real page load (see Home.tsx), so the CTAs
 * below are plain anchors, not client-side routes.
 */
import { useEffect, useState } from "react";
import { fetchCourses, learnerApi, savedLearner, type Course } from "../api.ts";

export function NextLessonCard({ labId }: { labId: string }) {
  const [courses, setCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const learner = savedLearner();
        const [list] = await Promise.all([
          fetchCourses(),
          learner ? learnerApi.progress(learner).catch(() => null) : Promise.resolve(null),
        ]);
        if (!stale) setCourses(list);
      } catch {
        // Quiet failure — no card is better than a broken one here.
      }
    })();
    return () => {
      stale = true;
    };
  }, [labId]);

  if (!courses) return null;

  const course = courses.find((c) => c.lessons.some((l) => l.labId === labId));
  const idx = course?.lessons.findIndex((l) => l.labId === labId) ?? -1;
  const next = course && idx >= 0 ? course.lessons[idx + 1] : undefined;
  const isLastLesson = !!course && idx === course.lessons.length - 1;
  const standalone = !course;

  if (standalone) {
    return (
      <div className="chat-nextlesson">
        <p className="nextlesson-line">That's this one wrapped up 🌿 — curious what else is on the shelf?</p>
        <a className="chip" href="/home">
          Explore more lessons
        </a>
      </div>
    );
  }

  if (next) {
    const nextTitle = next.title ?? next.labId;
    const pct = ((idx + 1) / course.lessons.length) * 100;
    return (
      <div className="chat-nextlesson">
        <div className="nextlesson-eyebrow">
          {course.title} · Lesson {idx + 1} of {course.lessons.length} complete
        </div>
        <p className="nextlesson-line">
          Nice work — that's one down. Next up: <strong>{nextTitle}</strong>.
        </p>
        <div className="nextlesson-meter">
          <div className="nextlesson-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="nextlesson-tile">
          <span className="nextlesson-badge">{idx + 2}</span>
          <div className="nextlesson-tile-body">
            <span className="nextlesson-tile-title">{nextTitle}</span>
            {next.note && <span className="nextlesson-tile-note">{next.note}</span>}
          </div>
        </div>
        <a className="chip chip-primary" href={`/lab?lab=${encodeURIComponent(next.labId)}`}>
          Start the next lesson →
        </a>
      </div>
    );
  }

  if (isLastLesson) {
    const total = course.lessons.length;
    return (
      <div className="chat-nextlesson">
        <div className="nextlesson-eyebrow">
          🏆 {course.title} · {total} of {total} complete
        </div>
        <p className="nextlesson-line">
          That's the whole path — <strong>{course.title}</strong>, done start to finish. 🎉 Really nicely done.
        </p>
        <div className="nextlesson-meter">
          <div className="nextlesson-meter-fill" style={{ width: "100%" }} />
        </div>
        <a className="chip" href="/home">
          Back to your courses
        </a>
      </div>
    );
  }

  return null;
}
