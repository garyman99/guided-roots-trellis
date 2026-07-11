import { randomBytes, randomUUID } from "node:crypto";

/** Anonymous learner/session IDs — no accounts, no PII in the POC. */
export const newSessionId = (): string => randomUUID();
export const newLearnerId = (): string => "learner-" + randomBytes(6).toString("hex");
/** Bearer token gating WebSocket/HTTP access to a session (see ADR: WS auth). */
export const newSessionToken = (): string => randomBytes(24).toString("base64url");
