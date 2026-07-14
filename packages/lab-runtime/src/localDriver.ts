/**
 * LocalProcessDriver — runs the lab in a temp directory on the host with a
 * real interactive bash behind a pty (allocated by `script(1)`, so no native
 * node-pty dependency).
 *
 * ── SECURITY ─────────────────────────────────────────────────────────────
 * This driver is for local development and the offline POC ONLY. It is NOT
 * an isolation boundary: learner commands run as the API process's user.
 * Mitigations applied anyway (defense in depth):
 *   • The shell env is CONSTRUCTED, never inherited — host env vars and
 *     provider API keys are never visible inside the lab shell.
 *   • HOME is remapped into the workspace so host dotfiles stay invisible.
 * Real isolation = DockerDriver (dockerDriver.ts). Selected via LAB_DRIVER.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecResult, LabDefinition, LabDriver, LabHandle, TerminalAttachment } from "./driver.ts";

const INSTRUMENT_RC = join(dirname(fileURLToPath(import.meta.url)), "..", "instrument", "trellis-bashrc.sh");

function labEnv(workspace: string, channels: { events: string; results: string }): Record<string, string> {
  // SECURITY: allowlist construction — nothing from process.env leaks in
  // except PATH (needed to find node/git/npm).
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: workspace,
    TERM: "xterm-256color",
    LANG: process.env.LANG ?? "C.UTF-8",
    TRELLIS_WORKSPACE: workspace,
    TRELLIS_EVENTS_FILE: channels.events,
    TRELLIS_RESULTS_FILE: channels.results,
    GIT_CONFIG_NOSYSTEM: "1",
    npm_config_update_notifier: "false",
  };
}

async function run(cmd: string[], cwd: string, env: Record<string, string>, timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: String(err) });
    });
  });
}

class LocalLabHandle implements LabHandle {
  readonly eventsFilePath: string;
  readonly resultsFilePath: string;
  private terminal: ReturnType<typeof spawn> | null = null;
  private dataCbs: Array<(chunk: Buffer) => void> = [];
  private exitCbs: Array<(code: number | null) => void> = [];

  readonly id: string;
  readonly labId: string;
  readonly workspace: string;
  private readonly channelDir: string;
  private readonly def: LabDefinition;

  constructor(id: string, labId: string, workspace: string, channelDir: string, def: LabDefinition) {
    this.id = id;
    this.labId = labId;
    this.workspace = workspace;
    this.channelDir = channelDir;
    this.def = def;
    this.eventsFilePath = join(channelDir, "commands.log");
    this.resultsFilePath = join(channelDir, "test-results.json");
  }

  private env() {
    return labEnv(this.workspace, { events: this.eventsFilePath, results: this.resultsFilePath });
  }

  async initWorkspace(): Promise<void> {
    mkdirSync(this.workspace, { recursive: true });
    cpSync(join(this.def.labDir, "template"), this.workspace, { recursive: true });
    writeFileSync(this.eventsFilePath, "");
    const env = this.env();
    const git = (args: string[]) =>
      run(["git", "-c", "user.email=lab@trellis.local", "-c", "user.name=Trellis Lab", ...args], this.workspace, env);
    await git(["init", "-q", "-b", "main"]);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "Initial commit"]);
    // SIMULATED BEHAVIOR: apply the scripted "AI agent" change, uncommitted.
    const apply = join(this.def.labDir, "scripts", "apply-ai-change.mjs");
    if (existsSync(apply)) {
      const args = ["node", apply, this.workspace];
      if (this.def.variant?.defect) args.push(this.def.variant.defect); // adaptive labs: variant-selected defect
      const res = await run(args, this.workspace, env);
      if (res.exitCode !== 0) throw new Error(`apply-ai-change failed: ${res.stderr || res.stdout}`);
    }
  }

  attachTerminal(): TerminalAttachment {
    if (!this.terminal) {
      // `script -qfc` allocates a real pty around the instrumented bash.
      const cmd = `bash --rcfile ${INSTRUMENT_RC} -i`;
      this.terminal = spawn("script", ["-qfc", cmd, "/dev/null"], {
        cwd: this.workspace,
        env: this.env(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.terminal.stdout!.on("data", (d: Buffer) => this.dataCbs.forEach((cb) => cb(d)));
      this.terminal.stderr!.on("data", (d: Buffer) => this.dataCbs.forEach((cb) => cb(d)));
      this.terminal.on("close", (code) => {
        this.terminal = null;
        this.exitCbs.forEach((cb) => cb(code));
      });
      // A spawn failure (e.g. `script(1)` absent — Windows has no util-linux
      // shell) emits 'error'; without a listener Node throws it as an
      // UNHANDLED error and takes the whole API down. Surface it into the
      // terminal stream instead and end the attachment cleanly.
      this.terminal.on("error", (err: NodeJS.ErrnoException) => {
        this.terminal = null;
        const hint =
          err.code === "ENOENT"
            ? "the local driver needs a Unix shell with script(1); on Windows set LAB_DRIVER=docker"
            : String(err.message);
        const msg = `\r\n\x1b[31mTerminal unavailable: ${hint}\x1b[0m\r\n`;
        this.dataCbs.forEach((cb) => cb(Buffer.from(msg)));
        this.exitCbs.forEach((cb) => cb(1));
      });
    }
    const term = this.terminal;
    return {
      write: (data) => term.stdin!.write(data),
      onData: (cb) => this.dataCbs.push(cb),
      onExit: (cb) => this.exitCbs.push(cb),
      kill: () => term.kill("SIGKILL"),
    };
  }

  exec(command: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }) {
    return run(command, this.workspace, { ...this.env(), ...opts?.env }, opts?.timeoutMs);
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  async reset(): Promise<void> {
    this.terminal?.kill("SIGKILL");
    this.terminal = null;
    this.dataCbs = [];
    // RACE (observed under load): the just-killed shell's instrumentation
    // hooks — `git hash-object` file snapshots on each prompt — or dying npm
    // children can write into the tree while it's being recursively deleted,
    // which surfaces as ENOTEMPTY. SIGKILL doesn't wait for the process
    // group; deletion must win, so retry briefly until writers are gone.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(this.workspace, { recursive: true, force: true });
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if ((code === "ENOTEMPTY" || code === "EBUSY") && attempt < 20) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        throw err;
      }
    }
    writeFileSync(this.resultsFilePath, "", { flag: "w" });
    await this.initWorkspace();
  }

  async destroy(): Promise<void> {
    this.terminal?.kill("SIGKILL");
    rmSync(dirname(this.workspace), { recursive: true, force: true });
  }
}

export class LocalProcessDriver implements LabDriver {
  async create(def: LabDefinition, sessionId: string): Promise<LabHandle> {
    const root = mkdtempSync(join(tmpdir(), "trellis-lab-"));
    const workspace = join(root, "workspace");
    const channelDir = join(root, "channels");
    mkdirSync(channelDir, { recursive: true });
    const handle = new LocalLabHandle(sessionId, def.labId, workspace, channelDir, def);
    await handle.initWorkspace();
    return handle;
  }
}
