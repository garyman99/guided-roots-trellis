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
 * AUTH (POC scope): every session-scoped route requires the session token
 * (Authorization: Bearer <token> or ?token=). Tokens are 192-bit random,
 * compared timing-safely, returned once at session creation, and never
 * stored server-side beyond the live session object. No accounts — learner
 * identity is an anonymous ID. TLS/origin checks are deployment concerns
 * documented in the ADR.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { acceptUpgrade } from "./miniWs.ts";
import { createStore, type LearnerMeta } from "./store.ts";
import { SessionManager, taskStatuses, type Session } from "./sessions.ts";
import { newLearnerId } from "../../../packages/shared/src/ids.ts";
import { recommendNext } from "../../../packages/learner-model/src/recommend.ts";
import { cohortAggregate, learnerSummary } from "../../../packages/learner-model/src/analytics.ts";
import type { SessionDigest } from "../../../packages/learner-model/src/evidence.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const store = createStore();
export const manager = new SessionManager(store, join(repoRoot, "labs"));

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
        const message = await session.ask(text, body.stuck === true, body.screen);
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
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[trellis-api] listening on http://127.0.0.1:${PORT} (driver=${manager.driverKind})`);
  });
}

async function shutdown(): Promise<void> {
  await manager.destroyAll();
  store.close();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
