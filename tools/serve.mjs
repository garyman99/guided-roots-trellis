/**
 * serve — single, supervisable production-ish process: serve the already-built
 * web app AND the API from one Node process, so an overnight autopilot run
 * survives an interactive dev session (vite dev + api, two processes) dying.
 *
 *   npm run serve            (builds apps/web first, then runs this)
 *
 * Mirrors tools/dev.mjs's env/spawn wiring, but starts only the API — with
 * TRELLIS_STATIC_DIR pointed at apps/web/dist so apps/api/src/staticServe.ts
 * serves the SPA. No new deps; Windows-safe (spawns node.exe directly, no
 * shell — see dev.mjs's comment on why node must not go through cmd.exe).
 *
 * See tools/install-service.ps1 for a Windows Scheduled Task recipe that runs
 * `npm run serve` at startup and restarts it on failure.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "web", "dist");

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

// .env fills gaps; the real environment always wins (same rule as dev.mjs).
const env = { ...loadDotEnv(join(ROOT, ".env")), ...process.env };
const port = env.PORT || "8787";

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`[serve] ${DIST} has no index.html — build the web app first ("npm run build -w apps/web").`);
  process.exit(1);
}

console.log(`[serve] http://127.0.0.1:${port} (API + built web app from apps/web/dist)`);

const child = spawn(process.execPath, [join(ROOT, "apps", "api", "src", "server.ts")], {
  cwd: ROOT,
  env: { ...env, PORT: port, TRELLIS_STATIC_DIR: DIST },
  stdio: "inherit",
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
