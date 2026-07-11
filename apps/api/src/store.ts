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

export interface SessionMeta {
  sessionId: string;
  learnerId: string;
  labId: string;
  createdAt: string;
  consentAnalytics: boolean;
}

export interface LearnerMeta {
  learnerId: string;
  token: string;
  createdAt: string;
  consents: { selfAnalytics: boolean; cohortAggregate: boolean; research: boolean };
}

export interface StoredReflection {
  sessionId: string;
  learnerId: string;
  labId: string;
  reflection: Reflection;
  narrative: string;
  createdAt: string;
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
  sessionsForLearner(learnerId: string): string[];
  createSession(meta: SessionMeta): void;
  appendEvent(sessionId: string, event: SessionEvent): void;
  eventsFor(sessionId: string): SessionEvent[];
  sessionMeta(sessionId: string): SessionMeta | null;
  deleteSession(sessionId: string): void;
  close(): void;
}

class SqliteStore implements EventStore {
  private db: DatabaseSync;
  private insertEvent;
  private selectEvents;
  private insertSession;
  private selectSession;
  private deleteEvents;
  private deleteSessionRow;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        lab_id     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consent_analytics INTEGER NOT NULL DEFAULT 0
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
      CREATE TABLE IF NOT EXISTS reflections (
        session_id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        lab_id     TEXT NOT NULL,
        reflection TEXT NOT NULL,
        narrative  TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.insertEvent = this.db.prepare("INSERT INTO events (session_id, type, timestamp, payload) VALUES (?, ?, ?, ?)");
    this.selectEvents = this.db.prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY id ASC");
    this.insertSession = this.db.prepare(
      "INSERT INTO sessions (session_id, learner_id, lab_id, created_at, consent_analytics) VALUES (?, ?, ?, ?, ?)",
    );
    this.selectSession = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?");
    this.deleteEvents = this.db.prepare("DELETE FROM events WHERE session_id = ?");
    this.deleteSessionRow = this.db.prepare("DELETE FROM sessions WHERE session_id = ?");
  }

  createSession(meta: SessionMeta): void {
    this.insertSession.run(meta.sessionId, meta.learnerId, meta.labId, meta.createdAt, meta.consentAnalytics ? 1 : 0);
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
      | { session_id: string; learner_id: string; lab_id: string; created_at: string; consent_analytics: number }
      | undefined;
    if (!row) return null;
    return {
      sessionId: row.session_id,
      learnerId: row.learner_id,
      labId: row.lab_id,
      createdAt: row.created_at,
      consentAnalytics: row.consent_analytics === 1,
    };
  }


  // ── learners / consent / erasure ──
  createLearner(meta: LearnerMeta): void {
    this.db
      .prepare("INSERT INTO learners (learner_id, token, created_at, consent_self, consent_cohort, consent_research) VALUES (?, ?, ?, ?, ?, ?)")
      .run(meta.learnerId, meta.token, meta.createdAt, meta.consents.selfAnalytics ? 1 : 0, meta.consents.cohortAggregate ? 1 : 0, meta.consents.research ? 1 : 0);
  }

  learnerMeta(learnerId: string): LearnerMeta | null {
    const row = this.db.prepare("SELECT * FROM learners WHERE learner_id = ?").get(learnerId) as
      | { learner_id: string; token: string; created_at: string; consent_self: number; consent_cohort: number; consent_research: number }
      | undefined;
    if (!row) return null;
    return {
      learnerId: row.learner_id,
      token: row.token,
      createdAt: row.created_at,
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

  /** Session deletion is the ONE deliberate exception to append-only: a learner discarding their sandbox discards its history. */
  deleteSession(sessionId: string): void {
    this.deleteEvents.run(sessionId);
    this.deleteSessionRow.run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}

class MemoryStore implements EventStore {
  private sessions = new Map<string, SessionMeta>();
  private events = new Map<string, SessionEvent[]>();
  private learners = new Map<string, LearnerMeta>();
  private tombstones = new Set<string>();
  private evidence = new Map<string, StoredEvidence[]>();
  private evidenceSeq = 0;
  private reflections = new Map<string, StoredReflection>();

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
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.events.delete(sessionId);
  }
  close(): void {}
}

export function createStore(env = process.env): EventStore {
  if ((env.TRELLIS_PERSISTENCE ?? "on").toLowerCase() === "off") return new MemoryStore();
  return new SqliteStore(env.TRELLIS_DB_PATH ?? "./data/trellis.db");
}
