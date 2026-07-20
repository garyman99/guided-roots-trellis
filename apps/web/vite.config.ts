import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the web app talks to the API without CORS ceremony.
// API_PORT must match the PORT the api server was started with (default
// 8787) — a hardcoded target here silently broke the UI whenever the api
// landed elsewhere (e.g. a second session, or 8787 briefly occupied).
const apiPort = Number(process.env.API_PORT) || 8787;

export default defineConfig({
  plugins: [react()],
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
