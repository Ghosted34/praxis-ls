import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath rather than __dirname (unavailable in an ESM config) or
// import.meta.dirname (Node 20.11+; .nvmrc pins 20, so don't assume the patch).
const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config (audit F15 — the client had ZERO tests against ~50 backend Jest
 * suites, on a frontend that drives journal entries, payroll runs and God-Mode
 * purges).
 *
 * Separate from vite.config.ts on purpose: that file carries the PWA plugin and
 * a manualChunks strategy, neither of which should run for tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      // Mirrors vite.config.ts: packages/shared holds the Zod schemas the
      // Express API validates with, so the form tests exercise the SAME schema
      // objects the backend parses with rather than a copy (audit F12).
      "@shared": path.resolve(dirname, "../packages/shared"),
      // ONE zod instance. packages/shared is CommonJS: Node's own loader
      // resolves its `require("zod")` from the repo root, and no bundler flag
      // changes that (dedupe and ssr.noExternal both leave CJS interop alone).
      // So the client is pointed at that same root copy — two copies would make
      // `instanceof z.ZodType` false across the boundary and hand zodResolver a
      // schema from the "wrong" zod. This requires the root install; CI's
      // frontend job does it explicitly for the client.
      zod: path.resolve(dirname, "../node_modules/zod"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
