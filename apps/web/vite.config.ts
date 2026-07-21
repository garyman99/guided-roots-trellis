import { defineConfig, createLogger, type LogErrorOptions } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the web app talks to the API without CORS ceremony.
// API_PORT must match the PORT the api server was started with (default
// 8787) — a hardcoded target here silently broke the UI whenever the api
// landed elsewhere (e.g. a second session, or 8787 briefly occupied).
const apiPort = Number(process.env.API_PORT) || 8787;

// A client that hangs up an in-flight request is NORMAL traffic, not a
// failure — the browser aborting an rrweb DOM-snapshot upload when the page
// navigates, a closed terminal websocket. Vite logs these resets at ERROR
// level ("http/ws proxy error: … ECONNRESET/ECONNABORTED/EPIPE"), which floods
// the log and trains you to ignore your own errors. Suppress ONLY those benign
// client-disconnect codes on proxy requests; a real proxy failure — the API
// being down surfaces as ECONNREFUSED — still logs loudly. (First suppression
// prints one info line so the silence is explained, not mysterious.)
const CLIENT_DISCONNECT = new Set(["ECONNRESET", "ECONNABORTED", "EPIPE"]);
const baseLogger = createLogger();
let announcedSuppression = false;
const logger = {
  ...baseLogger,
  error(msg: string, options?: LogErrorOptions) {
    const code = (options?.error as (Error & { code?: string }) | undefined)?.code;
    if (code && CLIENT_DISCONNECT.has(code) && /proxy/i.test(msg)) {
      if (!announcedSuppression) {
        announcedSuppression = true;
        baseLogger.info(
          "[proxy] suppressing benign client-disconnect resets (ECONNRESET/ECONNABORTED/EPIPE) on proxied requests — " +
            "normal when the page navigates mid-upload. Real proxy failures (e.g. API down → ECONNREFUSED) still log.",
        );
      }
      return;
    }
    baseLogger.error(msg, options);
  },
};

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    // WEB_HOST=0.0.0.0 exposes the dev server on the LAN (npm run dev:lan).
    // The API keeps listening on loopback — LAN clients reach it through this
    // server's /api and /ws proxies, so only this port is ever exposed.
    host: process.env.WEB_HOST || undefined,
    // PORT lets a second session run its own dev server beside 5173.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
