/**
 * dev — start the API and the web UI together with one command:
 *
 *   npm run dev
 *
 * Zero-dep and cross-platform (npm scripts run under cmd.exe on Windows,
 * where POSIX `&` backgrounding doesn't exist — hence a launcher instead of
 * a shell one-liner). Behavior:
 *
 * - Loads .env from the repo root into the children's environment
 *   (real environment variables always win; .env fills gaps).
 * - PORT (default 8787) is the API's port; WEB_PORT (default 5173) is the
 *   UI's. The web dev server's API_PORT proxy target is wired to the API's
 *   port automatically, so the two can never disagree (the failure mode
 *   this file exists to prevent).
 * - Output is prefixed [api]/[web]; Ctrl+C (or either child dying) stops
 *   both.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

// .env fills gaps; the real environment always wins.
const env = { ...loadDotEnv(join(ROOT, ".env")), ...process.env };
const apiPort = env.PORT || "8787";
const webPort = env.WEB_PORT || "5173";

const children = [];
let shuttingDown = false;

function start(name, command, args, extraEnv, { useShell = false } = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...env, ...extraEnv },
    // Only npm needs a shell (it's npm.cmd on Windows, and Node refuses to
    // spawn .cmd files directly). node.exe must NOT go through cmd.exe —
    // its path ("C:\Program Files\...") breaks on the unquoted space.
    shell: useShell && process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (stream, sink) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") sink.write(`[${name}] ${line}\n`);
      }
    });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`[dev] ${name} exited (${code ?? "signal"}) — stopping the other`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (process.platform === "win32") {
        // A plain kill() only reaches the immediate child (the npm shell),
        // orphaning vite/node underneath — taskkill /T fells the tree.
        spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        c.kill();
      }
    } catch {
      /* already gone */
    }
  }
  // Give children a moment to release ports before we exit.
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// --lan (npm run dev:lan): bind the WEB server to the machine's private-LAN
// address so other devices on the home network can use the app. The API stays
// on loopback — LAN clients reach it through the web server's /api and /ws
// proxies, so the unauthenticated-by-default admin surface is never exposed.
// Only the REAL LAN interface is bound (192.168.* by default; TRELLIS_LAN_HOST
// overrides) — virtual adapters (Hyper-V/WSL 172.*) are neither bound nor
// advertised. Note: in --lan mode use the LAN URL on this machine too;
// localhost is deliberately not bound.
const lan = process.argv.includes("--lan") || env.TRELLIS_LAN === "1";
const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);
const lanHost = lan ? (env.TRELLIS_LAN_HOST || lanIps.find((ip) => ip.startsWith("192.168.")) || lanIps[0] || "0.0.0.0") : null;
// The sim-test/recorder preflight fetches TRELLIS_WEB_URL from the API process;
// with the web server bound to the LAN address, localhost would fail.
const webUrl = lan ? `http://${lanHost === "0.0.0.0" ? "localhost" : lanHost}:${webPort}` : `http://localhost:${webPort}`;

console.log(`[dev] api → http://127.0.0.1:${apiPort} · web → ${webUrl} (proxying /api to :${apiPort})`);
if (lan) console.log(`[dev] LAN mode: web bound to ${lanHost} — share ${webUrl} (localhost is not bound)`);
start("api", process.execPath, [join(ROOT, "apps", "api", "src", "server.ts")], { PORT: apiPort, TRELLIS_WEB_URL: webUrl });
start("web", "npm", ["--workspace", "@trellis/web", "run", "dev"], { PORT: webPort, API_PORT: apiPort, ...(lan ? { WEB_HOST: lanHost } : {}) }, { useShell: true });
