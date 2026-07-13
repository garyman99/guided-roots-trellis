/**
 * Courses + session-history e2e: boots the real API and exercises the
 * curated-course shelf (seed, admin CRUD, validation, gating), the learner
 * progress view, and the admin session history + replay — including that the
 * instructor's actual words now land in the event log (schema v3).
 * Uses the workspace lab so no shell or container is needed.
 */
process.env.NODE_ENV = "test";
process.env.TRELLIS_PERSISTENCE = "off";
process.env.INSTRUCTOR_PROVIDER = "mock";
process.env.TRELLIS_ADMIN_TOKEN = "test-admin-token";

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { server, manager } from "../src/server.ts";

let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await manager.destroyAll();
  server.close();
});

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const admin = (method: string, path: string, body?: unknown) => api(method, path, body, "test-admin-token");

interface CourseShape {
  courseId: string;
  title: string;
  level: string;
  lessons: Array<{ labId: string; title?: string }>;
}

test("the Playwright Foundations course is seeded and publicly listable", async () => {
  const { status, body } = await api("GET", "/api/courses");
  assert.equal(status, 200);
  const courses = (body as { courses: CourseShape[] }).courses;
  const pw = courses.find((c) => c.courseId === "playwright-foundations");
  assert.ok(pw, "seed course exists");
  assert.equal(pw.title, "Playwright Foundations");
  assert.deepEqual(
    pw.lessons.map((l) => l.labId),
    ["turn-heading-check-into-first-test", "read-one-failing-result-before-editing", "learn-playwright-basics"],
    "lessons run first-test → read-failure → repair, in order",
  );
});

test("course CRUD is admin-gated and validates its lessons", async () => {
  // gate: no token / wrong token
  assert.equal((await api("POST", "/api/admin/courses", { title: "X", lessons: [] })).status, 401);

  // validation: missing title, unknown lab
  assert.equal((await admin("POST", "/api/admin/courses", { title: "", lessons: [] })).status, 400);
  const badLab = await admin("POST", "/api/admin/courses", {
    title: "Broken",
    lessons: [{ labId: "no-such-lab" }],
  });
  assert.equal(badLab.status, 400);
  assert.match((badLab.body as { error: string }).error, /unknown lab/);

  // create
  const created = await admin("POST", "/api/admin/courses", {
    title: "Git Review Habits",
    description: "Review agent changes with confidence.",
    audience: "Software Development",
    level: "intermediate",
    lessons: [{ labId: "inspect-generated-changes", title: "Find the planted defect" }, { labId: "review-content-changes" }],
  });
  assert.equal(created.status, 201);
  const course = (created.body as { course: CourseShape }).course;
  assert.equal(course.courseId, "git-review-habits", "id derives from the title");
  assert.equal(course.lessons.length, 2);

  // update: reorder + retitle
  const updated = await admin("PUT", `/api/admin/courses/${course.courseId}`, {
    title: "Git Review Habits",
    description: "Review agent changes with confidence.",
    audience: "Software Development",
    level: "advanced",
    lessons: [{ labId: "review-content-changes" }, { labId: "inspect-generated-changes" }],
  });
  assert.equal(updated.status, 200);
  const after1 = (updated.body as { course: CourseShape }).course;
  assert.equal(after1.level, "advanced");
  assert.equal(after1.lessons[0].labId, "review-content-changes");

  // public list reflects the change; delete removes it
  const listed = (await api("GET", "/api/courses")).body as { courses: CourseShape[] };
  assert.ok(listed.courses.some((c) => c.courseId === course.courseId));
  assert.equal((await admin("DELETE", `/api/admin/courses/${course.courseId}`)).status, 200);
  assert.equal((await admin("DELETE", `/api/admin/courses/${course.courseId}`)).status, 404, "second delete: gone");
  const relisted = (await api("GET", "/api/courses")).body as { courses: CourseShape[] };
  assert.ok(!relisted.courses.some((c) => c.courseId === course.courseId));
});

test("learner progress + admin session history + replay tell one story", async () => {
  // learner + a workspace session with some guide conversation
  const learner = await api("POST", "/api/learners", {});
  assert.equal(learner.status, 201);
  const { learnerId, learnerToken } = learner.body as { learnerId: string; learnerToken: string };

  const created = await api("POST", "/api/sessions", {
    labId: "improve-delayed-order-reply",
    learnerId,
    learnerToken,
  });
  assert.equal(created.status, 201);
  const session = created.body as { sessionId: string; token: string };

  const ask = await api("POST", `/api/sessions/${session.sessionId}/ask`, { text: "where do I start?" }, session.token);
  assert.equal(ask.status, 200);
  const said = (ask.body as { message: { text: string } }).message.text;
  assert.ok(said.length > 0, "mock instructor answered");

  // learner progress: the attempt is on record, not completed, nothing mastered
  const progress = await api("GET", `/api/learners/${learnerId}/progress`, undefined, learnerToken);
  assert.equal(progress.status, 200);
  const p = progress.body as { completedLabIds: string[]; sessions: Array<{ sessionId: string; labId: string; completed: boolean }> };
  assert.deepEqual(p.completedLabIds, []);
  assert.equal(p.sessions.length, 1);
  assert.equal(p.sessions[0].labId, "improve-delayed-order-reply");
  assert.equal(p.sessions[0].completed, false);
  // and it is learner-token gated
  assert.equal((await api("GET", `/api/learners/${learnerId}/progress`)).status, 401);

  // admin session history: same session, finished=false, activity counted
  const sessions = await admin("GET", "/api/admin/sessions");
  assert.equal(sessions.status, 200);
  const mine = (sessions.body as { sessions: Array<{ sessionId: string; learnerId: string; labId: string; completed: boolean; live: boolean; eventCount: number; counts: { questions: number; hints: number } }> }).sessions.find(
    (s) => s.sessionId === session.sessionId,
  );
  assert.ok(mine, "session appears in the admin history");
  assert.equal(mine.learnerId, learnerId);
  assert.equal(mine.completed, false);
  assert.equal(mine.live, true, "still attached to this process");
  assert.equal(mine.counts.questions, 1);
  assert.equal(mine.counts.hints, 1);

  // replay: full event log, and the guide's WORDS are in it (schema v3)
  const replay = await admin("GET", `/api/admin/sessions/${session.sessionId}/replay`);
  assert.equal(replay.status, 200);
  const r = replay.body as { meta: { labTitle: string }; events: Array<{ type: string; v?: number; text?: string }> };
  assert.ok(r.meta.labTitle.length > 0);
  const hint = r.events.find((e) => e.type === "instructor.hint");
  assert.ok(hint, "hint event recorded");
  assert.equal(hint.v, 3);
  assert.equal(hint.text, said, "the replay carries exactly what the guide said");
  assert.ok(r.events.some((e) => e.type === "learner.question"), "learner side of the conversation too");

  // gate + unknown id
  assert.equal((await api("GET", "/api/admin/sessions")).status, 401);
  assert.equal((await admin("GET", "/api/admin/sessions/nope/replay")).status, 404);

  // hygiene: erase the test learner (removes its sessions/history too) so
  // repeated runs never accumulate rows in a persistent store.
  assert.equal((await api("DELETE", `/api/learners/${learnerId}`, undefined, learnerToken)).status, 200);
});
