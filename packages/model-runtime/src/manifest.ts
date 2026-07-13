/**
 * Run manifests + evidence references (ADR-0006 D38).
 *
 * The manifest is the committed, auditable spine of a run. Raw evidence
 * (traces, screenshots, transcripts, webm) is NOT committed — it lives in a
 * git-ignored artifacts directory locally, or object storage in CI — and the
 * manifest keeps a hash-anchored reference to every item, so losing a bundle
 * degrades an audit but never orphans one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelInvocationRecord, ModelRole } from "./invocation.ts";

export type RedactionStatus = "none" | "sanitized" | "redacted";

export type RetentionStatus =
  | "committed" // in git (reports, fixtures)
  | "local" // git-ignored artifacts dir on the machine that ran it
  | "ci-artifact" // uploaded immutable CI artifact
  | "object-storage" // uploaded object with a retention policy
  | "expired"; // known to have aged out — reference remains auditable

export interface EvidenceRef {
  /** What kind of evidence: "event-log" | "trace" | "screenshot" | "webm" | … */
  kind: string;
  /** Logical path (repo-relative or artifacts-relative) or remote artifact URI. */
  logicalPath: string;
  /** sha256 of the exact bytes referenced; omitted only when unhashable (e.g. remote-only). */
  sha256?: string;
  schemaVersion?: string;
  redaction: RedactionStatus;
  retention: RetentionStatus;
  /** Remote URI once uploaded (CI artifact / object storage). */
  uri?: string;
  bytes?: number;
}

export interface RoleModelSelection {
  provider: string;
  model: string;
  sampling?: Record<string, unknown>;
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  productCommit?: string;
  configHash?: string;
  scenarioId?: string;
  scenarioVersion?: string;
  personaVersion?: string;
  /** promptId → "version@sha256-prefix" for every prompt the run used. */
  promptVersions?: Record<string, string>;
  models?: Partial<Record<ModelRole, RoleModelSelection>>;
  toolVersion?: string;
  evaluatorVersion?: string;
  experimentId?: string;
  variant?: string;
  runNumber?: number;
  seed?: number | string;
  evidence: EvidenceRef[];
}

/**
 * Filesystem layout under a root (git-ignored `artifacts/` by default):
 *   <root>/runs/<runId>/manifest.json      — immutable, write-once
 *   <root>/runs/<runId>/invocations.jsonl  — append-only invocation stream
 */
export class RunArtifactWriter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  runDir(runId: string): string {
    return join(this.rootDir, "runs", runId);
  }

  manifestPath(runId: string): string {
    return join(this.runDir(runId), "manifest.json");
  }

  invocationsPath(runId: string): string {
    return join(this.runDir(runId), "invocations.jsonl");
  }

  /** Write-once: a second write for the same runId throws (immutability, D38). */
  writeManifest(manifest: RunManifest): string {
    const path = this.manifestPath(manifest.runId);
    if (existsSync(path)) {
      throw new Error(`run manifest already exists (immutable): ${path}`);
    }
    mkdirSync(this.runDir(manifest.runId), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    return path;
  }

  readManifest(runId: string): RunManifest {
    return JSON.parse(readFileSync(this.manifestPath(runId), "utf8")) as RunManifest;
  }

  appendInvocation(record: ModelInvocationRecord): string {
    const path = this.invocationsPath(record.runId);
    mkdirSync(this.runDir(record.runId), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + "\n");
    return path;
  }

  readInvocations(runId: string): ModelInvocationRecord[] {
    const path = this.invocationsPath(runId);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as ModelInvocationRecord);
  }
}
