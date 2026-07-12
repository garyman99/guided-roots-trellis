/**
 * DockerDriver — one disposable container per learner session.
 *
 * ⚠ UNVERIFIED IN BUILD SANDBOX: this driver was written and reviewed but
 * could not be executed where the POC was built (no Docker daemon). The
 * LocalProcessDriver exercises the identical LabHandle contract and is
 * covered by tests. Treat this file as "ready for first run", not "proven".
 *
 * ── SECURITY DESIGN ──────────────────────────────────────────────────────
 *   • Non-root: container runs as the image's `node` user (see lab Dockerfile).
 *   • No network: --network none (the lab needs none; loosen per-lab only
 *     if a lesson requires it).
 *   • Resource limits: --cpus, --memory, --pids-limit.
 *   • The host Docker socket is NEVER mounted into lab containers.
 *   • The API server itself needs Docker access — that is the platform's
 *     most privileged capability. Run the API as an unprivileged user in
 *     the `docker` group (or against a socket proxy), never as root, and
 *     never expose the API host beyond localhost/reverse-proxy.
 *   • docker CLI args are passed as argv arrays (no shell interpolation);
 *     session ids are platform-generated UUIDs, not learner input.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecResult, LabDefinition, LabDriver, LabHandle, TerminalAttachment } from "./driver.ts";

const IMAGE_PREFIX = "trellis-lab-";
const WORKSPACE = "/workspace";
const CHANNEL_DIR = "/tmp/trellis";
// The instrumented bashrc ships with the PLATFORM, not with lab images: it is
// docker-cp'd into every container at create time. (Lab Dockerfiles only bake
// template/, scripts/, verify/ — instrumentation is the driver's job.)
const INSTRUMENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "instrument");

function docker(args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 60_000);
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

class DockerLabHandle implements LabHandle {
  readonly eventsFilePath = `${CHANNEL_DIR}/commands.log`;
  readonly resultsFilePath = `${CHANNEL_DIR}/test-results.json`;
  private dataCbs: Array<(chunk: Buffer) => void> = [];
  private exitCbs: Array<(code: number | null) => void> = [];
  private terminal: ReturnType<typeof spawn> | null = null;

  readonly id: string;
  readonly labId: string;
  private readonly container: string;
  private readonly def: LabDefinition;

  constructor(id: string, labId: string, container: string, def: LabDefinition) {
    this.id = id;
    this.labId = labId;
    this.container = container;
    this.def = def;
  }

  private baseEnvArgs(): string[] {
    return [
      "-e", `TRELLIS_WORKSPACE=${WORKSPACE}`,
      "-e", `TRELLIS_EVENTS_FILE=${this.eventsFilePath}`,
      "-e", `TRELLIS_RESULTS_FILE=${this.resultsFilePath}`,
      "-e", "GIT_CONFIG_NOSYSTEM=1",
      // Parity with LocalProcessDriver's constructed env: without TERM, pagers
      // degrade ("terminal is not fully functional") and curses editors break.
      "-e", "TERM=xterm-256color",
      "-w", WORKSPACE,
    ];
  }

  async initWorkspace(): Promise<void> {
    const sh = (script: string) =>
      docker(["exec", ...this.baseEnvArgs(), this.container, "bash", "-lc", script]);
    await sh(`mkdir -p ${CHANNEL_DIR} && : > ${this.eventsFilePath}`);
    const init = await sh(
      [
        `cp -r /opt/lab/template/. ${WORKSPACE}/`,
        `git init -q -b main`,
        `git -c user.email=lab@trellis.local -c user.name='Trellis Lab' add -A`,
        `git -c user.email=lab@trellis.local -c user.name='Trellis Lab' commit -qm 'Initial commit'`,
        // SIMULATED BEHAVIOR: the scripted "AI agent" change, uncommitted.
        // Optional — authoring labs ship no agent change (parity with
        // LocalProcessDriver's existsSync guard).
        `if [ -f /opt/lab/scripts/apply-ai-change.mjs ]; then node /opt/lab/scripts/apply-ai-change.mjs ${WORKSPACE}${this.def.variant?.defect ? " " + this.def.variant.defect : ""}; fi`,
      ].join(" && "),
    );
    if (init.exitCode !== 0) throw new Error(`docker workspace init failed: ${init.stderr || init.stdout}`);
  }

  attachTerminal(): TerminalAttachment {
    if (!this.terminal) {
      // `script(1)` inside the container allocates the pty, so we don't need
      // `docker exec -t` (which would require a tty on the API side).
      this.terminal = spawn(
        "docker",
        [
          "exec", "-i", ...this.baseEnvArgs(), this.container,
          "script", "-qfc", "bash --rcfile /opt/lab/instrument/trellis-bashrc.sh -i", "/dev/null",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      this.terminal.stdout!.on("data", (d: Buffer) => this.dataCbs.forEach((cb) => cb(d)));
      this.terminal.stderr!.on("data", (d: Buffer) => this.dataCbs.forEach((cb) => cb(d)));
      this.terminal.on("close", (code) => {
        this.terminal = null;
        this.exitCbs.forEach((cb) => cb(code));
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

  async exec(command: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<ExecResult> {
    const envArgs = Object.entries(opts?.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return docker(["exec", ...this.baseEnvArgs(), ...envArgs, this.container, ...command], {
      timeoutMs: opts?.timeoutMs,
    });
  }

  async readFile(path: string): Promise<string | null> {
    const res = await this.exec(["cat", path]);
    return res.exitCode === 0 ? res.stdout : null;
  }

  async reset(): Promise<void> {
    this.terminal?.kill("SIGKILL");
    this.terminal = null;
    this.dataCbs = [];
    await this.exec(["bash", "-lc", `rm -rf ${WORKSPACE}/* ${WORKSPACE}/.git ${WORKSPACE}/.gitignore ${this.resultsFilePath}`]);
    await this.initWorkspace();
  }

  async destroy(): Promise<void> {
    this.terminal?.kill("SIGKILL");
    await docker(["rm", "-f", this.container]);
  }
}

export interface DockerDriverOptions {
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
  network?: "none" | "bridge";
}

export class DockerDriver implements LabDriver {
  private readonly opts: DockerDriverOptions;
  constructor(opts: DockerDriverOptions = {}) {
    this.opts = opts;
  }

  async create(def: LabDefinition, sessionId: string): Promise<LabHandle> {
    const container = `trellis-lab-${sessionId}`;
    const image = IMAGE_PREFIX + def.labId;
    const res = await docker([
      "run", "-d",
      "--name", container,
      "--cpus", this.opts.cpus ?? "0.5",
      "--memory", this.opts.memory ?? "512m",
      "--pids-limit", String(this.opts.pidsLimit ?? 128),
      "--network", this.opts.network ?? "none",
      "--security-opt", "no-new-privileges",
      image,
      "sleep", "infinity",
    ]);
    if (res.exitCode !== 0) {
      throw new Error(`docker run failed (is the '${image}' image built?): ${res.stderr}`);
    }
    // Install the platform's shell instrumentation (see INSTRUMENT_DIR note).
    const inst = await docker(["cp", INSTRUMENT_DIR, `${container}:/opt/lab/`]);
    if (inst.exitCode !== 0) {
      await docker(["rm", "-f", container]);
      throw new Error(`failed to install instrumentation into ${container}: ${inst.stderr}`);
    }
    const handle = new DockerLabHandle(sessionId, def.labId, container, def);
    await handle.initWorkspace();
    return handle;
  }
}
