/**
 * free-ports — kill whatever is still listening on the Trellis dev ports.
 *
 *   node free-ports.mjs            # clears the API + web ports
 *   node free-ports.mjs 5175 9229  # ...plus any extra ports you name
 *   npm run free-ports             # same, via package.json
 *
 * Cross-platform: Windows (netstat + taskkill) and macOS/Linux (lsof + kill).
 * Ports come from .env (PORT / WEB_PORT) like tools/dev.mjs, defaulting to
 * 8787 (API) and 5173 (web) — plus a few above the web port, since Vite walks
 * upward (5174, 5175, …) when 5173 is taken. It prints what it kills.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";

/** PORT / WEB_PORT from .env (real env wins), matching tools/dev.mjs. */
function envPorts() {
  const out = {};
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*(PORT|WEB_PORT)\s*=\s*(\d+)/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  }
  return out;
}

const env = envPorts();
const apiPort = Number(process.env.PORT || env.PORT || 8787);
const webPort = Number(process.env.WEB_PORT || env.WEB_PORT || 5173);
const extra = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
// Vite's autoPort walks upward from webPort — clear a small range so a second
// stale UI (on 5174/5175) doesn't survive.
const ports = [...new Set([apiPort, webPort, webPort + 1, webPort + 2, webPort + 3, ...extra])];

/** Build a port → Set(pid) map of LISTENING sockets in one shell call (Windows). */
function windowsListenMap() {
  const map = new Map();
  let out = "";
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return map;
  }
  for (const line of out.split("\n")) {
    // e.g.  TCP    127.0.0.1:8787   0.0.0.0:0   LISTENING   12345
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (!m) continue;
    const port = Number(m[1]);
    const pid = m[2];
    if (pid === "0") continue;
    if (!map.has(port)) map.set(port, new Set());
    map.get(port).add(pid);
  }
  return map;
}

function pidsOnPort(port, winMap) {
  if (isWin) return [...(winMap.get(port) ?? [])];
  try {
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return []; // nothing listening
  }
}

function kill(pid) {
  try {
    // /T also fells child processes (vite/node spawned under npm).
    execSync(isWin ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const winMap = isWin ? windowsListenMap() : new Map();
let freed = 0;
for (const port of ports) {
  const pids = pidsOnPort(port, winMap);
  if (pids.length === 0) {
    console.log(`port ${port}: free`);
    continue;
  }
  for (const pid of pids) {
    const ok = kill(pid);
    if (ok) freed++;
    console.log(`port ${port}: ${ok ? "killed" : "could not kill (try an elevated shell)"} PID ${pid}`);
  }
}
console.log(freed ? `\nFreed ${freed} process(es) — 'npm run dev' should start cleanly now.` : "\nNothing to kill; all ports were already free.");
