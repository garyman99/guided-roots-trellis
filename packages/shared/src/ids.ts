import { randomBytes, randomUUID } from "node:crypto";

/** Anonymous learner/session IDs — no accounts, no PII in the POC. */
export const newSessionId = (): string => randomUUID();
export const newLearnerId = (): string => "learner-" + randomBytes(6).toString("hex");
/** Bearer token gating WebSocket/HTTP access to a session (see ADR: WS auth). */
export const newSessionToken = (): string => randomBytes(24).toString("base64url");

/**
 * Lesson-version families. A revision of lesson `orient-101` ships as the NEW,
 * immutable lab `orient-101-v2`; the FAMILY is the version-less base id (v1
 * keeps the bare id). Blueprint validation reserves the `-v<N>` suffix (a newly
 * minted lesson id may not match it), so stripping is unambiguous.
 */
export const familyOf = (labId: string): string => labId.replace(/-v\d+$/, "");
/** 1 for the bare family id; N for `<family>-v<N>`. */
export const versionOf = (labId: string): number => {
  const m = labId.match(/-v(\d+)$/);
  return m ? Number(m[1]) : 1;
};
/** The labId a given version of a family ships under. */
export const versionedLabId = (family: string, version: number): string =>
  version <= 1 ? family : `${family}-v${version}`;
