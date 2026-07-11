import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the web app talks to the API on 8787 without CORS ceremony.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
