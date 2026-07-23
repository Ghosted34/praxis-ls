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
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
