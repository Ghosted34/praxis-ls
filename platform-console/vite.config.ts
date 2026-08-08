import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The console is served at the ROOT of the admin host in production, so base "/".
// Dev: `npm run dev` runs Vite on :5174 and proxies /api to the Node API. Platform
// routes ignore the Host header (they're not tenant-scoped), so — unlike the tenant
// client — no Host rewrite is needed here.
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8080";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      // Socket.IO — Error Command Center live feed (spec §2.1).
      //
      // WITHOUT THIS ENTRY THE FEED IS PERMANENTLY DEGRADED IN DEV, and it
      // fails in a way that looks like working software: the console dials
      // ws://localhost:5174/socket.io, Vite has no socket.io server, the
      // handshake is refused, and useErrorStream does exactly what it was
      // designed to do — falls back to polling and shows "📡 Polling". Nothing
      // is red. Acceptance criteria #1 and #8 are both quietly unmet, and the
      // one thing anyone would have tested to prove realtime works (open the
      // page, fire an error, watch it appear) still passes, ten seconds late.
      //
      // `ws: true` is the whole point: socket.io's first request is HTTP
      // polling but it upgrades, and a proxy that forwards the GET without
      // handling the Upgrade header connects once and then drops.
      "/socket.io": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
