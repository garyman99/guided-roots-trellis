/**
 * LabDriver — the boundary between the platform and disposable lab
 * environments. Two implementations:
 *
 *   LocalProcessDriver  — dev/POC. Real shell + real git in a temp dir.
 *                         NOT a security boundary (documented in-file).
 *   DockerDriver        — one container per session with resource limits,
 *                         no network, non-root. The real isolation story.
 *
 * The platform only ever talks to a LabHandle; nothing above this interface
 * knows which driver is in use.
 */

export interface TerminalAttachment {
  write(data: string): void;
  onData(cb: (chunk: Buffer) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LabHandle {
  readonly id: string;
  readonly labId: string;
  /** Attach the (single) interactive learner terminal. */
  attachTerminal(): TerminalAttachment;
  /**
   * Side-channel command execution inside the lab environment (evaluator,
   * git snapshots). Runs in the workspace; never touches the learner's tty.
   */
  exec(command: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult>;
  /** Read a small file from inside the lab environment (instrumentation channels). */
  readFile(path: string): Promise<string | null>;
  /** Path (inside the environment) of the command-event channel file. */
  readonly eventsFilePath: string;
  /** Path (inside the environment) of the test-results channel file. */
  readonly resultsFilePath: string;
  /** Return the workspace to its initial lab state (fresh repo + AI change). */
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

export interface LabDefinition {
  /** Absolute path to the lab folder (template/, scripts/, verify/, lab.json). */
  labDir: string;
  labId: string;
  /** Adaptive labs: the resolved variant. Absent → the lab's default variant. */
  variant?: { defect: string };
}

export interface LabDriver {
  create(def: LabDefinition, sessionId: string): Promise<LabHandle>;
}
