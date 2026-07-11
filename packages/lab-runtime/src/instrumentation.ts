/**
 * SessionInstrumentation — the deterministic observer.
 *
 * Sources (all measured, none inferred):
 *   • command channel file  → terminal.command.started / .completed
 *     (written by the instrumented bashrc, base64-framed)
 *   • pty output buffer     → outputSummary (sanitized slice of output
 *     produced while the command ran — an approximation, documented)
 *   • git status snapshots  → file.changed (diffed after each command)
 *   • test-results file     → tests.completed (written by the lab's runner)
 *   • command text          → git.diff.viewed (documented heuristic)
 *
 * Untrusted data (command text, output) is sanitized and length-capped
 * before it enters an event.
 */
import { sanitizeUntrusted, summarizeOutput } from "../../shared/src/sanitize.ts";
import { isDiffViewingCommand, now, type SessionEvent } from "../../session-events/src/events.ts";
import type { LabHandle } from "./driver.ts";

const MAX_COMMAND_LEN = 500;
const OUTPUT_BUFFER_CAP = 64 * 1024;

export class SessionInstrumentation {
  private eventsOffset = 0;
  private outputBuffer = "";
  private lastGitSnapshot = new Map<string, string>(); // path -> status
  private lastResultsRaw = "";
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  private readonly handle: LabHandle;
  private readonly emit: (event: SessionEvent) => void;
  private readonly pollMs: number;

  constructor(handle: LabHandle, emit: (event: SessionEvent) => void, pollMs = 700) {
    this.handle = handle;
    this.emit = emit;
    this.pollMs = pollMs;
  }

  /** Feed raw pty output (already being streamed to the browser anyway). */
  onTerminalOutput(chunk: Buffer): void {
    this.outputBuffer += chunk.toString("utf8");
    if (this.outputBuffer.length > OUTPUT_BUFFER_CAP) {
      this.outputBuffer = this.outputBuffer.slice(-OUTPUT_BUFFER_CAP);
    }
  }

  async start(): Promise<void> {
    // Baseline BEFORE watching: the simulated AI change dirties the repo at
    // session start; those paths must not be attributed to the learner.
    await this.baselineFileSnapshot();
    this.timer = setInterval(() => void this.drain(), this.pollMs);
  }

  private async baselineFileSnapshot(): Promise<void> {
    const snap = await this.readFileSnapshot();
    if (snap) this.lastGitSnapshot = snap;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Reset offsets after a lab reset (channel files were truncated). */
  async onLabReset(): Promise<void> {
    this.eventsOffset = 0;
    this.outputBuffer = "";
    this.lastResultsRaw = "";
    await this.baselineFileSnapshot();
  }

  /** One drain cycle; exposed for deterministic tests. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const sawCommand = await this.drainCommandChannel();
      await this.drainResultsChannel();
      if (sawCommand) await this.snapshotFileChanges();
    } finally {
      this.draining = false;
    }
  }

  private async drainCommandChannel(): Promise<boolean> {
    const raw = await this.handle.readFile(this.handle.eventsFilePath);
    if (raw === null || raw.length <= this.eventsOffset) return false;
    const fresh = raw.slice(this.eventsOffset);
    this.eventsOffset = raw.length;

    let saw = false;
    for (const line of fresh.split("\n")) {
      if (!line.trim()) continue;
      const [kind, b64, exitStr, startMs, endMs] = line.split("\t");
      if (kind !== "cmd" || !b64) continue; // unknown/corrupt frames are dropped, never guessed at
      let command: string;
      try {
        command = sanitizeUntrusted(Buffer.from(b64, "base64").toString("utf8"), MAX_COMMAND_LEN);
      } catch {
        continue;
      }
      const exitCode = Number.parseInt(exitStr, 10);
      const startedAt = Number.isFinite(+startMs) ? new Date(+startMs).toISOString() : now();
      const completedAt = Number.isFinite(+endMs) ? new Date(+endMs).toISOString() : now();
      saw = true;

      this.emit({ type: "terminal.command.started", command, timestamp: startedAt });
      // APPROXIMATION (documented): the summary is the tail of pty output
      // accumulated since the previous drain — close enough for hints,
      // never used for checkpoint decisions.
      const outputSummary = summarizeOutput(this.outputBuffer);
      this.outputBuffer = "";
      this.emit({
        type: "terminal.command.completed",
        command,
        exitCode: Number.isFinite(exitCode) ? exitCode : 1,
        outputSummary,
        timestamp: completedAt,
      });
      if (isDiffViewingCommand(command)) {
        this.emit({ type: "git.diff.viewed", command, timestamp: completedAt });
      }
    }
    return saw;
  }

  /**
   * One exec, content-addressed: hash every modified/untracked file. Status
   * alone is not enough — a file already dirtied by the simulated AI change
   * keeps status " M" when the learner edits it again; its hash changes.
   */
  private static readonly SNAPSHOT_SCRIPT =
    `git ls-files -mo --exclude-standard | while IFS= read -r f; do ` +
    `if [ -f "$f" ]; then printf '%s\\t%s\\n' "$(git hash-object "$f")" "$f"; ` +
    `else printf 'deleted\\t%s\\n' "$f"; fi; done`;

  private async readFileSnapshot(): Promise<Map<string, string> | null> {
    const res = await this.handle.exec(["bash", "-c", SessionInstrumentation.SNAPSHOT_SCRIPT], { timeoutMs: 10_000 });
    if (res.exitCode !== 0) return null;
    const map = new Map<string, string>();
    for (const line of res.stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab <= 0) continue;
      map.set(line.slice(tab + 1).trim(), line.slice(0, tab));
    }
    return map;
  }

  private async snapshotFileChanges(): Promise<void> {
    const current = await this.readFileSnapshot();
    if (!current) return;
    for (const [path, hash] of current) {
      if (this.lastGitSnapshot.get(path) !== hash) {
        this.emit({ type: "file.changed", path: sanitizeUntrusted(path, 300), timestamp: now() });
      }
    }
    this.lastGitSnapshot = current;
  }

  private async drainResultsChannel(): Promise<void> {
    const raw = await this.handle.readFile(this.handle.resultsFilePath);
    if (!raw || raw === this.lastResultsRaw) return;
    this.lastResultsRaw = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.passed === "number" && typeof parsed.failed === "number") {
        this.emit({ type: "tests.completed", passed: parsed.passed, failed: parsed.failed, timestamp: now() });
      }
    } catch {
      // partial write; next drain will pick it up
    }
  }
}
