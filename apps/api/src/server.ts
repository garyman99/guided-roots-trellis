/**
 * Trellis API server — Node http + miniWs, zero dependencies.
 *
 * Routes:
 *   POST   /api/sessions                     { labId, consentAnalytics? } → session + token
 *   GET    /api/labs/:labId                  lesson content for the UI
 *   GET    /api/sessions/:id/state           reduced state + transcript + checkpoint spec
 *   GET    /api/sessions/:id/context-preview exactly what the instructor would see now
 *   POST   /api/sessions/:id/ask             { text, stuck? } → instructor message
 *   GET    /api/sessions/:id/intervention    non-blocking nudge poll (may be null)
 *   POST   /api/sessions/:id/checkpoint/evaluate
 *   POST   /api/sessions/:id/reset
 *   GET    /api/sessions/:id/export          full event log (data transparency)
 *   DELETE /api/sessions/:id
 *   WS     /ws/terminal?session=ID&token=T   the learner terminal
 *
 * Learner routes (Phase 1–5). Learner identity PERSISTS across sessions and
 * months; a learner token (issued once at creation) gates everything
 * learner-scoped. The profile belongs to the learner: no org-facing
 * individual views exist — analytics is cohort-only, k-suppressed.
 *   POST   /api/learners                         → { learnerId, learnerToken }
 *   GET    /api/learners/:id/profile             profile + evidence + recommendations
 *   GET    /api/learners/:id/reflections
 *   GET    /api/learners/:id/export              everything Trellis knows, same format Trellis uses
 *   PUT    /api/learners/:id/consents            { selfAnalytics, cohortAggregate, research }
 *   POST   /api/learners/:id/assertions          contestation: preference | suppression | fresh-start
 *   DELETE /api/learners/:id                     erasure (ADR-0002: delete + tombstone)
 *   POST   /api/sessions/:id/self-assessment     { confidence: 1..5 } calibration signal
 *   GET    /api/sessions/:id/reflection          after checkpoint pass
 *   GET    /api/analytics/cohort                 k-suppressed aggregate (consented learners only)
 *   GET    /api/analytics/research-export        research-consented learners only
 *
 * Courses (curated ordered paths of scenarios; operator content):
 *   GET    /api/courses                          public list — the home page renders these
 *   GET    /api/learners/:id/progress            completed labs + session attempts (learner-token gated)
 *
 * Admin routes (operator surface; bearer TRELLIS_ADMIN_TOKEN when set):
 *   GET    /api/admin/agents                     configured agents/services + their prompts
 *   GET    /api/admin/users                      learners: activity, tokens by model, derived profile
 *   GET    /api/admin/usage                      total token usage by model over time
 *   POST   /api/admin/courses                    create a course
 *   PUT    /api/admin/courses/:id                update a course
 *   DELETE /api/admin/courses/:id                delete a course
 *   GET    /api/admin/sessions                   every stored session: status, counts, live flag
 *   GET    /api/admin/sessions/:id/replay        meta + full event log (drives the replay player)
 *
 * AUTH (POC scope): every session-scoped route requires the session token
 * (Authorization: Bearer <token> or ?token=). Tokens are 192-bit random,
 * compared timing-safely, returned once at session creation, and never
 * stored server-side beyond the live session object. No accounts — learner
 * identity is an anonymous ID. TLS/origin checks are deployment concerns
 * documented in the ADR.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { acceptUpgrade } from "./miniWs.ts";
import { createStore, type Course, type CourseLesson, type LearnerMeta, type TokenUsageRecord } from "./store.ts";
import { SessionManager, taskStatuses, type Session } from "./sessions.ts";
import { newLearnerId } from "../../../packages/shared/src/ids.ts";
import { recommendNext } from "../../../packages/learner-model/src/recommend.ts";
import { cohortAggregate, learnerSummary } from "../../../packages/learner-model/src/analytics.ts";
import type { SessionDigest } from "../../../packages/learner-model/src/evidence.ts";
import { PROMPT_VERSION } from "../../../packages/instructor/src/index.ts";
import { resolveRoleConfig, ModelConfigError } from "../../../packages/model-runtime/src/config.ts";
import { defaultInterventionConfig } from "../../../packages/session-events/src/interventions.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Fail fast on bad provider config (plan Phase 3): a misconfigured Guide must
// die HERE, before the SessionManager constructs its provider, with the exact
// variable to fix — not a raw stack or a 500 on the first hint.
const guideBootConfig = (() => {
  try {
    return resolveRoleConfig("guide");
  } catch (err) {
    if (err instanceof ModelConfigError) {
      console.error(`[trellis-api] FATAL provider configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
})();

const store = createStore();
export const manager = new SessionManager(store, join(repoRoot, "labs"));

/**
 * Curated-course seed: a fresh deployment starts with the Playwright path
 * already on the shelf. Runs once (only when the course shelf is empty);
 * after that the course is ordinary admin content — editable, deletable.
 */
function seedCourses(): void {
  if (store.listCourses().length > 0) return;
  const lessons: CourseLesson[] = [
    { labId: "turn-heading-check-into-first-test", title: "Your first automated check", note: "Turn one manual expected result into a real Playwright assertion." },
    { labId: "read-one-failing-result-before-editing", title: "Read the failure like evidence", note: "A check fails on purpose — collect the four facts before touching anything." },
    { labId: "learn-playwright-basics", title: "Repair a broken test", note: "Fix the test itself without changing the app it protects." },
  ];
  // Only seed when every referenced lab actually ships in this checkout.
  try {
    for (const l of lessons) manager.loadManifest(l.labId);
  } catch {
    return;
  }
  const at = new Date().toISOString();
  store.saveCourse({
    courseId: "playwright-foundations",
    title: "Playwright Foundations",
    description:
      "Get comfortable writing Playwright tests, one sitting at a time: turn a manual check into your first automated test, learn to read a failing result calmly, then repair a broken test without touching the app it protects.",
    audience: "QA & Testing",
    level: "beginner",
    lessons,
    createdAt: at,
    updatedAt: at,
  });
}
seedCourses();

/** Course payload validation shared by create + update. Returns an error string or the clean fields. */
function parseCourseBody(body: Record<string, unknown>): string | Omit<Course, "courseId" | "createdAt" | "updatedAt"> {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return "title is required";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 80) : "";
  const levels = ["beginner", "intermediate", "advanced"];
  const level = typeof body.level === "string" && levels.includes(body.level) ? body.level : "beginner";
  if (!Array.isArray(body.lessons) || body.lessons.length > 50) return "lessons must be an array (max 50)";
  const lessons: CourseLesson[] = [];
  for (const raw of body.lessons) {
    const l = raw as Record<string, unknown>;
    const labId = typeof l.labId === "string" ? l.labId : "";
    try {
      manager.loadManifest(labId); // validates the id shape AND that the lab exists
    } catch {
      return `unknown lab: ${labId.slice(0, 80) || "(missing labId)"}`;
    }
    lessons.push({
      labId,
      ...(typeof l.title === "string" && l.title.trim() ? { title: l.title.trim().slice(0, 120) } : {}),
      ...(typeof l.note === "string" && l.note.trim() ? { note: l.note.trim().slice(0, 300) } : {}),
    });
  }
  return { title, description, audience, level, lessons };
}

/** Stable, readable course ids derived from the title; suffixed when taken. */
function newCourseId(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
  let id = base;
  for (let i = 2; store.getCourse(id); i++) id = `${base}-${i}`;
  return id;
}

const PORT = Number(process.env.PORT ?? 8787);

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function bearerToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token");
}

/**
 * Admin gate: /api/admin/* is the OPERATOR surface (the person running the
 * deployment), a deliberate owner-requested exception to the "no org-facing
 * individual views" rule that still governs /api/analytics. When
 * TRELLIS_ADMIN_TOKEN is set, every admin route requires it as a bearer
 * token; unset means open — acceptable only for the local/household POC.
 * Read per request (not at module load): ESM import hoisting runs this
 * module before a test file's env assignments.
 */
function adminAuthed(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const configured = process.env.TRELLIS_ADMIN_TOKEN ?? "";
  if (!configured) return true;
  const a = Buffer.from(configured);
  const b = Buffer.from(bearerToken(req, url) ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    json(res, 401, { error: "missing or invalid admin token" });
    return false;
  }
  return true;
}

interface ModelUsageTotals {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function usageByModel(records: TokenUsageRecord[]): ModelUsageTotals[] {
  const byModel = new Map<string, ModelUsageTotals>();
  for (const r of records) {
    const m = byModel.get(r.model) ?? { model: r.model, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    m.calls += 1;
    m.promptTokens += r.promptTokens;
    m.completionTokens += r.completionTokens;
    m.totalTokens += r.promptTokens + r.completionTokens;
    byModel.set(r.model, m);
  }
  return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Resolve + authenticate a session or answer with the right error. */
function authed(req: IncomingMessage, res: ServerResponse, url: URL, id: string): Session | null {
  const session = manager.get(id);
  if (!session) {
    json(res, 404, { error: "session not found" });
    return null;
  }
  if (!session.verifyToken(bearerToken(req, url))) {
    json(res, 401, { error: "missing or invalid session token" });
    return null;
  }
  return session;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // POST /api/learners — persistent learner identity + consent tiers
    if (req.method === "POST" && url.pathname === "/api/learners") {
      const body = await readBody(req);
      const meta: LearnerMeta = {
        learnerId: newLearnerId(),
        token: randomBytes(24).toString("base64url"),
        createdAt: new Date().toISOString(),
        consents: {
          selfAnalytics: body.consentSelfAnalytics !== false, // the product itself; default on
          cohortAggregate: body.consentCohortAggregate === true,
          research: body.consentResearch === true,
        },
      };
      store.createLearner(meta);
      return json(res, 201, { learnerId: meta.learnerId, learnerToken: meta.token, consents: meta.consents });
    }

    // /api/learners/:id/... — learner-token gated
    if (parts[0] === "api" && parts[1] === "learners" && parts.length >= 3) {
      const learnerId = parts[2];
      const tail = parts[3] ?? "";
      if (store.isErased(learnerId)) return json(res, 410, { error: "learner erased" });
      const meta = store.learnerMeta(learnerId);
      if (!meta) return json(res, 404, { error: "learner not found" });
      const candidate = bearerToken(req, url);
      const a = Buffer.from(meta.token);
      const b = Buffer.from(candidate ?? "");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return json(res, 401, { error: "missing or invalid learner token" });
      }

      if (req.method === "GET" && tail === "profile") {
        const profile = manager.learners.profileFor(learnerId);
        return json(res, 200, {
          profile,
          recommendations: recommendNext(profile, manager.learners.curriculum),
          evidence: store.evidenceFor(learnerId), // every claim's pointers resolve right here
        });
      }
      if (req.method === "GET" && tail === "reflections") {
        return json(res, 200, { reflections: store.reflectionsFor(learnerId) });
      }
      if (req.method === "GET" && tail === "progress") {
        // Course/scenario progress, derived — never stored: a lab is complete
        // exactly when a completion digest exists for it (the one door into
        // long-term memory), so this view can't disagree with the profile.
        const digests = store
          .evidenceFor(learnerId)
          .flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
        const completedSessions = new Set(digests.map((d) => d.sessionId));
        const sessions = store
          .sessionsForLearner(learnerId)
          .flatMap((id) => {
            const m = store.sessionMeta(id);
            return m ? [{ sessionId: m.sessionId, labId: m.labId, createdAt: m.createdAt, completed: completedSessions.has(m.sessionId) }] : [];
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return json(res, 200, {
          completedLabIds: [...new Set(digests.map((d) => d.labId))],
          sessions,
        });
      }
      if (req.method === "GET" && tail === "export") {
        // Portability: everything Trellis knows, in the format Trellis uses.
        return json(res, 200, {
          learner: { learnerId: meta.learnerId, createdAt: meta.createdAt, consents: meta.consents },
          evidence: store.evidenceFor(learnerId),
          profile: manager.learners.profileFor(learnerId),
          reflections: store.reflectionsFor(learnerId),
        });
      }
      if (req.method === "PUT" && tail === "consents") {
        const body = await readBody(req);
        const consents = {
          selfAnalytics: body.selfAnalytics === true,
          cohortAggregate: body.cohortAggregate === true,
          research: body.research === true,
        };
        store.updateConsents(learnerId, consents);
        return json(res, 200, { consents });
      }
      if (req.method === "POST" && tail === "assertions") {
        const body = await readBody(req);
        const kind = body.kind;
        if (kind !== "preference" && kind !== "suppression" && kind !== "fresh-start") {
          return json(res, 400, { error: "kind must be preference | suppression | fresh-start" });
        }
        // Contestation is first-class AND auditable: the correction is itself evidence.
        const stored = store.appendEvidence(learnerId, {
          type: "learner.assertion",
          kind,
          key: typeof body.key === "string" ? body.key.slice(0, 100) : undefined,
          value: typeof body.value === "string" ? body.value.slice(0, 200) : undefined,
          target: typeof body.target === "string" ? body.target.slice(0, 100) : undefined,
          conceptId: typeof body.conceptId === "string" ? body.conceptId.slice(0, 100) : undefined,
          note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
          timestamp: new Date().toISOString(),
        });
        return json(res, 201, { seq: stored.seq, profile: manager.learners.profileFor(learnerId) });
      }
      if (req.method === "DELETE" && tail === "") {
        await manager.destroyByLearner(learnerId);
        store.eraseLearner(learnerId);
        return json(res, 200, { erased: true });
      }
      return json(res, 404, { error: "unknown learner route" });
    }

    // GET /api/analytics/... — read-side projections over the same digests
    // everything else uses; consent tiers enforced here.
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "analytics") {
      const digestsFor = (learnerId: string): SessionDigest[] =>
        store.evidenceFor(learnerId).flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
      if (parts[2] === "cohort") {
        const perLearner = new Map<string, SessionDigest[]>();
        for (const id of store.listLearners()) {
          if (store.learnerMeta(id)?.consents.cohortAggregate) perLearner.set(id, digestsFor(id));
        }
        return json(res, 200, cohortAggregate(perLearner));
      }
      if (parts[2] === "research-export") {
        const learners = store
          .listLearners()
          .filter((id) => store.learnerMeta(id)?.consents.research)
          .map((id) => ({ learnerId: id, digests: digestsFor(id), summary: learnerSummary(digestsFor(id)) }));
        return json(res, 200, { consentTier: "research", learners });
      }
      return json(res, 404, { error: "unknown analytics route" });
    }

    // GET /api/courses — the public shelf of curated paths (home page).
    if (req.method === "GET" && url.pathname === "/api/courses") {
      return json(res, 200, { courses: store.listCourses() });
    }

    // ── /api/admin — operator views: agents, users, token usage ──────────
    if (parts[0] === "api" && parts[1] === "admin") {
      if (!adminAuthed(req, res, url)) return;

      // GET /api/admin/agents — every configured agent/service + its prompts
      if (req.method === "GET" && parts[2] === "agents" && parts.length === 3) {
        const promptsDir = join(repoRoot, "packages", "instructor", "prompts");
        const prompts = readdirSync(promptsDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((file) => ({
            id: file.replace(/\.md$/, ""),
            file: `packages/instructor/prompts/${file}`,
            active: file === `instructor.${PROMPT_VERSION}.md`,
            content: readFileSync(join(promptsDir, file), "utf8"),
          }));
        // Role-scoped resolution (GUIDE_* with legacy INSTRUCTOR_PROVIDER
        // fallback). Boot already validated it; this is display-only.
        const guideCfg = resolveRoleConfig("guide");
        const llm = guideCfg.provider === "anthropic" || guideCfg.provider === "openai-compatible";
        return json(res, 200, {
          agents: [
            {
              id: "instructor",
              name: "Instructor (the Guide)",
              role: "Turns measured session state into elicit-first coaching. The only component that calls a model; hint level and timing are decided by deterministic policy, never by the model.",
              kind: llm ? "llm" : guideCfg.provider,
              provider: guideCfg.provider,
              model: guideCfg.model ?? "mock-instructor",
              baseUrl: guideCfg.baseUrl ?? null,
              promptVersion: PROMPT_VERSION,
              prompts,
            },
            {
              id: "intervention-engine",
              name: "Intervention engine",
              role: "Deterministic rules deciding WHEN the instructor speaks unprompted (repeated failures, inactivity, tests not run); the instructor only chooses the words.",
              kind: "deterministic",
              config: defaultInterventionConfig,
              prompts: [],
            },
            {
              id: "reflection-narrative",
              name: "Reflection narrative renderer",
              role: "Renders the deterministic post-lab reflection struct into prose. Regenerable, no model call.",
              kind: "deterministic",
              prompts: [],
            },
            {
              id: "workspace-ai",
              name: "Workspace AI assistant (simulated)",
              role: "The in-lab \"AI app\" in workspace scenarios. Its drafts are authored per-lab content (labs/*/lab.json), not model output.",
              kind: "simulated",
              prompts: [],
            },
          ],
        });
      }

      // GET /api/admin/users — activity, per-model tokens, derived profile
      if (req.method === "GET" && parts[2] === "users" && parts.length === 3) {
        const users = store.listLearners().map((id) => {
          const meta = store.learnerMeta(id)!;
          const evidence = store.evidenceFor(id);
          const digests = evidence.flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
          const usage = store.tokenUsage(id);
          const profile = manager.learners.profileFor(id);
          const lastActiveAt =
            [evidence.at(-1)?.timestamp, usage.at(-1)?.createdAt, meta.createdAt]
              .filter((t): t is string => Boolean(t))
              .sort()
              .at(-1) ?? meta.createdAt;
          return {
            learnerId: id,
            createdAt: meta.createdAt,
            consents: meta.consents,
            activity: {
              sessionsOnRecord: store.sessionsForLearner(id).length,
              labsCompleted: profile.labsCompleted,
              reflections: store.reflectionsFor(id).length,
              hintCalls: usage.length,
              lastActiveAt,
              summary: learnerSummary(digests),
            },
            usageByModel: usageByModel(usage),
            // The derived profile — exactly what the context assembler draws
            // from when it briefs the instructor about this learner.
            profile,
          };
        });
        return json(res, 200, { users });
      }

      // GET /api/admin/usage — total tokens by model, bucketed by day
      if (req.method === "GET" && parts[2] === "usage" && parts.length === 3) {
        const records = store.tokenUsage();
        const buckets = new Map<string, { day: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }>();
        for (const r of records) {
          const day = r.createdAt.slice(0, 10);
          const key = `${day}|${r.model}`;
          const b = buckets.get(key) ?? { day, model: r.model, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
          b.promptTokens += r.promptTokens;
          b.completionTokens += r.completionTokens;
          b.totalTokens += r.promptTokens + r.completionTokens;
          buckets.set(key, b);
        }
        return json(res, 200, {
          byModel: usageByModel(records),
          series: [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
          calls: records.length,
        });
      }

      // ── courses CRUD (operator content; reads are public at /api/courses) ──
      if (parts[2] === "courses") {
        if (req.method === "POST" && parts.length === 3) {
          const parsed = parseCourseBody(await readBody(req));
          if (typeof parsed === "string") return json(res, 400, { error: parsed });
          const at = new Date().toISOString();
          const course: Course = { courseId: newCourseId(parsed.title), ...parsed, createdAt: at, updatedAt: at };
          store.saveCourse(course);
          return json(res, 201, { course });
        }
        if (parts.length === 4) {
          const existing = store.getCourse(parts[3]);
          if (!existing) return json(res, 404, { error: "course not found" });
          if (req.method === "PUT") {
            const parsed = parseCourseBody(await readBody(req));
            if (typeof parsed === "string") return json(res, 400, { error: parsed });
            const course: Course = { ...existing, ...parsed, updatedAt: new Date().toISOString() };
            store.saveCourse(course);
            return json(res, 200, { course });
          }
          if (req.method === "DELETE") {
            store.deleteCourse(parts[3]);
            return json(res, 200, { deleted: true });
          }
        }
      }

      // ── session history: every stored session, finished or not ──────────
      if (req.method === "GET" && parts[2] === "sessions" && parts.length === 3) {
        const sessions = store.listSessions().map((m) => {
          const events = store.eventsFor(m.sessionId);
          const last = events.at(-1)?.timestamp ?? m.createdAt;
          let commands = 0, questions = 0, hints = 0, testRuns = 0, completed = false;
          for (const e of events) {
            if (e.type === "terminal.command.completed") commands++;
            else if (e.type === "learner.question" || e.type === "learner.goal.stated") questions++;
            else if (e.type === "instructor.hint") hints++;
            else if (e.type === "tests.completed") testRuns++;
            else if (e.type === "checkpoint.completed") completed = true;
          }
          return {
            sessionId: m.sessionId,
            learnerId: m.learnerId,
            labId: m.labId,
            createdAt: m.createdAt,
            lastEventAt: last,
            durationMs: Math.max(0, Date.parse(last) - Date.parse(m.createdAt)),
            eventCount: events.length,
            counts: { commands, questions, hints, testRuns },
            completed,
            // Still attached to a live lab environment in this process?
            live: manager.get(m.sessionId) !== null,
          };
        });
        return json(res, 200, { sessions: sessions.reverse() }); // newest first
      }

      // ── session replay: the full event log, the deterministic recording ──
      if (req.method === "GET" && parts[2] === "sessions" && parts.length === 5 && parts[4] === "replay") {
        const meta = store.sessionMeta(parts[3]);
        if (!meta) return json(res, 404, { error: "session not found" });
        let labTitle = meta.labId;
        try {
          labTitle = manager.loadManifest(meta.labId).title;
        } catch {
          /* lab may have been renamed/removed since; the id still identifies it */
        }
        return json(res, 200, {
          meta: { ...meta, labTitle, live: manager.get(meta.sessionId) !== null },
          events: store.eventsFor(meta.sessionId),
        });
      }

      return json(res, 404, { error: "unknown admin route" });
    }

    // POST /api/sessions
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readBody(req);
      const labId = typeof body.labId === "string" ? body.labId : "inspect-generated-changes";

      // Persistent identity: an existing learner may attach this session to
      // their record by presenting their learner token.
      let learnerId: string | undefined;
      if (typeof body.learnerId === "string") {
        if (store.isErased(body.learnerId)) return json(res, 410, { error: "learner erased" });
        const meta = store.learnerMeta(body.learnerId);
        const supplied = typeof body.learnerToken === "string" ? body.learnerToken : "";
        const a = Buffer.from(meta?.token ?? "");
        const b = Buffer.from(supplied);
        if (!meta || a.length !== b.length || !timingSafeEqual(a, b)) {
          return json(res, 401, { error: "invalid learner credentials" });
        }
        learnerId = body.learnerId;
      }

      const session = await manager.createSession(labId, body.consentAnalytics === true, learnerId);
      return json(res, 201, {
        sessionId: session.id,
        token: session.token,
        learnerId: session.learnerId,
        variantId: session.variant?.variantId ?? null,
        labId,
        driver: manager.driverKind,
        terminalUrl: `/ws/terminal?session=${session.id}`,
      });
    }

    // GET /api/labs/:labId
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "labs" && parts.length === 3) {
      const manifest = manager.loadManifest(parts[2]);
      return json(res, 200, manifest);
    }

    // /api/sessions/:id/...
    if (parts[0] === "api" && parts[1] === "sessions" && parts.length >= 3) {
      const id = parts[2];
      const tail = parts[3] ?? "";
      const session = authed(req, res, url, id);
      if (!session) return;

      if (req.method === "GET" && tail === "state") {
        const state = session.state();
        const tasks = taskStatuses(session.manifest.tasks, state);
        return json(res, 200, {
          state,
          tasks,
          // "Everything looks ready — run the check": green tests, nothing
          // edited since, diff reviewed. Evaluation itself stays explicit.
          checkpointReady: tasks.every((t) => t.done),
          transcript: session.transcript,
          checkpoint: session.manifest.checkpoint,
          variantId: session.variant?.variantId ?? null,
          // The agent lane, straight from the event log — replayable truth.
          agentTimeline: session
            .events()
            .flatMap((e) => (e.type === "agent.action" ? [{ at: e.timestamp, action: e.action, detail: e.detail }] : [])),
          lab: {
            id: session.manifest.id,
            title: session.manifest.title,
            scenario: session.manifest.scenario,
            agentMessage: session.manifest.agentMessage ?? null,
            chat: session.manifest.chat ?? null,
            tasks: session.manifest.tasks,
            // Workspace labs: which simulated apps the desktop should offer
            // (and that there is no terminal). Null for terminal labs.
            workspaceApps: session.manifest.workspace?.apps ?? null,
          },
        });
      }
      if (req.method === "GET" && tail === "context-preview") {
        return json(res, 200, session.contextPreview());
      }
      if (req.method === "POST" && tail === "self-assessment") {
        const body = await readBody(req);
        const confidence = Number(body.confidence);
        if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
          return json(res, 400, { error: "confidence must be an integer 1..5" });
        }
        // Calibration signal: learner's stated confidence vs the measured outcome.
        const st = session.state();
        session.appendSelfAssessment(confidence, st.completedCheckpoints.length > 0);
        return json(res, 201, { recorded: true });
      }

      if (req.method === "GET" && tail === "reflection") {
        const r = session.latestReflection();
        return r ? json(res, 200, r) : json(res, 404, { error: "no reflection yet — complete the checkpoint first" });
      }

      // ── workspace fs (GUI editor) — same trust boundary as the terminal ──
      if (req.method === "GET" && tail === "fs") {
        try {
          return json(res, 200, { entries: await session.listWorkspaceFiles() });
        } catch (err) {
          return json(res, 500, { error: String((err as Error).message).slice(0, 300) });
        }
      }
      if (req.method === "GET" && tail === "file") {
        const path = url.searchParams.get("path") ?? "";
        try {
          return json(res, 200, await session.readWorkspaceFile(path));
        } catch (err) {
          const msg = String((err as Error).message);
          return json(res, msg.includes("invalid path") ? 400 : 404, { error: msg.slice(0, 300) });
        }
      }
      if (req.method === "PUT" && tail === "file") {
        const body = await readBody(req);
        const path = typeof body.path === "string" ? body.path : "";
        const content = typeof body.content === "string" ? body.content : null;
        if (content === null) return json(res, 400, { error: "content is required" });
        try {
          await session.writeWorkspaceFile(path, content);
          return json(res, 200, { saved: true, path });
        } catch (err) {
          const msg = String((err as Error).message);
          return json(res, msg.includes("invalid path") || msg.includes("too large") ? 400 : 500, { error: msg.slice(0, 300) });
        }
      }

      if (req.method === "POST" && tail === "ask") {
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return json(res, 400, { error: "text is required" });
        // body.screen: optional client self-report of what's on screen —
        // normalized + sanitized inside the session (untrusted input).
        // body.goal: goal-first onboarding — this message states the
        // learner's goal rather than asking for help.
        const message = await session.ask(text, body.stuck === true, body.screen, { goal: body.goal === true });
        return json(res, 200, { message });
      }
      if (req.method === "GET" && tail === "intervention") {
        // Workspace labs have no instrumentation loop; the poll drives rules.
        if (session.workspace) await session.maybeIntervene().catch(() => {});
        return json(res, 200, { intervention: session.takePendingIntervention() });
      }

      // ── workspace labs: simulated application state + actions ───────────
      if (req.method === "GET" && tail === "workspace") {
        if (!session.workspace) return json(res, 404, { error: "this lab has no simulated workspace" });
        return json(res, 200, session.workspace.view());
      }
      if (req.method === "POST" && tail === "workspace" && parts[4] === "action") {
        if (!session.workspace) return json(res, 404, { error: "this lab has no simulated workspace" });
        const body = await readBody(req);
        const str = (v: unknown): string => (typeof v === "string" ? v : "");
        try {
          const ws = session.workspace;
          switch (body.type) {
            case "open-app":
              ws.openApp(str(body.appId));
              break;
            case "open-artifact":
              ws.openArtifact(str(body.appId), str(body.artifactId));
              break;
            case "chat-send":
              ws.chatSend(str(body.prompt), str(body.context));
              break;
            case "insert-draft":
              ws.insertDraft(str(body.draftId));
              break;
            case "update-draft":
              ws.updateDraft(str(body.text));
              break;
            case "submit-reply":
              ws.submitReply();
              break;
            default:
              return json(res, 400, { error: "unknown workspace action" });
          }
          // Deterministic rules run right after learner actions, so coaching
          // (e.g. restricted context shared) lands while it is still relevant.
          await session.maybeIntervene().catch(() => {});
          return json(res, 200, session.workspace.view());
        } catch (err) {
          return json(res, 400, { error: String((err as Error).message).slice(0, 300) });
        }
      }
      if (req.method === "POST" && tail === "checkpoint" && parts[4] === "evaluate") {
        return json(res, 200, await session.evaluateCheckpoint());
      }
      if (req.method === "POST" && tail === "reset") {
        await session.reset();
        return json(res, 200, { ok: true, note: "workspace re-created; reconnect the terminal" });
      }
      if (req.method === "GET" && tail === "export") {
        return json(res, 200, {
          meta: { sessionId: session.id, learnerId: session.learnerId, labId: session.manifest.id, createdAt: session.createdAt },
          events: store.eventsFor(session.id),
        });
      }
      if (req.method === "DELETE" && tail === "") {
        await manager.destroy(id);
        return json(res, 200, { ok: true });
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String((err as Error).message ?? err).slice(0, 300) });
  }
});

// WS /ws/terminal?session=ID&token=T
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws/terminal") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  const session = manager.get(url.searchParams.get("session") ?? "");
  // AUTH: reject before the WebSocket handshake completes.
  if (!session || !session.verifyToken(url.searchParams.get("token"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  if (!session.handle) {
    // Workspace labs have no terminal to attach.
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  const ws = acceptUpgrade(req, socket);
  if (!ws) return;

  // Refresh is a non-event: replay recent scrollback, then live-stream.
  if (session.scrollback) ws.send(Buffer.from(session.scrollback));
  const unsubscribe = session.subscribe((chunk) => ws.send(chunk));

  ws.onMessage((data, isBinary) => {
    if (isBinary) {
      // Control channel: binary frames carry JSON, e.g. {type:"resize",cols,rows}.
      try {
        const msg = JSON.parse(data.toString("utf8"));
        if (msg?.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          session.resizeTerminal(msg.cols, msg.rows);
        }
      } catch {
        /* malformed control frames are dropped */
      }
      return;
    }
    session.writeTerminal(data.toString("utf8"));
  });
  ws.onClose(unsubscribe);
  // Closing the tab must not kill the lab: the session (and its shell) lives
  // until DELETE or server shutdown, so a refreshed tab reattaches.
});

if (process.env.NODE_ENV !== "test") {
  console.log(
    `[trellis-api] guide provider: ${guideBootConfig.provider}` +
      (guideBootConfig.model ? ` model=${guideBootConfig.model}` : "") +
      (guideBootConfig.baseUrl ? ` baseUrl=${guideBootConfig.baseUrl}` : ""),
  );
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[trellis-api] listening on http://127.0.0.1:${PORT} (driver=${manager.driverKind})`);
  });
}

async function shutdown(): Promise<void> {
  // releaseAll, not destroyAll: shutdown frees live resources but keeps the
  // stored history — the admin session replays depend on it surviving.
  await manager.releaseAll();
  store.close();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
