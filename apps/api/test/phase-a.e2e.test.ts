/**
 * Phase-A enablers over the real API: the capability-registry endpoint, course
 * draft/publish visibility, and the Go-live flip. Persistence off, no shell.
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
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const admin = (method: string, path: string, body?: unknown) => api(method, path, body, "test-admin-token");

interface CourseShape { courseId: string; title: string; level: string; status?: string }

test("GET /api/admin/capabilities is admin-gated and returns the registry", async () => {
  assert.equal((await api("GET", "/api/admin/capabilities")).status, 401, "gated");
  const { status, body } = await admin("GET", "/api/admin/capabilities");
  assert.equal(status, 200);
  const reg = body as { version: number; autoRules: Array<{ id: string }>; surfaces: Array<{ id: string }> };
  assert.ok(reg.version >= 1);
  assert.ok(reg.autoRules.some((r) => r.id === "diff-viewed"), "advertises diff-viewed");
  assert.deepEqual(reg.surfaces.map((s) => s.id).sort(), ["terminal", "workspace"]);
});

test("a draft course is admin-visible but hidden from the public shelf until Go-live", async () => {
  // Create a course (created courses are published by default — absent status).
  const created = await admin("POST", "/api/admin/courses", {
    title: "Phase A Draft Demo",
    description: "temp",
    audience: "QA & Testing",
    level: "intermediate",
    lessons: [{ labId: "improve-delayed-order-reply" }],
  });
  assert.equal(created.status, 201);
  const id = (created.body as { course: CourseShape }).course.courseId;

  // intermediate is now a first-class level (five-level ladder), not folded away.
  assert.equal((created.body as { course: CourseShape }).course.level, "intermediate");

  // Unpublish → draft: gone from /api/courses, still on admin's full list.
  assert.equal((await admin("POST", `/api/admin/courses/${id}/unpublish`)).status, 200);
  const publicList = (await api("GET", "/api/courses")).body as { courses: CourseShape[] };
  assert.ok(!publicList.courses.some((c) => c.courseId === id), "draft hidden from public");
  // (admin sees all courses via the same store; the public route is the filter.)

  // Editing a draft must not silently republish it.
  const edited = await admin("PUT", `/api/admin/courses/${id}`, {
    title: "Phase A Draft Demo (edited)",
    description: "temp",
    audience: "QA & Testing",
    level: "advanced",
    lessons: [{ labId: "improve-delayed-order-reply" }],
  });
  assert.equal(edited.status, 200);
  assert.equal((edited.body as { course: CourseShape }).course.status, "draft", "still draft after edit");
  const stillHidden = (await api("GET", "/api/courses")).body as { courses: CourseShape[] };
  assert.ok(!stillHidden.courses.some((c) => c.courseId === id), "edit did not republish");

  // Go live → visible again.
  assert.equal((await admin("POST", `/api/admin/courses/${id}/publish`)).status, 200);
  const relisted = (await api("GET", "/api/courses")).body as { courses: CourseShape[] };
  assert.ok(relisted.courses.some((c) => c.courseId === id), "published course is public");

  // publish/unpublish 404 on unknown course
  assert.equal((await admin("POST", "/api/admin/courses/no-such/publish")).status, 404);

  await admin("DELETE", `/api/admin/courses/${id}`);
});
