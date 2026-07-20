/**
 * Static serving for the built web app (autonomous-pipeline plan §3.3 "Durable
 * host", slice C1). Off by default; enabled only when TRELLIS_STATIC_DIR is
 * set (absolute or repo-relative path to apps/web/dist). Lets one process
 * serve the SPA + the API, so an overnight autopilot run survives an
 * interactive session (vite dev + api) dying.
 *
 * TRELLIS_STATIC_DIR is read LAZILY (inside tryServeStatic, not at module top
 * level) — same reason as server.ts's runsDir()/publishedDir(): a test must be
 * able to set it in its body after a static import without hitting the
 * ESM-import-hoisting hazard (see server.ts's comment on that).
 *
 * Path traversal defense mirrors packages/course-architect/src/artifacts.ts's
 * `abs()`: resolve the candidate path and verify it stays inside the static
 * root via `relative()`, not by string-matching "..". The request pathname is
 * also percent-decoded first — the WHATWG URL parser already collapses a
 * *literal* ".." segment before request.url reaches us, so the defense that
 * actually matters here is against percent-encoded traversal (e.g.
 * "/assets/%2e%2e/%2e%2e/secret").
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function staticRoot(): string | null {
  const dir = process.env.TRELLIS_STATIC_DIR;
  if (!dir) return null;
  return resolve(dir); // repo-relative or absolute — resolve() handles both
}

/** Resolve `pathname` under `root`, refusing anything that escapes it. */
function safeResolve(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  const abs = resolve(root, "." + decoded); // pathname always starts with "/"
  const rel = relative(root, abs);
  if (rel.startsWith("..") || resolve(rel) === rel) return null; // escaped the root
  return abs;
}

function send404(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: "not found" }));
}

function sendFile(res: ServerResponse, absPath: string, isIndex: boolean, isAsset: boolean): void {
  const ext = extname(absPath).toLowerCase();
  const cacheControl = isIndex ? "no-cache" : isAsset ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "cache-control": cacheControl,
  });
  createReadStream(absPath).pipe(res);
}

/**
 * Serve a request from the built web app. Returns true if the request was
 * fully handled (caller must not continue routing) — false to fall through
 * to the API's own 404.
 */
export function tryServeStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const root = staticRoot();
  if (!root) return false;
  if (pathname.startsWith("/api") || pathname.startsWith("/ws/")) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const isAsset = pathname.startsWith("/assets/");
  const wantsIndex = pathname === "/" || pathname === "/index.html";
  const abs = safeResolve(root, wantsIndex ? "/index.html" : pathname);
  if (!abs) return send404(res), true;

  if (existsSync(abs) && statSync(abs).isFile()) {
    sendFile(res, abs, wantsIndex, isAsset);
    return true;
  }

  // Unknown extension-less path (SPA route like /home, /lab) → index.html.
  // A path WITH an extension that doesn't exist is a genuine 404.
  if (extname(pathname) !== "") return send404(res), true;

  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) return false; // no build present — let the caller 404
  sendFile(res, indexPath, true, false);
  return true;
}
