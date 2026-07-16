/**
 * Append-only session event store.
 *
 * SQLite via node:sqlite (no external dependency). Events are never
 * updated or deleted while a session lives; state is always derived by the
 * reducer. Two privacy affordances (POC versions of real obligations):
 *
 *   • TRELLIS_PERSISTENCE=off  → events are held in memory only and vanish
 *     with the process. The consent flag rides along in session metadata.
 *   • export(sessionId)        → every stored event for a session, for
 *     "show me my data" and for learning-science analysis later.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionEvent } from "../../../packages/session-events/src/events.ts";
import { stampVersion, upcastEvent } from "../../../packages/session-events/src/schema.ts";
import type { EvidenceEvent, StoredEvidence } from "../../../packages/learner-model/src/evidence.ts";
import type { Reflection } from "../../../packages/learner-model/src/reflection.ts";
import type { Scenario } from "../../../packages/shared/src/scenarios.ts";
import type {
  CourseRun,
  CourseRunEvent,
  CourseRunGate,
  GateDecision,
  GateId,
  GateNote,
} from "../../../packages/course-architect/src/types.ts";

export interface SessionMeta {
  sessionId: string;
  learnerId: string;
  labId: string;
  createdAt: string;
  consentAnalytics: boolean;
  /** Lifecycle: "open" until the learner finishes or starts over. */
  status: "open" | "abandoned";
  endedAt: string | null;
}

/** Latest-wins snapshot of a session's workspace content, for resume-after-restart. */
export interface SessionSnapshot {
  sessionId: string;
  kind: "files" | "workspace";
  payload: string;
  updatedAt: string;
}

export interface LearnerMeta {
  learnerId: string;
  token: string;
  createdAt: string;
  /** Display identity from the auth layer (e.g. "Eva") — for the operator
   *  surface; sanitized+capped at the API boundary, never trusted further. */
  name?: string | null;
  email?: string | null;
  consents: { selfAnalytics: boolean; cohortAggregate: boolean; research: boolean };
}

export interface TokenUsageRecord {
  learnerId: string;
  sessionId: string;
  /** Set when the spend belongs to a course-generation run (not a learner session). */
  runId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Provider-reported cache tokens, when present — never zero-filled. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** USD estimate at write time from the versioned pricing table; absent
   *  when the model has no pricing entry (never guessed). */
  estimatedCostUSD?: number;
  pricingVersion?: number;
  createdAt: string;
}

export interface StoredReflection {
  sessionId: string;
  learnerId: string;
  labId: string;
  reflection: Reflection;
  narrative: string;
  createdAt: string;
}

/** One lesson in a curated course — a scenario (lab) with optional course-specific framing. */
export interface CourseLesson {
  labId: string;
  /** Course-voice name for this step (falls back to the scenario's own title). */
  title?: string;
  note?: string;
  /** Progression level for this lesson (intro | beginner | intermediate |
   *  advanced | expert). A course spans levels; /home groups lessons by this. */
  level?: string;
}

/**
 * A curated course: an ordered path of scenarios. Courses are OPERATOR
 * content (admin-managed), not learner truth — progress is always derived
 * from the learner's own completion digests, never stored on the course.
 */
export interface Course {
  courseId: string;
  title: string;
  description: string;
  /** Who it's for — matches the marketplace role labels (e.g. "QA & Testing"). */
  audience: string;
  /** Level-ladder rung shown on /home: intro | beginner | intermediate | advanced | expert. */
  level: string;
  lessons: CourseLesson[];
  /**
   * Learner visibility. Absent = published (backward compatible: every course
   * that predates the field is live). A generated course sits in "draft" after
   * its publish gate until an operator flips it live (Go-live). Only published
   * courses appear on /api/courses; admin sees both.
   */
  status?: "draft" | "published";
  /** Provenance: the course-generation run that produced this course, if any. */
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventStore {
  // learners & consent (Phase 0)
  createLearner(meta: LearnerMeta): void;
  learnerMeta(learnerId: string): LearnerMeta | null;
  updateConsents(learnerId: string, consents: LearnerMeta["consents"]): void;
  listLearners(): string[];
  /** Erasure (ADR-0002): hard-delete learner + evidence + sessions + reflections; leave a tombstone. */
  eraseLearner(learnerId: string): void;
  isErased(learnerId: string): boolean;
  // evidence stream (Phase 1)
  appendEvidence(learnerId: string, event: EvidenceEvent): StoredEvidence;
  evidenceFor(learnerId: string): StoredEvidence[];
  // reflections (Phase 2) — regenerable userland artifacts
  saveReflection(r: StoredReflection): void;
  reflectionsFor(learnerId: string): StoredReflection[];
  // model token accounting (admin views); append-only like everything else
  recordTokenUsage(rec: TokenUsageRecord): void;
  tokenUsage(learnerId?: string): TokenUsageRecord[];
  // curated courses (operator content; admin CRUD)
  listCourses(): Course[];
  getCourse(courseId: string): Course | null;
  saveCourse(course: Course): void; // insert-or-replace by courseId
  deleteCourse(courseId: string): void;
  // runtime scenario catalog entries (written at course-materialization; the
  // served catalog is SCENARIO_SEED overlaid by these — see /api/scenarios)
  listScenarioEntries(): Scenario[];
  saveScenarioEntry(scenario: Scenario): void; // insert-or-replace by labId
  deleteScenarioEntry(labId: string): void;
  // course-generation runs (CourseRunStore contract; the scheduler drives these)
  createCourseRun(run: CourseRun): void;
  getCourseRun(runId: string): CourseRun | null;
  listCourseRuns(): CourseRun[];
  updateCourseRun(run: CourseRun): void;
  deleteCourseRun(runId: string): void;
  appendCourseRunEvent(event: CourseRunEvent): CourseRunEvent;
  courseRunEvents(runId: string): CourseRunEvent[];
  requestCourseRunGate(runId: string, gateId: GateId, requestedAt: string): void;
  decideCourseRunGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    decidedBy: string | null,
    notes: GateNote[] | null,
    decidedAt: string,
  ): void;
  courseRunGates(runId: string): CourseRunGate[];
  sessionsForLearner(learnerId: string): string[];
  /** Every stored session (admin history view); newest last. */
  listSessions(): SessionMeta[];
  createSession(meta: SessionMeta): void;
  appendEvent(sessionId: string, event: SessionEvent): void;
  eventsFor(sessionId: string): SessionEvent[];
  sessionMeta(sessionId: string): SessionMeta | null;
  setSessionStatus(sessionId: string, status: "open" | "abandoned", endedAt: string | null): void;
  /** Newest still-open session for a learner+lab, or null. */
  latestOpenSession(learnerId: string, labId: string): SessionMeta | null;
  // session snapshots (resume-after-restart) — latest-wins per (session, kind)
  saveSnapshot(s: SessionSnapshot): void;
  snapshotFor(sessionId: string, kind: "files" | "workspace"): SessionSnapshot | null;
  deleteSession(sessionId: string): void;
  close(): void;
}

/* ── course-run row (de)serialization ── */

interface CourseRunRow {
  run_id: string;
  status: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

/** The JSON blob half of a course-run row (everything not in a column). */
function courseRunPayload(run: CourseRun): Record<string, unknown> {
  return {
    request: run.request,
    pendingPhase: run.pendingPhase,
    pendingChangeNotes: run.pendingChangeNotes ?? null,
    lastError: run.lastError ?? null,
  };
}

function rowToCourseRun(row: CourseRunRow): CourseRun {
  const p = JSON.parse(row.payload) as Partial<CourseRun>;
  return {
    runId: row.run_id,
    status: row.status as CourseRun["status"],
    request: p.request ?? ({ technology: "" } as CourseRun["request"]),
    pendingPhase: p.pendingPhase ?? null,
    pendingChangeNotes: p.pendingChangeNotes ?? null,
    lastError: p.lastError ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteStore implements EventStore {
  private db: DatabaseSync;
  private insertEvent;
  private selectEvents;
  private insertSession;
  private selectSession;
  private deleteEvents;
  private deleteSessionRow;
  private deleteSnapshots;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        lab_id     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consent_analytics INTEGER NOT NULL DEFAULT 0,
        status     TEXT NOT NULL DEFAULT 'open',
        ended_at   TEXT
      );
      CREATE TABLE IF NOT EXISTS session_snapshots (
        session_id TEXT NOT NULL,
        kind       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, kind)
      );
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, id);
      CREATE TABLE IF NOT EXISTS learners (
        learner_id TEXT PRIMARY KEY,
        token      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        name       TEXT,
        email      TEXT,
        consent_self INTEGER NOT NULL DEFAULT 1,
        consent_cohort INTEGER NOT NULL DEFAULT 0,
        consent_research INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tombstones (
        learner_id TEXT PRIMARY KEY,
        erased_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_events (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        learner_id TEXT NOT NULL,
        type       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_learner ON evidence_events(learner_id, seq);
      CREATE TABLE IF NOT EXISTS token_usage (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        learner_id        TEXT NOT NULL,
        session_id        TEXT NOT NULL,
        model             TEXT NOT NULL,
        prompt_tokens     INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cache_read_tokens  INTEGER,
        cache_write_tokens INTEGER,
        estimated_cost_usd REAL,
        pricing_version    INTEGER,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_learner ON token_usage(learner_id, id);
      CREATE TABLE IF NOT EXISTS reflections (
        session_id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        lab_id     TEXT NOT NULL,
        reflection TEXT NOT NULL,
        narrative  TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS courses (
        course_id  TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenarios (
        lab_id     TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS course_runs (
        run_id     TEXT PRIMARY KEY,
        status     TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS course_run_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id  TEXT NOT NULL,
        at      TEXT NOT NULL,
        type    TEXT NOT NULL,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_events ON course_run_events(run_id, id);
      CREATE TABLE IF NOT EXISTS course_run_gates (
        run_id       TEXT NOT NULL,
        gate_id      TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at   TEXT,
        decision     TEXT,
        decided_by   TEXT,
        notes        TEXT,
        PRIMARY KEY (run_id, gate_id, requested_at)
      );
    `);
    // Older DBs predate the identity/cost columns; ALTERs are idempotent-by-
    // failure (SQLite has no IF NOT EXISTS for columns). Fresh DBs get them
    // from CREATE TABLE above.
    for (const alter of [
      "ALTER TABLE learners ADD COLUMN name TEXT",
      "ALTER TABLE learners ADD COLUMN email TEXT",
      "ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER",
      "ALTER TABLE token_usage ADD COLUMN cache_write_tokens INTEGER",
      "ALTER TABLE token_usage ADD COLUMN estimated_cost_usd REAL",
      "ALTER TABLE token_usage ADD COLUMN pricing_version INTEGER",
      "ALTER TABLE token_usage ADD COLUMN run_id TEXT",
      "ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
      "ALTER TABLE sessions ADD COLUMN ended_at TEXT",
    ]) {
      try {
        this.db.exec(alter);
      } catch {
        /* column already exists */
      }
    }
    this.insertEvent = this.db.prepare("INSERT INTO events (session_id, type, timestamp, payload) VALUES (?, ?, ?, ?)");
    this.selectEvents = this.db.prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY id ASC");
    this.insertSession = this.db.prepare(
      "INSERT INTO sessions (session_id, learner_id, lab_id, created_at, consent_analytics, status, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.selectSession = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?");
    this.deleteEvents = this.db.prepare("DELETE FROM events WHERE session_id = ?");
    this.deleteSessionRow = this.db.prepare("DELETE FROM sessions WHERE session_id = ?");
    this.deleteSnapshots = this.db.prepare("DELETE FROM session_snapshots WHERE session_id = ?");
  }

  createSession(meta: SessionMeta): void {
    this.insertSession.run(
      meta.sessionId,
      meta.learnerId,
      meta.labId,
      meta.createdAt,
      meta.consentAnalytics ? 1 : 0,
      meta.status,
      meta.endedAt,
    );
  }

  appendEvent(sessionId: string, event: SessionEvent): void {
    const stamped = stampVersion(event);
    this.insertEvent.run(sessionId, stamped.type, stamped.timestamp, JSON.stringify(stamped));
  }

  eventsFor(sessionId: string): SessionEvent[] {
    // Old shapes replay correctly forever: reads pass through the upcaster.
    return (this.selectEvents.all(sessionId) as Array<{ payload: string }>).map((r) => upcastEvent(JSON.parse(r.payload)));
  }

  sessionMeta(sessionId: string): SessionMeta | null {
    const row = this.selectSession.get(sessionId) as
      | { session_id: string; learner_id: string; lab_id: string; created_at: string; consent_analytics: number; status: string; ended_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      learnerId: row.learner_id,
      labId: row.lab_id,
      createdAt: row.created_at,
      consentAnalytics: row.consent_analytics === 1,
      status: row.status === "abandoned" ? "abandoned" : "open",
      endedAt: row.ended_at,
    };
  }

  setSessionStatus(sessionId: string, status: "open" | "abandoned", endedAt: string | null): void {
    this.db.prepare("UPDATE sessions SET status = ?, ended_at = ? WHERE session_id = ?").run(status, endedAt, sessionId);
  }

  latestOpenSession(learnerId: string, labId: string): SessionMeta | null {
    const row = this.db
      .prepare(
        "SELECT * FROM sessions WHERE learner_id = ? AND lab_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      )
      .get(learnerId, labId) as
      | { session_id: string; learner_id: string; lab_id: string; created_at: string; consent_analytics: number; status: string; ended_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      learnerId: row.learner_id,
      labId: row.lab_id,
      createdAt: row.created_at,
      consentAnalytics: row.consent_analytics === 1,
      status: "open",
      endedAt: row.ended_at,
    };
  }

  // ── session snapshots ──
  saveSnapshot(s: SessionSnapshot): void {
    this.db
      .prepare("INSERT OR REPLACE INTO session_snapshots (session_id, kind, payload, updated_at) VALUES (?, ?, ?, ?)")
      .run(s.sessionId, s.kind, s.payload, s.updatedAt);
  }

  snapshotFor(sessionId: string, kind: "files" | "workspace"): SessionSnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM session_snapshots WHERE session_id = ? AND kind = ?")
      .get(sessionId, kind) as { session_id: string; kind: string; payload: string; updated_at: string } | undefined;
    if (!row) return null;
    return { sessionId: row.session_id, kind: row.kind as SessionSnapshot["kind"], payload: row.payload, updatedAt: row.updated_at };
  }


  // ── learners / consent / erasure ──
  createLearner(meta: LearnerMeta): void {
    this.db
      .prepare(
        "INSERT INTO learners (learner_id, token, created_at, name, email, consent_self, consent_cohort, consent_research) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        meta.learnerId,
        meta.token,
        meta.createdAt,
        meta.name ?? null,
        meta.email ?? null,
        meta.consents.selfAnalytics ? 1 : 0,
        meta.consents.cohortAggregate ? 1 : 0,
        meta.consents.research ? 1 : 0,
      );
  }

  learnerMeta(learnerId: string): LearnerMeta | null {
    const row = this.db.prepare("SELECT * FROM learners WHERE learner_id = ?").get(learnerId) as
      | { learner_id: string; token: string; created_at: string; name: string | null; email: string | null; consent_self: number; consent_cohort: number; consent_research: number }
      | undefined;
    if (!row) return null;
    return {
      learnerId: row.learner_id,
      token: row.token,
      createdAt: row.created_at,
      name: row.name,
      email: row.email,
      consents: { selfAnalytics: row.consent_self === 1, cohortAggregate: row.consent_cohort === 1, research: row.consent_research === 1 },
    };
  }

  updateConsents(learnerId: string, c: LearnerMeta["consents"]): void {
    this.db
      .prepare("UPDATE learners SET consent_self = ?, consent_cohort = ?, consent_research = ? WHERE learner_id = ?")
      .run(c.selfAnalytics ? 1 : 0, c.cohortAggregate ? 1 : 0, c.research ? 1 : 0, learnerId);
  }

  listLearners(): string[] {
    return (this.db.prepare("SELECT learner_id FROM learners").all() as Array<{ learner_id: string }>).map((r) => r.learner_id);
  }

  sessionsForLearner(learnerId: string): string[] {
    return (this.db.prepare("SELECT session_id FROM sessions WHERE learner_id = ?").all(learnerId) as Array<{ session_id: string }>).map((r) => r.session_id);
  }

  eraseLearner(learnerId: string): void {
    for (const sid of this.sessionsForLearner(learnerId)) this.deleteSession(sid);
    this.db.prepare("DELETE FROM evidence_events WHERE learner_id = ?").run(learnerId);
    this.db.prepare("DELETE FROM reflections WHERE learner_id = ?").run(learnerId);
    this.db.prepare("DELETE FROM token_usage WHERE learner_id = ?").run(learnerId);
    this.db.prepare("DELETE FROM learners WHERE learner_id = ?").run(learnerId);
    this.db.prepare("INSERT OR REPLACE INTO tombstones (learner_id, erased_at) VALUES (?, ?)").run(learnerId, new Date().toISOString());
  }

  isErased(learnerId: string): boolean {
    return this.db.prepare("SELECT 1 FROM tombstones WHERE learner_id = ?").get(learnerId) !== undefined;
  }

  // ── evidence stream ──
  appendEvidence(learnerId: string, event: EvidenceEvent): StoredEvidence {
    const res = this.db
      .prepare("INSERT INTO evidence_events (learner_id, type, timestamp, payload) VALUES (?, ?, ?, ?)")
      .run(learnerId, event.type, event.timestamp, JSON.stringify(event));
    return { ...event, seq: Number(res.lastInsertRowid) } as StoredEvidence;
  }

  evidenceFor(learnerId: string): StoredEvidence[] {
    return (
      this.db.prepare("SELECT seq, payload FROM evidence_events WHERE learner_id = ? ORDER BY seq ASC").all(learnerId) as Array<{ seq: number; payload: string }>
    ).map((r) => ({ ...JSON.parse(r.payload), seq: r.seq }));
  }

  // ── reflections ──
  saveReflection(r: StoredReflection): void {
    this.db
      .prepare("INSERT OR REPLACE INTO reflections (session_id, learner_id, lab_id, reflection, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.sessionId, r.learnerId, r.labId, JSON.stringify(r.reflection), r.narrative, r.createdAt);
  }

  reflectionsFor(learnerId: string): StoredReflection[] {
    return (
      this.db.prepare("SELECT * FROM reflections WHERE learner_id = ? ORDER BY created_at ASC").all(learnerId) as Array<{
        session_id: string; learner_id: string; lab_id: string; reflection: string; narrative: string; created_at: string;
      }>
    ).map((r) => ({ sessionId: r.session_id, learnerId: r.learner_id, labId: r.lab_id, reflection: JSON.parse(r.reflection), narrative: r.narrative, createdAt: r.created_at }));
  }

  // ── token usage ──
  recordTokenUsage(rec: TokenUsageRecord): void {
    this.db
      .prepare(
        "INSERT INTO token_usage (learner_id, session_id, run_id, model, prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, pricing_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        rec.learnerId,
        rec.sessionId,
        rec.runId ?? null,
        rec.model,
        rec.promptTokens,
        rec.completionTokens,
        rec.cacheReadTokens ?? null,
        rec.cacheWriteTokens ?? null,
        rec.estimatedCostUSD ?? null,
        rec.pricingVersion ?? null,
        rec.createdAt,
      );
  }

  tokenUsage(learnerId?: string): TokenUsageRecord[] {
    const rows = (
      learnerId
        ? this.db.prepare("SELECT * FROM token_usage WHERE learner_id = ? ORDER BY id ASC").all(learnerId)
        : this.db.prepare("SELECT * FROM token_usage ORDER BY id ASC").all()
    ) as Array<{
      learner_id: string; session_id: string; run_id: string | null; model: string; prompt_tokens: number; completion_tokens: number;
      cache_read_tokens: number | null; cache_write_tokens: number | null; estimated_cost_usd: number | null; pricing_version: number | null; created_at: string;
    }>;
    return rows.map((r) => ({
      learnerId: r.learner_id,
      sessionId: r.session_id,
      ...(r.run_id !== null ? { runId: r.run_id } : {}),
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      ...(r.cache_read_tokens !== null ? { cacheReadTokens: r.cache_read_tokens } : {}),
      ...(r.cache_write_tokens !== null ? { cacheWriteTokens: r.cache_write_tokens } : {}),
      ...(r.estimated_cost_usd !== null ? { estimatedCostUSD: r.estimated_cost_usd } : {}),
      ...(r.pricing_version !== null ? { pricingVersion: r.pricing_version } : {}),
      createdAt: r.created_at,
    }));
  }

  // ── courses ──
  listCourses(): Course[] {
    return (this.db.prepare("SELECT payload FROM courses ORDER BY created_at ASC").all() as Array<{ payload: string }>).map(
      (r) => JSON.parse(r.payload) as Course,
    );
  }

  getCourse(courseId: string): Course | null {
    const row = this.db.prepare("SELECT payload FROM courses WHERE course_id = ?").get(courseId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Course) : null;
  }

  saveCourse(course: Course): void {
    this.db
      .prepare("INSERT OR REPLACE INTO courses (course_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(course.courseId, JSON.stringify(course), course.createdAt, course.updatedAt);
  }

  deleteCourse(courseId: string): void {
    this.db.prepare("DELETE FROM courses WHERE course_id = ?").run(courseId);
  }

  // ── runtime scenario entries ──
  listScenarioEntries(): Scenario[] {
    return (this.db.prepare("SELECT payload FROM scenarios ORDER BY created_at ASC").all() as Array<{ payload: string }>).map(
      (r) => JSON.parse(r.payload) as Scenario,
    );
  }

  saveScenarioEntry(scenario: Scenario): void {
    const at = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO scenarios (lab_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(lab_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .run(scenario.labId, JSON.stringify(scenario), at, at);
  }

  deleteScenarioEntry(labId: string): void {
    this.db.prepare("DELETE FROM scenarios WHERE lab_id = ?").run(labId);
  }

  // ── course-generation runs ──
  createCourseRun(run: CourseRun): void {
    this.db
      .prepare("INSERT INTO course_runs (run_id, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(run.runId, run.status, JSON.stringify(courseRunPayload(run)), run.createdAt, run.updatedAt);
  }

  getCourseRun(runId: string): CourseRun | null {
    const row = this.db.prepare("SELECT * FROM course_runs WHERE run_id = ?").get(runId) as CourseRunRow | undefined;
    return row ? rowToCourseRun(row) : null;
  }

  listCourseRuns(): CourseRun[] {
    return (this.db.prepare("SELECT * FROM course_runs ORDER BY created_at ASC").all() as CourseRunRow[]).map(rowToCourseRun);
  }

  updateCourseRun(run: CourseRun): void {
    this.db
      .prepare("UPDATE course_runs SET status = ?, payload = ?, updated_at = ? WHERE run_id = ?")
      .run(run.status, JSON.stringify(courseRunPayload(run)), run.updatedAt, run.runId);
  }

  deleteCourseRun(runId: string): void {
    this.db.prepare("DELETE FROM course_runs WHERE run_id = ?").run(runId);
    this.db.prepare("DELETE FROM course_run_events WHERE run_id = ?").run(runId);
    this.db.prepare("DELETE FROM course_run_gates WHERE run_id = ?").run(runId);
  }

  appendCourseRunEvent(event: CourseRunEvent): CourseRunEvent {
    const res = this.db
      .prepare("INSERT INTO course_run_events (run_id, at, type, payload) VALUES (?, ?, ?, ?)")
      .run(event.runId, event.at, event.type, event.payload ? JSON.stringify(event.payload) : null);
    return { ...event, id: Number(res.lastInsertRowid) };
  }

  courseRunEvents(runId: string): CourseRunEvent[] {
    return (
      this.db.prepare("SELECT * FROM course_run_events WHERE run_id = ? ORDER BY id ASC").all(runId) as Array<{
        id: number; run_id: string; at: string; type: string; payload: string | null;
      }>
    ).map((r) => ({ id: r.id, runId: r.run_id, at: r.at, type: r.type, ...(r.payload ? { payload: JSON.parse(r.payload) } : {}) }));
  }

  requestCourseRunGate(runId: string, gateId: GateId, requestedAt: string): void {
    this.db
      .prepare("INSERT INTO course_run_gates (run_id, gate_id, requested_at) VALUES (?, ?, ?)")
      .run(runId, gateId, requestedAt);
  }

  decideCourseRunGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    decidedBy: string | null,
    notes: GateNote[] | null,
    decidedAt: string,
  ): void {
    // Decide the single still-open row for this gate (a gate can be re-requested
    // across a changes loop; only the latest is pending).
    this.db
      .prepare(
        "UPDATE course_run_gates SET decision = ?, decided_by = ?, notes = ?, decided_at = ? " +
          "WHERE run_id = ? AND gate_id = ? AND decided_at IS NULL",
      )
      .run(decision, decidedBy, notes ? JSON.stringify(notes) : null, decidedAt, runId, gateId);
  }

  courseRunGates(runId: string): CourseRunGate[] {
    return (
      this.db.prepare("SELECT * FROM course_run_gates WHERE run_id = ? ORDER BY requested_at ASC").all(runId) as Array<{
        run_id: string; gate_id: string; requested_at: string; decided_at: string | null; decision: string | null; decided_by: string | null; notes: string | null;
      }>
    ).map((r) => ({
      runId: r.run_id,
      gateId: r.gate_id as GateId,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      decision: (r.decision as GateDecision | null) ?? null,
      decidedBy: r.decided_by,
      notes: r.notes ? (JSON.parse(r.notes) as GateNote[]) : null,
    }));
  }

  listSessions(): SessionMeta[] {
    return (
      this.db.prepare("SELECT * FROM sessions ORDER BY created_at ASC").all() as Array<{
        session_id: string; learner_id: string; lab_id: string; created_at: string; consent_analytics: number; status: string; ended_at: string | null;
      }>
    ).map((r) => ({
      sessionId: r.session_id,
      learnerId: r.learner_id,
      labId: r.lab_id,
      createdAt: r.created_at,
      consentAnalytics: r.consent_analytics === 1,
      status: r.status === "abandoned" ? ("abandoned" as const) : ("open" as const),
      endedAt: r.ended_at,
    }));
  }

  /** Session deletion is the ONE deliberate exception to append-only: a learner discarding their sandbox discards its history. */
  deleteSession(sessionId: string): void {
    this.deleteEvents.run(sessionId);
    this.deleteSnapshots.run(sessionId);
    this.deleteSessionRow.run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}

class MemoryStore implements EventStore {
  private sessions = new Map<string, SessionMeta>();
  private events = new Map<string, SessionEvent[]>();
  /** Keyed `${sessionId}|${kind}` — latest-wins, like the SQLite primary key. */
  private snapshots = new Map<string, SessionSnapshot>();
  private learners = new Map<string, LearnerMeta>();
  private tombstones = new Set<string>();
  private evidence = new Map<string, StoredEvidence[]>();
  private evidenceSeq = 0;
  private reflections = new Map<string, StoredReflection>();
  private usage: TokenUsageRecord[] = [];
  private courses = new Map<string, Course>();
  private scenarioEntries = new Map<string, Scenario>();
  private courseRuns = new Map<string, CourseRun>();
  private courseRunEventLog = new Map<string, CourseRunEvent[]>();
  private courseRunGateRows = new Map<string, CourseRunGate[]>();
  private courseRunEventSeq = 0;

  createLearner(meta: LearnerMeta): void { this.learners.set(meta.learnerId, meta); }
  learnerMeta(id: string): LearnerMeta | null { return this.learners.get(id) ?? null; }
  updateConsents(id: string, c: LearnerMeta["consents"]): void {
    const m = this.learners.get(id);
    if (m) m.consents = c;
  }
  listLearners(): string[] { return [...this.learners.keys()]; }
  sessionsForLearner(id: string): string[] {
    return [...this.sessions.values()].filter((s) => s.learnerId === id).map((s) => s.sessionId);
  }
  eraseLearner(id: string): void {
    for (const sid of this.sessionsForLearner(id)) this.deleteSession(sid);
    this.evidence.delete(id);
    for (const [k, r] of this.reflections) if (r.learnerId === id) this.reflections.delete(k);
    this.usage = this.usage.filter((u) => u.learnerId !== id);
    this.learners.delete(id);
    this.tombstones.add(id);
  }
  isErased(id: string): boolean { return this.tombstones.has(id); }
  appendEvidence(id: string, event: EvidenceEvent): StoredEvidence {
    const stored = { ...event, seq: ++this.evidenceSeq } as StoredEvidence;
    this.evidence.set(id, [...(this.evidence.get(id) ?? []), stored]);
    return stored;
  }
  evidenceFor(id: string): StoredEvidence[] { return [...(this.evidence.get(id) ?? [])]; }
  saveReflection(r: StoredReflection): void { this.reflections.set(r.sessionId, r); }
  reflectionsFor(id: string): StoredReflection[] {
    return [...this.reflections.values()].filter((r) => r.learnerId === id);
  }
  recordTokenUsage(rec: TokenUsageRecord): void { this.usage.push(rec); }
  tokenUsage(learnerId?: string): TokenUsageRecord[] {
    return learnerId ? this.usage.filter((u) => u.learnerId === learnerId) : [...this.usage];
  }
  listCourses(): Course[] {
    return [...this.courses.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  getCourse(id: string): Course | null { return this.courses.get(id) ?? null; }
  saveCourse(course: Course): void { this.courses.set(course.courseId, course); }
  deleteCourse(id: string): void { this.courses.delete(id); }
  listScenarioEntries(): Scenario[] { return [...this.scenarioEntries.values()]; }
  saveScenarioEntry(s: Scenario): void { this.scenarioEntries.set(s.labId, s); }
  deleteScenarioEntry(labId: string): void { this.scenarioEntries.delete(labId); }

  createCourseRun(run: CourseRun): void { this.courseRuns.set(run.runId, structuredClone(run)); }
  getCourseRun(runId: string): CourseRun | null {
    const r = this.courseRuns.get(runId);
    return r ? structuredClone(r) : null;
  }
  listCourseRuns(): CourseRun[] {
    return [...this.courseRuns.values()].map((r) => structuredClone(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  updateCourseRun(run: CourseRun): void {
    if (this.courseRuns.has(run.runId)) this.courseRuns.set(run.runId, structuredClone(run));
  }
  deleteCourseRun(runId: string): void {
    this.courseRuns.delete(runId);
    this.courseRunEventLog.delete(runId);
    this.courseRunGateRows.delete(runId);
  }
  appendCourseRunEvent(event: CourseRunEvent): CourseRunEvent {
    const stored = { ...event, id: ++this.courseRunEventSeq };
    this.courseRunEventLog.set(event.runId, [...(this.courseRunEventLog.get(event.runId) ?? []), stored]);
    return stored;
  }
  courseRunEvents(runId: string): CourseRunEvent[] {
    return [...(this.courseRunEventLog.get(runId) ?? [])];
  }
  requestCourseRunGate(runId: string, gateId: GateId, requestedAt: string): void {
    const rows = this.courseRunGateRows.get(runId) ?? [];
    rows.push({ runId, gateId, requestedAt, decidedAt: null, decision: null, decidedBy: null, notes: null });
    this.courseRunGateRows.set(runId, rows);
  }
  decideCourseRunGate(
    runId: string,
    gateId: GateId,
    decision: GateDecision,
    decidedBy: string | null,
    notes: GateNote[] | null,
    decidedAt: string,
  ): void {
    const row = (this.courseRunGateRows.get(runId) ?? []).find((g) => g.gateId === gateId && g.decidedAt === null);
    if (row) {
      row.decision = decision;
      row.decidedBy = decidedBy;
      row.notes = notes;
      row.decidedAt = decidedAt;
    }
  }
  courseRunGates(runId: string): CourseRunGate[] {
    return (this.courseRunGateRows.get(runId) ?? []).map((g) => structuredClone(g));
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createSession(meta: SessionMeta): void {
    this.sessions.set(meta.sessionId, meta);
    this.events.set(meta.sessionId, []);
  }
  appendEvent(sessionId: string, event: SessionEvent): void {
    this.events.get(sessionId)?.push(stampVersion(event));
  }
  eventsFor(sessionId: string): SessionEvent[] {
    return (this.events.get(sessionId) ?? []).map((e) => upcastEvent(e as SessionEvent & { type: string }));
  }
  sessionMeta(sessionId: string): SessionMeta | null {
    return this.sessions.get(sessionId) ?? null;
  }
  setSessionStatus(sessionId: string, status: "open" | "abandoned", endedAt: string | null): void {
    const m = this.sessions.get(sessionId);
    if (m) {
      m.status = status;
      m.endedAt = endedAt;
    }
  }
  latestOpenSession(learnerId: string, labId: string): SessionMeta | null {
    let latest: SessionMeta | null = null;
    for (const s of this.sessions.values()) {
      if (s.learnerId !== learnerId || s.labId !== labId || s.status !== "open") continue;
      if (!latest || s.createdAt.localeCompare(latest.createdAt) > 0) latest = s;
    }
    return latest;
  }
  saveSnapshot(s: SessionSnapshot): void { this.snapshots.set(`${s.sessionId}|${s.kind}`, s); }
  snapshotFor(sessionId: string, kind: "files" | "workspace"): SessionSnapshot | null {
    return this.snapshots.get(`${sessionId}|${kind}`) ?? null;
  }
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.events.delete(sessionId);
    for (const kind of ["files", "workspace"] as const) this.snapshots.delete(`${sessionId}|${kind}`);
  }
  close(): void {}
}

export function createStore(env = process.env): EventStore {
  if ((env.TRELLIS_PERSISTENCE ?? "on").toLowerCase() === "off") return new MemoryStore();
  return new SqliteStore(env.TRELLIS_DB_PATH ?? "./data/trellis.db");
}
